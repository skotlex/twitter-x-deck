/**
 * 사진 속 글자를 Papago 이미지 번역으로 읽는다.
 *
 * 글 번역과 달리 결과를 뽑아오지 않고 **Papago 화면을 그대로 띄운다.** 번역된 이미지가
 * 어떤 모양으로 그려지는지에 기대지 않으므로 깨질 곳이 없고, 원문/번역 토글이나 확대
 * 같은 Papago 자신의 기능도 함께 쓸 수 있다.
 *
 * 파일 입력에는 주소를 넣을 수 없어 사진을 여기서 받아 바이트로 건넨다. 프레임 안에서
 * 도는 우리 스크립트(`papago.ts`)가 그것을 파일로 만들어 넣는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHANNEL,
  isPapagoMessage,
  LOGIN_REQUIRED,
  PAPAGO_ORIGIN,
  PAPAGO_PARAM,
  type PapagoMessage,
} from '@core/messages'
import { originalMediaUrl } from '../lib/format'
import { CloseIcon } from './icons'

/** 프레임이 뜨고 사진이 들어갈 때까지 기다리는 한계. */
const READY_TIMEOUT_MS = 20_000

export interface ImageTranslateModalProps {
  /** 번역할 사진. 원본 크기로 받아야 글자가 또렷하다. */
  imageUrl: string
  /** 사람이 읽는 언어. Papago 의 도착 언어로 넘긴다. */
  target: string
  onClose: () => void
}

export function ImageTranslateModal({ imageUrl, target, onClose }: ImageTranslateModalProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  /** 다시 시도한 횟수. 프레임을 처음부터 다시 띄우는 열쇠로 쓴다. */
  const [attempt, setAttempt] = useState(0)
  // 요청과 응답을 짝짓는 일회용 값. 다시 시도할 때마다 새로 만든다 —
  // 앞선 시도의 뒤늦은 응답을 이번 것으로 잘못 받으면 안 된다.
  const id = useMemo(
    () => `${attempt}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    [attempt],
  )

  const source = `${PAPAGO_ORIGIN}/image?${PAPAGO_PARAM}=${id}&tk=${encodeURIComponent(target)}`
  const needsLogin = error === LOGIN_REQUIRED

  const retry = useCallback(() => {
    setError(null)
    setSent(false)
    setAttempt((prev) => prev + 1)
  }, [])

  /** 사진을 받아 프레임으로 건넨다. 프레임이 준비됐다고 알려온 뒤에 부른다. */
  const send = useCallback(async () => {
    try {
      // 사진 서버가 x.com 오리진에 CORS 를 열어두어, 이 문서에서 그대로 받아올 수 있다.
      // 확장 권한을 더 요구하지 않아도 되는 이유다.
      const response = await fetch(originalMediaUrl(imageUrl))
      if (!response.ok) throw new Error(`사진을 받지 못했습니다 (${response.status})`)
      const blob = await response.blob()

      const message: PapagoMessage = {
        channel: CHANNEL,
        type: 'papago-image',
        id,
        blob,
        name: 'image.jpg',
      }
      frameRef.current?.contentWindow?.postMessage(message, PAPAGO_ORIGIN)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '사진을 넣지 못했습니다')
    }
  }, [id, imageUrl])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== PAPAGO_ORIGIN || !isPapagoMessage(event.data)) return
      if (event.data.id !== id) return

      if (event.data.type === 'papago-ready') void send()
      else if (event.data.type === 'papago-loaded') setSent(true)
      else if (event.data.type === 'papago-failed') setError(event.data.reason)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [id, send])

  // 끝내 아무 소식이 없으면 사용자를 세워두지 않고 사정을 알린다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setError((prev) => prev ?? 'Papago 가 응답하지 않았습니다')
    }, READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [attempt])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    // 캡처 단계로 받는다. 덱 오버레이가 키 이벤트를 끊어 버블로는 올라오지 않는다.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="사진 번역"
      // 이 창은 라이트박스 위에 겹쳐 뜬다. 여기서 멈추지 않으면 배경을 눌러 이 창을
      // 닫는 클릭이 아래 라이트박스까지 내려가 사진 보기도 함께 닫힌다.
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      className="animate-fade fixed inset-0 z-[70] flex flex-col bg-black/92 backdrop-blur-sm"
    >
      <header
        className="flex h-14 shrink-0 items-center gap-3 px-4 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-[13px] font-semibold">사진 번역</span>
        <span className={`text-[12.5px] ${error ? 'text-white' : 'text-white/60'}`}>
          {error ? error : sent ? 'Papago 로 번역했습니다' : '사진을 넣는 중…'}
        </span>

        {/*
          Papago 는 이미지 번역에 네이버 로그인을 요구한다. 우리가 대신 로그인해 줄 수는
          없으므로 새 탭으로 길만 내주고, 돌아와서 다시 시도할 수 있게 한다 —
          쿠키는 함께 쓰므로 그 탭에서 로그인하면 이 창에서도 통한다.
        */}
        {needsLogin && (
          <button
            type="button"
            onClick={() => window.open(`${PAPAGO_ORIGIN}/image`, '_blank', 'noopener,noreferrer')}
            className="rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-85"
          >
            새 탭에서 로그인
          </button>
        )}
        {error && (
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/25"
          >
            다시 시도
          </button>
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

      <div
        className="min-h-0 flex-1 px-3 pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        <iframe
          // 열쇠를 바꿔 프레임을 처음부터 다시 띄운다. 주소만 갈아 끼우면 SPA 가
          // 이미 뜬 상태를 그대로 들고 있어 사진을 다시 넣을 자리가 없다.
          key={attempt}
          ref={frameRef}
          src={source}
          title="Papago 사진 번역"
          className="h-full w-full rounded-2xl border-0 bg-white"
        />
      </div>
    </div>
  )
}
