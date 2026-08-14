/**
 * 저절로 도는 영상을 한 무리에 하나로 고른다.
 *
 * 후보로 나서는 것은 지금 보고 있는 카드(가리키거나 포커스가 있는 카드)의
 * 영상들뿐이다. 그 안에서도 여럿이면 화면 가운데에 가장 가까운 하나만 고른다.
 *
 * 자리로만 자르지 않는 이유는 맨 위 영상 때문이다 — 목록 첫 글이 영상이면 화면
 * 가운데까지 내려올 일이 없어 영영 안 돈다. 후보가 하나뿐이면 그것이 어디에 있든
 * 그 하나가 돈다.
 */

/** 이만큼도 안 보이면 겨룰 자격이 없다. 살짝 걸친 것이 화면 한가운데를 이기면 곤란하다. */
const MIN_VISIBLE = 0.35

interface Candidate {
  /** 이 영상이 속한 스크롤 상자. 컬럼마다 따로 고른다. */
  group: Element | null
  /** 화면 세로 가운데에서 떨어진 거리(px). 작을수록 이긴다. */
  distance: number
  visible: number
  play: (on: boolean) => void
}

const candidates = new Map<object, Candidate>()

/** 그룹마다 승자를 다시 뽑아 알린다. */
function elect(): void {
  const best = new Map<Element | null, { token: object; distance: number }>()

  for (const [token, candidate] of candidates) {
    if (candidate.visible < MIN_VISIBLE) continue
    const current = best.get(candidate.group)
    if (!current || candidate.distance < current.distance) {
      best.set(candidate.group, { token, distance: candidate.distance })
    }
  }

  const winners = new Set([...best.values()].map((entry) => entry.token))
  for (const [token, candidate] of candidates) candidate.play(winners.has(token))
}

/** 후보로 나서거나(next 있음) 물러난다(null). 부를 때마다 승자를 다시 뽑는다. */
export function reportCandidate(token: object, next: Candidate | null): void {
  if (next) candidates.set(token, next)
  else candidates.delete(token)
  elect()
}

/** 요소가 화면 세로 가운데에서 떨어진 거리. */
export function distanceFromCenter(rect: DOMRectReadOnly): number {
  return Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2)
}
