/**
 * 컬럼 없이 지켜보는 타임라인의 '안 본 수'.
 *
 * 읽음 여부를 항목마다 들고 다니지 않는다 — 마지막으로 본 시각 하나만 두고 그보다
 * 뒤에 들어온 것을 센다. 보관된 과거 글까지 안 본 것으로 세지 않으려면 그 시각의
 * 출발점은 덱을 연 때여야 한다.
 */

/**
 * 세는 데 필요한 것 전부. 게시물이든 알림이든 둘 다 가지고 있다.
 *
 * 신원(`id`)까지 보는 이유는 겹치기 때문이다 — 같은 멘션이 알림(전체)과 멘션
 * 양쪽에 실려 온다.
 */
export interface UnreadItem {
  id: string
  capturedAt: number
}

/** 한 갈래의 목록과, 그 갈래를 마지막으로 본 시각. */
export interface UnreadSlice {
  items: readonly UnreadItem[]
  since: number
}

/**
 * 안 본 수. 여러 갈래를 함께 넘기면 아울러 센다.
 *
 * 갈래마다 세어 더하지 않는다. 그러면 알림(전체)과 멘션 양쪽에 실린 멘션 한 건이
 * 두 건으로 보인다 — 종이 답해야 하는 것은 '확인할 것이 몇 건인가' 라서, 어느
 * 갈래에서 왔든 같은 글은 한 번만 센다.
 *
 * 본 시각은 갈래마다 다르다. 한쪽에서만 안 본 글이어도 아직 확인할 것이 남은
 * 것이므로 센다.
 *
 * 목록은 최신이 앞이므로 오래된 것을 만나는 순간 그 갈래를 접는다 — 상한(400건)까지
 * 쌓인 컬럼을 다시 그릴 때마다 전부 훑지 않는다.
 */
export function countUniqueSince(slices: readonly UnreadSlice[]): number {
  const seen = new Set<string>()
  for (const { items, since } of slices) {
    for (const item of items) {
      if (item.capturedAt <= since) break
      seen.add(item.id)
    }
  }
  return seen.size
}

/** 배지에 적을 글자. 세 자리부터는 정확한 수보다 '많다' 가 더 쓸모 있다. */
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
