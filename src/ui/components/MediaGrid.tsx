import { useState } from 'react'
import { MEDIA_MAX_HEIGHT, type MediaSize } from '@core/settings'
import type { TweetMedia } from '@core/types'
import { aspectRatio } from '../lib/format'
import { PlayIcon } from './icons'

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
  onOpen,
}: {
  media: TweetMedia
  /** 높이가 잘리는 크기에서는 채워서 자르고, 원본 크기에서는 비율을 지킨다. */
  fit: 'cover' | 'contain'
  sourceUrl: string
  onOpen: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const playable = media.kind !== 'photo' && Boolean(media.playbackUrl)

  if (playing && media.playbackUrl && !failed) {
    return (
      <video
        src={media.playbackUrl}
        poster={media.previewUrl}
        controls
        autoPlay
        playsInline
        preload="metadata"
        loop={media.kind === 'animated_gif'}
        muted={media.kind === 'animated_gif'}
        // 재생이 막히면 원문으로 넘기는 길을 열어준다.
        onError={() => setFailed(true)}
        className="h-full w-full bg-black object-contain"
      />
    )
  }

  if (failed) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="grid h-full w-full place-items-center bg-surface-2 px-4 text-center text-[13px] text-muted hover:text-accent"
      >
        재생할 수 없다 — x.com 에서 열기
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (playable) setPlaying(true)
        else onOpen()
      }}
      className="group relative block h-full w-full cursor-zoom-in overflow-hidden bg-surface-2"
      aria-label={media.altText ?? (playable ? '동영상 재생' : '이미지 원본 보기')}
    >
      <img
        src={media.previewUrl}
        alt={media.altText ?? ''}
        loading="lazy"
        decoding="async"
        className={`h-full w-full transition-transform duration-500 group-hover:scale-[1.02] ${
          fit === 'cover' ? 'object-cover' : 'object-contain'
        }`}
      />
      {playable && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70">
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

export interface MediaGridProps {
  media: TweetMedia[]
  /** 표시 크기. 작을수록 한 화면에 글이 많이 들어온다. */
  size: MediaSize
  /** 재생이 실패했을 때 열어줄 원문 주소. */
  sourceUrl: string
  /** 사진을 눌렀을 때 원본 보기를 띄운다. */
  onOpen?: (index: number) => void
}

export function MediaGrid({ media, size, sourceUrl, onOpen }: MediaGridProps) {
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
          <MediaItem media={item} fit={fit} sourceUrl={sourceUrl} onOpen={() => onOpen?.(index)} />
        </div>
      ))}
    </div>
  )
}
