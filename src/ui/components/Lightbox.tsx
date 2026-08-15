import { useCallback, useEffect, useState } from 'react'
import type { TweetMedia } from '@core/types'
import { readImageText, type ImageText } from '../../content/imageText'
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
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 사진마다 읽어낸 글. 넘겼다 돌아와도 다시 읽지 않는다. */
  const [texts, setTexts] = useState<Record<number, ImageText>>({})
  const total = media.length
  const current = media[Math.min(index, total - 1)]
  const found = texts[index] ?? null

  /**
   * 사진 속 글자를 읽어 번역한다.
   *
   * 번역된 사진을 만들지는 않는다 — 원문 글자를 지우고 다시 조판하는 일은 흉내 낼 수
   * 있는 수준이 아니라, 읽어낸 글과 그 번역을 따로 보여준다.
   */
  const read = useCallback(async () => {
    const url = current ? originalMediaUrl(current.previewUrl) : null
    if (!url || reading) return
    setReading(true)
    setError(null)
    try {
      const result = await readImageText(url, READING_LANG)
      setTexts((prev) => ({ ...prev, [index]: result }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '글자를 읽지 못했습니다')
    } finally {
      setReading(false)
    }
  }, [current, index, reading])

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
        {/* 사진에만 붙인다. 영상에서 글자를 읽을 일은 없다. */}
        {!current.playbackUrl && (
          <button
            type="button"
            disabled={reading}
            onClick={(event) => {
              event.stopPropagation()
              if (found) setTexts(({ [index]: _drop, ...rest }) => rest)
              else void read()
            }}
            className="text-[13px] leading-none text-white/70 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
            title="사진 속 글자를 읽어 번역합니다. 인식은 이 브라우저 안에서 하며, 처음 한 번은 글자 데이터를 내려받아 오래 걸립니다"
          >
            {reading ? '글자 읽는 중…' : found ? '글자 닫기' : '사진 속 글자'}
          </button>
        )}
        {error && <span className="text-[13px] leading-none text-white/70">{error}</span>}

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

      {found && (
        <ImageTextPanel text={found} onClose={() => setTexts(({ [index]: _drop, ...rest }) => rest)} />
      )}

      {total > 1 && (
        <>
          <NavButton side="left" onClick={() => move(-1)} />
          <NavButton side="right" onClick={() => move(1)} />
        </>
      )}
    </div>
  )
}

/** 번역기 이름. 무엇이 옮긴 글인지 밝혀야 사용자가 곧이곧대로 믿지 않는다. */
const ENGINE_LABEL: Record<ImageText['translation']['engine'], string> = {
  papago: 'Papago 번역',
  browser: '브라우저 번역',
}

/**
 * 읽어낸 글과 그 번역.
 *
 * 사진 위에 겹치지 않고 아래에 깔린다 — 글자를 사진 위에 얹으면 원문을 가리고, 어차피
 * 정확한 자리에 놓을 수도 없다. 번역을 크게, 원문은 작게 곁들여 둘을 견줄 수 있게 한다.
 */
function ImageTextPanel({ text, onClose }: { text: ImageText; onClose: () => void }) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="animate-fade max-h-[38%] shrink-0 overflow-y-auto border-t border-white/15 bg-black/80 px-5 py-4 text-white backdrop-blur-sm"
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-white/60">사진 속 글자</span>
          <span className="text-[12px] text-white/40">{ENGINE_LABEL[text.translation.engine]}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[12.5px] text-white/60 underline-offset-2 hover:text-white hover:underline"
          >
            닫기
          </button>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">
          {text.translation.text}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/45">
          {text.lines.join('\n')}
        </p>
      </div>
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
