/**
 * 사진에서 글자를 읽어낸다 (OCR).
 *
 * 왜 여기서 도는가 —
 * x.com 페이지 안에서는 워커를 띄울 수 없다. 그 페이지의 CSP 가 막고, 콘텐츠 스크립트가
 * 만든 워커도 그 제약을 그대로 받는다. 확장 문서(오프스크린)에는 그 제약이 없다.
 *
 * 남의 서비스에 사진을 보내지 않는다. 인식은 이 브라우저 안에서 끝나므로 횟수 제한도
 * 로그인도 없다. 대신 만화 말풍선이나 손글씨처럼 꾸민 글자는 잘 못 읽는다 —
 * 그건 이 방식의 한계이지 고장이 아니다.
 */
import { createWorker, type Page, type Worker } from 'tesseract.js'
import { OCR_DONE, OCR_PROGRESS, OCR_RUN, type OcrRequest, type OcrResult } from '@core/messages'

/**
 * 워커를 한 번 만들어 두고 계속 쓴다.
 *
 * 만들 때마다 글자 데이터를 다시 읽어야 해서 첫 인식이 느리다. 한 번 만들어두면
 * 그 다음부터는 곧바로 시작한다.
 */
let ready: Promise<Worker> | null = null

function worker(langs: string, onProgress: (note: string) => void): Promise<Worker> {
  ready ??= createWorker(langs, 1, {
    // 워커와 코어는 확장 안의 파일로 준다. 확장 문서의 CSP 는 blob 워커를 막으므로
    // tesseract 가 기본으로 쓰는 blob 방식을 끄고 실제 파일 경로를 넘긴다.
    workerBlobURL: false,
    workerPath: chrome.runtime.getURL('vendor/tesseract-worker.js'),
    // 폴더가 아니라 **파일 하나** 를 짚는다. 폴더를 주면 tesseract 가 제 나름으로
    // 변종을 고르는데, 우리는 그중 한 벌만 담았으므로 다른 것을 고르면 못 찾는다.
    corePath: chrome.runtime.getURL('vendor/core/tesseract-core-simd-lstm.wasm.js'),
    /*
     * 글자 데이터를 받아올 곳을 못 박는다.
     *
     * 기본값으로 두면 없는 주소를 물고 늘어져 아무 말 없이 멈춘다(확인해보니 404).
     * 여기 적은 주소는 실제로 받아지는 것을 확인했다. `_fast` 판을 쓰는 이유는 크기다 —
     * 일본어가 1.5MB 로, 기본 판(16MB)보다 열 배 작다. 인식이 조금 무뎌지지만
     * 처음 한 번 몇 분씩 기다리는 것과는 비교가 안 된다.
     */
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
    // 글자 데이터는 처음 한 번만 내려받고 그 뒤로는 브라우저에 남는다.
    cacheMethod: 'refresh',
    logger: (log: { status?: string; progress?: number }) => {
      onProgress(describe(log))
    },
  })
  return ready
}

/**
 * 진행 상황을 사람이 읽을 한 줄로 옮긴다.
 *
 * 처음 한 번은 글자 데이터를 내려받느라 오래 걸린다. 그동안 '읽는 중' 만 떠 있으면
 * 멈춘 것과 구별되지 않는다 — 실제로 몇 분을 그렇게 기다리게 만든 적이 있다.
 */
function describe(log: { status?: string; progress?: number }): string {
  const status = log.status ?? ''
  const percent = typeof log.progress === 'number' ? Math.round(log.progress * 100) : null

  // 단계를 뭉뚱그리지 않는다. 어디서 멈췄는지가 곧 어디를 고쳐야 하는지다 —
  // '준비 중' 하나로 묶어두는 바람에 코어를 못 여는 것을 한참 못 알아봤다.
  const label = status.includes('loading language')
    ? '글자 데이터 받는 중'
    : status.includes('recognizing')
      ? '글자 읽는 중'
      : status.includes('core')
        ? '인식기 불러오는 중'
        : status.includes('initializ')
          ? '인식기 여는 중'
          : '준비 중'
  return percent === null ? label : `${label} ${percent}%`
}

