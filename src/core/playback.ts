/**
 * 아무도 보지 않는 영상을 세울지 말지 정하는 규칙.
 *
 * 판단만 여기 둔다. DOM 을 실제로 만지는 쪽은 MAIN world 인터셉터인데, 거기는
 * 진짜 x.com 플레이어를 상대로만 확인되는 자리라 테스트로 붙잡을 수 없다.
 * 붙잡을 수 있는 조각을 떼어 두는 것이 이 파일의 목적이다.
 */
import type { TimelineKind } from './types'

/**
 * 이 문서의 영상을 세워야 하는가.
 *
 * 수집 프레임의 영상은 어떤 경우에도 사람이 보지 않는다. 덱이 얹힌 문서는 다르다 —
 * 통과 모드로 비켜서면 그 아래 x.com 을 실제로 보고 쓰는 중이다.
 */
export function blocksPlayback(role: TimelineKind | null, masked: boolean): boolean {
  return role !== null || masked
}

/**
 * 덱 자신의 영상인가.
 *
 * 덱은 그림자 DOM 안에 산다. 그 뿌리의 host 가 덱의 오버레이면 우리 영상이다.
 * `ShadowRoot` 인지만 보는 것으로는 부족하다 — x.com 도 그림자 DOM 을 쓸 수 있고,
 * 그때 남의 영상을 우리 것으로 잘못 봐준다.
 */
export function isDeckMedia(root: Node | null | undefined, overlayId: string): boolean {
  const host = (root as ShadowRoot | null | undefined)?.host
  return host instanceof Element && host.id === overlayId
}

/**
 * 같은 영상을 몇 번까지 떼어보고 포기할지.
 *
 * 세 번이면 상대가 물러설 뜻이 없다는 것을 알기에 충분하다. 낮게 잡을수록 싸움이
 * 짧게 끝나지만, 한 번 튕겨나간 재생을 정상적으로 다시 떼지 못하고 놔주게 된다.
 */
export const STOP_LIMIT = 3

export interface StopLedger {
  /** 이 영상을 지금 떼어도 되는가. 떼려는 횟수를 함께 센다. */
  allow(media: object): boolean
  /** 한도를 넘겨 포기한 영상인가. */
  gaveUp(media: object): boolean
}

/**
 * 손댄 횟수를 영상마다 세어 두고 한도를 넘으면 포기한다.
 *
 * 손대면 x.com 플레이어가 다시 살리는 자리가 있었다. 그대로 두면 초당 수백 번을
 * 오가며 코어 하나를 통째로 태운다 — 실제로 그랬다. 포기하면 그 영상 하나는
 * 디코딩을 계속하지만, 그 값은 왕복이 만들던 값에 비하면 없는 것이나 같다.
 *
 * `WeakMap` 이라 엘리먼트가 사라지면 셈도 함께 사라진다. x.com 이 엘리먼트를
 * 새로 만들어 붙이면 셈은 처음부터 다시 시작한다 — 그건 같은 싸움이 아니라
 * 새 영상이므로 맞다.
 */
export function createStopLedger(limit: number = STOP_LIMIT): StopLedger {
  const stopped = new WeakMap<object, number>()

  return {
    allow(media) {
      const next = (stopped.get(media) ?? 0) + 1
      stopped.set(media, next)
      return next <= limit
    },
    gaveUp(media) {
      return (stopped.get(media) ?? 0) > limit
    },
  }
}
