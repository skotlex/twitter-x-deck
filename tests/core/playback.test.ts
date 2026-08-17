/**
 * [playback.ts](../../src/core/playback.ts) 는 "이 영상을 세울 것인가" 만 정한다.
 *
 * 여기 있는 테스트는 전부 실제로 겪은 회귀에 대응한다. 특히 `createStopLedger` 는
 * 성능 트레이스에서 잡아낸 무한 왕복 — 우리가 세우면 x.com 이 다시 트는 것을
 * 초당 170~640 번 되풀이하며 코어 하나를 태우던 것 — 을 막기 위한 자리다.
 */
import { describe, expect, it } from 'vitest'
import { blocksPlayback, createStopLedger, isDeckMedia, STOP_LIMIT } from '@core/playback'

describe('blocksPlayback', () => {
  it('수집 프레임의 영상은 가림막과 무관하게 세운다', () => {
    expect(blocksPlayback('following', true)).toBe(true)
    expect(blocksPlayback('following', false)).toBe(true)
  })

  it('덱이 덮고 있는 최상위 문서의 영상은 세운다', () => {
    expect(blocksPlayback(null, true)).toBe(true)
  })

  it('통과 모드로 비켜선 최상위 문서는 건드리지 않는다', () => {
    // 그 아래 x.com 을 사람이 실제로 보고 쓰는 중이다.
    expect(blocksPlayback(null, false)).toBe(false)
  })
})

describe('isDeckMedia', () => {
  const OVERLAY = 'x-deck-overlay'

  const shadowUnder = (id: string): ShadowRoot => {
    const host = document.createElement('div')
    host.id = id
    document.body.append(host)
    return host.attachShadow({ mode: 'open' })
  }

  it('덱 오버레이의 그림자 DOM 안이면 우리 영상이다', () => {
    expect(isDeckMedia(shadowUnder(OVERLAY), OVERLAY)).toBe(true)
  })

  it('x.com 이 만든 그림자 DOM 은 우리 것이 아니다', () => {
    // 그림자 DOM 인지만 보면 남의 영상을 우리 것으로 착각해 그대로 틀어준다.
    expect(isDeckMedia(shadowUnder('some-x-widget'), OVERLAY)).toBe(false)
  })

  it('light DOM 과 아직 붙지 않은 엘리먼트는 우리 것이 아니다', () => {
    expect(isDeckMedia(document, OVERLAY)).toBe(false)
    expect(isDeckMedia(document.createElement('video'), OVERLAY)).toBe(false)
    expect(isDeckMedia(null, OVERLAY)).toBe(false)
  })
})

describe('createStopLedger', () => {
  it('한도까지는 세우고 그 뒤로는 포기한다', () => {
    const ledger = createStopLedger(3)
    const media = {}

    expect(ledger.allow(media)).toBe(true)
    expect(ledger.allow(media)).toBe(true)
    expect(ledger.allow(media)).toBe(true)
    expect(ledger.gaveUp(media)).toBe(false)

    expect(ledger.allow(media)).toBe(false)
    expect(ledger.gaveUp(media)).toBe(true)
  })

  it('한 번 포기한 영상은 계속 포기한 채로 둔다', () => {
    // 여기서 다시 true 로 돌아가면 왕복이 그대로 되살아난다.
    const ledger = createStopLedger(1)
    const media = {}

    ledger.allow(media)
    for (let i = 0; i < 50; i += 1) expect(ledger.allow(media)).toBe(false)
    expect(ledger.gaveUp(media)).toBe(true)
  })

  it('영상마다 따로 센다', () => {
    const ledger = createStopLedger(1)
    const a = {}
    const b = {}

    expect(ledger.allow(a)).toBe(true)
    expect(ledger.allow(a)).toBe(false)
    // a 를 포기했다고 b 까지 놓아주면 멀쩡한 영상이 그냥 돌아간다.
    expect(ledger.allow(b)).toBe(true)
    expect(ledger.gaveUp(b)).toBe(false)
  })

  it('기본 한도가 있다', () => {
    const ledger = createStopLedger()
    const media = {}

    for (let i = 0; i < STOP_LIMIT; i += 1) expect(ledger.allow(media)).toBe(true)
    expect(ledger.allow(media)).toBe(false)
  })
})
