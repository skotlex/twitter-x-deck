/**
 * 백그라운드 서비스 워커.
 *
 * 덱은 x.com 탭 위에 얹히므로, 여기서 할 일은 그 탭을 열고 다시 찾아주는 것뿐이다.
 * 수집 메시지는 같은 문서·같은 오리진 안에서만 오가므로 중계할 것이 없다.
 */
import {
  DECK_PARAM,
  OCR_DONE,
  OCR_PROGRESS,
  OCR_RUN,
  ROLE_PARAM,
  RULE_REPORT,
  type OcrDone,
  type OcrProgress,
  type OcrRequest,
} from '@core/messages'

/** 최상위 탭이 맡는 컬럼. 나머지는 그 탭 안의 숨은 프레임이 맡는다. */
const DECK_URL = `https://x.com/home?${ROLE_PARAM}=foryou&${DECK_PARAM}=1`

const TAB_KEY = 'deckTabId'

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
    if (rulesMatchedInfo.length === 0) {
      parts.push('매칭 0건')
    } else {
      const newest = Math.max(...rulesMatchedInfo.map((hit) => hit.timeStamp))
      const ago = Math.round((Date.now() - newest) / 1000)
      const ids = [...new Set(rulesMatchedInfo.map((hit) => hit.rule.ruleId))]
      parts.push(`매칭 ${rulesMatchedInfo.length}건 (규칙 ${ids.join(',')}, 마지막 ${ago}초 전)`)
    }
  } catch {
    parts.push('매칭 조회 불가')
  }
  return parts.join(' · ')
}

/**
 * 글자 인식이 도는 문서를 띄워둔다.
 *
 * 화면에 보이지 않는 확장 문서다. x.com 페이지 안에서는 워커를 띄울 수 없어(그 페이지의
 * CSP 가 막는다) 이 자리를 따로 마련한다. 한 번 띄우면 계속 두고 쓴다 — 띄울 때마다
 * 글자 데이터를 다시 읽으면 인식이 매번 느려진다.
 */
const OCR_DOCUMENT = 'offscreen.html'
let ocrReady: Promise<void> | null = null

function ensureOcrDocument(): Promise<void> {
  ocrReady ??= (async () => {
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    })
    if (existing.length > 0) return

    await chrome.offscreen.createDocument({
      url: OCR_DOCUMENT,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: '사진 속 글자를 이 브라우저 안에서 읽습니다.',
    })
  })().catch((cause: unknown) => {
    // 다음 요청에서 다시 시도할 수 있게 놓아준다.
    ocrReady = null
    throw cause
  })
  return ocrReady
}

/**
 * 인식을 시켜만 놓는다. 결과는 기다리지 않는다.
 *
 * 처음 한 번은 몇 분이 걸리는데, 그 시간을 응답 채널에 매달아 두면 그 사이 이 워커가
 * 잠들며 통로가 끊긴다. 결과는 오프스크린 문서가 따로 보내오고, 그때 탭으로 옮긴다.
 */
async function startOcr(request: OcrRequest, tabId: number): Promise<void> {
  try {
    await ensureOcrDocument()
    // 오프스크린 문서도 같은 메시지 통로를 듣는다. 보낸 것이 그대로 그쪽으로 간다.
    void chrome.runtime.sendMessage({ ...request, tabId }).catch(() => undefined)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : '글자 인식을 시작하지 못했습니다'
    void chrome.tabs
      .sendMessage(tabId, { type: OCR_DONE, tabId, result: { ok: false, reason } })
      .catch(() => undefined)
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type

  if (type === RULE_REPORT) {
    void ruleReport(sender.tab?.id).then(sendResponse)
    // 비동기로 답하겠다는 신호.
    return true
  }

  // 덱이 보낸 것만 받는다. 오프스크린 문서가 답으로 보내는 같은 이름의 메시지를
  // 여기서 다시 집으면 서로를 부르며 맴돈다.
  // 덱이 보낸 것만 받는다(tabId 가 없다). 오프스크린 문서로 넘긴 것을 여기서 다시
  // 집으면 서로를 부르며 맴돈다.
  if (type === OCR_RUN && sender.tab?.id !== undefined) {
    void startOcr(message as OcrRequest, sender.tab.id)
    sendResponse(null)
    return false
  }

  // 오프스크린 문서가 보낸 결과·진행 상황을 물어본 탭으로 넘긴다. 확장 메시지는
  // 콘텐츠 스크립트까지 저절로 가지 않아 여기서 한 번 옮겨줘야 한다.
  if (type === OCR_DONE) {
    const done = message as OcrDone
    if (done.tabId !== undefined) {
      void chrome.tabs.sendMessage(done.tabId, done).catch(() => undefined)
    }
    sendResponse(null)
    return false
  }

  if (type === OCR_PROGRESS) {
    const progress = message as OcrProgress
    if (progress.tabId !== undefined) {
      void chrome.tabs.sendMessage(progress.tabId, progress).catch(() => undefined)
    }
    sendResponse(null)
    return false
  }

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
