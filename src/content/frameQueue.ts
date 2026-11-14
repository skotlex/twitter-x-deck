/**
 * 숨은 프레임 작업을 한 번에 하나씩만 돌린다.
 *
 * 프레임 하나가 남의 웹앱을 통째로 부팅한다 — 세션 유지 요청까지 딸려 온다.
 * 여러 개가 겹치고 실패한 시도가 몇십 초씩 살아 있으면 네트워크 탭이 그 앱들의
 * 자체 요청으로 뒤덮인다. 줄을 세우면 살아 있는 앱이 늘 하나뿐이다.
 *
 * 앞 작업이 실패해도 다음 작업은 그대로 이어간다.
 */
let queue: Promise<unknown> = Promise.resolve()

export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/**
 * 보이지 않는 x.com 프레임을 띄운다. 다 쓰면 부른 쪽이 `remove()` 로 거둔다.
 *
 * @param name 프레임 이름. 프레임 안 우리 스크립트가 이것으로 자기 할 일을 안다.
 */
export function createHiddenFrame(url: string, name?: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  // 화면 밖으로 밀지 않는다 — 밖에 두면 렌더링이 멈춰 버튼이 그려지지 않는다.
  // 폭은 x.com 이 넓은 화면 배치를 쓰도록 넉넉히 준다. 좁으면 배치가 통째로 달라진다.
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:1100px;height:900px;opacity:0;pointer-events:none;border:0;z-index:-1'
  frame.setAttribute('aria-hidden', 'true')
  // 이름은 문서가 뜨기 전에 붙여야 한다. 프레임 안 스크립트는 문서 시작에 한 번 읽는다.
  if (name) frame.name = name
  frame.src = url
  document.documentElement.append(frame)
  return frame
}
