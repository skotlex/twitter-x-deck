/**
 * 사진 속 글자를 읽어 번역한다.
 *
 * 번역된 **사진** 을 만들지는 않는다. 글자를 뽑아 옮긴 글만 보여준다 — 원문 글자를
 * 깨끗이 지우고 그 자리에 다시 조판하는 일은 우리가 흉내 낼 수 있는 수준이 아니라,
 * 어설프게 덮어 그리면 결과가 더 지저분해진다.
 *
 * 글자 인식은 이 브라우저 안에서 끝난다. 남의 서비스에 사진을 보내지 않으므로 횟수
 * 제한도 로그인도 없다. 뽑아낸 글의 번역만 평소 쓰던 길(`translate.ts`)로 보낸다.
 */
import {
  OCR_DONE,
  OCR_PROGRESS,
  OCR_RUN,
  type OcrDone,
  type OcrProgress,
  type OcrResult,
} from '@core/messages'
import { translateText, type Translation } from './translate'

/**
 * 읽을 언어.
 *
 * 세로쓰기(jpn_vert)를 함께 넣는다. 일본 쪽 포스터·만화는 세로로 쓰는 것이 흔한데,
 * 가로 판으로 그걸 읽으면 글자가 아니라 부스러기가 나온다.
 *
 * 한글은 넣지 않는다 — 읽는 언어가 한국어면 번역할 일이 없다.
 */
const OCR_LANGS = 'jpn+jpn_vert+eng'

/** 결과를 기다리는 한계. 처음 한 번은 글자 데이터까지 받아야 해서 넉넉히 준다. */
const OCR_TIMEOUT_MS = 4 * 60_000

export interface ImageText {
  /** 사진에서 읽어낸 원문. 줄 단위로 끊어 온다. */
  lines: string[]
  translation: Translation
}

export class ImageTextError extends Error {}

/** 사진을 바이트로 읽어 data URL 로 바꾼다. 확장 메시지는 Blob 을 실어 나르지 못한다. */
async function toDataUrl(imageUrl: string): Promise<string> {
  // 사진 서버가 x.com 오리진에 CORS 를 열어두어 이 문서에서 그대로 받아올 수 있다.
  const response = await fetch(imageUrl).catch(() => null)
  if (!response?.ok) throw new ImageTextError('사진을 받지 못했습니다')

  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageTextError('사진을 읽지 못했습니다'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 사진 한 장에서 글자를 읽어 번역까지 마친다.
 *
 * 번역은 줄마다 따로 청하지 않고 한 번에 보낸다 — 줄마다 부르면 그 수만큼 번역
 * 프레임이 뜨고, 앞뒤 문맥이 끊겨 번역도 나빠진다.
 */
export async function readImageText(
  imageUrl: string,
  target: string,
  onProgress?: (note: string) => void,
): Promise<ImageText> {
  const dataUrl = await toDataUrl(imageUrl)
  const waiting = waitForResult(onProgress)

  void chrome.runtime.sendMessage({ type: OCR_RUN, dataUrl, langs: OCR_LANGS }).catch(() => {
    // 시작 요청 자체가 실패해도 아래 기다림이 시간으로 끊어준다.
  })

  const result = await waiting
  if (!result.ok) throw new ImageTextError(result.reason)

  const translation = await translateText(result.lines.join('\n'), 'auto', target)
  return { lines: result.lines, translation }
}

/**
 * 결과가 올 때까지 기다린다. 오는 길에 진행 상황도 함께 듣는다.
 *
 * 결과를 **요청의 응답으로 받지 않는다.** 처음 한 번은 글자 데이터를 받느라 몇 분이
 * 걸리는데, 그동안 배경 워커가 잠들면 그 통로가 끊긴다 — 'message channel closed
 * before a response was received' 가 그 소리다. 결과는 따로 오는 메시지로 받는다.
 *
 * 그래도 끝내 아무 것도 안 오는 경우가 있으므로 시간으로 끊는다. 무한정 '읽는 중' 으로
 * 두면 사용자는 멈춘 것인지 도는 것인지 알 길이 없다.
 */
function waitForResult(onProgress?: (note: string) => void): Promise<OcrResult> {
  return new Promise<OcrResult>((resolve) => {
    const timer = window.setTimeout(() => {
      finish({ ok: false, reason: '글자 인식이 끝나지 않았습니다' })
    }, OCR_TIMEOUT_MS)

    const listen = (message: unknown): void => {
      const type = (message as { type?: string } | null)?.type
      if (type === OCR_PROGRESS) {
        onProgress?.((message as OcrProgress).note)
        return
      }
      if (type === OCR_DONE) finish((message as OcrDone).result)
    }

    function finish(result: OcrResult): void {
      window.clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(listen)
      resolve(result)
    }

    chrome.runtime.onMessage.addListener(listen)
  })
}
