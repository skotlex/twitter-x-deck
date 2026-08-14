import { ROLE_PARAM } from './messages'
import type { TimelineKind } from './types'

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

const SESSION_KEY = 'xdeck:role'

function toKind(value: string | null | undefined): TimelineKind | null {
  return value === 'foryou' || value === 'following' ? value : null
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
