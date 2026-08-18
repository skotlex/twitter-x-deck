import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 움직임 줄이기(Windows 의 '애니메이션 효과' 끄기 포함)를 켠 사람에게 물레가
 * 형체 없이 떨렸던 자리를 지킨다.
 *
 * `animation-duration: 0.01ms` 만 걸고 반복 횟수를 그대로 두면 `infinite` 애니메이션은
 * 멈추는 대신 0.01ms 마다 한 바퀴를 돈다. 스타일시트는 그림자 DOM 안에서만 살아서
 * jsdom 으로 캐스케이드를 재현할 수 없으므로 규칙 자체를 읽어 확인한다.
 */
describe('움직임 줄이기', () => {
  const css = readFileSync(resolve(__dirname, '../../src/ui/index.css'), 'utf8')
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

  it('반복을 1 로 묶어 무한 애니메이션이 빨리 돌지 않게 한다', () => {
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/)
  })

  it('물레는 예외로 계속 돌되 더 느리게 돈다', () => {
    const spin = block.match(/\.animate-spin\s*\{([^}]*)\}/)
    expect(spin).not.toBeNull()

    const rule = spin![1] ?? ''
    expect(rule).toMatch(/infinite/)
    expect(rule).toMatch(/!important/)

    const seconds = Number(/animation:[^;]*?([\d.]+)s/.exec(rule)?.[1])
    expect(seconds).toBeGreaterThanOrEqual(1)
  })
})
