/**
 * x.com 내부 GraphQL 타임라인 응답을 우리 `Tweet` 모델로 정규화한다.
 *
 * 스키마가 예고 없이 바뀌는 대상이므로 두 단계로 방어한다.
 *   1) instructions → entries 를 정석대로 훑는다 (타임라인 최상위 항목만 정확히 집힌다).
 *   2) 1) 이 하나도 못 건지면 payload 전체를 훑어 tweet 객체를 긁고,
 *      인용·리포스트 원본으로 이미 소비된 id 는 제외해 중복을 막는다.
 */
import type {
  DeckItem,
  DeckNotification,
  MediaKind,
  NotificationIcon,
  TimelineKind,
  Tweet,
  TweetAuthor,
  TweetCard,
  TweetMedia,
} from './types'

// 외부 스키마라 정적 타입을 신뢰할 수 없다. 접근은 전부 옵셔널 체이닝으로 한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const TWEET_TYPES = new Set(['Tweet', 'TweetWithVisibilityResults'])

/** `TweetWithVisibilityResults` 래퍼와 툼스톤을 걷어내고 알맹이 tweet 을 돌려준다. */
function unwrapTweet(result: Raw): Raw | null {
  if (!result || typeof result !== 'object') return null
  const typename = result.__typename
  if (typename === 'TweetWithVisibilityResults') return unwrapTweet(result.tweet)
  if (typename && !TWEET_TYPES.has(typename)) return null
  // __typename 이 없어도 legacy/rest_id 조합이면 tweet 으로 취급한다.
  if (!result.rest_id && !result.legacy?.id_str) return null
  return result
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 서로게이트 페어를 깨지 않고 코드포인트 단위로 자른다. */
function sliceByCodePoint(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('')
}

function upgradeAvatar(url: string): string {
  return url.replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, '_bigger.$1')
}

function sizedMediaUrl(url: string): string {
  return url.includes('?') ? url : `${url}?name=medium`
}

function parseAuthor(userResult: Raw): TweetAuthor {
  const user = userResult?.__typename === 'UserWithVisibilityResults' ? userResult.user : userResult
  const legacy = user?.legacy ?? {}
  const core = user?.core ?? {}
  const avatar = user?.avatar?.image_url ?? legacy.profile_image_url_https ?? ''
  return {
    id: user?.rest_id ?? legacy.id_str ?? '',
    handle: core.screen_name ?? legacy.screen_name ?? '',
    name: core.name ?? legacy.name ?? '',
    avatarUrl: avatar ? upgradeAvatar(avatar) : '',
    verified: Boolean(user?.is_blue_verified || legacy.verified || user?.verification?.verified),
  }
}

function parseMedia(legacy: Raw): TweetMedia[] {
  const items: Raw[] = legacy?.extended_entities?.media ?? legacy?.entities?.media ?? []
  return items.map((m): TweetMedia => {
    const kind: MediaKind =
      m.type === 'video' || m.type === 'animated_gif' ? m.type : 'photo'
    // mp4 variant 중 비트레이트가 가장 높은 것을 고른다 (gif 는 비트레이트가 0 이라 그대로 잡힌다).
    const variants: Raw[] = m.video_info?.variants ?? []
    const best = variants
      .filter((v) => v.content_type === 'video/mp4')
      .sort((a, b) => toNumber(b.bitrate) - toNumber(a.bitrate))[0]
    const media: TweetMedia = {
      kind,
      previewUrl: sizedMediaUrl(m.media_url_https ?? ''),
      width: toNumber(m.original_info?.width ?? m.sizes?.large?.w),
      height: toNumber(m.original_info?.height ?? m.sizes?.large?.h),
    }
    if (best?.url) media.playbackUrl = best.url
    const alt = m.ext_alt_text ?? m.alt_text
    if (alt) media.altText = alt
    return media
  })
}

