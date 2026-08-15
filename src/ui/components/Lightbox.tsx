import { useCallback, useEffect, useState } from 'react'
import type { TweetMedia } from '@core/types'
import {
  ImageTranslateError,
  PAPAGO_LOGIN_URL,
  translateImage,
} from '../../content/imageTranslate'
import { READING_LANG } from '../../content/translate'
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
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  /** 사진마다의 번역 결과. 넘겼다 돌아와도 다시 번역하지 않는다. */
  const [translated, setTranslated] = useState<Record<number, string>>({})
  const [showOriginal, setShowOriginal] = useState(false)
  const total = media.length
  const current = media[Math.min(index, total - 1)]
  const result = translated[index] ?? null

  /**
   * 사진 번역. 배경에서 Papago 를 거쳐 번역된 사진만 받아 이 자리에 띄운다.
   *
   * 보이지 않는 프레임으로는 할 수 없는 일이다 — 네이버 로그인 쿠키가 x.com 이
   * 최상위인 프레임에는 실리지 않아, 프레임 안의 Papago 는 이미 로그인한 사람에게도
   * 로그인하라고 한다. 그래서 배경 워커가 탭을 화면 뒤로 열어 대신 처리한다.
   */
  const translate = useCallback(
    async (force = false) => {
      const url = current ? originalMediaUrl(current.previewUrl) : null
      if (!url || sending) return
      setSending(true)
      setError(null)
      setNeedsLogin(false)
      try {
        const image = await translateImage(url, READING_LANG, { force })
        setTranslated((prev) => ({ ...prev, [index]: image }))
        setShowOriginal(false)
      } catch (cause) {
        const login = cause instanceof ImageTranslateError && cause.needsLogin
        const detail = cause instanceof Error ? cause.message : '사진을 번역하지 못했습니다'
        // 로그인이 없어 멈춘 것이면 탭도 조용히 닫힌다. 그 밖의 실패는 번역 탭이
        // 앞으로 나오며, 거기에 결과가 떠 있을 수 있으므로 그 사실을 함께 알린다.
        setError(login ? detail : `${detail} · 번역 탭을 열어뒀습니다`)
        setNeedsLogin(login)
      } finally {
        setSending(false)
      }
    },
    [current, index, sending],
  )

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
        {/* 사진에만 붙인다. 영상은 Papago 이미지 번역이 받지 않는다. */}
        {!current.playbackUrl && (
          <button
            type="button"
            disabled={sending}
            onClick={(event) => {
              event.stopPropagation()
              if (result) setShowOriginal((prev) => !prev)
              else void translate()
            }}
            className="text-[13px] text-white/70 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
            title="Papago 로 사진 속 글자를 번역합니다 (네이버 로그인 필요)"
          >
            {sending
              ? '사진 번역 중…'
              : result
                ? showOriginal
                  ? '번역 보기'
                  : '원본 보기'
                : '사진 번역'}
          </button>
        )}
        {error && <span className="text-[12.5px] text-white/70">{error}</span>}
        {/*
          로그인은 사용자가 직접 해야 하고, 언제 할지도 사용자가 정한다. 우리가 탭을
          앞으로 끌어내지 않는다 — 사진을 보던 중에 난데없이 다른 탭으로 끌려가는 것이
          기다림보다 더 나쁘다. 여기서는 길만 낸다.
        */}
        {needsLogin && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                window.open(PAPAGO_LOGIN_URL, '_blank', 'noopener,noreferrer')
              }}
              className="rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-85"
            >
              네이버 로그인
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void translate(true)
              }}
              className="rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/25"
            >
              다시 시도
            </button>
          </>
        )}
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
            src={result && !showOriginal ? result : originalMediaUrl(current.previewUrl)}
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
