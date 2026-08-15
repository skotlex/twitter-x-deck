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
import { OCR_RUN, type OcrResult } from '@core/messages'
import { translateText, type Translation } from './translate'

/**
 * 읽을 언어.
 *
 * 언어를 많이 얹을수록 느려지고 틀리기도 쉬워서, 덱에서 자주 마주치는 글자만 고른다.
 * 한글은 넣지 않는다 — 읽는 언어가 한국어면 번역할 일이 없다.
 */
const OCR_LANGS = 'jpn+eng'

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
export async function readImageText(imageUrl: string, target: string): Promise<ImageText> {
  const dataUrl = await toDataUrl(imageUrl)

  const result = (await chrome.runtime.sendMessage({
    type: OCR_RUN,
    dataUrl,
    langs: OCR_LANGS,
  })) as OcrResult | undefined

  if (!result) throw new ImageTextError('글자 인식을 시작하지 못했습니다')
  if (!result.ok) throw new ImageTextError(result.reason)

  const translation = await translateText(result.lines.join('\n'), 'auto', target)
  return { lines: result.lines, translation }
}
