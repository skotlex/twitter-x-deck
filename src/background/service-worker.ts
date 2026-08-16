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
 * 덱은 x.com 문서 위에서 돌아 바깥 프로그램을 부를 수 없다. 확장 중에서도 이 워커만
 * 낼 수 있는 길이라 여기서 중계한다.
 *
 * 포트도 주소도 없다. `connectNative` 는 등록해 둔 프로그램을 브라우저가 직접 켜서
 * 표준 입출력으로 이어주고, 우리가 연결을 놓으면 함께 내린다 — 사용자가 무언가를
 * 띄워두거나 맞출 것이 없다.
 */
const HOST_NAME = 'com.xdeck.bridge'

/** 아직 등록하지 않았을 때 브라우저가 주는 말. 이때만은 안내가 달라야 한다. */
function notInstalled(reason: string): boolean {
  return /not found|not installed|no such native/i.test(reason)
}

/**
 * 브리지에 한 가지를 청하고 답을 받는다.
 *
 * 답이 크면 여러 덩이로 나뉘어 온다 — 브라우저가 한 덩이를 1MB 로 끊기 때문이다.
 * `seq` 자리에 채워 넣고 `total` 만큼 모이면 이어 붙여 원래 글로 되돌린다.
 * 청할 때마다 새로 잇고 끝나면 놓는다. 오래 붙들고 있어봐야 남의 프로세스를
 * 살려두는 것뿐이다.
 */
function callBridge(type: string, payload: object, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connectNative(HOST_NAME)
    } catch (cause) {
      resolve({
        reachable: false,
        error: `브리지를 열지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
      return
    }

    const id = crypto.randomUUID()
    const parts: (string | undefined)[] = []
    let total = 0
    let settled = false

    const finish = (value: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        port.disconnect()
      } catch {
        // 이미 끊겼다. 결과에는 영향이 없다.
      }
      resolve(value)
    }

    const timer = setTimeout(
      () => finish({ reachable: false, error: '브리지가 시간 안에 답하지 않았습니다.' }),
      timeoutMs,
    )

    port.onMessage.addListener((frame: { id?: string; seq?: number; total?: number; body?: string }) => {
      if (frame?.id !== id || typeof frame.seq !== 'number' || typeof frame.body !== 'string') return
      parts[frame.seq] = frame.body
      total = frame.total ?? 0
      // 빠진 자리가 없어야 이어 붙인다. 덩이는 순서대로 오지만 그것에 기대지 않는다.
      if (total > 0 && parts.length >= total) {
        for (let at = 0; at < total; at += 1) if (parts[at] === undefined) return
        try {
          finish({ reachable: true, ...(JSON.parse(parts.join('')) as object) })
        } catch {
          finish({ reachable: false, error: '브리지의 답을 읽지 못했습니다.' })
        }
      }
    })

    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message ?? ''
      finish({
        reachable: false,
        error: notInstalled(reason)
          ? '브리지가 등록되지 않았습니다. 내려받은 폴더의 install-bridge.bat 을 한 번 실행한 뒤 브라우저를 다시 켜세요.'
          : reason || '브리지와의 연결이 끊겼습니다.',
      })
    })

    port.postMessage({ id, type, ...payload })
  })
}

/**
 * 로그인 상태를 여기서 기억한다.
 *
 * 브리지도 답을 쟁여두지만 소용이 없다 — 우리가 연결을 놓으면 그 프로세스가 함께
 * 내려가면서 기억도 사라진다. 그래서 라이트박스를 열 때마다 브리지를 다시 켜고
 * 검사를 처음부터 돌렸고, 사진 번역 단추가 몇 초 뒤에야 나타났다.
 *
 * 로그인은 자주 바뀌는 것이 아니므로 이쪽에서 들고 있는다. 사용자가 '상태 다시 확인'
 * 을 누르면 그때는 기억을 버리고 실제로 다시 잰다.
 */
const STATUS_MEMO_MS = 5 * 60 * 1000
let statusMemo: { at: number; value: unknown } | null = null

async function readBridgeStatus(force: boolean): Promise<unknown> {
  if (!force && statusMemo !== null && Date.now() - statusMemo.at < STATUS_MEMO_MS) {
    return statusMemo.value
  }
  const value = await callBridge('status', { force }, 90_000)
  // 닿지 못한 답은 쟁여두지 않는다. 브리지를 이제 막 등록한 참일 수 있다.
  if ((value as { reachable?: unknown })?.reachable === true) {
    statusMemo = { at: Date.now(), value }
  }
  return value
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
    void readBridgeStatus(payload.force === true).then(sendResponse)
    return true
  }

  if (type === BRIDGE_LOGIN) {
    // 로그인을 시작했으면 기억해둔 상태는 곧 낡는다.
    statusMemo = null
    void callBridge('login', { engine: payload.engine }, 15_000).then(sendResponse)
    return true
  }

  if (type === IMAGE_TRANSLATE) {
    // 그림을 다시 그리는 데 1분을 넘기기도 한다. 브리지 쪽 한계보다 넉넉히 잡는다.
    void callBridge(
      'translate',
      {
        engine: payload.engine,
        imageUrl: payload.imageUrl,
        mode: payload.mode,
        fast: payload.fast,
      },
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
