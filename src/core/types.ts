/** 덱의 한 컬럼이 담당하는 타임라인 종류. x.com 홈의 두 탭에 각각 대응한다. */
export type TimelineKind = 'foryou' | 'following'

export const TIMELINE_KINDS: readonly TimelineKind[] = ['foryou', 'following']

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  foryou: '추천',
  following: '팔로잉',
}

/**
 * 각 타임라인을 만들어내는 GraphQL operation 이름.
 * 응답을 어느 컬럼에 넣을지 판별하는 1차 근거로 쓴다.
 */
export const TIMELINE_OPERATION: Record<TimelineKind, string> = {
  foryou: 'HomeTimeline',
  following: 'HomeLatestTimeline',
}

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
