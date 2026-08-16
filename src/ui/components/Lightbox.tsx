import { useCallback, useEffect, useState } from 'react'
import { loadTranslation, saveTranslation } from '@core/db'
import type { ImageTranslation, TranslateEngineId } from '@core/messages'
import { loadSettings, saveSettings, watchSettings } from '@core/settings'
import type { TweetMedia } from '@core/types'
import {
  ENGINE_LABEL,
  fetchBridgeStatus,
  pickEngine,
  translateImage,
} from '../../content/imageTranslate'
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

  /**
   * 번역에 쓸 명령. null 이면 단추를 달지 않는다.
   *
   * 설정에서 켜는 것과 실제로 쓸 수 있는 것은 다르다 — 브리지가 떠 있고 그 명령이
   * 로그인돼 있어야 비로소 쓸 수 있다. 여기 값이 정해지는 것이 그 확인의 결과다.
   */
  const [engine, setEngine] = useState<TranslateEngineId | null>(null)
  /**
   * 아직 쓸 수 있는지 알아보는 중.
   *
   * 로그인 확인은 브리지를 켜서 묻는 일이라 처음 한 번은 몇 초 걸린다. 그동안 아무
   * 것도 없으면 사용자는 '이 사진에는 번역이 안 되는구나' 로 읽고 지나가 버린다.
   * 자리를 비워두지 말고 확인 중이라고 말해준다.
   */
  const [probing, setProbing] = useState(false)
  /** Codex 가 무엇을 내줄지와, 글로 옮길 때 빠른 등급을 쓸지. */
  const [output, setOutput] = useState<'image' | 'text'>('image')
  const [fast, setFast] = useState(false)
  /**
   * 번역문 칸을 펼쳐둘지.
   *
   * 글이 길면 그만큼 사진이 눌려 작아진다. 사진을 보려고 연 화면이니 글은 접을 수
   * 있어야 한다. 사진을 넘겨도 접어둔 상태는 그대로 둔다 — 한 번 접었다는 것은
   * 지금은 사진을 보고 싶다는 뜻이지, 이 사진만 그렇다는 뜻이 아니다.
   */
  const [panelOpen, setPanelOpen] = useState(true)
  /** 사진을 보다 말고 방식을 바꿀 수 있게 여는 작은 차림표. */
  const [menuOpen, setMenuOpen] = useState(false)
  const [translation, setTranslation] = useState<ImageTranslation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 다시 그린 그림은 원본이 아니다. 언제든 되돌아갈 수 있어야 한다. */
  const [showTranslated, setShowTranslated] = useState(true)

  const move = useCallback(
    (delta: number) => {
      setIndex((prev) => (prev + delta + total) % total)
    },
    [total],
  )

  // 쓸 수 있는 명령이 있는지 알아둔다. 설정을 바꾸면 다시 본다.
  useEffect(() => {
    let alive = true

    const resolve = (imageTranslate: boolean, preferred: TranslateEngineId) => {
      if (!imageTranslate) {
        if (alive) {
          setEngine(null)
          setProbing(false)
        }
        return
      }
      if (alive) setProbing(true)
      void fetchBridgeStatus()
        .then((status) => {
          if (alive) setEngine(pickEngine(preferred, status.engines))
        })
        .catch(() => {
          if (alive) setEngine(null)
        })
        .finally(() => {
          if (alive) setProbing(false)
        })
    }

    const apply = (settings: {
      imageTranslate: boolean
      imageTranslateEngine: TranslateEngineId
      codexOutput: 'image' | 'text'
      codexTextFast: boolean
    }) => {
      if (!alive) return
      setOutput(settings.codexOutput)
      setFast(settings.codexTextFast)
      resolve(settings.imageTranslate, settings.imageTranslateEngine)
    }

    void loadSettings().then(apply)
    return watchSettings(apply)
  }, [])

  /** claude 는 늘 글이다. codex 만 그림과 글 사이에서 갈린다. */
  const mode: 'image' | 'text' = engine === 'claude' ? 'text' : output
  /** 쟁여둘 때 쓰는 열쇠. 명령과 결과 종류가 함께 들어가야 서로의 답을 집어가지 않는다. */
  const cacheKey = `${engine ?? '-'}:${mode}`

  // 사진을 넘기면 앞 사진의 번역은 남아 있으면 안 된다.
  const previewUrl = current?.previewUrl
  useEffect(() => {
    setTranslation(null)
    setError(null)
    setShowTranslated(true)
    if (!previewUrl || !engine) return

    // 쟁여둔 것이 있으면 부르지 않는다. 한 번이 30초 넘게 걸리고 구독 한도도 함께 닳는다.
    // 열쇠에 무엇을 내줬는지까지 담는다 — 같은 명령이라도 그림과 글은 다른 결과다.
    let alive = true
    void loadTranslation(originalMediaUrl(previewUrl), cacheKey)
      .then((found) => {
        if (alive && found) setTranslation(found)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [previewUrl, engine, cacheKey])

  const runTranslate = useCallback(() => {
    if (!previewUrl || !engine || busy) return
    const url = originalMediaUrl(previewUrl)
    setBusy(true)
    setError(null)
    void translateImage(url, engine, mode, fast)
      .then((result) => {
        setTranslation(result)
        setShowTranslated(true)
        return saveTranslation(url, cacheKey, result)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '번역하지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [previewUrl, engine, busy, mode, fast, cacheKey])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 차림표가 열려 있으면 그것부터 닫는다. 방식을 고르다 말았다고 사진까지 닫히면 안 된다.
      if (event.key === 'Escape' && menuOpen) setMenuOpen(false)
      else if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') move(1)
      else if (event.key === 'ArrowLeft') move(-1)
      else return
      event.preventDefault()
    }
    // 캡처 단계로 받는다. 덱 오버레이가 키 이벤트를 x.com 쪽으로 못 가게 끊기 때문에
    // 버블 단계에서는 window 까지 올라오지 않는다.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // menuOpen 을 함께 적는다 — 빼면 처음 걸어둔 값(닫힘)을 계속 붙잡아, 차림표가
    // 열려 있어도 Esc 가 사진을 닫아버린다.
  }, [move, onClose, menuOpen])

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

        {/*
          단추가 나오기 전 자리를 지킨다. 비워두면 '이 사진은 번역이 안 되는 것' 으로
          읽히는데, 실은 아직 알아보는 중일 뿐이다.
        */}
        {probing && !engine && !current.playbackUrl && (
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12.5px] text-white/60">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white/80"
            />
            번역 준비 확인 중…
          </span>
        )}

        {/* 동영상에는 달지 않는다. 프레임마다 글자가 달라 한 장을 번역해도 뜻이 없다. */}
        {engine && !current.playbackUrl && (
          <>
            <button
              type="button"
              onClick={runTranslate}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12.5px] text-white/85 transition-colors hover:bg-white/20 hover:text-white disabled:cursor-progress disabled:text-white/50"
            >
              {/* 도는 동안에는 같은 자리에 물레를 돌린다 — 자리가 흔들리지 않게 크기를 맞춘다. */}
              {busy ? (
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border border-white/30 border-t-white/80"
                />
              ) : (
                <TranslateIcon className="h-3.5 w-3.5" />
              )}
              {busy
                ? `${ENGINE_LABEL[engine]} 번역 중…`
                : translation
                  ? '다시 번역'
                  : '사진 번역'}
            </button>
            {/*
              Codex 만 고를 것이 있다. Claude 는 그림을 만들지 못해 늘 글이라
              열어봐야 바꿀 것이 없다.
            */}
            {engine === 'codex' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-expanded={menuOpen}
                  aria-label="번역 방식"
                  title="번역 방식"
                  className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                    menuOpen ? 'bg-white/25 text-white' : 'bg-white/10 text-white/75 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <circle cx="12" cy="12" r="3" />
                    <path
                      d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {menuOpen && (
                  <>
                    {/* 바깥을 누르면 닫히게 하는 자리. 라이트박스까지 닫히면 안 되므로 여기서 멈춘다. */}
                    <div
                      className="fixed inset-0 z-20"
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuOpen(false)
                      }}
                    />
                    <div className="absolute right-0 top-9 z-30 w-52 overflow-hidden rounded-xl border border-white/15 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur">
                      <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-white/40">결과</p>
                      {(['image', 'text'] as const).map((value) => (
                        <MenuItem
                          key={value}
                          selected={output === value}
                          label={value === 'image' ? '이미지로 다시 그리기' : '글자만 옮기기'}
                          hint={value === 'image' ? '80초쯤' : '훨씬 빠름'}
                          onClick={() => void saveSettings({ codexOutput: value })}
                        />
                      ))}

                      {output === 'text' && (
                        <>
                          <p className="mt-1 border-t border-white/10 px-3 pb-1 pt-2 text-[11px] font-medium text-white/40">
                            속도
                          </p>
                          {[false, true].map((value) => (
                            <MenuItem
                              key={String(value)}
                              selected={fast === value}
                              label={value ? '빠르게' : '일반'}
                              hint={value ? '사용량 더 씀' : undefined}
                              onClick={() => void saveSettings({ codexTextFast: value })}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {translation?.kind === 'image' && (
              <button
                type="button"
                onClick={() => setShowTranslated((prev) => !prev)}
                className="rounded-full bg-white/10 px-3 py-1 text-[12.5px] text-white/85 transition-colors hover:bg-white/20 hover:text-white"
              >
                {showTranslated ? '원본 보기' : '번역본 보기'}
              </button>
            )}
          </>
        )}
        {error && <span className="truncate text-[12.5px] text-red-300">{error}</span>}

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
            src={
              translation?.kind === 'image' && showTranslated
                ? translation.dataUrl
                : originalMediaUrl(current.previewUrl)
            }
            alt={current.altText ?? ''}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full cursor-default object-contain"
          />
        )}
      </div>

      {/*
        글자로 온 번역. 사진은 그대로 두고 읽은 것과 옮긴 것을 아래에 나란히 깐다 —
        원문 글자를 지우고 다시 조판하는 일은 이쪽 명령이 할 수 있는 몫이 아니다.
      */}
      {translation?.kind === 'text' && (
        <div
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 border-t border-white/15 bg-black/70"
        >
          <button
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            aria-expanded={panelOpen}
            className="flex w-full items-center gap-2 px-6 py-2 text-[12.5px] text-white/60 transition-colors hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
              className="h-3.5 w-3.5 transition-transform"
              style={{ transform: panelOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            번역 {translation.items.length}개
            <span className="ml-auto">{panelOpen ? '접기' : '펼치기'}</span>
          </button>

          {panelOpen && (
            <div className="scroll-thin max-h-[38vh] overflow-y-auto px-6 pb-4">
              {translation.items.length === 0 ? (
                <p className="text-[13px] text-white/60">읽을 글자가 없습니다.</p>
              ) : (
                <ul className="mx-auto flex max-w-3xl flex-col gap-3">
                  {translation.items.map((item, at) => (
                    <li key={at}>
                      <p className="text-[12.5px] leading-relaxed text-white/45">{item.source}</p>
                      <p className="text-[14px] leading-relaxed text-white">{item.korean}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
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

/** 글자를 옮긴다는 표시. 설정 › 번역 탭의 것과 같은 모양이라 둘이 한 기능으로 읽힌다. */
function TranslateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path
        d="M4 5h10M9 3v2m0 0c0 4-2 7-5 9m3-4c0 2 3 4 6 4m1 6 4-10 4 10m-7-3h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 차림표의 한 줄.
 *
 * 골라도 닫히지 않는다. 이것은 명령을 고르는 자리가 아니라 설정을 만지는 자리라,
 * 하나 누를 때마다 닫히면 '글자만 옮기기' 를 고른 뒤 속도를 바꾸려고 다시 열어야 한다 —
 * 게다가 속도 항목은 그 선택 때문에 비로소 나타나는 것이라 더 어긋난다.
 * 닫는 일은 톱니를 다시 누르거나, 바깥을 누르거나, Esc 를 치는 쪽에 맡긴다.
 */
function MenuItem({
  selected,
  label,
  hint,
  onClick,
}: {
  selected: boolean
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
        selected ? 'text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span aria-hidden="true" className={`w-3 shrink-0 ${selected ? 'text-accent' : 'text-transparent'}`}>
        ✓
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-white/35">{hint}</span>}
    </button>
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
