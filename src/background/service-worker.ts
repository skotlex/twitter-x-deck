/**
 * 백그라운드 서비스 워커.
 *
 * 덱은 x.com 탭 위에 얹히므로, 여기서 할 일은 그 탭을 열고 다시 찾아주는 것뿐이다.
 * 수집 메시지는 같은 문서·같은 오리진 안에서만 오가므로 중계할 것이 없다.
 */
import {
  DECK_PARAM,
  IMAGE_TRANSLATE,
  IMAGE_TRANSLATE_ASK,
  IMAGE_TRANSLATE_DONE,
  LOGIN_REQUIRED,
  PAPAGO_ORIGIN,
  PAPAGO_PARAM,
  ROLE_PARAM,
  RULE_REPORT,
  type ImageTranslateRequest,
  type ImageTranslateResult,
} from '@core/messages'

/** 최상위 탭이 맡는 컬럼. 나머지는 그 탭 안의 숨은 프레임이 맡는다. */
const DECK_URL = `https://x.com/home?${ROLE_PARAM}=foryou&${DECK_PARAM}=1`

const TAB_KEY = 'deckTabId'
/** 사진 한 장을 번역하는 데 줄 수 있는 시간. 탭이 뜨고 OCR 까지 도는 시간이다. */
const IMAGE_JOB_TIMEOUT_MS = 45_000

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
 * 사진 번역 중개.
 *
 * 덱과 Papago 탭은 서로 다른 사이트라 직접 말을 주고받을 수 없다. 여기서 잇는다 —
 * 탭을 **배경으로** 열어 일을 시키고, 결과만 덱에 돌려준 뒤 탭을 닫는다.
 * 사용자 눈에는 라이트박스에 번역된 사진이 뜨는 것으로만 보인다.
 *
 * 탭을 쓰는 이유는 하나뿐이다 — 네이버 로그인 쿠키는 Papago 가 최상위인 문서에만
 * 실린다. 로그인이 안 돼 있으면 그 탭을 **앞으로 꺼내** 사용자가 그 자리에서
 * 로그인하게 한다. 한 번 해두면 그 뒤로는 배경에서 조용히 끝난다.
 */
interface ImageJob {
  dataUrl: string
  tabId: number | null
  settle: (result: ImageTranslateResult) => void
}

const imageJobs = new Map<string, ImageJob>()

/**
 * 이 일에 쓴 탭을 정리한다.
 *
 * 성공했으면 조용히 닫는다. 결과를 못 꺼냈을 때만 **닫지 않고 앞으로 꺼낸다** —
 * 그 탭에는 이미 번역된 사진이 떠 있어서, 옮기지 못했다고 해둔 일까지 버릴 이유가 없다.
 *
 * 로그인이 필요한 경우는 예외다. 그때는 조용히 닫는다 — 사용자는 사진을 보려던
 * 참이었는데 몇 초 뒤 난데없이 다른 탭으로 끌려가면 그게 더 나쁘다. 로그인할지는
 * 덱에서 안내를 보고 사용자가 정한다.
 */
async function settleJobTab(job: ImageJob, result: ImageTranslateResult): Promise<void> {
  if (job.tabId === null) return
  const keep = !result.ok && !result.needsLogin
  if (keep) {
    await chrome.tabs.update(job.tabId, { active: true }).catch(() => null)
    return
  }
  await chrome.tabs.remove(job.tabId).catch(() => null)
}

/**
 * 로그인이 필요하다는 사실을 잠깐 기억해둔다.
 *
 * 로그인 여부는 탭을 열어 사진까지 넣어봐야 알 수 있어 10초쯤 걸린다. 한 번 겪고 나면
 * 그 뒤로는 탭을 열지 않고 곧바로 안내한다 — 사진마다 10초씩 기다릴 이유가 없다.
 *
 * 오래 붙들지는 않는다. 사용자가 그 사이 로그인했을 수 있으므로, 시간이 지나면
 * 잊고 다시 제대로 해본다.
 */
const LOGIN_MEMO_KEY = 'papagoLoginNeededAt'
const LOGIN_MEMO_MS = 5 * 60_000

async function loginKnownMissing(): Promise<boolean> {
  const stored = await chrome.storage.session.get(LOGIN_MEMO_KEY)
  const at = stored[LOGIN_MEMO_KEY]
  return typeof at === 'number' && Date.now() - at < LOGIN_MEMO_MS
}

async function rememberLogin(needed: boolean): Promise<void> {
  if (needed) await chrome.storage.session.set({ [LOGIN_MEMO_KEY]: Date.now() })
  else await chrome.storage.session.remove(LOGIN_MEMO_KEY)
}

async function translateImage(request: ImageTranslateRequest): Promise<ImageTranslateResult> {
  // 방금 로그인이 필요하다고 확인했으면 탭을 여는 수고를 하지 않는다.
  if (!request.force && (await loginKnownMissing())) {
    return { ok: false, reason: LOGIN_REQUIRED, needsLogin: true }
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const url =
    `${PAPAGO_ORIGIN}/image?${PAPAGO_PARAM}=${id}` +
    `&tk=${encodeURIComponent(request.target)}`

  return await new Promise<ImageTranslateResult>((resolve) => {
    const job: ImageJob = { dataUrl: request.dataUrl, tabId: null, settle: finish }
    imageJobs.set(id, job)

    function finish(result: ImageTranslateResult): void {
      if (!imageJobs.delete(id)) return
      // 서비스 워커에는 window 가 없다. 전역 함수를 그대로 쓴다.
      clearTimeout(timer)
      void settleJobTab(job, result)
      // 성공했다면 로그인은 멀쩡한 것이다. 기억해둔 것을 그때 지운다.
      if (result.ok || result.needsLogin) void rememberLogin(!result.ok)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'Papago 가 응답하지 않았습니다', needsLogin: false })
    }, IMAGE_JOB_TIMEOUT_MS)

    void chrome.tabs
      .create({ url, active: false })
      .then((tab) => {
        job.tabId = tab.id ?? null
      })
      .catch(() => {
        finish({ ok: false, reason: '번역 탭을 열지 못했습니다', needsLogin: false })
      })
  })
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type

  if (type === RULE_REPORT) {
    void ruleReport(sender.tab?.id).then(sendResponse)
    // 비동기로 답하겠다는 신호.
    return true
  }

  if (type === IMAGE_TRANSLATE) {
    void translateImage(message as ImageTranslateRequest).then(sendResponse)
    return true
  }

  // Papago 탭이 번역할 사진을 달라고 한다.
  if (type === IMAGE_TRANSLATE_ASK) {
    const job = imageJobs.get((message as { id: string }).id)
    sendResponse(job ? { dataUrl: job.dataUrl } : null)
    return false
  }

  // Papago 탭이 결과나 실패 사유를 들고 왔다.
  if (type === IMAGE_TRANSLATE_DONE) {
    const done = message as { id: string; dataUrl?: string; reason?: string }
    const job = imageJobs.get(done.id)
    if (job) {
      job.settle(
        done.dataUrl
          ? { ok: true, dataUrl: done.dataUrl }
          : {
              ok: false,
              reason: done.reason ?? '번역 결과를 가져오지 못했습니다',
              needsLogin: done.reason === LOGIN_REQUIRED,
            },
      )
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
