/**
 * [grok.ts](../../src/content/grok.ts) 의 **묻는 빈도** 규칙.
 *
 * 실제 요청은 가짜 길로 바꿔 끼운다. 여기서 재는 것은 같은 글을 두 번 묻지 않는지,
 * 사라진 카드의 몫을 묻지 않는지, 막혔을 때 물러서는지다.
 */
import { describe, expect, it } from 'vitest'
import {
  createGrokClient,
  type GrokOutcome,
  type GrokStore,
  type GrokTransport,
} from '../../src/content/grok'

function fakeTransport(answer: (tweetId: string) => GrokOutcome) {
  const asked: string[] = []
  const transport: GrokTransport = async (tweetId) => {
    asked.push(tweetId)
    return answer(tweetId)
  }
  return { asked, transport }
}

const client = (transport: GrokTransport, now = () => 0) =>
  createGrokClient({ transport, spacingMs: 0, now, sleep: async () => {} })

describe('createGrokClient', () => {
  it('받은 번역을 돌려주고 기억한다', async () => {
    const { asked, transport } = fakeTransport((id) => ({ ok: true, text: `번역 ${id}` }))
    const grok = client(transport)

    await expect(grok.request('1', 'ko').promise).resolves.toBe('번역 1')
    expect(grok.cached('1', 'ko')).toBe('번역 1')
    await expect(grok.request('1', 'ko').promise).resolves.toBe('번역 1')
    expect(asked).toEqual(['1'])
  })

  it('같은 글을 동시에 부탁해도 한 번만 묻는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = client(transport)

    const [a, b] = [grok.request('1', 'ko'), grok.request('1', 'ko')]
    await expect(Promise.all([a.promise, b.promise])).resolves.toEqual(['번역', '번역'])
    expect(asked).toEqual(['1'])
  })

  it('차례가 오기 전에 사라진 카드의 몫은 묻지 않는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = client(transport)

    const first = grok.request('1', 'ko')
    const gone = grok.request('2', 'ko')
    gone.cancel()
    await first.promise
    await expect(gone.promise).resolves.toBeNull()
    expect(asked).toEqual(['1'])
    // 묻지 않았으니 기억하지도 않는다 — 다시 보이면 그때 묻는다.
    expect(grok.cached('2', 'ko')).toBeUndefined()
  })

  it('같은 글을 보는 카드가 하나라도 남아 있으면 묻는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = client(transport)

    const first = grok.request('1', 'ko')
    const a = grok.request('2', 'ko')
    const b = grok.request('2', 'ko')
    a.cancel()
    await first.promise
    await expect(b.promise).resolves.toBe('번역')
    expect(asked).toEqual(['1', '2'])
  })

  it('막히면 풀릴 때까지 묻지 않고, 그 글을 못 옮기는 것으로 기억하지도 않는다', async () => {
    let clock = 0
    const { asked, transport } = fakeTransport(() => ({
      ok: false,
      reason: '요청이 너무 많습니다',
      limited: true,
      retryAt: 120_000,
    }))
    const grok = client(transport, () => clock)

    await expect(grok.request('1', 'ko').promise).resolves.toBeNull()
    expect(grok.cached('1', 'ko')).toBeUndefined()

    await expect(grok.request('2', 'ko').promise).resolves.toBeNull()
    expect(asked).toEqual(['1'])

    clock = 120_001
    await grok.request('3', 'ko').promise
    expect(asked).toEqual(['1', '3'])
  })

  it('막히는 순간 줄에 서 있던 것도 기다리게 두지 않는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: '많음', limited: true }))
    const grok = client(transport)

    const all = ['1', '2', '3'].map((id) => grok.request(id, 'ko').promise)
    await expect(Promise.all(all)).resolves.toEqual([null, null, null])
    expect(asked).toEqual(['1'])
  })

  it('x.com 이 거절한 글(4xx)은 다시 묻지 않는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: 'HTTP 400', status: 400 }))
    const grok = client(transport)

    await grok.request('1', 'ko').promise
    expect(grok.cached('1', 'ko')).toBeNull()
    await grok.request('1', 'ko').promise
    expect(asked).toEqual(['1'])
  })

  /*
   * 시간 초과 · 서버 오류 · 빈 응답은 그때 사정이다. 그 글을 못 옮기는 것으로 기억하면
   * 탭을 닫을 때까지 그 글은 원문으로 남았다.
   */
  it('일시적인 실패는 그 글을 못 옮기는 것으로 기억하지 않는다', async () => {
    let fail = true
    const { asked, transport } = fakeTransport(() =>
      fail ? { ok: false, reason: '응답하지 않았습니다' } : { ok: true, text: '번역' },
    )
    const grok = client(transport)

    await expect(grok.request('1', 'ko').promise).resolves.toBeNull()
    expect(grok.cached('1', 'ko')).toBeUndefined()

    fail = false
    await expect(grok.request('1', 'ko').promise).resolves.toBe('번역')
    expect(asked).toEqual(['1', '1'])
  })

  /*
   * 예전에는 연달아 다섯 번 실패하면 탭을 닫을 때까지 묻지 않았다. 지나가는 장애에도
   * 그 뒤로 들어온 글이 전부 원문으로 남았다.
   */
  it('연달아 실패하면 잠시 쉬었다가 다시 묻는다', async () => {
    let clock = 0
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: 'HTTP 503', status: 503 }))
    const grok = client(transport, () => clock)

    for (const id of ['1', '2', '3', '4', '5']) await grok.request(id, 'ko').promise
    await expect(grok.request('6', 'ko').promise).resolves.toBeNull()
    expect(asked).toEqual(['1', '2', '3', '4', '5'])
    expect(grok.nextAttemptIn()).toBeGreaterThan(0)

    clock += grok.nextAttemptIn()
    await grok.request('6', 'ko').promise
    expect(asked).toContain('6')
  })

  it('막혀 있지 않으면 바로 다시 물어도 된다고 알린다', () => {
    const { transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    expect(client(transport).nextAttemptIn()).toBe(0)
  })

  it('한 번이라도 받으면 실패 횟수를 다시 센다', async () => {
    const { asked, transport } = fakeTransport((id) =>
      id === 'ok' ? { ok: true, text: '번역' } : { ok: false, reason: 'HTTP 500' },
    )
    const grok = client(transport)

    for (const id of ['1', '2', '3', '4', 'ok', '5', '6', '7', '8']) {
      await grok.request(id, 'ko').promise
    }
    await grok.request('9', 'ko').promise
    expect(asked).toContain('9')
  })

  it('1분 상한을 넘기면 자리가 날 때까지 기다린다', async () => {
    let clock = 0
    const waits: number[] = []
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = createGrokClient({
      transport,
      spacingMs: 0,
      perMinute: 2,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms)
        clock += ms
      },
    })

    await Promise.all(['1', '2', '3'].map((id) => grok.request(id, 'ko').promise))
    expect(asked).toEqual(['1', '2', '3'])
    expect(waits).toEqual([60_000])
  })
})

