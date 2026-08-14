import { memo, useState } from 'react'
import type { Settings } from '@core/settings'
import type { DeckNotification, NotificationIcon, TweetAuthor } from '@core/types'
import { formatRelative, formatStamp } from '../lib/format'
import { LikeIcon, RepostIcon, ReplyIcon } from './icons'
import { TweetDetail } from './TweetDetail'

/** 얼굴을 몇 개까지 늘어놓을지. 넘치면 숫자로 접는다. */
const FACE_LIMIT = 6

/** 팔로우 알림용. 여기서만 쓰는 그림이라 공용 아이콘 모음에 두지 않는다. */
const PersonAddIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M18.5 8.5v5M21 11h-5" />
  </svg>
)

const ICONS: Record<NotificationIcon, { Glyph: typeof LikeIcon; tone: string }> = {
  like: { Glyph: LikeIcon, tone: 'text-danger' },
  repost: { Glyph: RepostIcon, tone: 'text-success' },
  follow: { Glyph: PersonAddIcon, tone: 'text-accent' },
  mention: { Glyph: ReplyIcon, tone: 'text-accent' },
  other: { Glyph: ReplyIcon, tone: 'text-faint' },
}

function Face({ actor, size }: { actor: TweetAuthor; size: number }) {
  const style = { width: size, height: size }
  if (!actor.avatarUrl) {
    return <span style={style} className="shrink-0 rounded-full bg-surface-3" aria-hidden="true" />
  }
  return (
    <img
      src={actor.avatarUrl}
      alt={actor.name}
      title={`@${actor.handle}`}
      loading="lazy"
      decoding="async"
      style={style}
      className="shrink-0 rounded-full bg-surface-3 object-cover"
    />
  )
}

export interface NotificationCardProps {
  notification: DeckNotification
  settings: Settings
  animate?: boolean
}

/**
 * 게시물이 아닌 알림 한 줄 (좋아요·팔로우·리포스트 등).
 *
 * 문구는 x.com 이 만들어 준 문장을 그대로 쓴다. 우리가 다시 지으면 지역화도,
 * '외 3명' 같은 묶음 계산도 전부 새로 해야 하는데 그럴 이유가 없다.
 * 대상 게시물이 딸려 있으면 본문 몇 줄만 접어서 함께 보여준다 — 무엇에 대한
 * 알림인지 카드를 열지 않고도 알 수 있어야 한다.
 */
function NotificationCardBase({ notification, settings, animate = false }: NotificationCardProps) {
  const [detail, setDetail] = useState(false)
  const { Glyph, tone } = ICONS[notification.icon]
  const compact = settings.density === 'compact'
  const target = notification.target
  const faces = notification.actors.slice(0, FACE_LIMIT)
  const rest = notification.actors.length - faces.length

  return (
    <article
      onClick={() => {
        if (!target || window.getSelection()?.toString()) return
        setDetail(true)
      }}
      className={`group/card relative border-b border-line-soft transition-colors hover:bg-surface-2/60 ${
        compact ? 'px-3 py-2' : 'px-4 py-3.5'
      } ${target ? 'cursor-pointer' : ''} ${animate ? 'animate-enter' : ''}`}
    >
      <div className={`flex ${compact ? 'gap-2.5' : 'gap-3'}`}>
        <Glyph className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} />

        <div className="min-w-0 flex-1">
          {faces.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {faces.map((actor, index) => (
                <Face key={`${actor.id}-${index}`} actor={actor} size={compact ? 22 : 28} />
              ))}
              {rest > 0 && <span className="text-[12.5px] text-faint">외 {rest}명</span>}
            </div>
          )}

          <p className={`text-text ${compact ? 'text-[13.5px]' : 'text-[14.5px]'} leading-snug`}>
            {notification.text}
          </p>

          {target && (
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-muted">{target.text}</p>
          )}

          <time
            dateTime={new Date(notification.createdAt).toISOString()}
            title={formatStamp(notification.createdAt)}
            className="mt-1.5 block text-[12px] text-faint"
          >
            {formatRelative(notification.createdAt)}
          </time>
        </div>
      </div>

      {detail && target && (
        <TweetDetail
          url={target.url}
          handle={target.author.handle}
          onClose={() => setDetail(false)}
        />
      )}
    </article>
  )
}

export const NotificationCard = memo(NotificationCardBase)
