import type { CollectorState, TimelineKind } from './types'

/** 모든 메시지에 붙는 채널 태그. x.com 페이지의 다른 postMessage 와 섞이지 않게 한다. */
export const CHANNEL = 'xdeck/v1'

/** iframe src 에 붙여 해당 프레임이 어느 컬럼용인지 알려주는 쿼리 파라미터. */
export const ROLE_PARAM = 'xdeck_role'

/** 이 탭에 덱 UI 를 띄우라는 표시. 확장 아이콘으로 열린 탭에만 붙는다. */
export const DECK_PARAM = 'xdeck'

/** 덱 → 배경 워커. 헤더 제거 규칙이 살아 있는지 물어본다 (진단용). */
export const RULE_REPORT = 'xdeck:rule-report'

/** MAIN world 인터셉터 → ISOLATED world 브리지 (같은 프레임 안). */
export interface CapturedPayload {
  channel: typeof CHANNEL
  type: 'captured'
  /** GraphQL operation 이름. URL 마지막 세그먼트에서 뽑는다. */
  operation: string
  url: string
  /** 파싱 전 응답 본문(JSON 문자열). 구조화는 덱 쪽에서 한다. */
  body: string
}

/** 브리지 → 덱 페이지. */
export type FrameMessage =
  | {
      channel: typeof CHANNEL
      type: 'timeline'
      role: TimelineKind
      operation: string
      body: string
    }
  | {
      channel: typeof CHANNEL
      type: 'status'
      role: TimelineKind
      state: CollectorState
      message?: string
    }
  | {
      channel: typeof CHANNEL
      type: 'pending'
      role: TimelineKind
      /** 감지한 '새 게시물 보기' 개수. 숫자를 못 읽으면 null. */
      count: number | null
    }

/** 작성창 프레임 → 덱. 글이 실제로 올라갔다는 신호. */
export interface ComposedMessage {
  channel: typeof CHANNEL
  type: 'composed'
}

/** 덱 페이지 → 브리지. */
export type DeckCommand =
  | { channel: typeof CHANNEL; type: 'command'; command: 'refresh' }
  | { channel: typeof CHANNEL; type: 'command'; command: 'select-tab' }
  | { channel: typeof CHANNEL; type: 'command'; command: 'ping' }

const FRAME_MESSAGE_TYPES = new Set(['timeline', 'status', 'pending'])

export function isFrameMessage(value: unknown): value is FrameMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    FRAME_MESSAGE_TYPES.has((value as { type?: string }).type ?? '')
  )
}

export function isDeckCommand(value: unknown): value is DeckCommand {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    (value as { type?: unknown }).type === 'command'
  )
}

export function isComposedMessage(value: unknown): value is ComposedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    (value as { type?: unknown }).type === 'composed'
  )
}

export function isCapturedPayload(value: unknown): value is CapturedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    (value as { type?: unknown }).type === 'captured'
  )
}
