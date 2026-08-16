/**
 * 컬럼 없이 지켜보는 타임라인의 '안 본 수'.
 *
 * 읽음 여부를 항목마다 들고 다니지 않는다 — 마지막으로 본 시각 하나만 두고 그보다
 * 뒤에 들어온 것을 센다. 보관된 과거 글까지 안 본 것으로 세지 않으려면 그 시각의
 * 출발점은 덱을 연 때여야 한다.
 */

/** 관측 시각만 있으면 센다. 게시물이든 알림이든 이 값은 둘 다 가지고 있다. */
export interface Captured {
  capturedAt: number
}

/**
 * `since` 보다 뒤에 관측된 항목 수.
 *
 * 목록은 최신이 앞이므로 오래된 것을 만나는 순간 멈춘다 — 상한(400건)까지 쌓인
 * 컬럼을 다시 그릴 때마다 전부 훑지 않는다.
 */
export function countSince(items: readonly Captured[], since: number): number {
  let count = 0
  for (const item of items) {
    if (item.capturedAt <= since) break
    count += 1
  }
  return count
}

/** 배지에 적을 글자. 세 자리부터는 정확한 수보다 '많다' 가 더 쓸모 있다. */
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
