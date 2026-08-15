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
import { createWorker, type Worker } from 'tesseract.js'
import { OCR_RUN, type OcrRequest, type OcrResult } from '@core/messages'

/**
 * 워커를 한 번 만들어 두고 계속 쓴다.
 *
 * 만들 때마다 글자 데이터를 다시 읽어야 해서 첫 인식이 느리다. 한 번 만들어두면
 * 그 다음부터는 곧바로 시작한다.
 */
let ready: Promise<Worker> | null = null

function worker(langs: string): Promise<Worker> {
  ready ??= createWorker(langs, 1, {
    // 워커와 코어는 확장 안의 파일로 준다. 확장 문서의 CSP 는 blob 워커를 막으므로
    // tesseract 가 기본으로 쓰는 blob 방식을 끄고 실제 파일 경로를 넘긴다.
    workerBlobURL: false,
    workerPath: chrome.runtime.getURL('vendor/tesseract-worker.js'),
    // 폴더가 아니라 **파일 하나** 를 짚는다. 폴더를 주면 tesseract 가 제 나름으로
    // 변종을 고르는데, 우리는 그중 한 벌만 담았으므로 다른 것을 고르면 못 찾는다.
    corePath: chrome.runtime.getURL('vendor/core/tesseract-core-simd-lstm.wasm.js'),
    // 글자 데이터는 처음 한 번만 내려받고 그 뒤로는 브라우저에 남는다.
    cacheMethod: 'refresh',
  })
  return ready
}

/** 읽어낸 글에서 쓸모없는 조각을 걷어낸다. */
function cleanLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    // 한두 글자짜리는 대개 잡음이다. 뜻이 있는 줄만 남긴다.
    .filter((line) => line.length > 1)
}

async function run(request: OcrRequest): Promise<OcrResult> {
  try {
    const engine = await worker(request.langs)
    const { data } = await engine.recognize(request.dataUrl)
    const lines = cleanLines(data.text ?? '')
    if (lines.length === 0) return { ok: false, reason: '사진에서 글자를 찾지 못했습니다' }
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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: string } | null)?.type !== OCR_RUN) return undefined
  void run(message as OcrRequest).then(sendResponse)
  // 비동기로 답하겠다는 신호.
  return true
})
