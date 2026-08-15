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
