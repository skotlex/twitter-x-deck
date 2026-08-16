/**
 * [mediaPlayback.ts](../../src/ui/lib/mediaPlayback.ts) 의 미디어 조작 판정.
 *
 * 브라우저가 영상에 붙여 주는 기본 조작(눌러서 재생·정지, 재생바의 소리 단추)과
 * 맞물린 자리라 화면만 봐서는 어느 쪽이 한 일인지 가릴 수 없다. 규칙만 떼어 못을 박는다.
 */
import { describe, expect, it } from 'vitest'
import { isUserVolume, mediaClick } from '@ui/lib/mediaPlayback'

describe('mediaClick — 눌렀을 때 할 일', () => {
  it('사진은 원본 보기로 연다', () => {
    expect(mediaClick({ playable: false, engaged: false })).toBe('open')
  })

  it('멈춰 있는 영상을 누르면 튼다', () => {
    expect(mediaClick({ playable: true, engaged: false })).toBe('start')
  })

  it('미리보기로 돌고 있어도 소리를 켜기 전 첫 클릭은 튼다', () => {
    // 브라우저의 재생·정지 토글에 맡기면 "보겠다"고 누른 클릭이 정지로 끝난다.
    expect(mediaClick({ playable: true, engaged: false })).not.toBe('toggle')
  })

  it('소리를 켠 뒤로는 브라우저에 맡긴다', () => {
    expect(mediaClick({ playable: true, engaged: true })).toBe('toggle')
  })
})

describe('isUserVolume — 소리를 사용자가 맞췄는지', () => {
  it('미리보기로 끈 음소거는 사용자가 한 일이 아니다', () => {
    expect(isUserVolume({ silent: false, engaged: false, muted: true })).toBe(false)
  })

  it('미리보기 중에 소리가 켜졌으면 사용자가 켠 것이다', () => {
    expect(isUserVolume({ silent: false, engaged: false, muted: false })).toBe(true)
  })

  it('소리를 켠 뒤에는 다시 끈 것도 사용자가 한 것이다', () => {
    expect(isUserVolume({ silent: true, engaged: true, muted: true })).toBe(false)
    expect(isUserVolume({ silent: false, engaged: true, muted: true })).toBe(true)
  })

  it('GIF 는 소리가 없으니 셈에서 뺀다', () => {
    expect(isUserVolume({ silent: true, engaged: false, muted: false })).toBe(false)
  })
})
