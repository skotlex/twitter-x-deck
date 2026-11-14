import { isNotification, type DeckItem, type MediaGroup, type Tweet } from '@core/types'

/** 라이트박스에서 보고 있는 자리. 몇 번째 글의 몇 번째 사진인지. */
export interface PhotoPosition {
  group: number
  index: number
}

/**
 * 한 장 옮긴 자리. 더 갈 곳이 없으면 null.
 *
 * 끝에서 처음으로 되돌아가지 않는다. 되감기면 끝에 닿았다는 것을 알 길이 없다.
 * 글의 끝에 닿으면 다음 글(타래)로 넘어가고, 앞으로 갈 때는 앞 글의 마지막 사진에
 * 선다 — 거꾸로 넘겨도 바로 이어 보이게.
 *
 * @param sizes 묶음마다의 사진 수. 사진이 없는 묶음은 건너뛴다.
 */
export function stepPhoto(
  sizes: readonly number[],
  at: PhotoPosition,
  delta: 1 | -1,
): PhotoPosition | null {
  const next = at.index + delta
  if (next >= 0 && next < (sizes[at.group] ?? 0)) return { group: at.group, index: next }

  for (let group = at.group + delta; group >= 0 && group < sizes.length; group += delta) {
    const size = sizes[group] ?? 0
    if (size > 0) return { group, index: delta > 0 ? 0 : size - 1 }
  }
  return null
}

/** 라이트박스에 넘길 묶음 목록과 처음 펼칠 자리. */
export interface ThreadMedia {
  groups: MediaGroup[]
  group: number
  index: number
}

/** 글 id 는 시각 순으로 커지는 큰 정수다. 자릿수가 숫자 범위를 넘으므로 글자로 견준다. */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * 컬럼 카드에서 연 사진을, 같은 사람이 이어 쓴 글들의 사진과 함께 묶는다.
 *
 * 타래는 같은 대화 안에서 같은 사람이 자기 글에 이어 단 글이다. 대화를 연 글이거나
 * 자기에게 단 답글만 잇는다 — 같은 사람이라도 남에게 단 답글은 그 사람과 나눈 말이지
 * 이어 쓴 글이 아니다. 지금 컬럼에 실려 있는 글까지만 본다.
 *
 * 컬럼은 최신 글이 위에 오지만 타래는 쓴 순서로 넘겨야 하므로 id 순으로 늘어놓는다.
 * 대화를 모르는 글(예전에 저장된 것)은 목록에 대화를 아는 같은 글이 있으면 그것을
 * 기준으로 삼고, 없으면 그 글 하나만 연다.
 *
 * 컬럼에는 보통 타래의 첫 글만 실린다. 이어 쓴 답글은 상세 페이지에서 받아와
 * `items` 에 함께 넘긴다 — {@link mayContinueThread}.
 *
 * @param index 누른 사진이 그 글의 `media` 에서 몇 번째인지.
 */
export function threadMedia(items: readonly DeckItem[], clicked: Tweet, index: number): ThreadMedia {
  const author = clicked.author.handle.toLowerCase()
  const conversation =
    clicked.conversationId ??
    items.find((item): item is Tweet => !isNotification(item) && item.id === clicked.id && !!item.conversationId)
      ?.conversationId

  const joins = (tweet: Tweet): boolean =>
    tweet.id === clicked.id ||
    (conversation !== undefined &&
      tweet.conversationId === conversation &&
      tweet.author.handle.toLowerCase() === author &&
      (tweet.id === conversation || tweet.replyToHandle?.toLowerCase() === author))

  // 리포스트로 같은 글이 두 번 실릴 수 있다. id 로 한 번씩만 담는다.
  const members = new Map<string, Tweet>([[clicked.id, clicked]])
  for (const item of items) {
    if (isNotification(item) || members.has(item.id) || !joins(item)) continue
    members.set(item.id, item)
  }

  const ordered = [...members.values()]
    .filter((tweet) => tweet.media.length > 0)
    .sort((a, b) => compareIds(a.id, b.id))
  return {
    groups: ordered.map((tweet) => ({ media: tweet.media, sourceUrl: tweet.url })),
    group: Math.max(0, ordered.findIndex((tweet) => tweet.id === clicked.id)),
    index,
  }
}

/**
 * 상세 페이지까지 가서 타래를 받아올 만한 글인지.
 *
 * 컬럼에는 타래의 첫 글만 실리는 일이 흔해, 이어 쓴 답글의 사진은 상세 페이지를 봐야
 * 안다. 다만 받아오는 데 숨은 x.com 한 벌이 뜨므로 이을 것이 없는 글은 거른다 —
 * 답글이 하나도 없고 자기에게 단 답글도 아니면 위로도 아래로도 이을 글이 없다.
 */
export function mayContinueThread(tweet: Tweet): boolean {
  const author = tweet.author.handle.toLowerCase()
  return tweet.stats.replies > 0 || tweet.replyToHandle?.toLowerCase() === author
}

/**
 * 라이트박스를 연 채로 묶음 목록이 바뀌었을 때 보던 사진의 새 자리.
 *
 * 타래는 연 뒤에 도착한다. 앞 글이 끼어들면 묶음 번호가 밀리므로, 번호가 아니라 보던
 * 글의 주소로 다시 찾는다. 새 목록에 그 글이 없으면 자리를 그대로 둔다.
 */
export function followGroups(
  before: readonly MediaGroup[],
  after: readonly MediaGroup[],
  at: PhotoPosition,
): PhotoPosition {
  const url = before[at.group]?.sourceUrl
  const group = url === undefined ? -1 : after.findIndex((candidate) => candidate.sourceUrl === url)
  return group < 0 ? at : { group, index: at.index }
}
