import { memo, useState } from 'react'
import type { Tweet } from '@core/types'
import {
  MEDIA_MAX_HEIGHT,
  smallerMediaSize,
  type MediaSize,
  type Settings,
} from '@core/settings'
import { openReplyComposer, runTweetAction, type TweetAction } from '../../content/actions'
import { formatCount, formatRelative, formatStamp } from '../lib/format'
import { Lightbox } from './Lightbox'
import { MediaGrid } from './MediaGrid'
import { RichText } from './RichText'
import { LikeIcon, ReplyIcon, RepostIcon, VerifiedIcon, ViewsIcon } from './icons'

/**
 * 밀도별 치수를 한곳에 모아둔다.
 * '조밀' 은 view 수만 감추는 게 아니라 사진·글자·여백·미디어를 함께 줄여
 * 한 화면에 들어오는 글 수를 실제로 늘린다.
 */
interface Metrics {
  padding: string
  avatar: number
  text: string
  /** 본문을 몇 줄까지 보여줄지. 넘치면 잘린다. */
  clamp: string
  gap: string
  statsMargin: string
  showViews: boolean
  shrinkMedia: boolean
}

const METRICS: Record<Settings['density'], Metrics> = {
  comfortable: {
    padding: 'px-4 py-3.5',
    avatar: 40,
    text: 'text-[15px] leading-[1.55]',
    clamp: '',
    gap: 'gap-3',
    statsMargin: 'mt-2.5',
    showViews: true,
    shrinkMedia: false,
  },
  compact: {
    padding: 'px-3 py-2',
    avatar: 30,
    text: 'text-[13.5px] leading-[1.42]',
    clamp: 'line-clamp-6',
    gap: 'gap-2.5',
    statsMargin: 'mt-1',
    showViews: false,
    shrinkMedia: true,
  },
}

function Avatar({ src, name, size }: { src: string; name: string; size: number }) {
  const style = { width: size, height: size }
  if (!src) {
    return <div style={style} className="shrink-0 rounded-full bg-surface-3" aria-hidden="true" />
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      style={style}
      className="shrink-0 rounded-full bg-surface-3 object-cover"
    />
  )
}

