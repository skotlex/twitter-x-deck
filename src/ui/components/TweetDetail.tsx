import { useCallback, useEffect, useRef, useState } from 'react'
import { HIDE_X_CHROME_CSS } from '../../content/selectors'
import { CloseIcon } from './icons'

/**
 * 창 폭. x.com 게시물 칸(600px) 에 스크롤바와 여백만 더한 값이다.
 * 더 넓혀도 그만큼이 빈 자리로 남을 뿐이다 — 칸의 폭은 x.com 이 정한다.
 */
const WIDTH = 'w-[648px]'

export interface TweetDetailProps {
  /** 게시물 원문 주소. 이 페이지에 답글이 전부 딸려 온다. */
  url: string
  handle: string
  onClose: () => void
}

/**
 * 게시물 상세.
 *
 * 답글 트리를 우리가 다시 만들지 않는다 — x.com 의 상세 페이지를 그대로 띄우면
 * 답글·인용·미디어·더 보기까지 전부 따라오고, UI 가 개편돼도 저절로 따라간다.
 * 대신 좌우 껍데기는 지워 본문과 답글만 남긴다.
 */
export function TweetDetail({ url, handle, onClose }: TweetDetailProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [blocked, setBlocked] = useState(false)

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

  // 같은 오리진이라 프레임 문서에 스타일을 직접 얹을 수 있다.
  const handleLoad = useCallback(() => {
    let doc: Document | null = null
    try {
      doc = frameRef.current?.contentDocument ?? null
    } catch {
      doc = null
    }
    if (!doc) {
      setBlocked(true)
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
      aria-label={`@${handle} 님의 게시물과 답글`}
      onClick={onClose}
      className="animate-fade fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`flex h-[880px] max-h-full ${WIDTH} max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40`}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="truncate text-[14px] font-semibold text-text">
            <span className="text-accent">@{handle}</span> 님의 게시물
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
              <p className="text-[14px] text-text">게시물을 덱 안에 띄우지 못했다.</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-block rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
              >
                새 탭에서 보기
              </a>
            </div>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            src={url}
            title="게시물과 답글"
            onLoad={handleLoad}
            className="min-h-0 flex-1 border-0 bg-canvas"
          />
        )}
      </div>
    </div>
  )
}
