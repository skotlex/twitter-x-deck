/**
 * 게시물 번역.
 *
 * 두 가지 길을 순서대로 쓴다 —
 *   1) **Papago**: 보이지 않는 프레임에 papago.naver.com 을 띄우고, 그 안에서 도는
 *      우리 스크립트(`papago.ts`)에 글월을 넘겨 결과를 받는다. 유료 API 가 아니라
 *      사람이 쓰는 화면을 그대로 빌린다.
 *   2) **크롬 내장 번역기**: Papago 가 막히거나 실패하면 브라우저가 기기 안에서
 *      돌리는 번역기로 물러선다. 네트워크도 권한도 필요 없다.
 *
 * x.com 자신의 번역은 쓰지 않는다. 글마다 번역을 주기도 안 주기도 하는 데다,
 * 한 번 번역할 때마다 x.com 앱을 통째로 부팅해야 해서 가장 비쌌다.
 */
import { CHANNEL, isPapagoMessage, PAPAGO_ORIGIN, PAPAGO_PARAM } from '@core/messages'
import { enqueue } from './frameQueue'

/** Papago 프레임이 뜨고 결과까지 돌아오기를 기다리는 한계. */
const PAPAGO_TIMEOUT_MS = 20_000

export class TranslateError extends Error {}

/**
 * 사람이 읽는 언어. 번역의 도착 언어이자, 번역을 권할지 가리는 기준이다.
 * 게시물 언어가 이것과 같으면 번역 버튼을 달지 않는다 — x.com 과 같은 기준이다.
 */
export const READING_LANG = (navigator.language || 'ko').split('-')[0]?.toLowerCase() ?? 'ko'

/** 어느 번역기가 한 것인지. 화면에 그대로 적어 사용자가 알 수 있게 한다. */
export type TranslateEngine = 'papago' | 'browser'

export interface Translation {
  text: string
  engine: TranslateEngine
}

/**
 * 주소에 글월을 실을 수 있는 길이의 한계.
 *
 * 넘으면 프레임 안에서 직접 입력란에 넣는다 — 그쪽이 덜 튼튼하므로 되도록 주소로 보낸다.
 */
const URL_TEXT_LIMIT = 6_000

/** Papago 가 받는 도착 언어. 모르는 코드면 영어로 간다. */
const PAPAGO_TARGETS = new Set([
  'ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'ru', 'pt', 'it', 'vi', 'th', 'id', 'hi',
])

function papagoTarget(lang: string): string {
  const lower = lang.toLowerCase()
  const base = lower.split('-')[0] ?? 'en'
  if (base === 'zh') return lower.includes('tw') ? 'zh-TW' : 'zh-CN'
  return PAPAGO_TARGETS.has(base) ? base : 'en'
}

function createFrame(url: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  // 화면 밖으로 밀지 않는다 — 밖에 두면 렌더링이 멈춰 입력란이 그려지지 않는다.
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:900px;height:700px;opacity:0;pointer-events:none;border:0;z-index:-1'
  frame.setAttribute('aria-hidden', 'true')
  frame.src = url
  document.documentElement.append(frame)
  return frame
}

/**
 * Papago 화면을 빌려 번역한다.
 *
 * 글월은 주소의 `st` 에 실어 보낸다 — Papago 가 공유 링크로 쓰는 방식이라, 편집기를
 * 밖에서 조작하는 것보다 훨씬 튼튼하다. 주소에 담기엔 긴 글만 프레임 안에서 직접
 * 넣는데, 그쪽도 같은 글월을 메시지로 받아두므로 판단은 프레임이 한다.
 *
 * 출발 언어는 늘 `auto` 다. x.com 이 붙여준 언어 코드보다 Papago 자신의 판정이 낫고,
 * 지원하지 않는 코드를 넘겨 통째로 실패할 일도 없다.
 */
