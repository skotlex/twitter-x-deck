/**
 * [unread.ts](../../src/ui/lib/unread.ts) 의 안 본 수 세기.
 *
 * 이 수는 종 배지의 유일한 근거다. 한 건이라도 새면 사용자는 멘션이 온 줄 모르고,
 * 과하게 세면 종이 켜진 채로 남아 아무 것도 알려주지 못한다.
 */
import { describe, expect, it } from 'vitest'
import { countUniqueSince, unreadLabel, type UnreadSlice } from '@ui/lib/unread'

/** 최신이 앞. 컬럼이 목록을 들고 있는 순서 그대로다. 글은 관측 시각으로 구별한다. */
const slice = (since: number, ...capturedAt: number[]): UnreadSlice => ({
  since,
  items: capturedAt.map((value) => ({ id: `t${value}`, capturedAt: value })),
})

describe('countUniqueSince', () => {
  it('본 시각보다 뒤에 들어온 것만 센다', () => {
    expect(countUniqueSince([slice(300, 500, 400, 300, 200)])).toBe(2)
  })

  it('본 시각과 같은 순간에 들어온 것은 본 것으로 친다', () => {
    expect(countUniqueSince([slice(300, 300, 200)])).toBe(0)
  })

  it('전부 새 것이면 전부 센다', () => {
    expect(countUniqueSince([slice(100, 500, 400)])).toBe(2)
  })

  it('빈 목록은 0 이다', () => {
    expect(countUniqueSince([slice(100)])).toBe(0)
    expect(countUniqueSince([])).toBe(0)
  })

  /**
   * 목록이 최신순이라는 전제로 첫 옛 항목에서 멈춘다. 그 뒤에 새 것이 섞여 있으면
   * 세지 않는데, 그것이 이 함수가 상한(400건)까지 쌓인 컬럼을 매번 안 훑는 이유다.
   */
  it('최신순 전제로 첫 옛 항목에서 멈춘다', () => {
    expect(countUniqueSince([slice(300, 500, 100, 400)])).toBe(1)
  })

  /**
   * 종에 묶인 갈래가 여럿일 때의 본론.
   *
   * 멘션 하나는 알림(전체)에도 그대로 실려 온다. 갈래별로 세어 더하던 시절에는
   * 멘션 한 건이 종에 2 로 떴다 — 들어가 보면 같은 글이었다.
   */
  it('같은 글이 여러 갈래에 실려도 한 번만 센다', () => {
    const 알림 = slice(100, 500)
    const 멘션 = slice(100, 500)
    expect(countUniqueSince([알림, 멘션])).toBe(1)
  })

  it('갈래가 다른 글을 담고 있으면 합쳐 센다', () => {
    expect(countUniqueSince([slice(100, 500), slice(100, 400, 300)])).toBe(3)
  })

  /** 본 시각은 갈래마다 다르다. 한쪽에서 이미 봤어도 다른 쪽에 남아 있으면 센다. */
  it('한 갈래에서만 안 본 글도 센다', () => {
    const 알림 = slice(600, 500)
    const 멘션 = slice(100, 500)
    expect(countUniqueSince([알림, 멘션])).toBe(1)
    expect(countUniqueSince([알림])).toBe(0)
  })
})

describe('unreadLabel', () => {
  it('두 자리까지는 수를 그대로 적는다', () => {
    expect(unreadLabel(1)).toBe('1')
    expect(unreadLabel(99)).toBe('99')
  })

  it('세 자리부터는 접는다 — 배지가 넓어지면 옆 단추를 민다', () => {
    expect(unreadLabel(100)).toBe('99+')
    expect(unreadLabel(1_234)).toBe('99+')
  })
})
