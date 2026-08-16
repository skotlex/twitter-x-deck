/**
 * 사진 속 글자 번역 — 덱 쪽 창구.
 *
 * 실제 일은 이 PC 에 깔린 `codex` · `claude` 가 하고, 그 둘을 부르는 것은 로컬 브리지
 * (`bridge/server.mjs`) 다. 덱은 배경 워커를 거쳐 그 브리지에 말을 건다.
 *
 * 별도 API 키를 쓰지 않는다. 두 명령이 이미 로그인해 둔 구독 계정을 그대로 빌린다 —
 * 그래서 '쓸 수 있는지' 는 열쇠가 있는지가 아니라 **로그인이 되어 있는지** 로 갈린다.
 */
import {
  BRIDGE_LOGIN,
  BRIDGE_STATUS,
  IMAGE_TRANSLATE,
  type BridgeStatus,
  type EngineStatus,
  type ImageTranslation,
  type TranslateEngineId,
} from '@core/messages'
export const ENGINE_LABEL: Record<TranslateEngineId, string> = {
  codex: 'Codex',
  claude: 'Claude',
}

/** 그 명령이 무엇을 내주는지. claude 는 그림을 만들지 못한다. */
export const ENGINE_OUTPUT: Record<TranslateEngineId, '이미지' | '텍스트'> = {
  codex: '이미지',
  claude: '텍스트',
}

export class ImageTranslateError extends Error {}

/**
 * 브리지를 찾는 일은 배경 워커가 한다.
 *
 * 덱은 x.com 문서 위에서 돌아 바깥 프로그램을 부를 수 없다. 브리지를 켜고 잇는 일은
 * 워커가 하므로, 이쪽에서 넘길 것은 무엇을 해달라는 말뿐이다.
 */

/** 브리지와 두 명령의 형편을 물어본다. `force` 면 브리지가 쟁여둔 답을 버리고 다시 잰다. */
export async function fetchBridgeStatus(force = false): Promise<BridgeStatus> {
  return (await chrome.runtime.sendMessage({ type: BRIDGE_STATUS, force })) as BridgeStatus
}

/** 로그인 절차를 띄운다. 브라우저를 열어 사람이 마쳐야 하는 일이라 여기서 끝나지 않는다. */
export async function requestLogin(engine: TranslateEngineId): Promise<BridgeStatus> {
  return (await chrome.runtime.sendMessage({ type: BRIDGE_LOGIN, engine })) as BridgeStatus
}

/**
 * 실제로 쓸 명령을 고른다.
 *
 * 설정에서 고른 것을 먼저 보되, 그쪽이 로그인돼 있지 않으면 로그인된 나머지로 간다 —
 * 둘 중 하나만 구독 중인 사람에게 고르라고 물을 이유가 없다. 둘 다 아니면 없다.
 */
export function pickEngine(
  preferred: TranslateEngineId,
  engines: Record<TranslateEngineId, EngineStatus> | undefined,
): TranslateEngineId | null {
  if (!engines) return null
  if (engines[preferred]?.loggedIn) return preferred
  const other: TranslateEngineId = preferred === 'codex' ? 'claude' : 'codex'
  return engines[other]?.loggedIn ? other : null
}

/** 사진 한 장을 번역한다. 결과의 종류는 어느 명령이 했는지에 달려 있다. */
export async function translateImage(
  imageUrl: string,
  engine: TranslateEngineId,
): Promise<ImageTranslation> {
  const answer = (await chrome.runtime.sendMessage({
    type: IMAGE_TRANSLATE,
    engine,
    imageUrl,
  })) as BridgeStatus & Partial<ImageTranslation>

  if (!answer?.reachable) {
    throw new ImageTranslateError(answer?.error ?? '브리지에 닿지 못했습니다.')
  }
  if (answer.kind === 'image' && typeof answer.dataUrl === 'string') {
    return { kind: 'image', engine, dataUrl: answer.dataUrl }
  }
  if (answer.kind === 'text' && Array.isArray(answer.items)) {
    return { kind: 'text', engine, items: answer.items }
  }
  throw new ImageTranslateError(
    (answer as { error?: string }).error ?? '번역 결과를 받지 못했습니다.',
  )
}
