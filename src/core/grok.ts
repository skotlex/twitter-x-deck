/**
 * x.com 의 Grok 번역.
 *
 * x.com 은 외국어 게시물을 Grok 으로 자동 번역해 보여준다. 그 번역은 타임라인 응답에
 * 실려 오지 않고, 화면이 글마다 `api.x.com/2/grok/translation.json` 을 따로 불러 받는다.
 * 덱도 같은 곳에 같은 모양으로 묻는다.
 *
 * 요청은 MAIN world 인터셉터가 보내고(x.com 자신과 똑같은 출처·쿠키로 나가야 한다),
 * 덱은 메시지로 부탁만 한다. 이 파일은 두 쪽이 함께 보는 약속과 응답 해석을 담는다.
 */
import { CHANNEL } from './messages'

export const GROK_TRANSLATE_URL = 'https://api.x.com/2/grok/translation.json'

/** 덱 → 인터셉터. 이 글을 이 언어로 옮겨 달라. */
export interface GrokAsk {
  channel: typeof CHANNEL
  type: 'grok-ask'
  id: string
  tweetId: string
  lang: string
}

/**
 * 인터셉터 → 덱.
 *
 * `limited` 는 요청이 너무 많다고 막힌 것이다 — 그 글을 못 옮기는 게 아니라 잠시 쉬라는
 * 뜻이다. `retryAt` 은 x.com 이 알려준, 다시 물어도 되는 시각 (없을 수 있다).
 */
export type GrokReply =
  | { channel: typeof CHANNEL; type: 'grok-result'; id: string; text: string }
  | {
      channel: typeof CHANNEL
      type: 'grok-failed'
      id: string
      reason: string
      limited?: boolean
      retryAt?: number
    }

function tagged(value: unknown): value is { type: string; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    typeof (value as { id?: unknown }).id === 'string'
  )
}

export function isGrokAsk(value: unknown): value is GrokAsk {
  return (
    tagged(value) &&
    value.type === 'grok-ask' &&
    typeof (value as { tweetId?: unknown }).tweetId === 'string'
  )
}

export function isGrokReply(value: unknown): value is GrokReply {
  return tagged(value) && (value.type === 'grok-result' || value.type === 'grok-failed')
}

export interface GrokStream {
  /** 조각을 이어 붙인 번역문. 아직 HTML 엔티티가 남아 있을 수 있다. */
  text: string
  /** 응답에 실린 오류 코드. 88 이면 요청이 너무 많다는 뜻이다. */
  errorCodes: number[]
  /** 깨진 조각이 있었는지. 끝까지 닫히지 않은 객체도 여기에 든다. */
  malformed: boolean
}

/**
 * Grok 번역 응답을 읽는다.
 *
 * 응답은 JSON 문서 하나가 아니라 **조각마다 객체 하나씩** 이어 붙인 흐름이다
 * (`{"result":{"text":"안"}}{"result":{"text":"녕"}}`). 그래서 `JSON.parse` 한 번으로는
 * 못 읽고, 최상위 중괄호가 닫힐 때마다 끊어 읽는다. 문자열 안의 중괄호와 이스케이프는
 * 세지 않는다.
 */
export function readGrokStream(raw: string): GrokStream {
  const out: GrokStream = { text: '', errorCodes: [], malformed: false }
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) readChunk(raw.slice(start, i + 1), out)
    }
  }

  if (depth !== 0) out.malformed = true
  return out
}

function readChunk(chunk: string, out: GrokStream): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(chunk)
  } catch {
    out.malformed = true
    return
  }
  const node = parsed as { result?: { text?: unknown }; errors?: { code?: unknown }[] }
  if (typeof node.result?.text === 'string') out.text += node.result.text
  if (Array.isArray(node.errors)) {
    for (const error of node.errors) {
      if (typeof error?.code === 'number') out.errorCodes.push(error.code)
    }
  }
}

/** 요청이 너무 많다는 오류 코드. 상태가 200 이어도 본문에 이것이 실려 올 수 있다. */
export const GROK_RATE_LIMIT_CODE = 88

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 번역문에 남은 HTML 엔티티를 푼다. x.com 본문과 같이 `&amp;` 꼴로 온다. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}