async function translateWithPapago(text: string, target: string): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const source = encodeURIComponent(text)
  const params = new URLSearchParams({ sk: 'auto', tk: papagoTarget(target), [PAPAGO_PARAM]: id })
  const url =
    `${PAPAGO_ORIGIN}/?${params.toString()}` +
    (source.length <= URL_TEXT_LIMIT ? `&st=${source}` : '')
  const frame = createFrame(url)

  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        finish()
        reject(new TranslateError('Papago 가 응답하지 않았습니다'))
      }, PAPAGO_TIMEOUT_MS)

      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== PAPAGO_ORIGIN || !isPapagoMessage(event.data)) return
        if (event.data.id !== id) return

        if (event.data.type === 'papago-ready') {
          frame.contentWindow?.postMessage(
            { channel: CHANNEL, type: 'papago-ask', id, text, target: papagoTarget(target) },
            PAPAGO_ORIGIN,
          )
          return
        }
        if (event.data.type === 'papago-result') {
          const result = event.data.text
          finish()
          resolve(result)
          return
        }
        if (event.data.type === 'papago-failed') {
          const reason = event.data.reason
          finish()
          reject(new TranslateError(reason))
        }
      }

      function finish(): void {
        window.clearTimeout(timer)
        window.removeEventListener('message', onMessage)
      }

      window.addEventListener('message', onMessage)
    })
  } finally {
    frame.remove()
  }
}

/**
 * 크롬이 기기 안에서 돌리는 번역기. 표준 `Translator` API 다.
 *
 * 브라우저에 없거나 그 언어 짝을 지원하지 않으면 null 을 돌려준다 — 그건 실패가
 * 아니라 '이 길은 없다' 는 뜻이라, 부르는 쪽이 마지막 실패 이유를 그대로 들고 간다.
 * 처음 쓸 때 언어팩을 내려받는데, 사용자가 버튼을 누른 흐름 안이라 허용된다.
 */
interface LanguagePair {
  sourceLanguage: string
  targetLanguage: string
}

interface TranslatorApi {
  availability?(options: LanguagePair): Promise<string>
  create(options: LanguagePair): Promise<{
    translate(text: string): Promise<string>
    destroy?(): void
  }>
}

/**
 * 이 브라우저의 번역기를 찾는다.
 *
 * 표준으로 자리 잡기까지 이름이 몇 번 바뀐 API 라 알려진 자리를 모두 본다.
 * 어디에도 없으면 이 길은 없는 것이다.
 */
function browserTranslator(): TranslatorApi | null {
  const scope = globalThis as {
    Translator?: TranslatorApi
    translation?: TranslatorApi
    ai?: { translator?: TranslatorApi }
  }
  const found = scope.Translator ?? scope.translation ?? scope.ai?.translator
  return typeof found?.create === 'function' ? found : null
}

async function translateWithBrowser(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  const api = browserTranslator()
  // 출발 언어를 모르면 이 길은 못 쓴다. Papago 와 달리 짝을 명시해야 한다.
  if (!api || source === 'auto') return null

  const pair = {
    sourceLanguage: source.split('-')[0] ?? source,
    targetLanguage: target.split('-')[0] ?? target,
  }
  try {
    if (api.availability && (await api.availability(pair)) === 'unavailable') return null
    const translator = await api.create(pair)
    try {
      return await translator.translate(text)
    } finally {
      translator.destroy?.()
    }
  } catch {
    return null
  }
}

/**
 * 게시물 하나를 번역한다. Papago 를 먼저 쓰고, 안 되면 브라우저 번역기로 물러선다.
 *
 * 프레임을 쓰는 길은 줄을 세운다 — 여러 개를 동시에 띄우면 그만큼 남의 서버를
 * 두드리게 되고, 우리 탭도 무거워진다.
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<Translation> {
  let reason = 'Papago 를 띄우지 못했습니다'

  try {
    const translated = await enqueue(() => translateWithPapago(text, targetLang))
    if (translated.length > 0) return { text: translated, engine: 'papago' }
    reason = '번역문이 비어 있습니다'
  } catch (cause) {
    reason = cause instanceof Error ? cause.message : reason
  }

  const fallback = await translateWithBrowser(text, sourceLang, targetLang)
  if (fallback !== null && fallback.length > 0) return { text: fallback, engine: 'browser' }

  throw new TranslateError(`${reason} · 브라우저 번역기도 쓸 수 없습니다`)
}
