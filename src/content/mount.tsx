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
import { isDeckScreen, isDeckTab, MASK_ATTR, OVERLAY_ID, readFrameRole, whenTrue } from '@core/role'
import { loadSettings } from '@core/settings'
import type { TimelineKind } from '@core/types'
import { App } from '../ui/App'
import { setHostCollector } from '../ui/hostCollector'
import { startCollector } from './collector'
import { watchFrameBlocks } from './frameBlock'
import { createUnderlayMask } from './underlay'

/**
 * 덱이 화면을 덮는 동안 아래 x.com 을 잠재운다 — 스크롤을 잠그고, 그리지 않게 한다.
 *
 * **왜 그리지 않게 하는가.**
 * 우리는 x.com 의 DOM 을 살려둔 채 덮는다. 그 아래에서 계속 폴링해야 알약이 뜨기
 * 때문이다. 그런데 수집기가 탭을 오갈 때마다(대타 방문은 15 초 간격이다) x.com 은
 * 타임라인을 통째로 다시 그린다 — 스타일 재계산부터 레이아웃 · 페인트 · 래스터 ·
 * 사진 디코딩까지, **아무도 볼 수 없는 화면**에 대해 전부.
 *
 * 래스터와 디코딩은 워커 스레드로 흩어져서 이 탭 하나가 CPU 100% 를 넘겼다. 같은
 * 탭을 백그라운드로 두면 0% 로 떨어지는 것이 그 증거였다 — 브라우저가 안 그리기
 * 시작하면 비용이 통째로 사라진다. 그 일을 앞당겨 하는 것이 여기다.
 *
 * 덱은 `<body>` 가 아니라 `<html>` 바로 아래에 붙는다. 그래서 `body` 만 감추면
 * x.com 은 안 그려지고 덱은 멀쩡하다. 방식과 그 이유는 [underlay](./underlay.ts) 에 있다.
 */
function createMask(): (masked: boolean) => void {
  const mask = createUnderlayMask()

  return (masked) => {
    mask(masked)
    // MAIN world 의 인터셉터도 이 상태를 봐야 한다 (영상을 세울지 말지).
    document.documentElement.toggleAttribute(MASK_ATTR, masked)
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

  const hostKind: TimelineKind = readFrameRole() ?? 'foryou'
  const { host, mountPoint } = createOverlay()
  const setUnderlayMask = createMask()
  // 첫 화면부터 덮는다. React 가 붙기 전에도 아래 타임라인이 비쳐 보이면 안 된다.
  setUnderlayMask(true)

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
        // 통과 모드에서는 아래 x.com 을 실제로 보고 굴려야 하므로 덮개를 걷는다.
        setUnderlayMask(!enabled)
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
 *
 * 판단은 한 번으로 끝나지 않는다. 로그인 화면에서 시작한 탭은 로그인을 마치고 홈으로
 * 옮겨가지만 문서는 그대로라, 처음 한 번만 보면 새로고침하기 전까지 덱이 뜨지 않는다.
 */
if (isDeckTab()) {
  mountWhenReady()
} else {
  void loadSettings().then((settings) => {
    if (!settings.autoMount) return
    whenTrue(isDeckScreen, mountWhenReady)
  })
}
