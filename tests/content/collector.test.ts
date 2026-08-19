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

/**
 * 인터셉터가 응답을 잡은 것처럼 같은 문서 안에서 메시지를 띄운다.
 * operation 이름이 곧 귀속이다 — 기본값은 추천, `HomeLatestTimeline` 이면 팔로잉.
 */
function capture(body: string, operation = 'HomeTimeline'): void {
  const payload: CapturedPayload = {
    channel: CHANNEL,
    type: 'captured',
    operation,
    url: `https://x.com/i/api/graphql/abc/${operation}`,
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

  it('사다리를 다 밟아도 응답은 오고 있었으면 컬럼을 넘기지 않는다', () => {
    collector.command('foryou', 'refresh')
    for (let step = 0; step < 5; step += 1) {
      capture(timelineBody(['1', '2', '3']))
      vi.advanceTimersByTime(4_000)
    }

    // 넘김 신고가 나갔다면 사다리 끝을 '고장' 으로 읽었다는 뜻이다. 목록이 그대로인
    // 것은 문서가 죽은 게 아니라 x.com 에 내놓을 새 글이 없는 것이다.
    expect(messages.some((m) => m.type === 'stalled')).toBe(false)
  })
})

/**
 * 최상위 문서는 다시 띄울 수 없다 — 그 위에 덱이 얹혀 있다.
 *
 * 그렇다고 손을 놓으면 그 컬럼은 사람이 탭을 새로고침할 때까지 죽어 있다. 이
 * 문서의 x.com 이 세션째로 막히면(로그가 `viewer_context` 500 으로 뒤덮이는 그
 * 상태) 실제로 그렇게 됐다. 되살리는 대신 **컬럼을 놓겠다고 알리고**, 덱이 숨은
 * 프레임에 넘기게 한다.
 */
describe('되살리지 못하면 컬럼을 넘긴다', () => {
  let collector: CollectorHandle

  beforeEach(async () => {
    stubChrome()
    vi.useFakeTimers()
    window.history.pushState({}, '', '/home')
    renderHome()
    messages = []
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
  })

  afterEach(() => {
    collector.dispose()
    vi.useRealTimers()
  })

  const stalled = (): string[] =>
    messages.filter((m) => m.type === 'stalled').map((m) => m.role)

  it('응답이 한 건도 없으면 사다리 끝에서 넘긴다', async () => {
    // 사다리 네 칸을 다 밟고 다음 차례가 올 때까지 둔다.
    await vi.advanceTimersByTimeAsync(400_000)

    expect(stalled()).toContain('foryou')
  })

  it('넘긴 뒤에는 더 두드리지 않는다 — 프레임과 엉키면 안 된다', async () => {
    await vi.advanceTimersByTimeAsync(400_000)
    // 덱이 신고를 받고 이 문서에서 손을 뗀다.
    collector.setKinds([])
    messages = []

    await vi.advanceTimersByTimeAsync(400_000)

    expect(rungs()).toEqual([])
    expect(messages).toEqual([])
  })
})

/**
 * **조용한지는 새 목록으로 잰다 — 응답이 왔는지로 재면 안 된다.**
 *
 * 우리는 x.com 의 폴링이 계속 돌도록 문서를 늘 '보임' 으로 위장해 둔다. 그래서
 * 두드리지 않아도 응답은 꾸준히 들어온다. 추천은 알고리즘 타임라인이라 그 응답이
 * 늘 같은 목록인데, 그것으로 유휴 시계를 되감으면 컬럼은 영영 '조용하지 않은' 것이
 * 되어 사다리가 **시작조차 하지 못한다.** 팔로잉은 시간순이라 폴링 응답에 새 글이
 * 실려 오므로 이 함정이 드러나지 않았다 — 추천만 20 분이 지나도 그대로였다.
 */
