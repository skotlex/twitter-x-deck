/**
 * 사진 속 글자를 Papago 이미지 번역으로 읽어 **결과 사진만** 가져온다.
 *
 * 글 번역과 달리 보이지 않는 프레임을 쓸 수 없다. 이미지 번역은 네이버 로그인이 있어야
 * 하는데, 로그인 쿠키가 `SameSite=Lax` 라 x.com 이 최상위인 프레임에는 실리지 않는다.
 * Papago 가 **최상위인 탭** 이어야 평소 쓰던 세션이 실린다.
 *
 * 그래서 배경 워커가 탭을 **화면 뒤로** 열어 일을 시키고, 우리는 결과 사진만 받는다.
 * 사용자 눈에는 라이트박스의 사진이 번역본으로 바뀌는 것으로만 보인다. 로그인이 안
 * 돼 있을 때만 그 탭이 앞으로 나와, 한 번 로그인해두면 그 뒤로는 조용히 끝난다.
 */
import {
  IMAGE_TRANSLATE,
  PAPAGO_LOGIN_PARAM,
  PAPAGO_ORIGIN,
  type ImageTranslateResult,
} from '@core/messages'

export class ImageTranslateError extends Error {
  /** 네이버 로그인이 없어 멈춘 것인지. 안내 문구가 달라진다. */
  readonly needsLogin: boolean

  constructor(message: string, needsLogin = false) {
    super(message)
    this.needsLogin = needsLogin
  }
}

/** 사진을 바이트로 읽어 data URL 로 바꾼다. 확장 메시지는 Blob 을 실어 나르지 못한다. */
async function toDataUrl(imageUrl: string): Promise<string> {
  // 사진 서버가 x.com 오리진에 CORS 를 열어두어 이 문서에서 그대로 받아올 수 있다.
  // 그래도 실패하면 어느 걸음에서 막혔는지 함께 적는다 — 'Failed to fetch' 만으로는
  // 사진을 못 받은 것인지 번역 탭이 막힌 것인지 밖에서 구별할 수 없다.
  let response: Response
  try {
    response = await fetch(imageUrl)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '알 수 없는 이유'
    throw new ImageTranslateError(`사진을 받지 못했습니다 (${detail})`)
  }
  if (!response.ok) throw new ImageTranslateError(`사진을 받지 못했습니다 (${response.status})`)

  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageTranslateError('사진을 읽지 못했습니다'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 네이버 로그인 화면. 로그인을 마치면 사진 번역 화면으로 돌아온다.
 *
 * Papago 화면으로 보내면 사용자가 거기서 로그인 버튼을 한 번 더 찾아야 한다.
 * 필요한 것이 로그인이면 로그인 화면으로 바로 데려가는 편이 낫다.
 */
export const PAPAGO_LOGIN_URL = `https://nid.naver.com/nidlogin.login?url=${encodeURIComponent(
  `${PAPAGO_ORIGIN}/image?${PAPAGO_LOGIN_PARAM}=1`,
)}`

/**
 * 사진 한 장을 번역해 그 결과 사진(data URL)을 돌려준다.
 * 주소는 원본 크기로 넘겨야 글자가 또렷해 잘 읽힌다.
 *
 * `force` 는 사용자가 방금 로그인했다고 알려줄 때만 쓴다 — 기억해둔 '로그인 필요' 를
 * 무시하고 실제로 다시 해본다.
 */
export async function translateImage(
  imageUrl: string,
  target: string,
  options?: { force?: boolean; width?: number; height?: number },
): Promise<string> {
  const dataUrl = await toDataUrl(imageUrl)

  const result = (await chrome.runtime.sendMessage({
    type: IMAGE_TRANSLATE,
    dataUrl,
    target,
    // 원본 크기를 함께 보낸다. 번역 탭은 이걸 잣대로 번역본과 남의 그림을 가른다.
    width: options?.width ?? 0,
    height: options?.height ?? 0,
    force: options?.force ?? false,
  })) as ImageTranslateResult | undefined

  if (!result) throw new ImageTranslateError('번역을 시작하지 못했습니다')
  if (!result.ok) throw new ImageTranslateError(result.reason, result.needsLogin)
  return result.dataUrl
}
