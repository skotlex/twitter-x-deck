/**
 * 백그라운드 서비스 워커.
 *
 * 덱은 x.com 탭 위에 얹히므로, 여기서 할 일은 그 탭을 열고 다시 찾아주는 것뿐이다.
 * 수집 메시지는 같은 문서·같은 오리진 안에서만 오가므로 중계할 것이 없다.
 */
import {
  BRIDGE_LOGIN,
  BRIDGE_STATUS,
  DECK_PARAM,
  IMAGE_TRANSLATE,
  ROLE_PARAM,
  RULE_REPORT,
} from '@core/messages'

/** 최상위 탭이 맡는 컬럼. 나머지는 그 탭 안의 숨은 프레임이 맡는다. */
const DECK_URL = `https://x.com/home?${ROLE_PARAM}=foryou&${DECK_PARAM}=1`

const TAB_KEY = 'deckTabId'

/**
 * 헤더를 걷어내는 규칙의 id (`rules.json`).
 *
 * 같은 파일의 광고·분석 차단 규칙은 늘 걸리므로 셈에 섞이면 진단이 못 쓰게 된다 —
 * 프레임이 막혔는지는 **헤더 규칙이** 방금 걸렸는지로만 가려진다.
 */
const HEADER_RULE_IDS = new Set([1, 2, 3])

async function rememberedTabId(): Promise<number | null> {
  const stored = await chrome.storage.session.get(TAB_KEY)
  const id = stored[TAB_KEY]
  return typeof id === 'number' ? id : null
}

async function openDeck(): Promise<void> {
  const remembered = await rememberedTabId()
  if (remembered !== null) {
    const tab = await chrome.tabs.get(remembered).catch(() => null)
    if (tab?.id !== undefined) {
      await chrome.tabs.update(tab.id, { active: true })
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
      return
    }
    await chrome.storage.session.remove(TAB_KEY)
  }

  const created = await chrome.tabs.create({ url: DECK_URL })
  if (created.id !== undefined) await chrome.storage.session.set({ [TAB_KEY]: created.id })
}

/**
 * 헤더 제거 규칙이 실제로 살아서 요청에 걸리고 있는지 확인해준다.
 *
 * 프레임이 막혔을 때 규칙이 안 실린 것인지, 실렸는데 요청 종류가 안 맞아 비껴간
 * 것인지는 밖에서 구별할 방법이 없다. 이 API 는 배경 워커에서만 부를 수 있어
 * 덱이 물어보면 대신 조회해준다.
 */
async function ruleReport(tabId?: number): Promise<string> {
  const parts: string[] = []
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets()
    parts.push(`규칙셋 [${enabled.join(', ') || '없음'}]`)
  } catch {
    parts.push('규칙셋 조회 실패')
  }
  try {
    // 물어본 탭의 것만 본다. 매칭이 몇 건인지보다 **방금 그 요청**에 걸렸는지가
    // 중요하고, 그건 마지막 매칭이 얼마나 오래됐는지로만 알 수 있다.
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules(
      tabId === undefined ? {} : { tabId },
    )
    const hits = rulesMatchedInfo.filter((hit) => HEADER_RULE_IDS.has(hit.rule.ruleId))
    if (hits.length === 0) {
      parts.push('매칭 0건')
    } else {
      const newest = Math.max(...hits.map((hit) => hit.timeStamp))
      const ago = Math.round((Date.now() - newest) / 1000)
      const ids = [...new Set(hits.map((hit) => hit.rule.ruleId))]
      parts.push(`매칭 ${hits.length}건 (규칙 ${ids.join(',')}, 마지막 ${ago}초 전)`)
    }
  } catch {
    parts.push('매칭 조회 불가')
  }
  return parts.join(' · ')
}

/**
 * 이미지 번역 브리지로 가는 길.
 *
 * 덱은 x.com 문서 위에서 돌아 로컬 서버를 직접 부르지 못한다 — 그 페이지의 연결 정책이
 * 막는다. 호스트 권한을 가진 이 워커만 낼 수 있는 길이라 여기서 중계한다.
 *
 * 포트와 열쇠는 덱이 실어 보낸다. 여기서 설정을 읽지 않는 이유는, 설정 모듈이
 * 페이지 저장소에 사본을 남기느라 `window` 를 만지는데 워커에는 그것이 없기 때문이다.
 */
/**
 * 브리지가 앉을 수 있는 자리. `bridge/server.mjs` 의 같은 값과 맞춰야 한다.
 * 브리지는 8765 가 막혀 있으면 다음 번호로 옮겨 앉으므로 이쪽도 같은 범위를 훑는다.
 */
