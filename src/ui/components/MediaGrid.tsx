import { useState } from 'react'
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

function MediaItem({ media, single }: { media: TweetMedia; single: boolean }) {
  const [playing, setPlaying] = useState(false)
  const playable = media.kind !== 'photo' && Boolean(media.playbackUrl)

  if (playing && media.playbackUrl) {
    return (
      <video
        src={media.playbackUrl}
        poster={media.previewUrl}
        controls
        autoPlay
        loop={media.kind === 'animated_gif'}
        playsInline
        className="h-full w-full bg-black object-contain"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        if (playable) setPlaying(true)
      }}
      className="group relative block h-full w-full cursor-pointer overflow-hidden bg-surface-2"
      aria-label={media.altText ?? (playable ? '동영상 재생' : '이미지')}
    >
      <img
        src={media.previewUrl}
        alt={media.altText ?? ''}
        loading="lazy"
        decoding="async"
        className={`h-full w-full transition-transform duration-500 group-hover:scale-[1.02] ${
          single ? 'object-contain' : 'object-cover'
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

export function MediaGrid({ media }: { media: TweetMedia[] }) {
  if (media.length === 0) return null

  const single = media.length === 1
  const first = media[0]
  const ratio = single && first ? aspectRatio(first.width, first.height) : undefined

  return (
    <div
      className={`mt-2.5 grid gap-0.5 overflow-hidden rounded-xl border border-line-soft ${layoutClass(media.length)}`}
      style={single ? { aspectRatio: ratio } : { aspectRatio: '16 / 9' }}
    >
      {media.slice(0, 4).map((item, index) => (
        <div key={`${item.previewUrl}-${index}`} className={`min-h-0 ${itemClass(media.length, index)}`}>
          <MediaItem media={item} single={single} />
        </div>
      ))}
    </div>
  )
}
