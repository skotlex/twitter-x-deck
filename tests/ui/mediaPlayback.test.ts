/**
 * [mediaPlayback.ts](../../src/ui/lib/mediaPlayback.ts) 의 미디어 조작 판정.
 *
 * 브라우저가 영상에 붙여 주는 기본 조작(눌러서 재생·정지, 재생바의 소리 단추)과
 * 맞물린 자리라 화면만 봐서는 어느 쪽이 한 일인지 가릴 수 없다. 규칙만 떼어 못을 박는다.
 */
import { describe, expect, it } from 'vitest'
import { isUserVolume, mediaClick, videoHoldsColumn } from '@ui/lib/mediaPlayback'

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

/**
 * 붙드는 이유는 '보던 것이 아래로 밀려나지 않게' 다. 보고 있지 않으면 붙들 이유도 없다.
 *
 * 여기서 막으려는 회귀는 하나다 — **켜뒀다는 사실만으로 컬럼을 잠그던 것.** 소리를
 * 켠 영상은 마우스가 떠나도 요소가 남으므로, 그 기준으로 붙들면 한 번 누른 영상
 * 하나가 그 컬럼을 영영 잠갔다. 스크롤이 맨 위인데도 새 글이 전부 알약으로만 쌓였다.
 */
describe('videoHoldsColumn — 영상이 컬럼을 붙드는지', () => {
  it('돌고 있으면 붙든다', () => {
    expect(videoHoldsColumn({ mounted: true, playing: true })).toBe(true)
  })

  it('켜둔 채 끝났거나 세워둔 영상은 놓아준다', () => {
    expect(videoHoldsColumn({ mounted: true, playing: false })).toBe(false)
  })

  it('요소가 내려갔으면 붙들지 않는다', () => {
    expect(videoHoldsColumn({ mounted: false, playing: true })).toBe(false)
  })
})
