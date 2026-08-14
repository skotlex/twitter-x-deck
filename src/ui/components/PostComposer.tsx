import { useCallback, useEffect, useRef, useState } from 'react'
import { isComposedMessage } from '@core/messages'
import { COMPOSE_FRAME_NAME } from '@core/role'
import {
  composerUrl,
  openComposerPopup,
  type ComposeMode,
  type ComposeTarget,
} from '../../content/actions'
import { CloseIcon } from './icons'

/** 이 시간 안에 작성 화면이 안 뜨면 임베드가 막힌 것으로 보고 새 창 안내를 띄운다. */
const LOAD_TIMEOUT_MS = 12_000

export interface PostComposerProps {
  mode: ComposeMode
  target: ComposeTarget
  /** 누구의 글에 답하거나 인용하는지 머리글에 적는다. */
  handle: string
  onClose: () => void
}

/**
 * 답글·인용 작성창.
 *
 * x.com 의 공식 작성 화면을 덱 안 대화상자에 그대로 띄운다. 글을 쓰고 올리는 일은
 * 전부 x.com 코드가 한다 — 하트·리포스트와 같은 원칙이고, 우리는 자리만 내준다.
 * 부모가 x.com 이라 쿠키도 로그인 상태도 그대로 실린다.
 *
 * 배경을 눌러도 닫지 않는다. 쓰던 글이 한 번의 헛클릭으로 날아가서는 안 된다 —
 * 닫는 길은 X 버튼과 Esc 두 개뿐이다.
 */
export function PostComposer({ mode, target, handle, onClose }: PostComposerProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [blocked, setBlocked] = useState(false)
  const title = mode === 'quote' ? '님의 게시물 인용' : '님에게 답글'

  useEffect(() => {
    // 오버레이가 키 이벤트를 x.com 쪽으로 못 가게 끊으므로 캡처 단계로 받는다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /**
   * 글이 올라가면 스스로 닫는다.
   *
   * x.com 의 작성 화면은 게시를 마쳐도 그 자리에 남아 홈 타임라인을 보여준다.
   * 그대로 두면 볼일이 끝난 창에 남의 타임라인이 떠 있게 된다.
   * 판단 근거는 DOM 이 아니라 게시 뮤테이션 자체다 — 화면이 개편돼도 흔들리지 않는다.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isComposedMessage(event.data)) return
      onClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onClose])

  // 프레임이 끝내 안 뜨면 사용자를 세워두지 않고 새 창으로 가는 길을 알려준다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const doc = (() => {
        try {
          return frameRef.current?.contentDocument ?? null
        } catch {
          return null
        }
      })()
      if (!doc?.body?.childElementCount) setBlocked(true)
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const openPopup = useCallback(() => {
    openComposerPopup(mode, target)
    onClose()
  }, [mode, onClose, target])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`@${handle} ${title}`}
      className="animate-fade fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex h-[720px] max-h-full w-[620px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="truncate text-[14px] font-semibold text-text">
            <span className="text-accent">@{handle}</span> {title}
          </span>
          <button
            type="button"
            onClick={openPopup}
            className="ml-auto shrink-0 text-[12.5px] text-faint transition-colors hover:text-accent"
          >
            새 창에서 열기
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon className="h-4.5 w-4.5" />
          </button>
        </header>

        {blocked ? (
          <div className="grid flex-1 place-items-center px-8 text-center">
            <div>
              <p className="text-[14px] text-text">작성 화면을 덱 안에 띄우지 못했다.</p>
              <button
                type="button"
                onClick={openPopup}
                className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
              >
                새 창에서 이어 쓰기
              </button>
            </div>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            name={COMPOSE_FRAME_NAME}
            src={composerUrl(mode, target)}
            title={mode === 'quote' ? '인용 작성' : '답글 작성'}
            className="min-h-0 flex-1 border-0 bg-canvas"
          />
        )}
      </div>
    </div>
  )
}
