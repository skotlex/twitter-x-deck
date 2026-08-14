/**
 * 덱 진입점. x.com 탭 **위에** 우리 UI 를 얹는다.
 *
 * 왜 확장 페이지가 아니라 x.com 페이지인가 —
 * x.com 의 `frame-ancestors 'self'` 는 x.com 이 x.com 을 임베드하는 것만 허용한다.
 * 부모를 x.com 으로 두면 CSP 를 건드릴 필요가 없고, 쿠키도 same-site 로 그대로 실리고,
 * 최상위 탭이라 타이머 스로틀링도 없고, 로그인은 x.com 자체가 처리한다.
 *
 * x.com 의 DOM 은 지우지 않고 그대로 살려둔 채 덮는다. 그 아래에서 x.com 이 계속
 * 폴링해야 '새 게시물 보기' 알림이 뜨고, 그게 우리 수집의 출발점이다.
 */
import { createRoot } from 'react-dom/client'
import css from '../ui/index.css?inline'
import { DECK_PARAM } from '@core/messages'
import { readFrameRole } from '@core/role'
import type { TimelineKind } from '@core/types'
import { App } from '../ui/App'
import { setHostCollector } from '../ui/hostCollector'
import { startCollector } from './collector'

const SESSION_KEY = 'xdeck:deck'
const OVERLAY_ID = 'x-deck-overlay'

/**
 * 이 탭이 덱 탭인지. 확장 아이콘으로 열릴 때 붙는 파라미터를 세션에 새겨두어,
 * x.com 의 SPA 이동이 쿼리를 지운 뒤에도 새로고침하면 덱이 그대로 살아난다.
 */
function isDeckTab(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get(DECK_PARAM) === '1') {
      window.sessionStorage.setItem(SESSION_KEY, '1')
      return true
    }
    return window.sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    // 세션 저장소가 막힌 환경이면 최초 파라미터만 믿는다.
    return new URLSearchParams(window.location.search).get(DECK_PARAM) === '1'
  }
}

function createOverlay(): { host: HTMLDivElement; mountPoint: HTMLDivElement } {
  const host = document.createElement('div')
  host.id = OVERLAY_ID
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.zIndex = '2147483647'

  // 그림자 DOM 으로 x.com 의 CSS 와 완전히 격리한다.
  const shadow = host.attachShadow({ mode: 'open' })
  // 스타일은 구성된 스타일시트로 넣는다 — 페이지 CSP 의 style-src 에 걸리지 않는다.
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  shadow.adoptedStyleSheets = [sheet]

  const mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  shadow.append(mountPoint)

  document.documentElement.append(host)

  // x.com 이 리렌더 과정에서 걷어내면 다시 붙인다.
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host)
  }).observe(document.documentElement, { childList: true })

  return { host, mountPoint }
}

function mount(): void {
  if (document.getElementById(OVERLAY_ID)) return

  const hostKind: TimelineKind = readFrameRole() ?? 'foryou'
  const { host, mountPoint } = createOverlay()

  // 최상위 문서가 담당하는 컬럼은 이 자리에서 직접 수집한다.
  // 결과를 window 로 되던져 자식 프레임과 똑같은 경로로 덱에 도달하게 한다.
  const handle = startCollector([hostKind], (message) => {
    window.postMessage(message, window.location.origin)
  })
  setHostCollector([hostKind], handle)

  createRoot(mountPoint).render(
    <App
      hostKind={hostKind}
      onPassthrough={(enabled) => {
        // 덱을 통과 모드로 두면 아래 x.com 을 그대로 쓸 수 있다 (로그인·원본 확인용).
        host.style.pointerEvents = enabled ? 'none' : 'auto'
      }}
    />,
  )
}

if (isDeckTab()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
}
