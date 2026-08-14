import { memo, useState } from 'react'
import type { Tweet, TweetMedia } from '@core/types'
import {
  MEDIA_MAX_HEIGHT,
  smallerMediaSize,
  type MediaSize,
  type Settings,
} from '@core/settings'
import { runTweetAction, type ComposeMode, type TweetAction } from '../../content/actions'
import { formatCount, formatRelative, formatStamp } from '../lib/format'
import { Lightbox } from './Lightbox'
import { MediaGrid } from './MediaGrid'
import { PostComposer } from './PostComposer'
import { RichText } from './RichText'
import { TweetDetail } from './TweetDetail'
import { LikeIcon, QuoteIcon, ReplyIcon, RepostIcon, VerifiedIcon, ViewsIcon } from './icons'

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
 * 카드 안에서 상세를 열어도 되는 클릭인지.
 *
 * 카드에는 이미 제 할 일이 있는 것들이 잔뜩 있다. 링크·버튼·사진은 그 자리의
 * 동작이 우선하고, 열려 있는 대화상자 안의 클릭이 뒤로 새어 나와서도 안 된다.
 * 글을 긁는 중이었다면 그건 복사하려던 것이지 클릭이 아니다.
 */
function opensDetail(event: React.MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, video, [role="button"], [role="dialog"]')) return false
  return !window.getSelection()?.toString()
}

/**
 * 인용된 글. 배경과 테두리를 함께 줘서 원글 본문과 확실히 갈린다 —
 * 테두리만으로는 밝은 테마에서 거의 보이지 않는다.
 *
 * 상자 전체를 링크로 두지는 않는다. 그러면 사진을 눌러 확대하려 해도 x.com 새 창이
 * 떠버려서, 덱 안에서 끝내자는 원칙과 정면으로 부딪힌다.
 * 원문으로 나가는 길은 작성자 줄에만 둔다 — 원글 카드의 프로필 링크와 같은 규칙이다.
 *
 * 카드에 마우스가 올라가면 카드 배경이 surface-2 쪽으로 밝아진다. 인용 상자가 같은
 * 색이면 그 순간 경계가 사라지므로, 그때는 한 단계 더 진한 색으로 내려앉힌다.
 */
