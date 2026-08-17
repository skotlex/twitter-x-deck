/**
 * 아무도 보지 않는 x.com 을 **그리지 않게** 한다.
 *
 * 덱이 덮은 최상위 문서와 숨은 수집 프레임은 둘 다 사람 눈에 닿지 않는데, 브라우저는
 * 그걸 모르고 스타일 재계산부터 페인트 · 합성까지 전부 치른다.
 *
 * **왜 `visibility` 인가.**
 * `display:none` 과 `content-visibility:hidden` 은 레이아웃까지 건너뛴다. 그러면
 * `getBoundingClientRect()` 가 전부 0 이 되어 [selectors](./selectors.ts) 가 탭도
 * 알약도 못 찾는다 — 수집이 통째로 멎는다. `visibility:hidden` 은 자리는 그대로
 * 잡아둔 채 그리기만 건너뛰므로 선택자가 다치지 않는다. `document.hidden` 과도
 * 무관해서 x.com 의 폴링도 그대로 돈다. 클릭도 좌표를 짚지 않고 엘리먼트에 직접
 * 이벤트를 쏘므로(`simulateClick`) 영향받지 않는다.
 *
 * 인라인 style 로 걸면 x.com 이 자기 모달을 여닫으며 같은 속성을 다시 써서 풀어버린다.
 * 구성된 스타일시트에 `!important` 로 넣으면 페이지의 인라인 선언보다 우선하고,
 * style 요소가 아니라서 페이지 CSP 의 style-src 에도 걸리지 않는다.
 */

/** 최상위 문서용. 덱이 `<html>` 바로 아래 붙으므로 `body` 만 감추면 덱은 멀쩡하다. */
const HOST_CSS = 'html,body{overflow:hidden!important}body{visibility:hidden!important}'

/**
 * 수집 프레임용. 스크롤은 살려둔다 — 수집기가 타임라인을 내려 더 받아온다.
 */
const FRAME_CSS = 'body{visibility:hidden!important}'

function sheetFor(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  return sheet
}

function toggle(sheet: CSSStyleSheet, on: boolean): void {
  const current = document.adoptedStyleSheets
  const applied = current.includes(sheet)
  if (on === applied) return
  document.adoptedStyleSheets = on ? [...current, sheet] : current.filter((item) => item !== sheet)
}

/** 덱이 덮고 있는 동안만 아래 x.com 을 재운다. 통과 모드로 비켜서면 걷는다. */
export function createUnderlayMask(): (masked: boolean) => void {
  const sheet = sheetFor(HOST_CSS)

  return (masked) => {
    toggle(sheet, masked)
    // 구성된 스타일시트가 막힌 환경을 대비한 보조 장치. 이쪽만으로는 x.com 이
    // 덮어쓸 수 있어 믿지 않지만, 있으면 최초 화면에서 한 번은 확실히 듣는다.
    document.documentElement.style.overflow = masked ? 'hidden' : ''
    if (document.body) document.body.style.visibility = masked ? 'hidden' : ''
  }
}

/**
 * 수집 프레임은 걷을 일이 없으므로 한 번 걸고 만다.
 *
 * 여기를 안 감추면 `opacity:0` 으로 감춘 프레임의 x.com 이 통째로 그려진다.
 * `opacity:0` 은 투명하게 **그릴 뿐** 페인트도 합성도 건너뛰지 않는다. 수집 프레임
 * 셋이 매 프레임 합성 대상에 들어가면서, 아무것도 바뀌지 않은 화면에 대한 합성
 * 갱신 한 번이 4.75ms 까지 올라갔다 — 그 값이 그대로 코어를 태웠다.
 */
export function hideFrameUnderlay(): void {
  const sheet = sheetFor(FRAME_CSS)
  toggle(sheet, true)
  const apply = (): void => {
    if (document.body) document.body.style.visibility = 'hidden'
  }
  apply()
  // 프레임은 문서가 다 오기 전에 스크립트가 먼저 도는 자리다.
  if (!document.body) document.addEventListener('DOMContentLoaded', apply, { once: true })
}
