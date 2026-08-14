/**
 * 자식 프레임용 진입점.
 *
 * 덱이 띄운 **숨은 자식 프레임**에서만 돈다. 최상위 문서의 수집은 덱 스크립트가
 * 같은 문서 안에서 직접 맡으므로 여기 관여하지 않는다.
 * 부모가 같은 오리진(x.com) 이라 메시지가 그대로 오간다 — 중계자가 필요 없다.
 */
import { isDeckCommand } from '@core/messages'
import { readFrameRole } from '@core/role'
import { startCollector } from './collector'

const role = readFrameRole()

if (role && window.parent !== window.self) {
  const origin = window.location.origin
  const handle = startCollector([role], (message) => {
    window.parent.postMessage(message, origin)
  })

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin === origin && isDeckCommand(event.data)) handle.command(role, event.data.command)
  })
}
