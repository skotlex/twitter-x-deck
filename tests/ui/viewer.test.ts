/**
 * [useViewer.ts](../../src/ui/hooks/useViewer.ts) 의 사진 메우기.
 *
 * 사이드바는 핸들부터 그리고 사진은 한 박자 뒤에 그린다. 그 사이에 읽으면 사진이
 * 빈 채로 잡히는데, 그대로 두면 상단 바에 머리글자만 남는다 — 지난번 사진으로 메운다.
 */
import { describe, expect, it } from 'vitest'
import { fillAvatar, isViewerComplete } from '@ui/hooks/useViewer'

const alice = { handle: 'alice', name: '앨리스', avatarUrl: 'https://pbs.twimg.com/alice.jpg' }
const blank = { handle: 'alice', name: '앨리스', avatarUrl: '' }

describe('fillAvatar — 지난번 사진으로 메우기', () => {
  it('사진이 비었으면 같은 계정의 지난 사진을 쓴다', () => {
    expect(fillAvatar(blank, alice).avatarUrl).toBe(alice.avatarUrl)
  })

  it('다른 계정의 사진은 쓰지 않는다', () => {
    expect(fillAvatar(blank, { ...alice, handle: 'bob' }).avatarUrl).toBe('')
  })

  it('지금 읽은 사진이 있으면 그쪽이 이긴다', () => {
    const fresh = { ...alice, avatarUrl: 'https://pbs.twimg.com/alice2.jpg' }
    expect(fillAvatar(fresh, alice).avatarUrl).toBe(fresh.avatarUrl)
  })

  it('메울 것이 없으면 읽은 그대로 둔다', () => {
    expect(fillAvatar(blank, null)).toEqual(blank)
  })
})

describe('isViewerComplete — 더 물어볼 필요가 있는지', () => {
  it('사진까지 읽혔을 때만 끝난 것으로 본다', () => {
    expect(isViewerComplete(alice)).toBe(true)
    expect(isViewerComplete(blank)).toBe(false)
    expect(isViewerComplete(null)).toBe(false)
  })
})
