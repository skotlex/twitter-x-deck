/**
 * [collector.ts](../../src/content/collector.ts) 의 강제 갱신 사다리를 잰다.
 *
 * 여기서 막으려는 회귀는 하나다 — **같은 목록을 다시 받은 것을 성공으로 세던 것.**
 * 이미 열려 있는 홈을 다시 두드리면 x.com 은 방금 준 것과 똑같은 목록을 한 번 더
 * 준다. 그걸 성공으로 읽으면 사다리가 첫 칸에서만 되감기고, 실제로 새 목록을
 * 받아오는 마지막 칸(탭 튕기기)까지 영영 올라가지 못한다. 추천 컬럼이 첫 적재
 * 뒤로 같은 글만 들고 있던 것이 이 자리였다.
 *
 * x.com 이 실제로 어떤 목록을 돌려주는지는 여기서 잴 수 없다. 재는 것은 수집기가
 * **무엇을 근거로 다음 수단으로 넘어가는가** 뿐이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL, type CapturedPayload, type DeletedMessage, type FrameMessage } from '../../src/core/messages'
import type { Settings } from '../../src/core/settings'
import { startCollector, timelineSignature, type CollectorHandle } from '../../src/content/collector'

/**
 * 수집기는 뜨자마자 설정을 읽고 변경을 구독한다. chrome 이 없으면 그 자리에서 터진다.
 * `stored` 로 넘긴 값이 그대로 저장돼 있던 설정이 된다.
 */
function stubChrome(stored: Partial<Settings> = {}): void {
  const area = { get: async () => ({ 'x-deck:settings': stored }), set: async () => {} }
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: area,
      local: area,
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
}

/** 수집기가 설정을 다 읽을 때까지 마이크로태스크를 흘려보낸다. */
async function settle(): Promise<void> {
  for (let step = 0; step < 5; step += 1) await Promise.resolve()
}

/** 홈 화면 최소 DOM. 탭 목록과 사이드바 홈 링크만 있으면 사다리가 다 돈다. */
function renderHome(): void {
  document.body.innerHTML = `
    <nav><a href="/home">홈</a></nav>
    <div data-testid="primaryColumn">
      <div role="tablist">
        <div role="tab" aria-selected="true">추천</div>
        <div role="tab" aria-selected="false">팔로우 중</div>
      </div>
    </div>
  `
}

/** 타임라인 응답 하나. `ids` 가 같으면 같은 목록이다. */
function timelineBody(ids: string[]): string {
  const entries = ids.map((id) => `{"entryId":"tweet-${id}","content":{}}`)
  // 커서와 광고는 같은 목록이어도 매번 값이 달라진다 — 지문에서 빠지는지 함께 잰다.
  entries.push(`{"entryId":"cursor-bottom-${Math.random()}"}`)
  entries.push(`{"entryId":"promoted-tweet-${Math.random()}"}`)
  return `{"data":{"home":{"home_timeline_urt":{"instructions":[{"entries":[${entries.join(',')}]}]}}}}`
}

/** 인터셉터가 응답을 잡은 것처럼 같은 문서 안에서 메시지를 띄운다. */
function capture(body: string): void {
  const payload: CapturedPayload = {
    channel: CHANNEL,
    type: 'captured',
    operation: 'HomeTimeline',
    url: 'https://x.com/i/api/graphql/abc/HomeTimeline',
    body,
  }
  const event = new MessageEvent('message', { data: payload })
  Object.defineProperty(event, 'source', { value: window })
  window.dispatchEvent(event)
}

describe('timelineSignature — 같은 목록인지 가리는 지문', () => {
  it('항목이 같으면 커서·광고가 달라도 같은 지문이다', () => {
    expect(timelineSignature(timelineBody(['1', '2']))).toBe(
      timelineSignature(timelineBody(['1', '2'])),
    )
  })

  it('항목이 하나만 달라도 다른 지문이다', () => {
    expect(timelineSignature(timelineBody(['1', '2']))).not.toBe(
      timelineSignature(timelineBody(['3', '2'])),
    )
  })

  it('뽑을 항목이 없으면 null 이다 — 부르는 쪽이 새 목록으로 치게 한다', () => {
    expect(timelineSignature('{"globalObjects":{"tweets":{}}}')).toBeNull()
  })
})

let messages: (FrameMessage | DeletedMessage)[]

/** 지금까지 알린 '강제 갱신 n/4: 수단' 문구만 차례대로 뽑는다. */
const rungs = (): string[] =>
  messages
    .filter((m) => m.type === 'status' && typeof m.message === 'string')
    .map((m) => (m as { message: string }).message)
    .filter((text) => text.startsWith('강제 갱신'))

