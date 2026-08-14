import { useEffect, useRef, useState } from 'react'
import { MEDIA_MAX_HEIGHT, type MediaMode, type MediaSize } from '@core/settings'
import type { TweetMedia } from '@core/types'
import { distanceFromCenter, reportCandidate } from '../lib/autoplay'
import { aspectRatio } from '../lib/format'
import { applyVolume, rememberVolume } from '../lib/volume'
import { ImageIcon, PlayIcon } from './icons'

/** 장수별 격자 배치. x.com 과 같은 규칙을 따른다. */
function layoutClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 3) return 'grid-cols-2 grid-rows-2'
  return 'grid-cols-2'
}

function itemClass(count: number, index: number): string {
  // 3장일 때 첫 장이 왼쪽 전체 높이를 차지한다.
  return count === 3 && index === 0 ? 'row-span-2' : ''
}

function MediaItem({
  media,
  fit,
  sourceUrl,
  hoverPlay,
  siblings,
  onOpen,
}: {
  media: TweetMedia
  /** 높이가 잘리는 크기에서는 채워서 자르고, 원본 크기에서는 비율을 지킨다. */
  fit: 'cover' | 'contain'
  sourceUrl: string
  hoverPlay: boolean
  /** 같은 카드에 붙은 미디어 수. 하나뿐이면 누가 도는지 겨룰 것도 없다. */
  siblings: number
  onOpen: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [hovered, setHovered] = useState(false)
  /** 이 영상이 실린 카드를 지금 가리키고 있거나 그 안에 포커스가 있는지. */
  const [cardActive, setCardActive] = useState(false)
  /** 겨룸에서 이겨 저절로 돌고 있는 상태. */
  const [centered, setCentered] = useState(false)
  /** 사용자가 눌러 소리를 켠 상태. 한 번 켜면 화면을 벗어나도 계속 돈다. */
  const [engaged, setEngaged] = useState(false)
  const hostRef = useRef<HTMLButtonElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const playable = media.kind !== 'photo' && Boolean(media.playbackUrl)
  const silent = media.kind === 'animated_gif'
  /** 같은 카드에 미디어가 여럿일 때만 누가 돌지 겨룬다. */
  const contested = siblings > 1

  /**
   * 돌아야 하는지.
   *
   *   1순위 — 이 영상을 직접 가리켰다.
   *   2순위 — 이 영상이 실린 카드를 가리켰거나 그 안에 포커스가 있다.
   *           카드에 미디어가 여럿이면 그중 화면 가운데에 가장 가까운 하나만.
   *   그리고 한 번 소리를 켠 영상은 조건과 무관하게 계속 돈다.
   */
  const showVideo =
    playable &&
    !failed &&
    (engaged || (hoverPlay && (hovered || (cardActive && (!contested || centered)))))

  /**
   * 이 영상이 실린 카드를 지금 보고 있는지 지켜본다.
   *
   * 영상 자체가 아니라 카드 전체를 기준으로 삼는다 — 글을 읽으려고 카드 위에
   * 마우스를 둔 것만으로도 그 글의 영상은 볼 뜻이 있는 것이고, 반대로 지나가는
   * 카드의 영상까지 돌 이유는 없다. 키보드로 옮겨 다닐 때를 위해 포커스도 함께 본다.
   */
  useEffect(() => {
    const node = hostRef.current
    if (!hoverPlay || !playable || !node) return
    const card = node.closest('article')
    if (!card) return

    const enter = () => setCardActive(true)
    const leave = () => setCardActive(false)
    card.addEventListener('mouseenter', enter)
    card.addEventListener('mouseleave', leave)
    card.addEventListener('focusin', enter)
    card.addEventListener('focusout', leave)
    return () => {
      card.removeEventListener('mouseenter', enter)
      card.removeEventListener('mouseleave', leave)
      card.removeEventListener('focusin', enter)
      card.removeEventListener('focusout', leave)
    }
  }, [hoverPlay, playable])

  /**
   * 미디어가 여럿인 카드에서 누가 돌지 겨룬다. 화면 가운데에 가장 가까운 하나가 이긴다.
   *
   * 하나뿐인 카드는 여기까지 오지 않는다 — 겨룰 상대가 없는데 관찰자를 붙이면
   * 그 응답을 기다리는 만큼 재생이 늦고, 그 경로가 어긋나면 카드를 가리켜도 영영
   * 돌지 않는다. 목록에 깔리는 관찰자 수도 그만큼 줄어든다.
   *
   * 관찰자는 조상의 잘림까지 셈에 넣으므로 컬럼 밖으로 밀려난 카드는 저절로 빠진다.
   * 문턱을 촘촘히 두는 것은 스크롤 도중에도 승자가 따라 바뀌게 하기 위해서다.
   */
  useEffect(() => {
    const node = hostRef.current
    if (!hoverPlay || !playable || !contested || !cardActive || !node) {
      setCentered(false)
      return
    }

    const token = {}
    const group = node.closest('.scroll-thin')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          reportCandidate(token, null)
          setCentered(false)
          return
        }
        reportCandidate(token, {
          group,
          distance: distanceFromCenter(entry.boundingClientRect),
          visible: entry.intersectionRatio,
          play: setCentered,
        })
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      reportCandidate(token, null)
      setCentered(false)
    }
  }, [hoverPlay, playable, contested, cardActive])

  /**
   * 소리는 요소를 바꾸지 않고 켠다. 눌렀다고 새 영상을 갈아 끼우면 보던 위치가
   * 처음으로 돌아간다 — 재생바를 잡아 옮기던 중이었다면 더 그렇다.
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (engaged && !silent) applyVolume(video)
    else video.muted = true
  }, [engaged, silent, showVideo])

  if (failed) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="grid h-full w-full place-items-center bg-surface-2 px-4 text-center text-[13px] text-muted hover:text-accent"
      >
        재생할 수 없습니다 — x.com 에서 열기
      </a>
    )
  }

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (playable) setEngaged(true)
        else onOpen()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // 눌렀을 때 할 일이 다르면 커서도 달라야 한다. 동영상·GIF 는 그 자리에서
      // 재생되고, 사진만 원본 보기로 확대된다.
      className={`group/media relative block h-full w-full overflow-hidden bg-surface-2 ${
        playable ? 'cursor-pointer' : 'cursor-zoom-in'
      }`}
      aria-label={media.altText ?? (playable ? '동영상 재생' : '이미지 원본 보기')}
    >
      {/* 확대 효과는 두지 않는다. 카드 어디에 마우스를 올려도 섬네일이 들썩여 읽기를 방해한다. */}
      {showVideo && media.playbackUrl ? (
        <video
          ref={videoRef}
          src={media.playbackUrl}
          poster={media.previewUrl}
          // 재생바는 마우스를 올렸을 때만 띄운다. 저절로 도는 동안에도 늘 떠 있으면
          // 목록이 조작 장치로 뒤덮인다.
          controls={hovered || engaged}
          autoPlay
          playsInline
          preload="metadata"
          // 소리를 켜기 전까지는 되돌아 돈다. 소리를 켠 영상은 끝나면 멈춘다.
          loop={silent || !engaged}
          muted
          // 재생바를 잡아 옮겼다는 것은 이미 이 영상을 보기로 한 것이다. 누른 것과
          // 똑같이 다뤄 소리를 켠다. 되돌아 도느라 처음으로 돌아가는 것은 사용자가
          // 한 일이 아니므로 시작점 근처는 셈에서 뺀다.
          onSeeking={(event) => {
            if (event.currentTarget.currentTime > 0.05) setEngaged(true)
          }}
          onVolumeChange={(event) => {
            if (engaged && !silent) rememberVolume(event.currentTarget)
          }}
          onError={() => setFailed(true)}
          className={`h-full w-full bg-black ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      ) : (
        <img
          src={media.previewUrl}
          alt={media.altText ?? ''}
          loading="lazy"
          decoding="async"
          className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      )}
      {playable && !showVideo && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover/media:bg-black/70">
            <PlayIcon className="h-5 w-5 translate-x-[1px]" />
          </span>
        </span>
      )}
      {media.kind === 'animated_gif' && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
          GIF
        </span>
      )}
    </button>
  )
}

/** 무엇이 몇 개 붙어 있는지 한 줄로. 없는 종류는 아예 적지 않는다. */
function summarize(media: TweetMedia[]): string {
  const count = (kind: TweetMedia['kind']) => media.filter((item) => item.kind === kind).length
  return (
    [
      count('photo') && `사진 ${count('photo')}`,
      count('video') && `동영상 ${count('video')}`,
      count('animated_gif') && `GIF ${count('animated_gif')}`,
    ]
      .filter(Boolean)
      .join(' · ') || `첨부 ${media.length}`
  )
}

/**
 * 미디어가 들어갈 자리.
 *
 * 라벨 모드에서는 무엇이 붙어 있는지만 알려주고, 눌러야 그 자리에서 펼친다.
 * 펼친 상태는 카드마다 따로 기억한다 — 하나 열었다고 목록 전체가 열리면
 * 라벨로 둔 뜻이 없어진다.
 */
export function MediaSlot({
  media,
  mode,
  size,
  sourceUrl,
  hoverPlay,
  onOpen,
}: {
  media: TweetMedia[]
  mode: MediaMode
  size: MediaSize
  sourceUrl: string
  hoverPlay: boolean
  onOpen?: (index: number) => void
}) {
  const [revealed, setRevealed] = useState(false)

  if (mode === 'hide' || media.length === 0) return null

  if (mode === 'label' && !revealed) {
    const playable = media.some((item) => item.kind !== 'photo')
    const Glyph = playable ? PlayIcon : ImageIcon
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setRevealed(true)
        }}
        className="mt-2.5 flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px] font-medium text-muted transition-colors hover:border-button hover:text-text"
      >
        <Glyph className="h-3.5 w-3.5" />
        {summarize(media)} 보기
      </button>
    )
  }

  return (
    <MediaGrid
      media={media}
      size={size}
      sourceUrl={sourceUrl}
      hoverPlay={hoverPlay}
      onOpen={onOpen}
    />
  )
}

export interface MediaGridProps {
  media: TweetMedia[]
  /** 표시 크기. 작을수록 한 화면에 글이 많이 들어온다. */
  size: MediaSize
  /** 재생이 실패했을 때 열어줄 원문 주소. */
  sourceUrl: string
  /** 마우스를 올린 것만으로 미리 재생할지. */
  hoverPlay: boolean
  /** 사진을 눌렀을 때 원본 보기를 띄운다. */
  onOpen?: (index: number) => void
}

export function MediaGrid({ media, size, sourceUrl, hoverPlay, onOpen }: MediaGridProps) {
  if (media.length === 0) return null

  const single = media.length === 1
  const first = media[0]
  const maxHeight = MEDIA_MAX_HEIGHT[size]
  const ratio = single && first ? aspectRatio(first.width, first.height) : 16 / 9

  const style: React.CSSProperties = { aspectRatio: ratio }
  if (maxHeight !== null) style.maxHeight = maxHeight

  // 높이를 자르는 크기에서는 여백이 생기지 않도록 채워서 자른다.
  const fit: 'cover' | 'contain' = maxHeight === null && single ? 'contain' : 'cover'

  return (
    <div
      className={`mt-2.5 grid gap-0.5 overflow-hidden rounded-xl border border-line-soft ${layoutClass(media.length)}`}
      style={style}
    >
      {media.slice(0, 4).map((item, index) => (
        <div key={`${item.previewUrl}-${index}`} className={`min-h-0 ${itemClass(media.length, index)}`}>
          <MediaItem
            media={item}
            fit={fit}
            sourceUrl={sourceUrl}
            hoverPlay={hoverPlay}
            siblings={media.length}
            onOpen={() => onOpen?.(index)}
          />
        </div>
      ))}
    </div>
  )
}