function parseCard(tweet: Raw): TweetCard | undefined {
  const card = tweet?.card
  const bindings: Raw[] = card?.legacy?.binding_values ?? []
  if (!bindings.length) return undefined
  const pick = (key: string): Raw =>
    bindings.find((b) => b.key === key)?.value

  const title = pick('title')?.string_value
  if (!title) return undefined

  const image =
    pick('photo_image_full_size_large')?.image_value?.url ??
    pick('thumbnail_image_large')?.image_value?.url ??
    pick('summary_photo_image_large')?.image_value?.url

  // 카드가 가리키는 실제 주소. 카드 자체에는 t.co 만 있으므로 entity 에서 원래 주소를 찾는다.
  const entityUrls: Raw[] = tweet?.legacy?.entities?.urls ?? []
  const shortUrl: string | undefined = card?.legacy?.url
  const target =
    entityUrls.find((u) => u?.url === shortUrl)?.expanded_url ??
    pick('card_url')?.string_value ??
    entityUrls.at(-1)?.expanded_url ??
    (typeof shortUrl === 'string' && shortUrl.startsWith('http') ? shortUrl : undefined)

  const result: TweetCard = { title }
  const description = pick('description')?.string_value
  if (description) result.description = description
  const domain = pick('domain')?.string_value
  if (domain) result.domain = domain
  if (image) result.imageUrl = image
  if (target) result.url = target
  return result
}

/**
 * 본문을 사람이 읽을 형태로 만든다.
 * - 긴 글은 `note_tweet` 쪽에 전문이 있다.
 * - `display_text_range` 뒤에 붙는 미디어용 t.co 링크는 잘라낸다.
 * - 남은 t.co 링크는 표시용 URL 로 바꾼다.
 */
function parseText(tweet: Raw): string {
  const legacy = tweet?.legacy ?? {}
  const note = tweet?.note_tweet?.note_tweet_results?.result
  let text: string = note?.text ?? legacy.full_text ?? ''

  if (!note && Array.isArray(legacy.display_text_range)) {
    const [start, end] = legacy.display_text_range
    if (typeof start === 'number' && typeof end === 'number') {
      text = sliceByCodePoint(text, start, end)
    }
  }

  // t.co 단축 링크는 원래 주소로 되돌린다. 화면에 짧게 보이는 건 렌더러가 처리한다.
  const urls: Raw[] = note?.entity_set?.urls ?? legacy.entities?.urls ?? []
  for (const u of urls) {
    const replacement = u?.expanded_url ?? u?.display_url
    if (u?.url && replacement) text = text.split(u.url).join(replacement)
  }

  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** tweet 객체 하나를 `Tweet` 으로 정규화한다. `depth` 는 인용 펼침 깊이 제한용. */
function normalize(
  raw: Raw,
  source: TimelineKind,
  capturedAt: number,
  depth = 0,
): Tweet | null {
  const tweet = unwrapTweet(raw)
  if (!tweet) return null

  // 리포스트면 원본이 본체다. 겉의 계정은 '리포스트한 사람' 으로만 남긴다.
  const repostSource = tweet.legacy?.retweeted_status_result?.result
  if (repostSource) {
    const original = normalize(repostSource, source, capturedAt, depth)
    if (!original) return null
    const by = parseAuthor(tweet.core?.user_results?.result)
    if (!by.handle) return original
    // 리포스트 여부는 겉 껍데기에 실려 온다. 원본 쪽 값으로는 알 수 없다.
    const reposted = Boolean(tweet.legacy?.retweeted) || Boolean(original.viewer?.reposted)
    return {
      ...original,
      repostedBy: by,
      viewer: { liked: Boolean(original.viewer?.liked), reposted },
    }
  }

  const legacy = tweet.legacy ?? {}
  const id: string = tweet.rest_id ?? legacy.id_str ?? ''
  if (!id) return null

  const author = parseAuthor(tweet.core?.user_results?.result)
  const createdAt = legacy.created_at ? Date.parse(legacy.created_at) : Number.NaN

  const result: Tweet = {
    id,
    createdAt: Number.isFinite(createdAt) ? createdAt : capturedAt,
    text: parseText(tweet),
    author,
    media: parseMedia(legacy),
    // 통계는 legacy 아래가 정석이지만, 스키마 이행 중에는 tweet 바로 아래에도 실려 온다.
    stats: {
      replies: toNumber(legacy.reply_count ?? tweet.reply_count),
      reposts: toNumber(legacy.retweet_count ?? tweet.retweet_count),
      likes: toNumber(legacy.favorite_count ?? tweet.favorite_count),
      quotes: toNumber(legacy.quote_count ?? tweet.quote_count),
      bookmarks: toNumber(legacy.bookmark_count ?? tweet.bookmark_count),
    },
    url: `https://x.com/${author.handle || 'i'}/status/${id}`,
    source,
    capturedAt,
    viewer: { liked: Boolean(legacy.favorited), reposted: Boolean(legacy.retweeted) },
  }

  if (legacy.lang && legacy.lang !== 'und') result.lang = legacy.lang
  if (tweet.views?.count) result.stats.views = toNumber(tweet.views.count)
  if (legacy.in_reply_to_screen_name) result.replyToHandle = legacy.in_reply_to_screen_name

  const card = parseCard(tweet)
  if (card) result.card = card

  if (depth < 1) {
    const quoted = normalize(tweet.quoted_status_result?.result, source, capturedAt, depth + 1)
    if (quoted) result.quoted = quoted
  }

  return result
}

/** x.com 이 붙이는 아이콘 이름을 우리 종류로 옮긴다. 모르는 이름은 기타로 둔다. */
function notificationIcon(name: unknown): NotificationIcon {
  const id = typeof name === 'string' ? name : ''
  if (id.includes('heart')) return 'like'
  if (id.includes('retweet') || id.includes('repost')) return 'repost'
  if (id.includes('person') || id.includes('user')) return 'follow'
  if (id.includes('mention') || id.includes('reply')) return 'mention'
  return 'other'
}

/** 객체 안 어디에 있든 `user_results.result` 를 모은다. 템플릿 모양이 여러 가지다. */
function collectUsers(node: Raw, out: Raw[] = [], depth = 0): Raw[] {
  if (depth > 6 || !node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectUsers(child, out, depth + 1)
    return out
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'user_results' && (value as Raw)?.result) out.push((value as Raw).result)
    else collectUsers(value, out, depth + 1)
  }
  return out
}

