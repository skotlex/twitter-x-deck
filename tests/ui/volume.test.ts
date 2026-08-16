/**
 * [volume.ts](../../src/ui/lib/volume.ts) 의 소리 크기 공유.
 *
 * 미리보기는 음소거로 두는데, 크기까지 놓아두면 요소 기본값인 최대로 남는다.
 * 재생바의 소리 단추로 켜는 순간 그 크기로 터져 나오고, 그 단추 조작은 카드까지
 * 알려 오지 않아 뒤늦게 손볼 수도 없다 — 켜기 전부터 맞아 있어야 한다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyVolume, rememberVolume } from '@ui/lib/volume'

/** 크기를 맞춘 적 있는 상태를 만든다. 요소 기본값(최대·소리 켬)과 겹치지 않는 값으로. */
function remember(volume: number, muted: boolean) {
  const node = document.createElement('video')
  node.volume = volume
  node.muted = muted
  rememberVolume(node)
}

beforeEach(() => {
  remember(0.3, false)
})

describe('applyVolume', () => {
  it('새로 트는 영상에 지금까지 맞춰둔 크기를 입힌다', () => {
    const node = document.createElement('video')
    applyVolume(node)
    expect(node.volume).toBe(0.3)
    expect(node.muted).toBe(false)
  })

  it('음소거로 두라고 하면 크기는 맞추되 소리는 내지 않는다', () => {
    const node = document.createElement('video')
    applyVolume(node, true)
    expect(node.volume).toBe(0.3)
    expect(node.muted).toBe(true)
  })

  it('음소거로 맞춰 두었으면 그냥 불러도 소리가 나지 않는다', () => {
    remember(0.3, true)
    const node = document.createElement('video')
    applyVolume(node)
    expect(node.muted).toBe(true)
  })

  it('요소가 없으면 아무 일도 하지 않는다', () => {
    expect(() => applyVolume(null)).not.toThrow()
  })
})