/** 이 정도는 확신해야 글로 친다. 잘 읽은 줄은 대개 80 을 넘는다. */
const MIN_CONFIDENCE = 65
/** 뜻 있는 글자가 이만큼은 돼야 한다. 기호와 부스러기만 남은 줄을 걸러낸다. */
const MIN_MEANINGFUL = 0.6
/** 사람이 읽는 글자 — 한자·가나·한글·로마자·숫자. */
const MEANINGFUL_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9]/u

/**
 * 읽어낸 줄 중 **믿을 만한 것만** 남긴다.
 *
 * 인식기는 못 읽은 자리에서도 무언가를 내놓는다. 그림 무늬나 장식 글꼴을 글자로 잘못
 * 보고 기호를 늘어놓는데, 그걸 그대로 번역에 넘기면 뜻 없는 문장이 번역 결과랍시고
 * 화면에 뜬다. 실제로 그랬다 — 포스터 한 장이 알아볼 수 없는 글로 뒤덮였다.
 *
 * 그래서 두 가지를 함께 본다. 인식기가 스스로 매긴 확신, 그리고 그 줄에 사람이 읽는
 * 글자가 얼마나 들어 있는지. 둘 중 하나만 봐도 새는 것이 있다 — 확신은 높은데
 * 기호만 있는 줄, 글자는 많은데 확신이 바닥인 줄이 다 나온다.
 */
function usefulLines(page: Page): string[] {
  const lines = (page.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  )

  return lines
    .filter((line) => line.confidence >= MIN_CONFIDENCE)
    .map((line) => line.text.trim())
    .filter((text) => {
      if (text.length < 2) return false
      const meaningful = [...text].filter((char) => MEANINGFUL_RE.test(char)).length
      return meaningful / [...text].length >= MIN_MEANINGFUL
    })
}

async function run(request: OcrRequest): Promise<OcrResult> {
  const report = (note: string): void => {
    // 받는 이가 없어도 상관없다. 진행 상황일 뿐이라 놓쳐도 잃을 것이 없다.
    void chrome.runtime.sendMessage({ type: OCR_PROGRESS, tabId: request.tabId, note }).catch(
      () => undefined,
    )
  }

  try {
    const engine = await worker(request.langs, report)
    // 줄마다의 확신을 봐야 하므로 글자만이 아니라 구조까지 받는다.
    const { data } = await engine.recognize(request.dataUrl, {}, { blocks: true, text: true })

    const lines = usefulLines(data)
    if (lines.length === 0) {
      return { ok: false, reason: '사진에서 알아볼 만한 글자를 찾지 못했습니다' }
    }
    return { ok: true, lines }
  } catch (cause) {
    // 한 번 어긋난 워커는 계속 어긋난다. 다음 요청에서 새로 만들게 놓아준다.
    ready = null
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : '글자를 읽지 못했습니다',
    }
  }
}

/*
 * 배경 워커가 넘겨준 것만 받는다. 덱이 처음 보낸 것도 이 문서까지 닿는데, 그것까지
 * 집으면 같은 사진을 두 번 읽는다 — 배경 워커가 붙여주는 tabId 로 가른다.
 *
 * 결과는 응답이 아니라 따로 보낸다. 몇 분이 걸리는 일을 응답 채널에 매달아 두면
 * 그 사이 배경 워커가 잠들며 통로가 끊긴다.
 */
chrome.runtime.onMessage.addListener((message: unknown): undefined => {
  const request = message as OcrRequest
  if (request?.type !== OCR_RUN || request.tabId === undefined) return undefined

  void run(request).then((result) => {
    void chrome.runtime
      .sendMessage({ type: OCR_DONE, tabId: request.tabId, result })
      .catch(() => undefined)
  })
  return undefined
})
