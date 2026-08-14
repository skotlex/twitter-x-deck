import { useCallback, useEffect, useState } from 'react'
import type { TweetMedia } from '@core/types'
import { originalMediaUrl } from '../lib/format'
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
    window.addEventListener('keydown', onKey)
    // 뒤쪽 컬럼이 같이 스크롤되지 않게 잠근다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
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

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        <img
          src={originalMediaUrl(current.previewUrl)}
          alt={current.altText ?? ''}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full cursor-default object-contain"
        />
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

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={side === 'left' ? '이전 이미지' : '다음 이미지'}
      className={`absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25 ${
        side === 'left' ? 'left-4' : 'right-4'
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
