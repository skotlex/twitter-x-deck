/**
 * 덱과 같은 문서에서 도는 수집기로 가는 손잡이.
 *
 * 자식 프레임에는 postMessage 로 명령을 보내지만, 최상위 문서의 수집기는 같은
 * 격리 세계에 있으므로 함수를 직접 부르면 된다. 그 연결만 여기서 보관한다.
 */
import type { CollectorHandle } from '../content/collector'
import type { DeckCommand } from '@core/messages'
import type { TimelineKind } from '@core/types'

let handle: CollectorHandle | null = null
let owned: TimelineKind[] = []

export function setHostCollector(kinds: TimelineKind[], next: CollectorHandle): void {
  handle = next
  owned = [...kinds]
}

/** 해당 컬럼이 최상위 문서 담당이면 명령을 전달하고 true 를 준다. */
export function commandHostCollector(kind: TimelineKind, command: DeckCommand['command']): boolean {
  if (!handle || !owned.includes(kind)) return false
  handle.command(kind, command)
  return true
}

/** 최상위 문서가 맡을 컬럼을 다시 정한다. 프레임이 죽었을 때 교대 수집으로 넘기는 통로. */
export function setHostKinds(kinds: TimelineKind[]): void {
  if (!handle) return
  owned = [...kinds]
  handle.setKinds(kinds)
}

export function hostOwns(kind: TimelineKind): boolean {
  return owned.includes(kind)
}
