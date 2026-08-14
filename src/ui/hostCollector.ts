/**
 * 덱과 같은 문서에서 도는 수집기로 가는 손잡이.
 *
 * 자식 프레임에는 postMessage 로 명령을 보내지만, 최상위 문서의 수집기는 같은
 * 격리 세계에 있으므로 함수를 직접 부르면 된다. 그 연결만 여기서 보관한다.
 */
import type { CollectorHandle } from '../content/collector'
import type { DeckCommand } from '@core/messages'
import type { TimelineKind } from '@core/types'

let registered: { kind: TimelineKind; handle: CollectorHandle } | null = null

export function setHostCollector(kind: TimelineKind, handle: CollectorHandle): void {
  registered = { kind, handle }
}

/** 해당 컬럼이 최상위 문서 담당이면 명령을 전달하고 true 를 준다. */
export function commandHostCollector(kind: TimelineKind, command: DeckCommand['command']): boolean {
  if (registered?.kind !== kind) return false
  registered.handle.command(command)
  return true
}
