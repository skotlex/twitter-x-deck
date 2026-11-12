/**
 * [lightboxNav.ts](../../src/ui/lib/lightboxNav.ts) 의 사진 넘기기.
 *
 * 마지막 사진에서 '다음' 을 누르면 첫 사진으로 되돌아갔다. 끝에 닿았는지 알 수 없고,
 * 타래라면 다음 글의 사진으로 이어져야 할 자리였다.
 */
import { describe, expect, it } from 'vitest'
import { stepPhoto } from '@ui/lib/lightboxNav'

describe('stepPhoto — 한 글 안', () => {
  it('묶음 안에서는 한 장씩 옮긴다', () => {
    expect(stepPhoto([3], { group: 0, index: 0 }, 1)).toEqual({ group: 0, index: 1 })
    expect(stepPhoto([3], { group: 0, index: 2 }, -1)).toEqual({ group: 0, index: 1 })
  })

  it('마지막 사진에서 다음으로 가도 첫 사진으로 돌아가지 않는다', () => {
    expect(stepPhoto([3], { group: 0, index: 2 }, 1)).toBeNull()
  })

  it('첫 사진에서 이전으로 가도 마지막 사진으로 돌아가지 않는다', () => {
    expect(stepPhoto([3], { group: 0, index: 0 }, -1)).toBeNull()
  })

  it('한 장뿐이면 어느 쪽으로도 가지 않는다', () => {
    expect(stepPhoto([1], { group: 0, index: 0 }, 1)).toBeNull()
    expect(stepPhoto([1], { group: 0, index: 0 }, -1)).toBeNull()
  })
})

describe('stepPhoto — 타래', () => {
  it('글의 마지막 사진에서 다음은 다음 글의 첫 사진이다', () => {
    expect(stepPhoto([2, 3], { group: 0, index: 1 }, 1)).toEqual({ group: 1, index: 0 })
  })

  it('글의 첫 사진에서 이전은 앞 글의 마지막 사진이다', () => {
    expect(stepPhoto([2, 3], { group: 1, index: 0 }, -1)).toEqual({ group: 0, index: 1 })
  })

  it('타래의 마지막 사진에서는 멈춘다', () => {
    expect(stepPhoto([2, 3], { group: 1, index: 2 }, 1)).toBeNull()
    expect(stepPhoto([2, 3], { group: 0, index: 0 }, -1)).toBeNull()
  })

  it('사진이 없는 묶음은 건너뛴다', () => {
    expect(stepPhoto([1, 0, 2], { group: 0, index: 0 }, 1)).toEqual({ group: 2, index: 0 })
    expect(stepPhoto([1, 0, 2], { group: 2, index: 0 }, -1)).toEqual({ group: 0, index: 0 })
  })
})
