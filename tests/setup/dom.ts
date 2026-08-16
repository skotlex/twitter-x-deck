/**
 * happy-dom 에는 레이아웃 엔진이 없어서 `getBoundingClientRect()` 가 항상 0 을 준다.
 *
 * 그대로 두면 [selectors.ts](../../src/content/selectors.ts) 의 `isVisible()` 이 모든
 * 요소를 '안 보임' 으로 판정해, 탭도 알약도 하나도 못 찾는 채로 테스트가 전부 통과해
 * 버린다 — 셀렉터가 깨져도 똑같이 통과하니 재는 의미가 없다.
 *
 * 그래서 사각형을 테스트가 정할 수 있게 바꿔 끼운다.
 *   - 기본값은 '보이는' 크기다 (100x40).
 *   - `data-test-hidden="true"` 를 주면 0 크기, 즉 안 보이는 요소가 된다.
 *   - `data-test-top="260"` 으로 세로 위치를 정한다. `findRefreshPill()` 이 상단
 *     220px 아래 버튼을 후보에서 빼므로, 그 경계를 재려면 이 값이 필요하다.
 */

const HIDDEN_ATTR = 'data-test-hidden'
const TOP_ATTR = 'data-test-top'

Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
  const hidden = this.getAttribute(HIDDEN_ATTR) === 'true'
  const top = Number(this.getAttribute(TOP_ATTR) ?? 0)
  const width = hidden ? 0 : 100
  const height = hidden ? 0 : 40

  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}