describe('쟁여둔 번역', () => {
  function memoryStore(initial: Record<string, string> = {}) {
    const kept = new Map(Object.entries(initial))
    const store: GrokStore = {
      load: async (key) => kept.get(key) ?? null,
      save: async (key, text) => {
        kept.set(key, text)
      },
    }
    return { kept, store }
  }

  it('쟁여둔 번역이 있으면 묻지 않는다 — 새로고침 뒤에도 다시 묻지 않게', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '새 번역' }))
    const { store } = memoryStore({ 'ko:1': '쟁여둔 번역' })
    const grok = createGrokClient({ transport, store, spacingMs: 0, sleep: async () => {} })

    await expect(grok.request('1', 'ko').promise).resolves.toBe('쟁여둔 번역')
    expect(asked).toEqual([])
    expect(grok.cached('1', 'ko')).toBe('쟁여둔 번역')
  })

  it('받은 번역을 쟁여둔다', async () => {
    const { transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const { kept, store } = memoryStore()
    const grok = createGrokClient({ transport, store, spacingMs: 0, sleep: async () => {} })

    await grok.request('1', 'ko').promise
    expect(kept.get('ko:1')).toBe('번역')
  })

  it('못 옮긴다는 판정은 쟁여두지 않는다 — 그때 사정일 수 있다', async () => {
    const { transport } = fakeTransport(() => ({ ok: false, reason: 'HTTP 500' }))
    const { kept, store } = memoryStore()
    const grok = createGrokClient({ transport, store, spacingMs: 0, sleep: async () => {} })

    await grok.request('1', 'ko').promise
    expect(kept.size).toBe(0)
  })

  it('막혀 있는 동안에도 쟁여둔 것은 꺼내 준다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: '많음', limited: true }))
    const { store } = memoryStore({ 'ko:2': '쟁여둔 번역' })
    const grok = createGrokClient({ transport, store, spacingMs: 0, now: () => 0, sleep: async () => {} })

    await grok.request('1', 'ko').promise
    await expect(grok.request('2', 'ko').promise).resolves.toBe('쟁여둔 번역')
    expect(asked).toEqual(['1'])
  })

  it('저장소를 못 열면 그냥 묻는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const store: GrokStore = {
      load: async () => {
        throw new Error('blocked')
      },
      save: async () => {
        throw new Error('blocked')
      },
    }
    const grok = createGrokClient({ transport, store, spacingMs: 0, sleep: async () => {} })

    await expect(grok.request('1', 'ko').promise).resolves.toBe('번역')
    expect(asked).toEqual(['1'])
  })
})

describe('지나간 카드의 몫', () => {
  /** 기다리는 중인 sleep 을 손으로 깨운다. 깨우면 그만큼 시계가 간다. */
  function manualClock() {
    let clock = 0
    let wake: () => void = () => {}
    return {
      now: () => clock,
      sleep: (ms: number) =>
        new Promise<void>((done) => {
          wake = () => {
            clock += ms
            done()
          }
        }),
      wake: () => wake(),
    }
  }
  const settle = () => new Promise((done) => setTimeout(done, 0))

  it('상한에 걸려 기다리는 동안 지나간 카드의 몫은 묻지 않고 지금 보이는 글을 묻는다', async () => {
    // 내려 읽다 맨 위로 돌아간 경우. 지나간 카드가 줄 맨 앞에서 차례를 쥐고 있으면
    // 새로 보이는 글이 그 뒤로 밀려 한참 늦는다.
    const time = manualClock()
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = createGrokClient({ transport, spacingMs: 0, perMinute: 1, ...time })

    await grok.request('1', 'ko').promise
    const passed = grok.request('2', 'ko')
    await settle()
    passed.cancel()
    const seen = grok.request('3', 'ko')
    await settle()
    time.wake()

    await expect(seen.promise).resolves.toBe('번역')
    await expect(passed.promise).resolves.toBeNull()
    expect(asked).toEqual(['1', '3'])
  })

  it('줄에 선 채 지나갔다가 다시 보이면 한 번만 묻는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: true, text: '번역' }))
    const grok = client(transport)

    const first = grok.request('1', 'ko')
    const left = grok.request('2', 'ko')
    left.cancel()
    const back = grok.request('2', 'ko')
    await first.promise
    await expect(back.promise).resolves.toBe('번역')
    expect(asked).toEqual(['1', '2'])
  })
})
