/**
 * 컬럼이 사진에 내줄 수 있는 가로 폭을 카드까지 알리는 통로.
 *
 * 컬럼은 `flex-1` 이라 창 크기와 컬럼 수에 따라 폭이 크게 달라진다 — 최소값
 * (`MIN_COLUMN_WIDTH`) 만 있고 위쪽은 열려 있어서, 4 컬럼이면 400px 대, 2 컬럼에
 * 넓은 화면이면 1200px 을 넘기도 한다. 사진을 어느 크기로 받아야 하는지는 그
 * 실측값을 봐야 정할 수 있다.
 *
 * 카드는 컬럼 안쪽 깊은 곳에 있으므로 [columnActivity](./columnActivity.ts) 와 같은
 * 방식으로 context 로 내린다.
 */
import { createContext, useContext, useLayoutEffect, useState, type RefObject } from 'react'
import { MEDIA_STEPS } from './lib/format'

/**
 * 화면 배율의 상한.
 *
 * 목록의 사진은 스치듯 지나가는 것이라 배율을 곧이곧대로 따를 이유가 없다. 상한이
 * 없으면 넓은 컬럼 + 고DPI 화면에서 필요 픽셀이 2000 을 넘어 지금보다 큰 사진을
 * 받게 되는데, 그러면 메모리를 줄이려던 것이 정반대로 간다.
 */
const MAX_PIXEL_RATIO = 2

/**
 * 격자에서 칸 하나가 차지하는 몫. 사진이 여러 장이면 2열로 깔린다
 * ([MediaGrid](./components/MediaGrid.tsx) 의 `layoutClass`).
 */
export const GRID_SHARE = 0.5

/**
 * 다시 그릴 값어치가 있는 폭만 남긴다.
 *
 * 고를 수 있는 크기는 몇 단계뿐이라, 그 경계를 넘지 않는 한 폭이 몇 px 달라져도
 * 결과가 같다. 실측값을 그대로 흘리면 창을 끄는 동안 카드 수백 장이 계속 다시
 * 그려지므로, 경계까지 올려 붙여 값이 드물게만 바뀌게 한다.
 *
 * 경계는 단계마다 둘이다 — 사진 한 장은 컬럼 폭을 다 쓰고, 격자에 깔린 칸은 그
 * 절반만 쓴다. 올려 붙이는 쪽이라 실제보다 작게 잡는 일은 없다.
 */
const BOUNDARIES = MEDIA_STEPS.flatMap((step) => [step.width, step.width / GRID_SHARE]).sort(
  (a, b) => a - b,
)

/** 실측 CSS 폭을 '이 컬럼이 쓸 수 있는 기기 픽셀' 로 옮긴다. */
export function columnPixelsFrom(cssWidth: number): number {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const pixels = cssWidth * ratio
  return BOUNDARIES.find((edge) => pixels <= edge) ?? BOUNDARIES.at(-1) ?? 0
}

/**
 * 컬럼 폭. 아직 재기 전이면 0 이고, 그때는 받는 쪽이 가장 큰 크기로 물러선다 —
 * 첫 화면에서 작게 받았다가 곧바로 다시 받는 것이 제일 나쁘다.
 */
export const ColumnPixelsContext = createContext<number>(0)

export function useColumnPixels(): number {
  return useContext(ColumnPixelsContext)
}

/**
 * 컬럼의 스크롤 칸을 재서 context 에 실을 값을 만든다.
 *
 * 첫 값은 `useLayoutEffect` 에서 그리기 전에 잡는다. 카드는 저장소를 읽어온 뒤에야
 * 그려지므로, 사진이 처음 요청될 때는 이미 폭이 정해져 있다.
 */
export function useMeasuredColumnPixels(ref: RefObject<HTMLElement | null>): number {
  const [pixels, setPixels] = useState(0)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    const measure = (): void => setPixels(columnPixelsFrom(node.clientWidth))
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return pixels
}
