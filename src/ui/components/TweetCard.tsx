import { memo, useState } from 'react'
import type { Tweet } from '@core/types'
import type { Settings } from '@core/settings'
import { formatCount, formatRelative, formatStamp } from '../lib/format'
import { Lightbox } from './Lightbox'
import { MediaGrid } from './MediaGrid'
import { RichText } from './RichText'
import { LikeIcon, ReplyIcon, RepostIcon, VerifiedIcon, ViewsIcon } from './icons'

/**
 * 답글·리포스트·마음에 들어요는 x.com 공식 intent 페이지로 넘긴다.
 *
 * 내부 GraphQL 뮤테이션을 직접 호출하면 덱 안에서 처리할 수는 있지만, 그건 읽기만 하던
 * 확장이 사용자 계정으로 쓰기를 하는 것이고 계정 잠금 위험을 진다.
 * intent 페이지는 x.com 이 공개한 경로이고 최종 확인도 x.com 화면에서 이뤄진다.
 */
const INTENT = {
  reply: (id: string) => `https://x.com/intent/post?in_reply_to=${id}`,
  repost: (id: string) => `https://x.com/intent/retweet?tweet_id=${id}`,
  like: (id: string) => `https://x.com/intent/like?tweet_id=${id}`,
}

function Avatar({ src, name, size = 'md' }: { src: string; name: string; size?: 'md' | 'sm' }) {
  const dimension = size === 'md' ? 'h-10 w-10' : 'h-5 w-5'
  if (!src) {
    return <div className={`${dimension} shrink-0 rounded-full bg-surface-3`} aria-hidden="true" />
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      className={`${dimension} shrink-0 rounded-full bg-surface-3 object-cover`}
    />
  )
}

function AuthorLine({ tweet, compact }: { tweet: Tweet; compact: boolean }) {
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
      {!compact && tweet.stats.views ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-faint">
          <ViewsIcon className="h-3.5 w-3.5" />
          {formatCount(tweet.stats.views)}
        </span>
      ) : null}
    </div>
  )
}

function QuotedTweet({ tweet, showMedia }: { tweet: Tweet; showMedia: boolean }) {
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      className="mt-2.5 block rounded-xl border border-line p-3 transition-colors hover:border-line hover:bg-surface-2"
    >
      <div className="flex items-center gap-1.5 text-[13px]">
        <Avatar src={tweet.author.avatarUrl} name={tweet.author.name} size="sm" />
        <span className="truncate font-semibold text-text">{tweet.author.name}</span>
        <span className="truncate text-faint">@{tweet.author.handle}</span>
        <span className="text-faint">·</span>
        <span className="shrink-0 text-faint">{formatRelative(tweet.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-muted">
        <RichText text={tweet.text} />
      </div>
      {showMedia && <MediaGrid media={tweet.media} />}
    </a>
  )
}

function LinkCard({ card }: { card: NonNullable<Tweet['card']> }) {
  const Wrapper = card.url ? 'a' : 'div'
  return (
    <Wrapper
      {...(card.url
        ? { href: card.url, target: '_blank', rel: 'noreferrer noopener' as const }
        : {})}
      className={`mt-2.5 block overflow-hidden rounded-xl border border-line transition-colors ${
        card.url ? 'hover:bg-surface-2' : ''
      }`}
    >
      {card.imageUrl && (
        <img
          src={card.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-[1.91/1] w-full object-cover"
        />
      )}
      <div className="px-3 py-2.5">
        {card.domain && <p className="text-[12px] text-faint">{card.domain}</p>}
        <p className="mt-0.5 line-clamp-2 text-[14px] font-medium text-text">{card.title}</p>
        {card.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{card.description}</p>}
      </div>
    </Wrapper>
  )
}

/** 통계이면서 동시에 동작 버튼. 누르면 x.com intent 페이지가 새 탭으로 열린다. */
function StatAction({
  icon,
  value,
  label,
  href,
  tone,
}: {
  icon: React.ReactNode
  value: number
  label: string
  href: string
  tone: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label}
      aria-label={`${label} (${value.toLocaleString('ko-KR')})`}
      onClick={(event) => event.stopPropagation()}
      className={`-mx-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[12.5px] tabular-nums text-faint transition-colors ${tone}`}
    >
      {icon}
      {formatCount(value)}
    </a>
  )
}

export interface TweetCardProps {
  tweet: Tweet
  settings: Settings
  /** 새로 들어온 카드에만 등장 애니메이션을 준다. */
  animate?: boolean
}

function TweetCardBase({ tweet, settings, animate = false }: TweetCardProps) {
  const compact = settings.density === 'compact'
  const padding = compact ? 'px-3.5 py-2.5' : 'px-4 py-3.5'
  const [lightboxAt, setLightboxAt] = useState<number | null>(null)

  return (
    <article
      className={`group relative border-b border-line-soft transition-colors hover:bg-surface-2/60 ${padding} ${
        animate ? 'animate-enter' : ''
      }`}
    >
      {tweet.repostedBy && (
        <p className="mb-1.5 flex items-center gap-1.5 pl-[52px] text-[12.5px] font-medium text-faint">
          <RepostIcon className="h-3.5 w-3.5" />
          <span className="truncate">{tweet.repostedBy.name} 님이 리포스트</span>
        </p>
      )}

      <div className="flex gap-3">
        <a
          href={`https://x.com/${tweet.author.handle}`}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0"
          aria-label={`${tweet.author.name} 프로필`}
        >
          <Avatar src={tweet.author.avatarUrl} name={tweet.author.name} />
        </a>

        <div className="min-w-0 flex-1">
          <AuthorLine tweet={tweet} compact={compact} />

          {tweet.replyToHandle && (
            <p className="mt-0.5 text-[13px] text-faint">
              <span className="text-accent">@{tweet.replyToHandle}</span> 님에게 보내는 답글
            </p>
          )}

          <div className="mt-1">
            <RichText text={tweet.text} />
          </div>

          {settings.showMedia && <MediaGrid media={tweet.media} onOpen={setLightboxAt} />}
          {tweet.card && !tweet.media.length && settings.showMedia && <LinkCard card={tweet.card} />}
          {tweet.quoted && <QuotedTweet tweet={tweet.quoted} showMedia={settings.showMedia} />}

          <div className={`flex items-center gap-4 ${compact ? 'mt-1.5' : 'mt-2.5'}`}>
            <StatAction
              icon={<ReplyIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.replies}
              label="답글 달기"
              href={INTENT.reply(tweet.id)}
              tone="hover:bg-accent-soft hover:text-accent"
            />
            <StatAction
              icon={<RepostIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.reposts}
              label="리포스트"
              href={INTENT.repost(tweet.id)}
              tone="hover:bg-success/12 hover:text-success"
            />
            <StatAction
              icon={<LikeIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.likes}
              label="마음에 들어요"
              href={INTENT.like(tweet.id)}
              tone="hover:bg-danger/12 hover:text-danger"
            />
            <a
              href={tweet.url}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto text-[12.5px] text-faint opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
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
