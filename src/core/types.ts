/** 덱의 한 컬럼이 담당하는 타임라인 종류. x.com 의 홈 두 탭과 알림 두 탭에 대응한다. */
export type TimelineKind = 'foryou' | 'following' | 'mentions' | 'notifications'

/**
 * 고르는 자리에 늘어놓는 차례. 알림이 멘션보다 앞이다 — 알림은 멘션까지 담은 전체
 * 목록이고 멘션은 그중 한 갈래라, 넓은 것에서 좁은 것으로 내려가는 편이 읽기 쉽다.
 */
export const TIMELINE_KINDS: readonly TimelineKind[] = [
  'foryou',
  'following',
  'notifications',
  'mentions',
]

/**
 * 화면에 적는 이름. 컬럼 머리글·탭·설정이 모두 이것 하나를 쓴다.
 *
 * 알림에 '(전체)' 를 붙여 둔다. 멘션과 나란히 놓이는 자리가 많은데, 알림은 멘션까지
 * 담은 전체 목록이고 멘션은 그중 한 갈래라서 이름만으로 갈리지 않으면 어느 쪽에
 * 무엇이 쌓이는지 알 수 없다.
 */
export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  foryou: '추천',
  following: '팔로잉',
  mentions: '멘션',
  notifications: '알림(전체)',
}

/** 이 컬럼을 수집하려면 x.com 의 어느 주소에 앉아 있어야 하는지. */
export const TIMELINE_PATH: Record<TimelineKind, string> = {
  foryou: '/home',
  following: '/home',
  mentions: '/notifications/mentions',
  notifications: '/notifications',
}

/** 알림 페이지에서 오는 컬럼. 홈과 화면 구조도 응답 모양도 다르다. */
export const NOTIFICATION_KINDS: readonly TimelineKind[] = ['mentions', 'notifications']

export const isNotificationKind = (kind: TimelineKind): boolean =>
  NOTIFICATION_KINDS.includes(kind)

/**
 * 각 타임라인을 만들어내는 GraphQL operation 이름.
 * 응답을 어느 컬럼에 넣을지 판별하는 1차 근거로 쓴다.
 * 알림 쪽은 operation 이름이 확실하지 않아 여기에 두지 않는다 — 그 프레임은 담당이
 * 하나뿐이라 무엇이 오든 자기 컬럼으로 귀속시키면 된다.
 */
export const TIMELINE_OPERATION: Record<string, string> = {
  foryou: 'HomeTimeline',
  following: 'HomeLatestTimeline',
}

/** 글이 실제로 올라갔을 때 x.com 이 부르는 뮤테이션. 작성창을 닫을 근거로 쓴다. */
export const CREATE_TWEET_OPERATION = 'CreateTweet'

/** 글을 지웠을 때의 뮤테이션. 지운 글을 우리 목록에서도 걷어낼 근거다. */
export const DELETE_TWEET_OPERATION = 'DeleteTweet'

export type MediaKind = 'photo' | 'video' | 'animated_gif'

export interface TweetMedia {
  kind: MediaKind
  /** 정지 이미지 또는 비디오 썸네일 URL. */
  previewUrl: string
  /** video/gif 일 때 재생 가능한 mp4 URL (가장 높은 비트레이트). */
  playbackUrl?: string
  width: number
  height: number
  altText?: string
}

export interface TweetAuthor {
  id: string
  handle: string
  name: string
  avatarUrl: string
  verified: boolean
}

/**
 * 지금 로그인한 계정.
 *
 * 화면에서 읽어내지만 저장소에도 잠깐 남겨 두므로 core 에 둔다 —
 * 읽는 쪽(content)과 담아두는 쪽(core) 이 같은 모양을 봐야 한다.
 */
export interface ViewerInfo {
  handle: string
  name: string
  avatarUrl: string
}

export interface TweetStats {
  replies: number
  reposts: number
  likes: number
  quotes: number
  bookmarks: number
  views?: number
}

export interface TweetCard {
  title: string
  description?: string
  domain?: string
  url?: string
  imageUrl?: string
}

/** 내 계정이 이 게시물에 이미 반응했는지. 저장 이전 기록에는 없을 수 있다. */
export interface ViewerState {
  liked: boolean
  reposted: boolean
}

