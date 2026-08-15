/**
 * 사진 속 글자를 Papago 이미지 번역으로 읽는다.
 *
 * 글 번역과 달리 **새 탭에서** 한다. 이미지 번역은 네이버 로그인이 있어야 쓸 수 있는데,
 * 로그인 쿠키가 `SameSite=Lax` 라 x.com 이 최상위인 프레임에는 실리지 않는다. 그래서
 * 프레임 안의 Papago 는 이미 로그인한 사람에게도 로그인하라고 한다. 새 탭은 Papago 가
 * 최상위이므로 평소 쓰던 그 세션이 그대로 실린다.
 *
 * 우리가 하는 일은 탭을 열고 사진을 건네는 것까지다. 번역 결과는 그 탭의 Papago 화면에
 * 그대로 뜬다 — 원문/번역 토글이나 확대도 Papago 것을 쓴다.
 */
import {
  CHANNEL,
  isPapagoMessage,
  PAPAGO_ORIGIN,
  PAPAGO_PARAM,
  type PapagoMessage,
} from '@core/messages'

/** 새 탭이 준비됐다고 알려오기를 기다리는 한계. */
const READY_TIMEOUT_MS = 20_000

export class ImageTranslateError extends Error {}

/**
 * 사진 한 장을 Papago 이미지 번역 탭으로 보낸다. 주소는 원본 크기로 넘겨야
 * 글자가 또렷해 잘 읽힌다.
 *
 * 탭은 **사용자가 누른 그 자리에서** 연다. 사진을 먼저 받아오면 그 사이에 사용자
 * 제스처가 풀려 브라우저가 팝업으로 보고 막는다.
 */
export async function openImageTranslation(imageUrl: string, target: string): Promise<void> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const url = `${PAPAGO_ORIGIN}/image?${PAPAGO_PARAM}=${id}&tk=${encodeURIComponent(target)}`

  // noopener 를 주면 안 된다 — 그 창이 우리를 못 찾아 준비됐다는 말을 전할 수 없다.
  const tab = window.open(url, `xdeck-image-${id}`)
  if (!tab) throw new ImageTranslateError('새 탭을 열지 못했습니다 — 팝업 차단을 확인해 주세요')

  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      finish()
      reject(new ImageTranslateError('Papago 탭이 응답하지 않았습니다'))
    }, READY_TIMEOUT_MS)

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== PAPAGO_ORIGIN || !isPapagoMessage(event.data)) return
      if (event.data.id !== id) return

      if (event.data.type === 'papago-ready') {
        finish()
        resolve()
      } else if (event.data.type === 'papago-failed') {
        const reason = event.data.reason
        finish()
        reject(new ImageTranslateError(reason))
      }
    }

    function finish(): void {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
  })

  await ready

  // 사진 서버가 x.com 오리진에 CORS 를 열어두어 이 문서에서 그대로 받아올 수 있다.
  // 파일 입력에는 주소를 넣을 수 없으므로 바이트가 필요하다.
  const response = await fetch(imageUrl)
  if (!response.ok) throw new ImageTranslateError(`사진을 받지 못했습니다 (${response.status})`)

  const message: PapagoMessage = {
    channel: CHANNEL,
    type: 'papago-image',
    id,
    blob: await response.blob(),
    name: 'image.jpg',
  }
  tab.postMessage(message, PAPAGO_ORIGIN)
}
