import { useCallback, useEffect, useState } from 'react'
import type { TweetMedia } from '@core/types'
import { originalMediaUrl } from '../lib/format'
import { applyVolume, rememberVolume } from '../lib/volume'
import { CloseIcon } from './icons'

export interface LightboxProps {
  media: TweetMedia[]
  startIndex: number
  /** 원문으로 건너뛸 링크. */
  sourceUrl: string
  onClose: () => void
}

/** 이미지 원본 보기. 화살표·Esc 로 조작하고, 배경을 누르면 닫힌다. */
export function Lightbox({ media, startIndex, sourceUrl, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex)
  const total = media.length
  const current = media[Math.min(index, total - 1)]

  const move = useCallback(
    (delta: number) => {
      setIndex((prev) => (prev + delta + total) % total)
    },
    [total],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') move(1)
      else if (event.key === 'ArrowLeft') move(-1)
      else return
      event.preventDefault()
    }
    // 캡처 단계로 받는다. 덱 오버레이가 키 이벤트를 x.com 쪽으로 못 가게 끊기 때문에
    // 버블 단계에서는 window 까지 올라오지 않는다.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [move, onClose])

  if (!current) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 원본 보기"
      onClick={onClose}
      className="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/92 backdrop-blur-sm"
    >
      <header
        className="flex h-14 shrink-0 items-center gap-3 px-4 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        {total > 1 && (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12.5px] tabular-nums">
            {index + 1} / {total}
          </span>
        )}
        <a
          href={originalMediaUrl(current.previewUrl)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] text-white/70 underline-offset-2 hover:text-white hover:underline"
        >
          새 탭에서 원본 열기
        </a>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] text-white/70 underline-offset-2 hover:text-white hover:underline"
        >
          원문 게시물
        </a>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-9 w-9 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="닫기"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      {/*
        사진이 여러 장이면 양옆을 단추 폭만큼 비워 둔다. 그러지 않으면 가로로 넓은
        사진이 화면 끝까지 뻗어 단추 자리를 그대로 덮는다 — 단추는 사진 위에 묻혀
        보이지 않고, 그 자리를 눌러도 사진이 눌릴 뿐 다음 장으로 넘어가지 않는다.
        세로로 긴 사진에서는 양옆이 비어 있어 멀쩡히 보였으니, 사진에 따라 됐다 안
        됐다 하는 것처럼 보였다.
      */}
      <div
        className={`flex min-h-0 flex-1 items-center justify-center pb-6 ${total > 1 ? 'px-16' : 'px-4'}`}
      >
        {current.playbackUrl ? (
          <video
            src={current.playbackUrl}
            poster={current.previewUrl}
            controls
            autoPlay
            playsInline
            // GIF 는 소리가 없다. 나머지 영상만 덱이 함께 쓰는 소리 크기를 따른다.
            {...(current.kind === 'animated_gif'
              ? { loop: true, muted: true }
              : {
                  ref: applyVolume,
                  onVolumeChange: (event: React.SyntheticEvent<HTMLVideoElement>) =>
                    rememberVolume(event.currentTarget),
                })}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <img
            src={originalMediaUrl(current.previewUrl)}
            alt={current.altText ?? ''}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full cursor-default object-contain"
          />
        )}
      </div>

      {total > 1 && (
        <>
          <NavButton side="left" onClick={() => move(-1)} />
          <NavButton side="right" onClick={() => move(1)} />
        </>
      )}
    </div>
  )
}

/**
 * 앞뒤 사진으로 넘기는 단추.
 *
 * 사진 쪽에 자리를 비워 두었지만(위), 그것만 믿지 않는다. 배경을 검게 깔고 흰 테두리를
 * 둘러 밝은 사진 위에서도 모양이 남게 하고, z-10 으로 사진보다 위에 놓아 눌리는 것도
 * 이 단추가 되게 한다.
 */
function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={side === 'left' ? '이전 이미지' : '다음 이미지'}
      className={`absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/30 backdrop-blur-sm transition-colors hover:bg-black/80 ${
        side === 'left' ? 'left-4' : 'right-4'
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
