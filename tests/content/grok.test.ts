/**
 * [grok.ts](../../src/content/grok.ts) 의 **묻는 빈도** 규칙.
 *
 * 실제 요청은 가짜 길로 바꿔 끼운다. 여기서 재는 것은 같은 글을 두 번 묻지 않는지,
 * 사라진 카드의 몫을 묻지 않는지, 막혔을 때 물러서는지다.
 */
import { describe, expect, it } from 'vitest'
import { createGrokClient, type GrokOutcome, type GrokTransport } from '../../src/content/grok'

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

  it('못 옮기는 글은 다시 묻지 않는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: 'HTTP 400' }))
    const grok = client(transport)

    await grok.request('1', 'ko').promise
    expect(grok.cached('1', 'ko')).toBeNull()
    await grok.request('1', 'ko').promise
    expect(asked).toEqual(['1'])
  })

  it('연달아 실패하면 이 탭에서는 그만 묻는다', async () => {
    const { asked, transport } = fakeTransport(() => ({ ok: false, reason: 'HTTP 404' }))
    const grok = client(transport)

    for (const id of ['1', '2', '3', '4', '5']) await grok.request(id, 'ko').promise
    await expect(grok.request('6', 'ko').promise).resolves.toBeNull()
    expect(asked).toEqual(['1', '2', '3', '4', '5'])
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
