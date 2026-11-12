/**
 * Papago 에 부탁하는 주소의 규칙.
 *
 * 부탁하는 쪽(`translate.ts`, x.com 문서)과 받아서 어긋남을 고치는 쪽(`papago.ts`,
 * Papago 문서)이 같은 이름을 봐야 해서 한곳에 둔다.
 *
 * Papago 는 주소 형식을 `sk`·`tk`·`st` 에서 `sl`·`tl`·`text` 로 바꿨다. 옛 이름으로
 * 보내면 글월은 옮겨 받으면서 도착 언어는 버리고 제 기본값(영어)을 쓴다.
 * 출발 언어는 x.com 이 붙인 언어를 적고, 모를 때만 `auto` 로 둔다 (`papagoUrl` 참고).
 */
import { PAPAGO_ORIGIN, PAPAGO_PARAM } from '@core/messages'

/**
 * 주소에 글월을 실을 수 있는 길이의 한계.
 *
 * 넘으면 프레임 안에서 직접 입력란에 넣는다 — 그쪽이 덜 튼튼하므로 되도록 주소로 보낸다.
 */
export const URL_TEXT_LIMIT = 6_000

/**
 * 번역 프레임에 띄울 주소. `id` 는 프레임 안 스크립트가 자기 일인지 알아보는 표시다.
 *
 * 출발 언어를 알면 적는다. `auto` 로 보내면 Papago 가 도착 언어를 영어로 다시 쓰는데,
 * 원문이 영어면 영어 → 영어가 되어 원문이 그대로 돌아온다. 출발 언어가 적혀 있으면
 * Papago 는 `tl` 을 따른다.
 */
export function papagoUrl(text: string, target: string, id: string, source = 'auto'): string {
  const params = new URLSearchParams({ sl: source, tl: target, [PAPAGO_PARAM]: id })
  if (encodeURIComponent(text).length <= URL_TEXT_LIMIT) params.set('text', text)
  return `${PAPAGO_ORIGIN}/?${params.toString()}`
}

/**
 * Papago 가 주소를 제 상태로 다시 쓰면서 도착 언어를 바꿔놓았으면, 다시 띄울 쿼리를 준다.
 * 맞게 앉아 있거나 판단할 근거가 없으면 null.
 *
 * Papago 는 출발 언어가 `auto` 면 `tl` 을 버리고 기본값(영어)으로 다시 쓰지만, 출발 언어가
 * 적혀 있으면 `tl` 을 따른다. 그래서 다시 띄울 때는 `auto` 로 돌리지 않고 Papago 가
 * 감지해 적어 둔 출발 언어를 그대로 쓴다. 감지한 언어가 도착 언어와 같으면 옮길 것이
 * 없는 글이라 그대로 둔다.
 *
 * 옛 이름(`sk`·`tk`)으로 다시 쓰는 판도 함께 알아본다. 고칠 때는 지금 이름으로만 싣는다.
 * 우리 표시는 그 재작성에 지워지므로 직접 다시 넣는다.
 */
export function retargetSearch(search: string, target: string, id: string): string | null {
  const params = new URLSearchParams(search)
  const now = params.get('tl') ?? params.get('tk')
  if (!now || now === target || target.length === 0) return null

  const detected = params.get('sl') ?? params.get('sk') ?? 'auto'
  if (detected === target) return null

  params.delete('sk')
  params.delete('tk')
  params.set('sl', detected)
  params.set('tl', target)
  params.set(PAPAGO_PARAM, id)
  return `?${params.toString()}`
}