describe('유휴 판정 — 응답이 아니라 새 목록', () => {
  let collector: CollectorHandle

  beforeEach(async () => {
    stubChrome()
    vi.useFakeTimers()
    window.history.pushState({}, '', '/home')
    renderHome()
    messages = []
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
    capture(timelineBody(['1', '2', '3']))
  })

  afterEach(() => {
    collector.dispose()
    vi.useRealTimers()
  })

  it('x.com 이 제 폴링으로 같은 목록을 계속 줘도 사다리는 제 시간에 오른다', async () => {
    // 5 분 동안 15 초마다 같은 목록이 들어온다.
    for (let step = 0; step < 20; step += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      capture(timelineBody(['1', '2', '3']))
    }

    expect(rungs()).toContain('강제 갱신 4/4: 탭 튕기기')
  })

  it('새 목록이 계속 들어오는 동안에는 두드리지 않는다', async () => {
    for (let step = 0; step < 20; step += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      capture(timelineBody([`${step}`, '1', '2']))
    }

    expect(rungs()).toEqual([])
  })

  it('폴링 응답이 계속 와도 새로고침은 사다리를 끝까지 밟는다', async () => {
    collector.command('foryou', 'refresh')

    // 1 초마다 같은 목록이 돌아온다 — 사람이 기다리는 동안에도 멈춰서는 안 된다.
    for (let step = 0; step < 12; step += 1) {
      await vi.advanceTimersByTimeAsync(1_000)
      capture(timelineBody(['1', '2', '3']))
    }

    expect(rungs()).toEqual([
      '강제 갱신 1/4: 홈 링크 재클릭',
      '강제 갱신 2/4: 탭 재클릭',
      '강제 갱신 3/4: 단축키',
      '강제 갱신 4/4: 탭 튕기기',
    ])
  })
})

/**
 * 대타 방문(`prime`)은 **담당 컬럼의 사다리를 건드리면 안 된다.**
 *
 * 최상위 문서는 자기 컬럼(추천)을 맡으면서, 프레임이 조용한 옆 컬럼을 잠깐 대신
 * 훑고 온다. 그 방문에서 받은 옆 컬럼의 응답을 담당 컬럼의 갱신으로 세면 사다리가
 * 매번 첫 칸으로 되감기고, 돌아오며 유휴 시계까지 되감으면 담당 컬럼은 유휴 간격에
 * 영영 닿지 못한다 — 추천이 20 분이 지나도 목록을 새로 못 받던 자리다.
 */
describe('대타 방문 중의 사다리', () => {
  let collector: CollectorHandle

  beforeEach(async () => {
    stubChrome()
    vi.useFakeTimers()
    window.history.pushState({}, '', '/home')
    renderHome()
    messages = []
    collector = startCollector(['foryou'], (message) => messages.push(message))
    await settle()
    capture(timelineBody(['1', '2', '3']))
  })

  afterEach(() => {
    collector.dispose()
    vi.useRealTimers()
  })

  /** 옆 컬럼을 한 번 대신 훑고 온다. 그쪽은 늘 새 목록을 내놓는 상황. */
  const primeFollowing = async (step: number): Promise<void> => {
    collector.prime('following')
    capture(timelineBody([`f${step}`]), 'HomeLatestTimeline')
    await vi.advanceTimersByTimeAsync(2_000)
  }

  it('옆 컬럼을 대신 훑고 와도 담당 컬럼의 사다리가 끝까지 오른다', async () => {
    // 추천은 두드려도 조용하다. 대타 방문은 실제 주기(90 초)대로 끼어든다.
    for (let step = 0; step < 12; step += 1) {
      await vi.advanceTimersByTimeAsync(100_000)
      await primeFollowing(step)
    }

    expect(rungs()).toContain('강제 갱신 4/4: 탭 튕기기')
  })

  it('사람이 누른 뒤 대타 방문이 끼어들어도 사다리가 되감기지 않는다', async () => {
    collector.command('foryou', 'refresh')
    expect(rungs()).toEqual(['강제 갱신 1/4: 홈 링크 재클릭'])

    for (let step = 0; step < 3; step += 1) {
      // 담당 컬럼은 같은 목록만 돌려준다 — 다음 칸으로 올라가야 하는 상황.
      capture(timelineBody(['1', '2', '3']))
      await primeFollowing(step)
      await vi.advanceTimersByTimeAsync(2_000)
    }

    expect(rungs()).toEqual([
      '강제 갱신 1/4: 홈 링크 재클릭',
      '강제 갱신 2/4: 탭 재클릭',
      '강제 갱신 3/4: 단축키',
      '강제 갱신 4/4: 탭 튕기기',
    ])
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