/** 알림 항목 하나를 정규화한다. 문구는 x.com 이 준 문장을 그대로 쓴다. */
function normalizeNotification(
  item: Raw,
  entryId: string,
  source: TimelineKind,
  capturedAt: number,
): DeckNotification | null {
  const id: string = item?.id ?? entryId
  if (!id) return null

  const actors = collectUsers(item?.template)
    .map((user) => parseAuthor(user))
    .filter((author) => author.handle)

  const text: string = item?.rich_message?.text ?? item?.message?.text ?? ''
  const icon = notificationIcon(item?.notification_icon)
  // 문구가 비어 있으면 아무 것도 안 보이므로, 아는 것만으로 한 줄을 만든다.
  const fallback = actors.length
    ? `${actors[0]?.name ?? ''}님의 새 알림`
    : '새 알림'

  const timestamp = toNumber(item?.timestamp_ms)
  const targetRaw = deepCollectTweets(item?.template)[0]
  const target = targetRaw ? normalize(targetRaw, source, capturedAt) : null

  const result: DeckNotification = {
    kind: 'notification',
    id,
    createdAt: timestamp > 0 ? timestamp : capturedAt,
    text: text || fallback,
    icon,
    actors,
    source,
    capturedAt,
  }
  if (target) result.target = target
  return result
}

/** `entries[]` 중 게시물 항목에서 tweet 원본 객체만 순서대로 뽑는다. */
function collectFromEntries(entries: Raw[]): Raw[] {
  const found: Raw[] = []
  for (const entry of entries ?? []) {
    const content = entry?.content
    if (!content) continue

    if (content.entryType === 'TimelineTimelineItem' || content.__typename === 'TimelineTimelineItem') {
      const item = content.itemContent
      if (item?.itemType === 'TimelineTweet' && item.tweet_results?.result) {
        found.push(item.tweet_results.result)
      }
      continue
    }

    // 대화 스레드는 module 안에 여러 게시물이 묶여 온다.
    if (content.entryType === 'TimelineTimelineModule' || content.__typename === 'TimelineTimelineModule') {
      for (const sub of content.items ?? []) {
        const item = sub?.item?.itemContent
        if (item?.itemType === 'TimelineTweet' && item.tweet_results?.result) {
          found.push(item.tweet_results.result)
        }
      }
    }
  }
  return found
}

/** `entries[]` 중 알림 항목을 뽑는다. 게시물 항목과 한 배열에 섞여 온다. */
function collectNotifications(
  entries: Raw[],
  source: TimelineKind,
  capturedAt: number,
): DeckNotification[] {
  const found: DeckNotification[] = []
  for (const entry of entries ?? []) {
    const item = entry?.content?.itemContent
    const type = item?.itemType ?? item?.__typename
    if (typeof type !== 'string' || !type.includes('Notification')) continue
    const notification = normalizeNotification(item, entry?.entryId ?? '', source, capturedAt)
    if (notification) found.push(notification)
  }
  return found
}

