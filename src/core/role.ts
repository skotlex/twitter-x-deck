import { DECK_PARAM, ROLE_PARAM } from './messages'
import { readMirror } from './settings'
import { TIMELINE_KINDS, type TimelineKind } from './types'

/** iframe 의 `name` 속성에 붙이는 접두사. 프레임 안 SPA 이동에도 살아남는다. */
export const FRAME_NAME_PREFIX = 'xdeck:'

/**
 * 답글·인용 작성창 프레임의 이름.
 *
 * 쿼리 파라미터로 표시하면 intent 주소가 홈으로 리다이렉트되는 순간 날아간다.
 * `window.name` 은 그 이동을 건너 살아남으므로 여기서도 같은 수를 쓴다.
 * 'compose' 는 컬럼 이름이 아니라 `readFrameRole` 은 계속 null 을 준다 — 수집기가
 * 작성창에서 깨어나는 일은 없다.
 */
export const COMPOSE_FRAME_NAME = `${FRAME_NAME_PREFIX}compose`

export function isComposeFrame(): boolean {
  return window.name === COMPOSE_FRAME_NAME
}

/**
 * 게시물 상세·프로필을 띄우는 창의 프레임 이름.
 *
 * 여기서도 사람이 글을 지우거나 답글을 단다. 이름을 붙여야 우리 코드가 그 문서에
 * 들어가 그 사실을 덱까지 나른다 — 안 붙이면 창 안에서 지운 글이 목록에 그대로
 * 남는다.
 */
export const PAGE_FRAME_NAME = `${FRAME_NAME_PREFIX}page`

export function isPageFrame(): boolean {
  return window.name === PAGE_FRAME_NAME
}

/** 덱이 띄운 창의 프레임인지. 수집은 안 하지만 무슨 일이 일어났는지는 알려야 한다. */
export function isDeckPanelFrame(): boolean {
  return isComposeFrame() || isPageFrame()
}

const SESSION_KEY = 'xdeck:role'

/** 컬럼 종류 목록에서 직접 확인한다. 종류가 늘 때 여기를 빠뜨리면 그 프레임은 조용히 죽는다. */
function toKind(value: string | null | undefined): TimelineKind | null {
  return TIMELINE_KINDS.find((kind) => kind === value) ?? null
}

/**
 * 이 프레임이 어느 컬럼을 담당하는지 알아낸다. 셋 다 실패하면 `null` —
 * 사용자가 평소에 쓰는 x.com 탭이라는 뜻이므로 아무 것도 건드리지 않는다.
 *
 *   1) `window.name` — 덱이 iframe 에 심어둔 값. 로그인 리다이렉트를 거쳐도 남는다.
 *   2) `sessionStorage` — 폴백 탭 모드용. iframe 모드에서는 두 프레임이 같은 저장소를
 *      공유하므로 최상위 문서일 때만 읽고 쓴다.
 *   3) 쿼리 파라미터 — 최초 진입 시점의 값.
 */
export function readFrameRole(): TimelineKind | null {
  const fromName = toKind(
    window.name?.startsWith(FRAME_NAME_PREFIX) ? window.name.slice(FRAME_NAME_PREFIX.length) : null,
  )
  if (fromName) return fromName

  const isTopLevel = window.top === window.self
  const fromParam = toKind(new URLSearchParams(window.location.search).get(ROLE_PARAM))

  if (isTopLevel) {
    try {
      if (fromParam) {
        window.sessionStorage.setItem(SESSION_KEY, fromParam)
        return fromParam
      }
      return toKind(window.sessionStorage.getItem(SESSION_KEY))
    } catch {
      // 스토리지 접근이 막힌 환경에서는 파라미터만 믿는다.
    }
  }

  return fromParam
}

const DECK_SESSION_KEY = 'xdeck:deck'

/**
 * 설치한 웹앱 창에서 열렸는지.
 *
 * 앱 창에는 주소창이 없어 `?xdeck=1` 을 붙일 방법이 없고, 창을 껐다 켜면 세션
 * 기록도 사라진다. 그래서 표시를 창의 **모양** 에서 읽는다 — 탭 브라우저가 아닌
 * 창이면 x.com 을 앱으로 띄운 것이고, 그건 덱을 보려고 만든 창이다.
 */
export function isAppWindow(): boolean {
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
export function isTimelineHome(): boolean {
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
export function isDeckTab(): boolean {
  if (isAppWindow()) return true
  try {
    if (new URLSearchParams(window.location.search).get(DECK_PARAM) === '1') {
      window.sessionStorage.setItem(DECK_SESSION_KEY, '1')
      return true
    }
    return window.sessionStorage.getItem(DECK_SESSION_KEY) === '1'
  } catch {
    // 세션 저장소가 막힌 환경이면 최초 파라미터만 믿는다.
    return new URLSearchParams(window.location.search).get(DECK_PARAM) === '1'
  }
}

/**
 * 이 문서 위에 덱이 얹히는지 — 곧, 여기서 수집이 일어나는지.
 *
 * 덱은 자기가 얹힌 문서를 역할 표시가 없어도 '추천' 담당으로 세운다(`mount.tsx`).
 * 그러니 인터셉터도 같은 기준으로 깨어나야 한다. 예전에는 역할 표시만 보고 판단해서,
 * 자동으로 얹힌 덱의 최상위 문서에서는 응답을 한 건도 가로채지 못했다 — 추천 컬럼이
 * '준비 중' 에서 넘어가지 못하고 영영 갱신되지 않았다.
 *
 * 자동 적용 설정은 확장 저장소에 있어 MAIN world 에서는 못 읽는다. 대신 설정을
 * 저장할 때마다 페이지에 남겨두는 사본을 본다. 사본이 아직 없으면 기본값(켬)으로 본다.
 */
export function isDeckHostDocument(): boolean {
  if (window.top !== window.self) return false
  if (isDeckTab()) return true
  return isTimelineHome() && readMirror()?.autoMount !== false
}