describe('강제 갱신 사다리', () => {
  let collector: CollectorHandle

  beforeEach(() => {
    stubChrome()
    vi.useFakeTimers()
    window.history.pushState({}, '', '/home')
    renderHome()
    messages = []
    collector = startCollector(['foryou'], (message) => messages.push(message))
    // 첫 목록. 여기서부터 '같은 목록인지' 를 잴 수 있다.
    capture(timelineBody(['1', '2', '3']))
  })

  afterEach(() => {
    collector.dispose()
    vi.useRealTimers()
  })

  it('같은 목록만 돌아오면 다음 수단으로 올라간다', () => {
    collector.command('foryou', 'refresh')
    expect(rungs()).toEqual(['강제 갱신 1/4: 홈 링크 재클릭'])

    // 두드릴 때마다 x.com 이 방금 준 것과 똑같은 목록을 돌려주는 상황.
    for (let step = 0; step < 3; step += 1) {
      capture(timelineBody(['1', '2', '3']))
      vi.advanceTimersByTime(4_000)
    }

    expect(rungs()).toEqual([
      '강제 갱신 1/4: 홈 링크 재클릭',
      '강제 갱신 2/4: 탭 재클릭',
      '강제 갱신 3/4: 단축키',
      '강제 갱신 4/4: 탭 튕기기',
    ])
  })

  it('새 목록이 오면 거기서 멈춘다', () => {
    collector.command('foryou', 'refresh')
    // 첫 수단이 통했다 — 목록이 바뀌었다.
    capture(timelineBody(['4', '5', '6']))
    vi.advanceTimersByTime(10_000)

    expect(rungs()).toEqual(['강제 갱신 1/4: 홈 링크 재클릭'])
  })

  it('사다리를 다 밟아도 응답은 오고 있었으면 문서를 다시 띄우지 않는다', () => {
    collector.command('foryou', 'refresh')
    for (let step = 0; step < 5; step += 1) {
      capture(timelineBody(['1', '2', '3']))
      vi.advanceTimersByTime(4_000)
    }

    // 최상위 문서에서는 재적재 대신 이 문구가 나간다. 나왔다면 사다리 끝을
    // '고장' 으로 읽었다는 뜻이다.
    const notes = messages
      .filter((m) => m.type === 'status' && typeof m.message === 'string')
      .map((m) => (m as { message: string }).message)
    expect(notes).not.toContain('되살리지 못함 — 탭 새로고침이 필요합니다')
  })
})

/**
 * 컬럼별 절전은 **그 컬럼을 맡은 수집기가** 지켜야 한다.
 *
 * 전체 절전은 모든 수집기가 함께 잠들어서 어디서도 두드리지 않는다. 컬럼별은
 * 다르다 — 옆 컬럼은 깨어 있으므로, 잠든 컬럼의 수집기 하나가 스스로 멈추지 않으면
 * 아무 것도 달라지지 않는다.
 */
describe('컬럼별 절전', () => {
  let collector: CollectorHandle | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    window.history.pushState({}, '', '/home')
    renderHome()
    messages = []
  })

  afterEach(() => {
    collector?.dispose()
    collector = null
    vi.useRealTimers()
  })

  /** 유휴 갱신 간격(기본 2 분)을 훌쩍 넘겨 사다리가 돌 시간을 준다. */
  const idleFor = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('멈춰둔 컬럼은 저절로 두드리지 않는다', async () => {
    stubChrome({ powerSaveColumns: ['foryou'] })
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
    capture(timelineBody(['1', '2', '3']))

    await idleFor(300_000)

    expect(rungs()).toEqual([])
  })

  it('멈추지 않은 컬럼은 그대로 두드린다', async () => {
    stubChrome({ powerSaveColumns: ['following'] })
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
    capture(timelineBody(['1', '2', '3']))

    await idleFor(300_000)

    expect(rungs().length).toBeGreaterThan(0)
  })

  /** 절전이 막는 것은 저절로 도는 일이지 사람이 누른 것이 아니다. */
  it('멈춰뒀어도 사람이 누른 새로고침은 처리한다', async () => {
    stubChrome({ powerSaveColumns: ['foryou'] })
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
    capture(timelineBody(['1', '2', '3']))

    collector.command('foryou', 'refresh')

    expect(rungs()).toEqual(['강제 갱신 1/4: 홈 링크 재클릭'])
  })
})
