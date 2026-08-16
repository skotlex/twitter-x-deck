import { useEffect, useRef, useState } from 'react'
import { MEDIA_MAX_HEIGHT, type MediaMode, type MediaSize } from '@core/settings'
import type { TweetMedia } from '@core/types'
import { useColumnActivity } from '../columnActivity'
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

/** 가리킨 영역에서 돌 영상을 고르는 표식. 영역 안에서 맨 앞에 달린 것 하나가 대표다. */
const PLAYABLE_MARK = 'data-playable'

/**
 * 카드 안에서 따로 떼어 볼 영역의 표식.
 *
 * 인용 상자가 여기에 해당한다 — 인용 상자를 가리키면 그 안 영상이, 원글 쪽을
 * 가리키면 원글 영상이 돈다. 상자가 눈에 띄게 갈려 있으니 어느 쪽을 볼 셈인지도
 * 마우스 위치로 갈린다.
 */
export const MEDIA_REGION_MARK = 'data-media-region'

/** 이 요소가 든 영역. 표식이 붙은 상자가 있으면 그 상자, 없으면 카드 전체다. */
function regionOf(node: Element): Element | null {
  return node.closest(`[${MEDIA_REGION_MARK}]`) ?? node.closest('article')
}

function MediaItem({
  media,
  fit,
  sourceUrl,
  hoverPlay,
  onOpen,
}: {
  media: TweetMedia
  /** 높이가 잘리는 크기에서는 채워서 자르고, 원본 크기에서는 비율을 지킨다. */
  fit: 'cover' | 'contain'
  sourceUrl: string
  hoverPlay: boolean
  onOpen: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [hovered, setHovered] = useState(false)
  /** 이 영상이 실린 영역을 지금 보고 있고, 그 영역의 대표 영상이 이것인지. */
  const [regionLeads, setRegionLeads] = useState(false)
  /** 사용자가 눌러 소리를 켠 상태. 한 번 켜면 마우스가 떠나도 계속 돈다. */
  const [engaged, setEngaged] = useState(false)
  const hostRef = useRef<HTMLButtonElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const playable = media.kind !== 'photo' && Boolean(media.playbackUrl)
  const silent = media.kind === 'animated_gif'

  /**
   * 돌아야 하는지.
   *
   *   1순위 — 이 영상을 직접 가리켰다.
   *   2순위 — 이 영상이 실린 영역을 가리켰거나 그 안에 포커스가 있다.
   *           한 영역에 영상이 여럿이면 맨 앞 하나만 돈다.
   *   그리고 한 번 소리를 켠 영상은 조건과 무관하게 계속 돈다.
   */
  const showVideo = playable && !failed && (engaged || (hoverPlay && (hovered || regionLeads)))

  // 영상이 도는 동안에는 새 글을 목록에 끼워 넣지 않는다 — 보고 있던 화면이
  // 그 높이만큼 아래로 밀려난다. 그동안 온 글은 알약으로 세워둔다.
  useColumnActivity(showVideo)

  /**
   * 이 영상이 든 영역을 지금 보고 있는지 지켜본다.
   *
   * 영상 자체가 아니라 그 영상이 든 영역을 기준으로 삼는다 — 글을 읽으려고 그 위에
   * 마우스를 둔 것만으로도 그 글의 영상은 볼 뜻이 있는 것이고, 반대로 지나가는
   * 카드의 영상까지 돌 이유는 없다. 키보드로 옮겨 다닐 때를 위해 포커스도 함께 본다.
   *
   * 한 영역에서 도는 영상은 하나다. 문서 순서로 맨 앞의 영상을 그때그때 찾으므로,
   * 라벨 모드에서 한쪽만 펼쳐 두었을 때처럼 목록이 도중에 바뀌어도 대표가 어긋나지
   * 않는다. 마우스가 어디에 있는지는 카드 전체에서 지켜본다 — 원글과 인용 상자
   * 사이를 오갈 때는 카드를 벗어나지 않아 각 영역의 mouseenter 만으로는 모자란다.
   */
  useEffect(() => {
    const node = hostRef.current
    if (!hoverPlay || !playable || !node) return
    const card = node.closest('article')
    const region = regionOf(node)
    if (!card || !region) return

    /** 지금 가리킨(또는 포커스가 간) 곳이 내 영역이고, 그 영역의 대표가 나인지. */
    const active = (target: EventTarget | null) =>
      target instanceof Element &&
      regionOf(target) === region &&
      region.querySelector(`[${PLAYABLE_MARK}]`) === node

    // 영역 안을 옮겨 다녀도 같은 값이 다시 계산될 뿐이고, 원글 ↔ 인용 상자로 건너가는
    // 순간에만 값이 갈린다. 그래서 영역별 mouseenter 대신 카드에서 올라오는 이벤트를 본다.
    const enter = (event: Event) => setRegionLeads(active(event.target))
    const leave = () => setRegionLeads(false)

    /** 마우스가 지금 내 영역 위에 있는지. 안에 든 별도 영역(인용 상자) 위는 셈에서 뺀다. */
    const pointerInside = () =>
      region.matches(':hover') && !region.querySelector(`[${MEDIA_REGION_MARK}]:hover`)

    /**
     * 포커스를 잃었다고 다 떠난 것은 아니다.
     *
     * 카드 안 버튼을 누르면 포커스가 카드 밖으로 밀려나는 일이 여럿 있다 — 처리하는
     * 동안 그 버튼이 비활성화되기도 하고(비활성화된 요소는 포커스를 잃는다), 번역이
     * 띄운 숨은 프레임이 제 입력란에 포커스를 가져가기도 한다. 그걸 이탈로 세면
     * 보고 있던 영상이 버튼을 눌렀다는 이유만으로 멈춘다.
     *
     * 그래서 두 가지를 먼저 본다 — 마우스가 아직 내 영역 위에 있으면 무엇이 포커스를
     * 가져갔든 이쪽을 보고 있는 것이고, 포커스가 카드 안에서 자리만 옮겼거나 아예
     * 사라진 것도 떠난 것이 아니다.
     */
    const leaveFocus = (event: FocusEvent) => {
      if (pointerInside()) return
      const next = event.relatedTarget as Node | null
      if (next === null || card.contains(next)) return
      leave()
    }

    card.addEventListener('mouseover', enter)
    card.addEventListener('mouseleave', leave)
    card.addEventListener('focusin', enter)
    card.addEventListener('focusout', leaveFocus)
    return () => {
      card.removeEventListener('mouseover', enter)
      card.removeEventListener('mouseleave', leave)
      card.removeEventListener('focusin', enter)
      card.removeEventListener('focusout', leaveFocus)
    }
  }, [hoverPlay, playable])

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
        event.stopPropagation()
        if (!playable) {
          event.preventDefault()
          onOpen()
          return
        }
        // 영상이 이미 떠 있으면 기본 동작을 막지 않는다. 눌러서 재생·정지하는 것은
        // 브라우저가 해주는 일인데, 여기서 막으면 재생 버튼 위에서만 듣게 된다.
        if (!showVideo) event.preventDefault()
        setEngaged(true)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...(playable ? { [PLAYABLE_MARK]: '' } : {})}
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
            onOpen={() => onOpen?.(index)}
          />
        </div>
      ))}
    </div>
  )
}
