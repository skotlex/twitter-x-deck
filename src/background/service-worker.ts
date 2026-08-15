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
  PAPAGO_LOGIN_DONE,
  PAPAGO_ORIGIN,
  PAPAGO_PARAM,
  RESULT_MISSING,
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
 * 덱과 Papago 문서는 서로 다른 사이트라 직접 말을 주고받을 수 없다. 여기서 잇는다 —
 * 탭을 배경으로 열어 일을 시키고, 결과만 덱에 돌려준 뒤 그 탭을 닫는다.
 * 사용자 눈에는 라이트박스에 번역된 사진이 뜨는 것으로만 보인다.
 *
 * 탭을 쓰는 이유는 하나뿐이다 — 네이버 로그인 쿠키는 Papago 가 최상위인 문서에만
 * 실린다. 로그인이 안 돼 있으면 그 탭도 조용히 닫고 덱에서 안내한다. 한 번 로그인해
 * 두면 그 뒤로는 사용자가 아무 것도 안 해도 배경에서 끝난다.
 */
interface ImageJob {
  dataUrl: string
  /** 원본 크기. 번역 탭이 결과를 가려낼 때 잣대로 쓴다. */
  width: number
  height: number
  tabId: number | null
  settle: (result: ImageTranslateResult) => void
}

const imageJobs = new Map<string, ImageJob>()

/**
 * 이 일에 쓴 탭을 **어떤 경우에도 닫는다.**
 *
 * 실패했을 때 '결과가 저기 떠 있을지 모른다' 며 남겨둔 적이 있는데, 그러면 실패할
 * 때마다 탭이 하나씩 쌓인다. 사용자는 사진을 보려 했을 뿐이지 탭을 치우려던 게 아니다.
 * 실패는 덱에서 알리고 다시 시도하게 하는 편이 낫다.
 */
async function settleJobTab(job: ImageJob): Promise<void> {
  if (job.tabId === null) return
  await chrome.tabs.remove(job.tabId).catch(() => null)
}

/**
 * 번역할 문서를 띄운다. 포커스는 가져가지 않는다.
 *
 * 최소화한 별도 창으로 띄워봤지만 더 나빴다 — 크롬이 만들 때의 `minimized` 를 그대로
 * 지키지 않아 제 크기로 한 번 떴다가 뒤로 밀리는 모양이 됐다. 배경 탭이 낫다.
 *
 * 아주 안 보이게 할 수는 없다. 네이버 로그인 쿠키는 Papago 가 최상위인 문서에만
 * 실리고, 크롬이 주는 최상위 문서는 탭과 창뿐이다.
 */
async function openJobDocument(job: ImageJob, url: string): Promise<void> {
  const tab = await chrome.tabs.create({ url, active: false })
  job.tabId = tab.id ?? null
}

/**
 * 네이버에 로그인돼 있는지 **쿠키로** 확인한다.
 *
 * 화면을 뒤져 알아내려 했지만 번번이 틀렸다. 로그인 안내가 안 뜨는 판도 있고, 로그인
 * 상태의 사용자 메뉴가 숨은 채로 문서에 늘 들어 있기도 해서, 무엇을 근거로 삼든
 * 로그인 여부와 어긋났다. 세션 쿠키가 있는지가 그 답 자체다.
 *
 * 탭을 열기 **전에** 확인하므로 로그아웃 상태에서는 기다림도 탭도 없다.
 * 쿠키를 못 읽는 환경이면 막지 않고 그냥 해본다 — 확인 수단이 없다고 기능을 닫을
 * 이유는 없다.
 */
const NAVER_SESSION_COOKIES = ['NID_SES', 'NID_AUT']

async function hasNaverSession(): Promise<boolean> {
  try {
    for (const name of NAVER_SESSION_COOKIES) {
      const cookie = await chrome.cookies.get({ url: PAPAGO_ORIGIN, name })
      if (cookie?.value) return true
    }
    return false
  } catch {
    return true
  }
}

/**
 * Papago 이미지 번역 API 를 직접 부른다. 되면 탭이 아예 필요 없다.
 *
 * 유료 API 가 아니라 **Papago 웹 화면이 스스로 부르는 그 요청** 이다. 그쪽 번들에서
 * 확인한 모양 그대로 보낸다 — `POST /api/image/translation` 에 사진 하나를 담은
 * multipart, 나머지는 쿼리 파라미터. 서명도 API 키도 붙지 않고 쿠키로만 인증한다.
 *
 * 배경 워커의 요청에는 호스트 권한이 있으면 네이버 세션 쿠키가 실린다. 탭이 필요했던
 * 이유가 그 쿠키 하나였으므로, 이 길이 통하면 화면에 아무 것도 안 뜬다.
 *
 * 다만 남의 내부 API 다. 모양이 바뀌면 조용히 깨지므로, 실패하면 지금까지 쓰던
 * 탭 방식으로 물러선다.
 */
