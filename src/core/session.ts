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