/** 정규화된 게시물. IndexedDB 에 이 형태 그대로 저장한다. */
export interface Tweet {
  id: string
  /** 게시 시각 (epoch ms). */
  createdAt: number
  text: string
  lang?: string
  author: TweetAuthor
  media: TweetMedia[]
  stats: TweetStats
  card?: TweetCard
  /** 리포스트인 경우 리포스트한 사람. 본문·통계는 원본 것을 쓴다. */
  repostedBy?: TweetAuthor
  /** 인용된 원본 게시물 (1단계까지만 펼친다). */
  quoted?: Tweet
  /** 답글이면 대상 핸들. */
  replyToHandle?: string
  /** 내 반응 상태. 하트·리포스트 버튼의 초기값. */
  viewer?: ViewerState
  /** x.com 원문 링크. */
  url: string
  /** 어느 컬럼에서 수집됐는지. */
  source: TimelineKind
  /** 우리 덱이 관측한 시각 (epoch ms). 정렬·정리 기준. */
  capturedAt: number
}

/** 알림의 종류. x.com 이 붙여주는 아이콘 이름에서 뽑는다. */
export type NotificationIcon = 'like' | 'repost' | 'follow' | 'mention' | 'other'

/**
 * 게시물이 아닌 알림 한 건 (좋아요·팔로우·리포스트 등).
 *
 * 문구는 우리가 짓지 않고 x.com 이 만들어 준 문장을 그대로 쓴다 — 이미 지역화돼
 * 있고, '외 3명' 같은 묶음 표현까지 저쪽이 계산해 준다.
 */
export interface DeckNotification {
  /** 게시물과 구별하는 표시. 한 컬럼에 두 종류가 섞여 들어온다. */
  kind: 'notification'
  id: string
  createdAt: number
  text: string
  icon: NotificationIcon
  /** 이 알림을 만든 사람들. 앞의 몇 명만 얼굴로 보여준다. */
  actors: TweetAuthor[]
  /** 알림이 가리키는 게시물. 팔로우 알림처럼 없을 수도 있다. */
  target?: Tweet
  source: TimelineKind
  capturedAt: number
}

/** 컬럼에 쌓이는 항목. 알림 컬럼에는 둘이 섞인다. */
export type DeckItem = Tweet | DeckNotification

export function isNotification(item: DeckItem): item is DeckNotification {
  return (item as DeckNotification).kind === 'notification'
}

/**
 * 알림의 신원. 같은 알림인지 가리는 근거다. 가려낼 내용이 없으면 null.
 *
 * **x.com 이 준 id 를 그대로 쓰면 같은 알림이 여러 줄로 쌓인다.** 모아 보여주는
 * 알림('N 개를 마음에 들어 합니다')은 다시 받아올 때마다 id 가 갈리는데, 우리는
 * `${source}:${id}` 로만 중복을 가리므로 새 줄이 된다 — 문구도 대상 글도 똑같은
 * '마음에 들어 합니다' 가 네 줄씩 쌓였다.
 *
 * 그래서 신원을 **내용에서** 만든다. 누가(`actors`) · 무엇을(`icon`) · 어느 글에
 * (`target`). 문구는 넣지 않는다 — 건수가 늘면 문구가 바뀌므로, 넣으면 '2개' 와
 * '3개' 가 서로 다른 알림이 되어 결국 같은 것이 두 줄로 남는다.
 *
 * 사람도 대상 글도 없는 알림은 null 을 준다. 아이콘 하나로 묶으면 서로 다른 안내가
 * 한 줄로 뭉개지므로, 그때는 부르는 쪽이 x.com 의 id 로 물러선다.
 */
export function notificationIdentity(
  item: Pick<DeckNotification, 'icon' | 'actors' | 'target'>,
): string | null {
  const who = item.actors
    .map((actor) => actor.handle)
    .sort()
    .join(',')
  const target = item.target?.id ?? ''
  if (!who && !target) return null
  return `${item.icon}:${who}:${target}`
}

/** 수집 프레임의 상태. 상단 바 인디케이터에 그대로 노출한다. */
export type CollectorState =
  | 'idle'
  | 'loading'
  | 'login-required'
  | 'streaming'
  | 'blocked'
  | 'error'

export interface CollectorStatus {
  kind: TimelineKind
  state: CollectorState
  /** 마지막으로 게시물을 받은 시각 (epoch ms). */
  lastReceivedAt: number | null
  /** 지금 대기 중인 '새 게시물 보기' 알림 개수. 미상이면 null. */
  pendingCount: number | null
  message?: string
}