/** payload 어디에 있든 `instructions` 배열을 전부 찾아낸다. */
function findInstructions(node: Raw, out: Raw[] = [], depth = 0): Raw[] {
  if (depth > 12 || !node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findInstructions(child, out, depth + 1)
    return out
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'instructions' && Array.isArray(value)) out.push(...value)
    else findInstructions(value, out, depth + 1)
  }
  return out
}

/** 최후 수단: payload 전체를 훑어 tweet 처럼 생긴 객체를 모은다. */
function deepCollectTweets(node: Raw, out: Raw[] = [], depth = 0): Raw[] {
  if (depth > 14 || !node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) deepCollectTweets(child, out, depth + 1)
    return out
  }
  if (TWEET_TYPES.has(node.__typename)) out.push(node)
  for (const value of Object.values(node)) deepCollectTweets(value, out, depth + 1)
  return out
}

export interface ParseResult {
  /** 게시물과 알림이 섞여 들어온다. 알림 타임라인에는 둘 다 있다. */
  items: DeckItem[]
  /** 정석 경로가 실패해 전체 훑기로 건진 결과인지. 진단 배지에 쓴다. */
  degraded: boolean
}

/**
 * GraphQL 응답 본문(JSON 문자열)에서 게시물과 알림을 뽑아낸다.
 * 파싱 자체가 실패해도 예외를 던지지 않고 빈 결과를 돌려준다 — 스트림이 끊기면 안 된다.
 */
export function parseTimelinePayload(
  body: string,
  source: TimelineKind,
  capturedAt: number = Date.now(),
): ParseResult {
  let payload: Raw
  try {
    payload = JSON.parse(body)
  } catch {
    return { items: [], degraded: false }
  }

  const instructions = findInstructions(payload)
  const rawTweets: Raw[] = []
  const notifications: DeckNotification[] = []
  for (const instruction of instructions) {
    if (Array.isArray(instruction?.entries)) {
      rawTweets.push(...collectFromEntries(instruction.entries))
      notifications.push(...collectNotifications(instruction.entries, source, capturedAt))
    }
    // TimelineAddToModule 은 entries 대신 moduleItems 로 온다.
    if (Array.isArray(instruction?.moduleItems)) {
      rawTweets.push(...collectFromEntries(instruction.moduleItems.map((item: Raw) => ({ content: item?.item }))))
    }
  }

  // 정석 경로가 빈손인 건 두 경우다 — 새 글이 없어서 진짜 비었거나, 스키마가 바뀌어서
  // 못 읽었거나. 전체 훑기가 실제로 뭔가 건져올 때만 '폴백' 으로 본다.
  // 그러지 않으면 새 글 없는 평범한 응답이 전부 폴백으로 표시된다.
  let degraded = false
  let candidates = rawTweets
  if (candidates.length === 0 && notifications.length === 0) {
    const scanned = deepCollectTweets(payload)
    if (scanned.length > 0) {
      degraded = true
      candidates = scanned
    }
  }

  const tweets: Tweet[] = []
  const seen = new Set<string>()
  // 인용·리포스트 원본으로 이미 소비된 id 는 최상위 항목으로 다시 넣지 않는다.
  const nested = new Set<string>()

  for (const candidate of candidates) {
    const tweet = normalize(candidate, source, capturedAt)
    if (!tweet || seen.has(tweet.id)) continue
    seen.add(tweet.id)
    if (tweet.quoted) nested.add(tweet.quoted.id)
    tweets.push(tweet)
  }

  const filtered = degraded ? tweets.filter((t) => !nested.has(t.id)) : tweets

  // 알림이 가리키는 게시물은 알림 카드 안에 이미 실려 있다. 같은 글을 따로 또
  // 세우지 않는다 — 알림 하나가 두 줄로 보이면 읽는 흐름이 끊긴다.
  const inNotification = new Set(
    notifications.map((notification) => notification.target?.id).filter(Boolean) as string[],
  )
  const items: DeckItem[] = [
    ...notifications,
    ...filtered.filter((tweet) => !inNotification.has(tweet.id)),
  ]
  return { items, degraded }
}