function AuthorLine({ tweet, metrics }: { tweet: Tweet; metrics: Metrics }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-semibold text-text">{tweet.author.name}</span>
      {tweet.author.verified && (
        <VerifiedIcon className="h-[15px] w-[15px] shrink-0 translate-y-[2px] text-accent" />
      )}
      <span className="truncate text-[13px] text-faint">@{tweet.author.handle}</span>
      <span className="shrink-0 text-[13px] text-faint">·</span>
      <time
        dateTime={new Date(tweet.createdAt).toISOString()}
        title={formatStamp(tweet.createdAt)}
        className="shrink-0 text-[13px] text-faint"
      >
        {formatRelative(tweet.createdAt)}
      </time>
      {metrics.showViews && tweet.stats.views ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-faint">
          <ViewsIcon className="h-3.5 w-3.5" />
          {formatCount(tweet.stats.views)}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 인용된 글. 배경과 테두리를 함께 줘서 원글 본문과 확실히 갈린다 —
 * 테두리만으로는 밝은 테마에서 거의 보이지 않는다.
 */
function QuotedTweet({
  tweet,
  showMedia,
  mediaSize,
  textClass,
}: {
  tweet: Tweet
  showMedia: boolean
  mediaSize: MediaSize
  textClass: string
}) {
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      className="mt-2.5 block rounded-xl border border-line bg-surface-2 p-3 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center gap-1.5 text-[13px]">
        <Avatar src={tweet.author.avatarUrl} name={tweet.author.name} size={20} />
        <span className="truncate font-semibold text-text">{tweet.author.name}</span>
        <span className="truncate text-faint">@{tweet.author.handle}</span>
        <span className="text-faint">·</span>
        <span className="shrink-0 text-faint">{formatRelative(tweet.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-muted">
        <RichText text={tweet.text} className={`${textClass} line-clamp-6`} />
      </div>
      {showMedia && (
        <MediaGrid media={tweet.media} size={smallerMediaSize(mediaSize)} sourceUrl={tweet.url} />
      )}
    </a>
  )
}

/** 링크 미리보기. 인용글과 같은 이유로 배경을 깔아 본문과 구분한다. */
function LinkCard({ card, mediaSize }: { card: NonNullable<Tweet['card']>; mediaSize: MediaSize }) {
  const Wrapper = card.url ? 'a' : 'div'
  const maxHeight = MEDIA_MAX_HEIGHT[mediaSize]
  return (
    <Wrapper
      {...(card.url ? { href: card.url, target: '_blank', rel: 'noreferrer noopener' as const } : {})}
      className={`mt-2.5 block overflow-hidden rounded-xl border border-line bg-surface-2 transition-colors ${
        card.url ? 'hover:border-accent/40' : ''
      }`}
    >
      {card.imageUrl && (
        // 높이는 감싼 상자가 정한다. 이미지에 max-height 만 걸면 aspect-ratio 와 다퉈
        // 크기 설정이 먹지 않는다.
        <div
          className="overflow-hidden"
          style={{ aspectRatio: 1.91, ...(maxHeight === null ? {} : { maxHeight }) }}
        >
          <img
            src={card.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="px-3 py-2.5">
        {card.domain && <p className="text-[12px] text-faint">{card.domain}</p>}
        <p className="mt-0.5 line-clamp-2 text-[14px] font-medium text-text">{card.title}</p>
        {card.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{card.description}</p>}
      </div>
    </Wrapper>
  )
}

const ACTION_BASE =
  '-mx-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[12.5px] tabular-nums transition-colors disabled:cursor-progress'

/** 개수만 보여주고 누르면 새 창을 여는 동작 (답글). */
function LinkAction({
  icon,
  value,
  label,
  tone,
  onPress,
}: {
  icon: React.ReactNode
  value: number
  label: string
  tone: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={`${label} (${value.toLocaleString('ko-KR')})`}
      onClick={(event) => {
        event.stopPropagation()
        onPress()
      }}
      className={`${ACTION_BASE} text-faint ${tone}`}
    >
      {icon}
      {formatCount(value)}
    </button>
  )
}

/**
 * 켜고 끌 수 있는 동작 (하트·리포스트).
 * 화면은 즉시 바꾸고, 실제 반영은 보이지 않는 x.com 페이지에서 진행한다.
 * 실패하면 표시를 되돌리고 이유를 툴팁에 남긴다.
 */
function ToggleAction({
  icon,
  value,
  label,
  tone,
  activeClass,
  initial,
  tweetUrl,
  on,
  off,
}: {
  icon: React.ReactNode
  value: number
  label: string
  tone: string
  activeClass: string
  initial: boolean
  tweetUrl: string
  on: TweetAction
  off: TweetAction
}) {
  const [active, setActive] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 낙관적 표시. 서버 개수는 다음 수집분에서 따라온다.
  const shown = value + (active === initial ? 0 : active ? 1 : -1)

  const press = async () => {
    if (busy) return
    const next = !active
    setActive(next)
    setBusy(true)
    setError(null)
    try {
      await runTweetAction(tweetUrl, next ? on : off)
    } catch (cause) {
      setActive(!next)
      setError(cause instanceof Error ? cause.message : '실패했다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={active}
      title={error ? `${label} 실패 — ${error}` : label}
      aria-label={`${label} (${shown.toLocaleString('ko-KR')})`}
      onClick={(event) => {
        event.stopPropagation()
        void press()
      }}
      className={`${ACTION_BASE} ${tone} ${
        error ? 'text-danger' : active ? activeClass : 'text-faint'
      } ${busy ? 'opacity-60' : ''}`}
    >
      {icon}
      {formatCount(shown)}
    </button>
  )
}

export interface TweetCardProps {
  tweet: Tweet
  settings: Settings
  /** 새로 들어온 카드에만 등장 애니메이션을 준다. */
  animate?: boolean
}

function TweetCardBase({ tweet, settings, animate = false }: TweetCardProps) {
  const metrics = METRICS[settings.density]
  const mediaSize = metrics.shrinkMedia ? smallerMediaSize(settings.mediaSize) : settings.mediaSize
  const [lightboxAt, setLightboxAt] = useState<number | null>(null)

  return (
    <article
      className={`group/card relative border-b border-line-soft transition-colors hover:bg-surface-2/60 ${metrics.padding} ${
        animate ? 'animate-enter' : ''
      }`}
    >
      {tweet.repostedBy && (
        <p
          className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-faint"
          style={{ paddingLeft: metrics.avatar + 12 }}
        >
          <RepostIcon className="h-3.5 w-3.5" />
          <span className="truncate">{tweet.repostedBy.name} 님이 리포스트</span>
        </p>
      )}

      <div className={`flex ${metrics.gap}`}>
        <a
          href={`https://x.com/${tweet.author.handle}`}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0"
          aria-label={`${tweet.author.name} 프로필`}
        >
          <Avatar src={tweet.author.avatarUrl} name={tweet.author.name} size={metrics.avatar} />
        </a>

        <div className="min-w-0 flex-1">
          <AuthorLine tweet={tweet} metrics={metrics} />

          {tweet.replyToHandle && (
            <p className="mt-0.5 text-[13px] text-faint">
              <span className="text-accent">@{tweet.replyToHandle}</span> 님에게 보내는 답글
            </p>
          )}

          <div className="mt-1">
            <RichText text={tweet.text} className={`${metrics.text} ${metrics.clamp}`} />
          </div>

          {settings.showMedia && (
            <MediaGrid
              media={tweet.media}
              size={mediaSize}
              sourceUrl={tweet.url}
              onOpen={setLightboxAt}
            />
          )}
          {tweet.card && !tweet.media.length && settings.showMedia && (
            <LinkCard card={tweet.card} mediaSize={mediaSize} />
          )}
          {tweet.quoted && (
            <QuotedTweet
              tweet={tweet.quoted}
              showMedia={settings.showMedia}
              mediaSize={mediaSize}
              textClass={metrics.text}
            />
          )}

          <div className={`flex items-center gap-4 ${metrics.statsMargin}`}>
            <LinkAction
              icon={<ReplyIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.replies}
              label="답글 달기"
              tone="hover:bg-accent-soft hover:text-accent"
              onPress={() => openReplyComposer(tweet.id)}
            />
            <ToggleAction
              icon={<RepostIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.reposts}
              label="리포스트"
              tone="hover:bg-success/12 hover:text-success"
              activeClass="text-success"
              initial={Boolean(tweet.viewer?.reposted)}
              tweetUrl={tweet.url}
              on="repost"
              off="unrepost"
            />
            <ToggleAction
              icon={<LikeIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.likes}
              label="마음에 들어요"
              tone="hover:bg-danger/12 hover:text-danger"
              activeClass="text-danger"
              initial={Boolean(tweet.viewer?.liked)}
              tweetUrl={tweet.url}
              on="like"
              off="unlike"
            />
            <a
              href={tweet.url}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto text-[12.5px] text-faint opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover/card:opacity-100"
            >
              원문 보기
            </a>
          </div>
        </div>
      </div>

      {lightboxAt !== null && (
        <Lightbox
          media={tweet.media}
          startIndex={lightboxAt}
          sourceUrl={tweet.url}
          onClose={() => setLightboxAt(null)}
        />
      )}
    </article>
  )
}

export const TweetCard = memo(TweetCardBase)
