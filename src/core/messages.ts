import type { CollectorState, TimelineKind } from './types'

/** 모든 메시지에 붙는 채널 태그. x.com 페이지의 다른 postMessage 와 섞이지 않게 한다. */
export const CHANNEL = 'xdeck/v1'

/** iframe src 에 붙여 해당 프레임이 어느 컬럼용인지 알려주는 쿼리 파라미터. */
export const ROLE_PARAM = 'xdeck_role'

/** 이 탭에 덱 UI 를 띄우라는 표시. 확장 아이콘으로 열린 탭에만 붙는다. */
export const DECK_PARAM = 'xdeck'

/**
 * 수집 프레임 주소에 붙이는 일회용 값.
 *
 * 늘 같은 주소로 프레임을 띄우면 브라우저가 캐시에 남은 응답을 그대로 쓴다.
 * 그러면 요청이 네트워크로 나가지 않아 헤더 제거 규칙이 낄 자리가 없고,
 * 캐시된 응답에 남아 있는 `X-Frame-Options` 가 그대로 프레임을 막는다.
 * 값이 매번 달라지면 캐시를 비켜가 규칙이 걸린 응답을 받는다.
 */
export const NOCACHE_PARAM = 'xdeck_t'

/** 덱 → 배경 워커. 헤더 제거 규칙이 살아 있는지 물어본다 (진단용). */
export const RULE_REPORT = 'xdeck:rule-report'

/**
 * 사진 번역 (덱 ↔ 배경 워커 ↔ Papago 탭).
 *
 * 이 길만 postMessage 가 아니라 확장 메시지를 쓴다. Papago 이미지 번역은 네이버
 * 로그인이 있어야 하는데, 로그인 쿠키가 `SameSite=Lax` 라 x.com 이 최상위인 프레임에는
 * 실리지 않는다. Papago 가 **최상위인 탭** 이어야만 평소 세션이 실리므로, 탭을 배경으로
 * 열어 일을 시키고 결과만 받아온다. 그 탭과 덱은 서로 다른 사이트라 배경 워커가 잇는다.
 */
export const IMAGE_TRANSLATE = 'xdeck:image-translate'
/** Papago 탭 → 배경 워커. 준비됐으니 번역할 사진을 달라. */
export const IMAGE_TRANSLATE_ASK = 'xdeck:image-ask'
/** Papago 탭 → 배경 워커. 번역 결과 또는 실패 사유. */
export const IMAGE_TRANSLATE_DONE = 'xdeck:image-done'

/** 네이버 로그인이 없어 더 못 간다는 사유. 이 값일 때만 덱이 로그인 안내를 낸다. */
export const LOGIN_REQUIRED = '네이버 로그인이 필요합니다'

/**
 * 로그인을 마치고 돌아온 탭임을 알리는 표시.
 *
 * 로그인 화면에는 '마치면 이리로 보내라' 는 주소를 함께 넘기는데, 거기에 이 표시를
 * 달아 보낸다. 그 주소로 돌아온 탭은 할 일을 다 한 것이므로 스스로 물러난다 —
 * 로그인하려던 사람에게 난데없이 Papago 화면이 남는 것은 뒤끝이 좋지 않다.
 */
export const PAPAGO_LOGIN_PARAM = 'xdeck_login'
/** 로그인 탭 → 배경 워커. 다 됐으니 이 탭을 닫아달라. */
export const PAPAGO_LOGIN_DONE = 'xdeck:papago-login-done'

export interface ImageTranslateRequest {
  type: typeof IMAGE_TRANSLATE
  /** 번역할 사진. 확장 메시지는 Blob 을 실어 나르지 못해 data URL 로 보낸다. */
  dataUrl: string
  target: string
  /**
   * 원본 사진의 크기. 번역된 사진을 가려내는 잣대다 — 화면에는 배너·배지 같은 남의
   * 그림도 함께 뜨는데, 번역본은 원본과 가로세로 비율이 같다.
   */
  width: number
  height: number
  /**
   * 로그인이 필요하다고 기억해둔 것을 무시하고 그래도 해본다.
   * 사용자가 '로그인했습니다' 라고 알려줄 때만 켠다.
   */
  force?: boolean
}

export type ImageTranslateResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: string; needsLogin: boolean }

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

/**
 * 작성창 프레임 → 덱. 글이 실제로 올라갔다는 신호.
 * 응답 본문을 함께 실어 보낸다 — 방금 올린 글이 그 안에 통째로 들어 있어,
 * 타임라인을 다시 받아오지 않고도 목록에 바로 끼워 넣을 수 있다.
 */
export interface ComposedMessage {
  channel: typeof CHANNEL
  type: 'composed'
  body: string
}

/** 글을 지웠다는 신호. 무엇을 지웠는지는 보낸 요청에만 있으므로 그 본문을 싣는다. */
export interface DeletedMessage {
  channel: typeof CHANNEL
  type: 'deleted'
  body: string
}

/** 덱이 띄운 번역 프레임임을 알리는 표시. 사람이 직접 연 Papago 는 건드리지 않는다. */
export const PAPAGO_PARAM = 'xdeck_tr'

/** 번역 프레임의 출처. 이 두 곳 사이에서만 메시지를 주고받는다. */
export const PAPAGO_ORIGIN = 'https://papago.naver.com'
export const X_ORIGIN = 'https://x.com'

/**
 * 덱 ↔ Papago 프레임. 교차 출처라 서로의 DOM 을 못 읽으므로 메시지로만 오간다.
 *
 * `id` 는 요청과 응답을 짝짓는 일회용 값이다. 프레임을 하나씩 띄우더라도 앞 요청이
 * 시간을 넘긴 뒤 뒤늦게 도착한 응답을 다음 요청의 것으로 잘못 받는 일이 없어야 한다.
 */
export type PapagoMessage =
  | { channel: typeof CHANNEL; type: 'papago-ready'; id: string }
  | { channel: typeof CHANNEL; type: 'papago-ask'; id: string; text: string; target: string }
  | { channel: typeof CHANNEL; type: 'papago-result'; id: string; text: string }
  | { channel: typeof CHANNEL; type: 'papago-failed'; id: string; reason: string }
  /**
   * 이미지 번역. 파일 입력에는 주소를 넣을 수 없어 바이트를 통째로 건넨다 —
   * Blob 은 구조화 복제로 그대로 건너간다.
   */
  | { channel: typeof CHANNEL; type: 'papago-image'; id: string; blob: Blob; name: string }
  /** 이미지를 넣었다. 결과는 프레임 안 Papago 화면에 그대로 뜬다. */
  | { channel: typeof CHANNEL; type: 'papago-loaded'; id: string }

const PAPAGO_MESSAGE_TYPES = new Set([
  'papago-ready',
  'papago-ask',
  'papago-result',
  'papago-failed',
  'papago-image',
  'papago-loaded',
])

export function isPapagoMessage(value: unknown): value is PapagoMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    PAPAGO_MESSAGE_TYPES.has((value as { type?: string }).type ?? '') &&
    typeof (value as { id?: unknown }).id === 'string'
  )
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

function isTagged(value: unknown, type: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    (value as { type?: unknown }).type === type
  )
}

export function isComposedMessage(value: unknown): value is ComposedMessage {
  return isTagged(value, 'composed')
}

export function isDeletedMessage(value: unknown): value is DeletedMessage {
  return isTagged(value, 'deleted')
}

export function isCapturedPayload(value: unknown): value is CapturedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    (value as { type?: unknown }).type === 'captured'
  )
}
