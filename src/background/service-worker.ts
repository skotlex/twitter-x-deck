/**
 * 백그라운드 서비스 워커.
 *
 * 덱은 x.com 탭 위에 얹히므로, 여기서 할 일은 그 탭을 열고 다시 찾아주는 것,
 * 그리고 그 탭에만 헤더 제거 규칙을 걸어주는 것이다. 수집 메시지는 같은 문서·
 * 같은 오리진 안에서만 오가므로 중계할 것이 없다.
 */
import { DECK_PARAM, ROLE_PARAM, RULE_REPORT, RULE_SCOPE } from '@core/messages'

/** 최상위 탭이 맡는 컬럼. 나머지는 그 탭 안의 숨은 프레임이 맡는다. */
const DECK_URL = `https://x.com/home?${ROLE_PARAM}=foryou&${DECK_PARAM}=1`

const TAB_KEY = 'deckTabId'

/**
 * 헤더 제거 규칙.
 *
 * x.com 은 자기 자신의 임베드를 CSP `frame-ancestors 'self'` 로 허용하지만
 * `X-Frame-Options` 는 동일 출처까지 막는다. 수집 프레임을 띄우려면 그 헤더를
 * 걷어내야 한다.
 *
 * 다만 이 규칙이 브라우저 전체에 걸리면 임의의 사이트가 x.com 을 프레임에 실을
 * 수 있게 되어, 로그인한 사용자가 클릭재킹에 노출된다. 그래서 정적 규칙 파일을
 * 두지 않고 **덱이 뜬 탭에만** 거는 세션 규칙으로 만든다 — `tabIds` 조건은
 * 세션 규칙에서만 쓸 수 있다.
 *
 * 프레임을 만든 문서의 출처(`initiatorDomains`) 로 좁히는 방법은 통하지 않는다.
 * 콘텐츠 스크립트가 붙인 iframe 은 x.com 이 만든 요청으로 잡히지 않아 규칙이
 * 통째로 비껴간다 (규칙셋은 살아 있는데 매칭 0건).
 */
const XFO_RULE_ID = 1
const CSP_RULE_ID = 2
const RULE_IDS = [XFO_RULE_ID, CSP_RULE_ID]

function scopedRules(tabIds: number[]): chrome.declarativeNetRequest.Rule[] {
  // 대상 탭이 없으면 규칙 자체를 두지 않는다. 빈 `tabIds` 는 조건으로 성립하지 않는다.
  if (tabIds.length === 0) return []

  return [
    {
      id: XFO_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [
          {
            header: 'x-frame-options',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        requestDomains: ['x.com'],
        tabIds,
        // 프레임 요청이 어느 종류로 잡히든 놓치지 않게 넓게 둔다. 탭 안으로 이미
        // 좁혀 두었으므로 종류를 더 조여서 얻을 것이 없다.
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'xmlhttprequest',
          'other',
        ] as chrome.declarativeNetRequest.ResourceType[],
      },
    },
    {
      id: CSP_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [
          {
            header: 'content-security-policy',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
          {
            header: 'content-security-policy-report-only',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        requestDomains: ['x.com'],
        tabIds,
        resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType],
      },
    },
  ]
}

/**
 * 지금 규칙이 걸려 있는 탭들.
 *
 * 워커는 언제든 잠들었다 깨어나므로 목록을 메모리에 들고 있을 수 없다. 세션
 * 규칙은 브라우저 세션 동안 남아 있으니 규칙 자신에게 물어보는 것이 확실하다.
 */
async function scopedTabIds(): Promise<number[]> {
  const rules = await chrome.declarativeNetRequest.getSessionRules()
  return rules.find((rule) => rule.id === XFO_RULE_ID)?.condition.tabIds ?? []
}

async function applyScope(tabIds: number[]): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: RULE_IDS,
    addRules: scopedRules(tabIds),
  })
}

/** 이 탭에서 수집 프레임이 뜰 수 있게 한다. 이미 걸려 있으면 그대로 둔다. */
async function scopeTab(tabId: number): Promise<void> {
  const tabIds = await scopedTabIds()
  if (tabIds.includes(tabId)) return
  await applyScope([...tabIds, tabId])
}

/** 탭이 닫히면 그 탭 몫의 예외도 함께 걷는다. */
async function unscopeTab(tabId: number): Promise<void> {
  const tabIds = await scopedTabIds()
  if (!tabIds.includes(tabId)) return
  await applyScope(tabIds.filter((id) => id !== tabId))
}

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
  if (created.id !== undefined) {
    await chrome.storage.session.set({ [TAB_KEY]: created.id })
    // 문서가 뜨기 전에 걸어둔다. 덱도 마운트하며 다시 청하지만, 규칙이 먼저
    // 서 있으면 첫 프레임부터 통과한다.
    await scopeTab(created.id)
  }
}

/**
 * 규칙이 실제로 살아서 요청에 걸리고 있는지 확인해준다.
 *
 * 프레임이 막혔을 때 규칙이 안 걸린 것인지, 걸렸는데 조건이 안 맞아 비껴간
 * 것인지는 밖에서 구별할 방법이 없다. 이 API 는 배경 워커에서만 부를 수 있어
 * 덱이 물어보면 대신 조회해준다.
 */
async function ruleReport(tabId?: number): Promise<string> {
  const parts: string[] = []
  try {
    const tabIds = await scopedTabIds()
    parts.push(`규칙 적용 탭 [${tabIds.join(', ') || '없음'}]${tabId === undefined ? '' : ` · 여기 ${tabId}`}`)
  } catch {
    parts.push('세션 규칙 조회 실패')
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type

  if (type === RULE_REPORT) {
    void ruleReport(sender.tab?.id).then(sendResponse)
    // 비동기로 답하겠다는 신호.
    return true
  }

  if (type === RULE_SCOPE) {
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse(false)
      return true
    }
    void scopeTab(tabId).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true
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
  void unscopeTab(tabId)
  void rememberedTabId().then((id) => {
    if (id === tabId) void chrome.storage.session.remove(TAB_KEY)
  })
})
