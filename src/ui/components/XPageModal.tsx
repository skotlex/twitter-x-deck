import { useCallback, useEffect, useRef, useState } from 'react'
import { isDeletedMessage } from '@core/messages'
import { parseDeletedId } from '@core/parser'
import { PAGE_FRAME_NAME } from '@core/role'
import { describeFrameBlock, refreshRuleReport } from '../../content/frameBlock'
import { HIDE_X_CHROME_CSS } from '../../content/selectors'
import { CloseIcon } from './icons'

/**
 * 창 폭. x.com 게시물 칸(600px) 에 스크롤바와 여백만 더한 값이다.
 * 더 넓혀도 그만큼이 빈 자리로 남을 뿐이다 — 칸의 폭은 x.com 이 정한다.
 */
const WIDTH = 'w-[648px]'

export interface XPageModalProps {
  /** 띄울 x.com 주소. 게시물 상세이거나 프로필이다. */
  url: string
  handle: string
  /** 머리글에서 핸들 뒤에 붙일 말. */
  label?: string
  onClose: () => void
}

/**
 * x.com 페이지를 덱 안 창에 그대로 띄운다.
 *
 * 게시물의 답글 트리도, 프로필 화면도 우리가 다시 만들지 않는다 — 저쪽 페이지를
 * 그대로 띄우면 인용·미디어·더 보기·팔로우까지 전부 따라오고, UI 가 개편돼도
 * 저절로 따라간다. 대신 좌우 껍데기는 지워 본문만 남긴다.
 */
export function XPageModal({ url, handle, label = '님의 게시물', onClose }: XPageModalProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [blocked, setBlocked] = useState(false)
  /** 막혔을 때 왜 막혔는지. 규칙이 안 걸린 것과 조건이 비껴간 것은 손볼 자리가 다르다. */
  const [why, setWhy] = useState<string | null>(null)

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
   * 보고 있던 글이 지워지면 스스로 닫는다.
   *
   * x.com 은 글을 지운 뒤 그 화면을 프로필로 갈아 끼운다. 그대로 두면 게시물을
   * 보려고 연 창에 엉뚱한 화면이 남는다. 지운 글이 이 창이 보고 있던 그 글일 때만
   * 닫는다 — 프로필을 띄운 창에서 남의 글을 지웠다고 닫힐 이유는 없다.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isDeletedMessage(event.data)) return
      const id = parseDeletedId(event.data.body)
      // 무엇을 지웠는지 못 읽었더라도 게시물을 띄운 창이라면 닫는다. 지울 수 있는
      // 글은 내 글뿐이고, 그 창에서 일어난 삭제는 그 글일 수밖에 없다.
      if (id ? url.includes(id) : url.includes('/status/')) onClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onClose, url])

  // 같은 오리진이라 프레임 문서에 스타일을 직접 얹을 수 있다.
  const handleLoad = useCallback(() => {
    const frame = frameRef.current
    let doc: Document | null = null
    /**
     * 못 읽은 사정을 그대로 들고 있는다.
     *
     * 문서를 못 읽는 경우는 둘인데 겉으로는 같아 보인다 — 프레임이 다른 오리진으로
     * 떨어져 접근이 거부된 것(예외가 뜬다)과, 문서 자체가 서지 않은 것(null 이 온다).
     * 앞은 임베드가 막힌 것이고 뒤는 요청이 아예 실패한 것이라 손볼 자리가 다르다.
     */
    let detail = ''
    try {
      doc = frame?.contentDocument ?? null
      if (!doc) detail = `문서 없음 (창 ${frame?.contentWindow ? '있음' : '없음'})`
    } catch (error) {
      doc = null
      detail = `접근 거부: ${error instanceof Error ? error.message : String(error)}`
    }
    if (!doc) {
      setBlocked(true)
      // 규칙 상태는 요청이 나간 뒤에 물어야 의미가 있다.
      void refreshRuleReport().then(() => setWhy(`${detail} · ${describeFrameBlock()}`))
      return
    }
    setBlocked(false)

    // 껍데기 감추기는 덤이다. 여기서 넘어져도 게시물은 그대로 보여야 하므로
    // 프레임을 못 띄운 것으로 취급하지 않는다.
    try {
      const view = doc.defaultView
      if (!view) return
      // 구성된 스타일시트는 만든 문서에서만 쓸 수 있다. 프레임 것으로 만들어야 한다.
      const sheet = new view.CSSStyleSheet()
      sheet.replaceSync(HIDE_X_CHROME_CSS)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    } catch {
      // 사이드바가 그대로 보일 뿐이다.
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`@${handle} ${label}`}
      onClick={onClose}
      className="animate-fade fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`flex h-[880px] max-h-full ${WIDTH} max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40`}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="truncate text-[14px] font-semibold text-text">
            <span className="text-accent">@{handle}</span> {label}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto shrink-0 text-[12.5px] text-faint transition-colors hover:text-accent"
          >
            새 탭에서 열기
          </a>
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
              <p className="text-[14px] text-text">덱 안에 띄우지 못했습니다.</p>
              {why && <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{why}</p>}
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-block rounded-lg bg-button px-3 py-1.5 text-[13px] font-semibold text-button-text transition-colors hover:bg-button-strong"
              >
                새 탭에서 보기
              </a>
            </div>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            name={PAGE_FRAME_NAME}
            src={url}
            title={`@${handle} ${label}`}
            onLoad={handleLoad}
            className="min-h-0 flex-1 border-0 bg-canvas"
          />
        )}
      </div>
    </div>
  )
}
