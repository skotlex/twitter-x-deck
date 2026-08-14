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
import { loadSettings } from '@core/settings'
import type { TimelineKind } from '@core/types'
import { App } from '../ui/App'
import { setHostCollector } from '../ui/hostCollector'
import { startCollector } from './collector'
import { watchFrameBlocks } from './frameBlock'
import { ensureRuleScope } from './ruleScope'

const SESSION_KEY = 'xdeck:deck'
const OVERLAY_ID = 'x-deck-overlay'

/**
 * 설치한 웹앱 창에서 열렸는지.
 *
 * 앱 창에는 주소창이 없어 `?xdeck=1` 을 붙일 방법이 없고, 창을 껐다 켜면 세션
 * 기록도 사라진다. 그래서 표시를 창의 **모양** 에서 읽는다 — 탭 브라우저가 아닌
 * 창이면 x.com 을 앱으로 띄운 것이고, 그건 덱을 보려고 만든 창이다.
 */
function isAppWindow(): boolean {
  return ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  )
}

/**
 * 덱이 대신하려는 화면인지.
 *
 * 덱은 홈 타임라인을 대신하는 물건이므로 그 자리에서는 부르지 않아도 얹는다.
 * 게시물·프로필 같은 나머지 주소는 건드리지 않는다 — 우리 화면의 '원문 보기' 나
 * '새 탭에서 열기' 가 여는 곳이 바로 거기라, 그것까지 덮으면 빠져나갈 길이 없다.
 */
function isTimelineHome(): boolean {
  const path = window.location.pathname
  return path === '/home' || path === '/'
}

/**
 * 사용자가 이 탭을 덱으로 지목했는지.
 *
 * 확장 아이콘으로 열릴 때 붙는 파라미터를 세션에 새겨두어, x.com 의 SPA 이동이
 * 쿼리를 지운 뒤에도 새로고침하면 덱이 그대로 살아난다. 앱 창은 파라미터를 받을
 * 자리가 없으므로 창 모양만으로 판단한다.
 *
 * 여기에 걸리면 자동 적용 설정과 무관하게 뜬다 — 직접 부른 것이기 때문이다.
 */
function isDeckTab(): boolean {
  if (isAppWindow()) return true
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

/**
 * 덱이 화면을 덮는 동안 아래 x.com 의 스크롤을 잠근다.
 *
 * 인라인 style 로 걸면 x.com 이 자기 모달을 여닫으며 같은 속성을 다시 써서 풀어버린다.
 * 구성된 스타일시트에 `!important` 로 넣으면 페이지의 인라인 선언보다 우선하고,
 * style 요소가 아니라서 페이지 CSP 의 style-src 에도 걸리지 않는다.
 */
function createScrollLock(): (locked: boolean) => void {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync('html,body{overflow:hidden!important}')

  return (locked) => {
    const current = document.adoptedStyleSheets
    const applied = current.includes(sheet)
    if (locked !== applied) {
      document.adoptedStyleSheets = locked
        ? [...current, sheet]
        : current.filter((item) => item !== sheet)
    }
    // 구성된 스타일시트가 막힌 환경을 대비한 보조 장치. 이쪽만으로는 x.com 이
    // 덮어쓸 수 있어 믿지 않지만, 있으면 최초 화면에서 한 번은 확실히 듣는다.
    document.documentElement.style.overflow = locked ? 'hidden' : ''
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

  // 그림자 DOM 을 빠져나온 이벤트가 x.com 의 전역 핸들러에 닿지 않게 여기서 끊는다.
  // 우리 React 루트는 그림자 안쪽이라 이미 처리를 마친 뒤다 — 덱 조작이 x.com 의
  // 라우팅이나 단축키를 건드리는 일이 없어진다.
  const CONTAINED = [
    'click',
    'auxclick',
    'dblclick',
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'keydown',
    'keyup',
    'keypress',
    'wheel',
    'touchstart',
    'touchend',
    // 컬럼을 끌어 옮기는 동안 x.com 의 첨부 드롭 영역이 깨어나지 않도록 함께 끊는다.
    'dragstart',
    'dragenter',
    'dragover',
    'dragleave',
    'drop',
    'dragend',
  ]
  for (const type of CONTAINED) {
    host.addEventListener(type, (event) => event.stopPropagation())
  }

  document.documentElement.append(host)

  // x.com 이 리렌더 과정에서 걷어내면 다시 붙인다.
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host)
  }).observe(document.documentElement, { childList: true })

  return { host, mountPoint }
}

function mount(): void {
  if (document.getElementById(OVERLAY_ID)) return

  // 프레임이 막히는 순간을 놓치지 않으려면 첫 프레임을 만들기 전에 걸어둬야 한다.
  watchFrameBlocks()
  // 헤더 제거 규칙도 지금 청해둔다. 수집 프레임이 없는 화면(컬럼 하나)에서도
  // 작성창·상세 창은 프레임으로 뜨므로, 아무도 청하지 않는 상태로 두면 안 된다.
  void ensureRuleScope()

  const hostKind: TimelineKind = readFrameRole() ?? 'foryou'
  const { host, mountPoint } = createOverlay()
  const setScrollLock = createScrollLock()
  // 첫 화면부터 잠근다. React 가 붙기 전에도 아래 타임라인의 스크롤바가 보이면 안 된다.
  setScrollLock(true)

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
        // 통과 모드에서는 아래 x.com 을 실제로 굴려야 하므로 잠금을 푼다.
        setScrollLock(!enabled)
      }}
    />,
  )
}

function mountWhenReady(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
}

/**
 * 뜰지 말지 정한다.
 *
 * 직접 지목한 탭이면 설정을 볼 것도 없이 뜬다. 홈 타임라인은 설정을 따르는데,
 * 그 값은 저장소에서 읽어야 하므로 여기서만 한 박자 늦게 결정된다.
 */
if (isDeckTab()) {
  mountWhenReady()
} else if (isTimelineHome()) {
  void loadSettings().then((settings) => {
    if (settings.autoMount) mountWhenReady()
  })
}