function QuotedTweet({
  tweet,
  showMedia,
  mediaSize,
  textClass,
  onOpenMedia,
  onOpenDetail,
}: {
  tweet: Tweet
  showMedia: boolean
  mediaSize: MediaSize
  textClass: string
  onOpenMedia: (index: number) => void
  onOpenDetail: () => void
}) {
  return (
    <div
      // 인용 상자 안의 클릭은 여기서 가로챈다. 그러지 않으면 원글 상세가 열린다.
      onClick={(event) => {
        if (!opensDetail(event)) return
        event.stopPropagation()
        onOpenDetail()
      }}
      className="mt-2.5 rounded-xl border border-line bg-surface-2 p-3 transition-colors group-hover/card:bg-surface-3 hover:border-accent/40"
    >
      <a
        href={tweet.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 text-[13px] hover:text-accent"
        aria-label={`${tweet.author.name} 님의 인용된 게시물 원문 보기`}
      >
        <Avatar src={tweet.author.avatarUrl} name={tweet.author.name} size={20} />
        <span className="truncate font-semibold text-text">{tweet.author.name}</span>
        <span className="truncate text-faint">@{tweet.author.handle}</span>
        <span className="text-faint">·</span>
        <span className="shrink-0 text-faint">{formatRelative(tweet.createdAt)}</span>
      </a>
      <div className="mt-1.5 text-muted">
        <RichText text={tweet.text} className={`${textClass} line-clamp-6`} />
      </div>
      {showMedia && (
        <MediaGrid
          media={tweet.media}
          size={smallerMediaSize(mediaSize)}
          sourceUrl={tweet.url}
          onOpen={onOpenMedia}
        />
      )}
    </div>
  )
}

/**
 * 링크 카드를 좌우로 눕히는 크기별 치수.
 *
 * 사진 높이만 깎으면 제목·설명·여백이 그대로 남아 카드가 실제로는 별로 짧아지지 않는다.
 * 그래서 아래 두 단계는 배치 자체를 바꿔 섬네일을 왼쪽으로 돌린다.
 * 여기 없는 단계(크게·원본)는 사진을 위에 크게 얹는 원래 배치를 쓴다.
 */
const CARD_SIDE_LAYOUT: Partial<
  Record<MediaSize, { image: string; minHeight: string; title: string; description: boolean }>
> = {
  // 제목 한 줄만 곁들인 목록형. 한 화면에 들어오는 글 수를 최대로 늘린다.
  small: { image: 'w-[92px]', minHeight: 'min-h-[62px]', title: 'text-[13.5px]', description: false },
  // 사진은 3분의 1만 쓰고 나머지는 기사 설명에 내준다.
  medium: { image: 'w-1/3', minHeight: 'min-h-[116px]', title: 'text-[14px]', description: true },
}

/** 링크 미리보기. 인용글과 같은 이유로 배경을 깔아 본문과 구분한다. */
function LinkCard({ card, mediaSize }: { card: NonNullable<Tweet['card']>; mediaSize: MediaSize }) {
  const Wrapper = card.url ? 'a' : 'div'
  const maxHeight = MEDIA_MAX_HEIGHT[mediaSize]
  const side = CARD_SIDE_LAYOUT[mediaSize]
  const linkProps = card.url
    ? { href: card.url, target: '_blank', rel: 'noreferrer noopener' as const }
    : {}
  // 인용 상자와 같은 이유로, 카드가 밝아지는 동안에는 한 단계 더 진하게 둔다.
  const shell = `mt-2.5 overflow-hidden rounded-xl border border-line bg-surface-2 transition-colors group-hover/card:bg-surface-3 ${
    card.url ? 'hover:border-accent/40' : ''
  }`

  if (side) {
    return (
      <Wrapper {...linkProps} className={`${shell} flex items-stretch ${side.minHeight}`}>
        {card.imageUrl && (
          // 글 높이에 맞춰 늘어나야 하므로 칸을 먼저 잡고 그 안을 사진으로 채운다.
          <div className={`relative shrink-0 self-stretch overflow-hidden bg-surface-3 ${side.image}`}>
            <img
              src={card.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
          {card.domain && <p className="truncate text-[12px] text-faint">{card.domain}</p>}
          <p className={`mt-0.5 line-clamp-2 font-medium leading-snug text-text ${side.title}`}>
            {card.title}
          </p>
          {side.description && card.description && (
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-muted">{card.description}</p>
          )}
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper {...linkProps} className={`${shell} block`}>
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
 * 켜고 끌 수 있는 동작의 공통 상태 (하트·리포스트).
 * 화면은 즉시 바꾸고, 실제 반영은 보이지 않는 x.com 페이지에서 진행한다.
 * 실패하면 표시를 되돌리고 이유를 남긴다.
 */
function useToggleAction(
  initial: boolean,
  tweetUrl: string,
  on: TweetAction,
  off: TweetAction,
  report: (message: string | null) => void,
  /** 반영이 끝난 뒤 알릴 곳. 타임라인에 흔적을 남기는 동작에만 준다. */
  onDone?: () => void,
) {
  const [active, setActive] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    if (busy) return
    const next = !active
    setActive(next)
    setBusy(true)
    setError(null)
    report(null)
    try {
      await runTweetAction(tweetUrl, next ? on : off)
      onDone?.()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '실패했다'
      setActive(!next)
      setError(message)
      report(message)
    } finally {
      setBusy(false)
    }
  }

  return { active, busy, error, toggle }
}

/** 낙관적 표시. 서버 개수는 다음 수집분에서 따라온다. */
const shownCount = (value: number, initial: boolean, active: boolean): number =>
  value + (active === initial ? 0 : active ? 1 : -1)

/**
 * 누르면 바로 켜고 끄는 동작 (하트).
 * 하트는 타임라인에 아무 것도 남기지 않으므로 끝나도 컬럼을 다시 받지 않는다.
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
  report,
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
  /** 실패 이유를 카드 쪽에 올려 눈에 보이게 한다. */
  report: (message: string | null) => void
}) {
  const { active, busy, error, toggle } = useToggleAction(initial, tweetUrl, on, off, report)
  const shown = shownCount(value, initial, active)

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={active}
      title={error ? `${label} 실패 — ${error}` : label}
      aria-label={`${label} (${shown.toLocaleString('ko-KR')})`}
      onClick={(event) => {
        event.stopPropagation()
        void toggle()
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

function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text transition-colors hover:bg-surface-2"
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * 리포스트. x.com 과 마찬가지로 누르면 먼저 고르게 한다 —
 * 그대로 올릴지, 한마디 붙여 인용할지.
 */
function RepostAction({
  value,
  initial,
  tweetUrl,
  onQuote,
  report,
  onActed,
}: {
  value: number
  initial: boolean
  tweetUrl: string
  onQuote: () => void
  report: (message: string | null) => void
  onActed: () => void
}) {
  const [open, setOpen] = useState(false)
  const { active, busy, error, toggle } = useToggleAction(
    initial,
    tweetUrl,
    'repost',
    'unrepost',
    report,
    onActed,
  )
  const shown = shownCount(value, initial, active)

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={error ? `리포스트 실패 — ${error}` : '리포스트'}
        aria-label={`리포스트 (${shown.toLocaleString('ko-KR')})`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className={`${ACTION_BASE} hover:bg-success/12 hover:text-success ${
          error ? 'text-danger' : active ? 'text-success' : 'text-faint'
        } ${busy ? 'opacity-60' : ''}`}
      >
        <RepostIcon className="h-3.5 w-3.5" />
        {formatCount(shown)}
      </button>

      {open && (
        <>
          {/* 바깥을 눌러 닫는 길. 문서 리스너는 오버레이가 끊으므로 화면을 덮어서 받는다. */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="animate-fade absolute bottom-full left-0 z-50 mb-1.5 w-36 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg shadow-black/30"
          >
            <MenuItem
              icon={<RepostIcon className="h-4 w-4 text-faint" />}
              label={active ? '리포스트 취소' : '리포스트'}
              onSelect={() => {
                setOpen(false)
                void toggle()
              }}
            />
            <MenuItem
              icon={<QuoteIcon className="h-4 w-4 text-faint" />}
              label="인용"
              onSelect={() => {
                setOpen(false)
                onQuote()
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

/** 원본 보기로 띄울 대상. 원글과 인용글이 각자의 사진 묶음을 갖는다. */
interface LightboxTarget {
  media: TweetMedia[]
  index: number
  sourceUrl: string
}

/** 상세 창으로 띄울 게시물. 원글이냐 인용글이냐는 어디를 눌렀는지가 정한다. */
interface DetailTarget {
  url: string
  handle: string
}

export interface TweetCardProps {
  tweet: Tweet
  settings: Settings
  /** 새로 들어온 카드에만 등장 애니메이션을 준다. */
  animate?: boolean
  /** 타임라인에 흔적이 남는 일을 마친 직후 (리포스트·인용·답글). 그 컬럼을 새로 받는 신호다. */
  onActed: () => void
}

function TweetCardBase({ tweet, settings, animate = false, onActed }: TweetCardProps) {
  const metrics = METRICS[settings.density]
  const mediaSize = metrics.shrinkMedia ? smallerMediaSize(settings.mediaSize) : settings.mediaSize
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null)
  const [composer, setComposer] = useState<ComposeMode | null>(null)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  // 동작 실패 이유. 툴팁에만 두면 아무도 모른 채 숫자만 되돌아간다.
  const [actionError, setActionError] = useState<string | null>(null)
  const quoted = tweet.quoted

  /** 카드를 누르면 답글까지 함께 보는 상세를 연다 — x.com 과 같은 감각이다. */
  const openDetail = (event: React.MouseEvent<HTMLElement>) => {
    if (!opensDetail(event)) return
    setDetail({ url: tweet.url, handle: tweet.author.handle })
  }

  return (
    <article
      onClick={openDetail}
      className={`group/card relative cursor-pointer border-b border-line-soft transition-colors hover:bg-surface-2/60 ${metrics.padding} ${
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
              onOpen={(index) => setLightbox({ media: tweet.media, index, sourceUrl: tweet.url })}
            />
          )}
          {tweet.card && !tweet.media.length && settings.showMedia && (
            <LinkCard card={tweet.card} mediaSize={mediaSize} />
          )}
          {quoted && (
            <QuotedTweet
              tweet={quoted}
              showMedia={settings.showMedia}
              mediaSize={mediaSize}
              textClass={metrics.text}
              onOpenMedia={(index) => setLightbox({ media: quoted.media, index, sourceUrl: quoted.url })}
              onOpenDetail={() => setDetail({ url: quoted.url, handle: quoted.author.handle })}
            />
          )}

          <div className={`flex items-center gap-4 ${metrics.statsMargin}`}>
            <LinkAction
              icon={<ReplyIcon className="h-3.5 w-3.5" />}
              value={tweet.stats.replies}
              label="답글 달기"
              tone="hover:bg-accent-soft hover:text-accent"
              onPress={() => setComposer('reply')}
            />
            <RepostAction
              value={tweet.stats.reposts}
              initial={Boolean(tweet.viewer?.reposted)}
              tweetUrl={tweet.url}
              onQuote={() => setComposer('quote')}
              report={setActionError}
              onActed={onActed}
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
              report={setActionError}
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

          {actionError && (
            <p className="mt-1.5 text-[12px] text-danger" role="status">
              x.com 에 반영하지 못했다 — {actionError}
            </p>
          )}
        </div>
      </div>

      {detail && (
        <TweetDetail url={detail.url} handle={detail.handle} onClose={() => setDetail(null)} />
      )}

      {composer && (
        <PostComposer
          mode={composer}
          target={{ id: tweet.id, url: tweet.url }}
          handle={tweet.author.handle}
          onPosted={onActed}
          onClose={() => setComposer(null)}
        />
      )}

      {lightbox && (
        <Lightbox
          media={lightbox.media}
          startIndex={lightbox.index}
          sourceUrl={lightbox.sourceUrl}
          onClose={() => setLightbox(null)}
        />
      )}
    </article>
  )
}

export const TweetCard = memo(TweetCardBase)
