/**
 * 자식 프레임용 진입점.
 *
 * 덱이 띄운 **숨은 자식 프레임**에서만 돈다. 최상위 문서의 수집은 덱 스크립트가
 * 같은 문서 안에서 직접 맡으므로 여기 관여하지 않는다.
 * 부모가 같은 오리진(x.com) 이라 메시지가 그대로 오간다 — 중계자가 필요 없다.
 *
 * 프레임은 두 종류다. 타임라인을 길어 올리는 수집 프레임과, 사람이 직접 글을 쓰는
 * 작성창 프레임. 작성창은 수집하지 않고 글이 올라간 순간만 부모에게 알린다.
 */
import { CHANNEL, isCapturedPayload, isDeckCommand } from '@core/messages'
import { isDeckPanelFrame, readFrameRole } from '@core/role'
import { CREATE_TWEET_OPERATION, DELETE_TWEET_OPERATION } from '@core/types'
import { startCollector } from './collector'

const role = readFrameRole()
const origin = window.location.origin
const framed = window.parent !== window.self

if (role && framed) {
  const handle = startCollector([role], (message) => {
    window.parent.postMessage(message, origin)
  })

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin === origin && isDeckCommand(event.data)) handle.command(role, event.data.command)
  })
} else if (isDeckPanelFrame() && framed) {
  // 작성창·상세 창. 수집은 하지 않고 글이 올라갔다는 것과 지워졌다는 것만 위로
  // 넘긴다. 덱은 전자로 창을 닫고 그 글을 목록에 끼워 넣으며, 후자로 지운 글을
  // 목록에서 걷어내고 그 글을 보고 있던 창을 닫는다.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || !isCapturedPayload(event.data)) return
    const { operation, body } = event.data
    if (operation === CREATE_TWEET_OPERATION) {
      window.parent.postMessage({ channel: CHANNEL, type: 'composed', body }, origin)
    } else if (operation === DELETE_TWEET_OPERATION) {
      window.parent.postMessage({ channel: CHANNEL, type: 'deleted', body }, origin)
    }
  })
}