const BRIDGE_PORT_BASE = 8765
const BRIDGE_PORT_TRIES = 16
const BRIDGE_SERVICE = 'x-deck-bridge'

/**
 * 우리 확장이라는 표시.
 *
 * 비밀이 아니다. 웹페이지가 이 헤더를 붙이려 하면 브라우저가 먼저 예비 요청을 보내는데
 * 브리지는 그것을 허락하지 않는다. 확장은 호스트 권한이 있어 그 검사를 거치지 않으므로,
 * 사용자가 아무것도 붙여넣지 않아도 우리만 통과한다.
 */
const BRIDGE_HEADERS = { 'content-type': 'application/json', 'x-deck-bridge': '1' }

async function request(port: number, path: string, body: unknown, timeoutMs: number) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: BRIDGE_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** 마지막으로 찾은 자리. 매번 훑지 않도록 기억해둔다. */
let knownPort: number | null = null

/** 그 포트에 우리 브리지가 있는지. 남의 서버가 앉아 있을 수도 있어 표시를 확인한다. */
async function isBridge(port: number): Promise<boolean> {
  try {
    const response = await request(port, '/hello', undefined, 1_500)
    if (!response.ok) return false
    const payload = (await response.json()) as { service?: unknown }
    return payload.service === BRIDGE_SERVICE
  } catch {
    return false
  }
}

/**
 * 브리지를 찾는다.
 *
 * 기억해둔 자리를 먼저 보고, 없거나 비었으면 범위를 처음부터 훑는다. 브리지를 껐다
 * 켜면서 다른 번호로 옮겨 앉는 경우가 있어 기억은 힌트일 뿐 근거가 아니다.
 */
async function findBridge(): Promise<number | null> {
  if (knownPort !== null && (await isBridge(knownPort))) return knownPort

  for (let at = 0; at < BRIDGE_PORT_TRIES; at += 1) {
    const port = BRIDGE_PORT_BASE + at
    if (port === knownPort) continue
    if (await isBridge(port)) {
      knownPort = port
      return port
    }
  }
  knownPort = null
  return null
}

async function callBridge(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const port = await findBridge()
  if (port === null) {
    return { reachable: false, error: '브리지를 찾지 못했습니다. npm run bridge 로 띄웠는지 확인하세요.' }
  }

  try {
    const response = await request(port, path, body, timeoutMs)
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      return {
        reachable: false,
        error:
          typeof payload.error === 'string'
            ? payload.error
            : `브리지가 ${response.status} 로 답했습니다.`,
      }
    }
    return { reachable: true, ...payload }
  } catch (cause) {
    // 도중에 브리지가 꺼졌을 수 있다. 기억을 버려 다음 번에는 처음부터 훑게 한다.
    knownPort = null
    const aborted = cause instanceof DOMException && cause.name === 'AbortError'
    return {
      reachable: false,
      error: aborted ? '브리지가 시간 안에 답하지 않았습니다.' : '브리지와의 연결이 끊겼습니다.',
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type
  const payload = (message ?? {}) as Record<string, unknown>

  if (type === RULE_REPORT) {
    void ruleReport(sender.tab?.id).then(sendResponse)
    // 비동기로 답하겠다는 신호.
    return true
  }

  if (type === BRIDGE_STATUS) {
    const path = payload.force === true ? '/status?force=1' : '/status'
    void callBridge(path, undefined, 90_000).then(sendResponse)
    return true
  }

  if (type === BRIDGE_LOGIN) {
    void callBridge('/login', { engine: payload.engine }, 15_000).then(sendResponse)
    return true
  }

  if (type === IMAGE_TRANSLATE) {
    // 그림을 다시 그리는 데 1분을 넘기기도 한다. 브리지 쪽 한계보다 넉넉히 잡는다.
    void callBridge(
      '/translate',
      { engine: payload.engine, imageUrl: payload.imageUrl },
      320_000,
    ).then(sendResponse)
    return true
  }

  // 덱이 보낸 것만 받는다. 오프스크린 문서가 답으로 보내는 같은 이름의 메시지를
  // 여기서 다시 집으면 서로를 부르며 맴돈다.
  return undefined
})

chrome.action.onClicked.addListener(() => {
  void openDeck()
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openDeck()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void rememberedTabId().then((id) => {
    if (id === tabId) void chrome.storage.session.remove(TAB_KEY)
  })
})