async function translateImageByApi(request: ImageTranslateRequest): Promise<string | null> {
  try {
    const body = new FormData()
    body.append('image', dataUrlToBlob(request.dataUrl), 'image.jpg')

    // 출발 언어를 모를 때 그쪽 화면이 보내는 값을 그대로 흉내낸다 —
    // source 자리에 target 을 넣고 langDetect 를 켠다.
    const params = new URLSearchParams({
      source: request.target,
      target: request.target,
      langDetect: 'true',
      rotation: '0',
      useGlossary: 'false',
      requestId: crypto.randomUUID(),
    })

    const response = await fetch(`${PAPAGO_ORIGIN}/api/image/translation?${params.toString()}`, {
      method: 'POST',
      body,
      credentials: 'include',
    })
    if (!response.ok) return null

    const payload = (await response.json()) as ImageTranslateResponse
    if (!payload?.imageId) return null

    /*
     * 번역된 사진은 따로 받아온다. 주소 조립식은 그쪽 번들에서 확인했다.
     *
     *   `${DOWNLOAD}?imageId=${id}&imageType=rendered&source=${source}&target=${target}`
     *
     * `imageType` 이 빠지면 400 이 돌아온다 — 원본(origin)·번역본(rendered) 중 어느
     * 것을 달라는 것인지가 이 값이다. 출발 언어는 그쪽이 알아낸 것을 그대로 돌려준다.
     */
    const source = payload.detectedLang ?? request.target
    const download = new URLSearchParams({
      imageId: payload.imageId,
      imageType: 'rendered',
      source,
      target: request.target,
    })

    const image = await fetch(
      `${PAPAGO_ORIGIN}/api/image/downloadImage?${download.toString()}`,
      { credentials: 'include' },
    )
    if (!image.ok) return null

    const blob = await image.blob()
    // 그림이 아니면 오류 문서다. 그것을 사진이라고 덱에 올려보내지 않는다.
    if (!blob.type.startsWith('image/')) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

/** 이미지 번역 응답에서 우리가 쓰는 부분. 글월 목록도 함께 오지만 지금은 안 쓴다. */
interface ImageTranslateResponse {
  imageId?: string
  detectedLang?: string
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: /:(.*?);/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/jpeg' })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of buffer) binary += String.fromCharCode(byte)
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

async function translateImage(request: ImageTranslateRequest): Promise<ImageTranslateResult> {
  if (!(await hasNaverSession())) {
    return { ok: false, reason: LOGIN_REQUIRED, needsLogin: true }
  }

  // 탭 없이 되는 길을 먼저 본다. 안 되면 아래의 탭 방식으로 물러선다.
  const direct = await translateImageByApi(request)
  if (direct) return { ok: true, dataUrl: direct }

  /*
   * 탭 방식은 첫 판이 헛도는 일이 있다. 로그인은 멀쩡한데(위에서 쿠키로 확인했다)
   * 처음 띄운 Papago 화면이 아직 자리를 못 잡아 결과가 안 나오고, 사용자가 '다시
   * 시도' 를 누르면 그때는 된다. 그 한 번을 사용자에게 시키지 않는다.
   */
  const first = await runImageJob(request)
  if (first.ok) return first
  return await runImageJob(request)
}

async function runImageJob(request: ImageTranslateRequest): Promise<ImageTranslateResult> {

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const url =
    `${PAPAGO_ORIGIN}/image?${PAPAGO_PARAM}=${id}` +
    `&tk=${encodeURIComponent(request.target)}`

  return await new Promise<ImageTranslateResult>((resolve) => {
    const job: ImageJob = {
      dataUrl: request.dataUrl,
      width: request.width,
      height: request.height,
      tabId: null,
      settle: finish,
    }
    imageJobs.set(id, job)

    function finish(result: ImageTranslateResult): void {
      if (!imageJobs.delete(id)) return
      // 서비스 워커에는 window 가 없다. 전역 함수를 그대로 쓴다.
      clearTimeout(timer)
      void settleJobTab(job)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'Papago 가 응답하지 않았습니다', needsLogin: false })
    }, IMAGE_JOB_TIMEOUT_MS)

    void openJobDocument(job, url).catch(() => {
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

  /*
   * 로그인을 마치고 돌아온 탭. 할 일이 끝났으니 닫아준다 — 로그인하려던 사람에게
   * 난데없이 Papago 화면이 남는 것은 뒤끝이 좋지 않다.
   */
  if (type === PAPAGO_LOGIN_DONE) {
    if (sender.tab?.id !== undefined) void chrome.tabs.remove(sender.tab.id).catch(() => null)
    sendResponse(null)
    return false
  }

  if (type === IMAGE_TRANSLATE) {
    void translateImage(message as ImageTranslateRequest).then(sendResponse)
    return true
  }

  // Papago 탭이 번역할 사진을 달라고 한다.
  if (type === IMAGE_TRANSLATE_ASK) {
    const job = imageJobs.get((message as { id: string }).id)
    sendResponse(job ? { dataUrl: job.dataUrl, width: job.width, height: job.height } : null)
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
              reason: done.reason ?? RESULT_MISSING,
              // 결과가 안 나온 것도 로그인이 풀린 탓일 수 있다. 그때도 로그인 길을 낸다.
              needsLogin: done.reason === LOGIN_REQUIRED || done.reason === RESULT_MISSING,
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
