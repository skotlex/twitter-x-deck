/**
 * 로그아웃이라는 판정을 문서 사이에 남긴다.
 *
 * 덱은 문서가 뜨자마자 그려지지만, 로그아웃 여부는 x.com 이 로그인 화면을 그린 뒤에야
 * 알 수 있다. 그 한 박자 사이에 보관된 글이 떴다가 로그인 화면으로 밀려나 화면이 튄다.
 * 지난 판정을 남겨두면 처음부터 비켜선 채로 시작할 수 있다.
 *
 * 어디까지나 **첫 화면을 고르는 힌트** 다. 수집기가 매초 다시 판단해 곧바로 덮어쓰므로,
 * 이 값이 틀려 있어도 1초면 바로잡힌다.
 */
import type { ViewerInfo } from './types'

const KEY = 'xdeck:logged-out'

export function rememberLoggedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    // 저장소가 막힌 환경이면 힌트 없이 간다. 한 박자 늦게 알아챌 뿐이다.
  }
}

export function wasLoggedOut(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 지난번에 읽어둔 로그인 계정.
 *
 * 사이드바는 핸들부터 그리고 프로필 사진은 한 박자 뒤에 붙인다. 그 사이에 읽으면
 * 사진이 빈 채로 잡혀 상단 바에 머리글자만 남는데, 지난번 사진이 있으면 그 틈을
 * 메울 수 있다. 여기 값도 **힌트일 뿐** 이라 화면에서 새로 읽히는 대로 덮인다.
 */
const VIEWER_KEY = 'xdeck:viewer'

export function rememberViewer(viewer: ViewerInfo): void {
  // 사진 없는 값은 메울 것이 없다. 적어봐야 다음 판에서 쓸모가 없다.
  if (!viewer.handle || !viewer.avatarUrl) return
  try {
    window.localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer))
  } catch {
    // 저장소가 막힌 환경이면 매번 사진이 붙기를 기다린다. 잃는 건 첫 몇 초뿐이다.
  }
}

export function rememberedViewer(): ViewerInfo | null {
  try {
    const raw = window.localStorage.getItem(VIEWER_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ViewerInfo> | null
    const handle = typeof value?.handle === 'string' ? value.handle : ''
    const avatarUrl = typeof value?.avatarUrl === 'string' ? value.avatarUrl : ''
    if (!handle || !avatarUrl) return null
    const name = typeof value?.name === 'string' && value.name ? value.name : handle
    return { handle, name, avatarUrl }
  } catch {
    // 형식이 깨졌으면 없는 셈 친다. 다음에 제대로 읽히면 그때 덮인다.
    return null
  }
}
