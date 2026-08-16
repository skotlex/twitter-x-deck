/**
 * [session.ts](../../src/core/session.ts) 의 문서 사이 힌트.
 *
 * 여기 담기는 값은 첫 화면을 고르는 데만 쓰이지만, 틀린 값이 남으면 화면이 튀거나
 * 엉뚱한 계정의 사진이 잠깐 뜬다. 저장 조건과 읽기 조건을 못박아 둔다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { rememberViewer, rememberedViewer } from '@core/session'

const alice = { handle: 'alice', name: '앨리스', avatarUrl: 'https://pbs.twimg.com/alice.jpg' }

beforeEach(() => {
  window.localStorage.clear()
})

describe('rememberViewer / rememberedViewer — 지난번 계정', () => {
  it('적어둔 계정을 그대로 돌려준다', () => {
    rememberViewer(alice)
    expect(rememberedViewer()).toEqual(alice)
  })

  it('아직 아무 것도 안 적었으면 null', () => {
    expect(rememberedViewer()).toBeNull()
  })

  it('사진 없는 값은 적지 않는다 — 메울 것이 없는 힌트다', () => {
    rememberViewer({ handle: 'alice', name: '앨리스', avatarUrl: '' })
    expect(rememberedViewer()).toBeNull()
  })

  it('사진이 생기면 지난 값을 덮어쓴다', () => {
    rememberViewer(alice)
    rememberViewer({ ...alice, avatarUrl: 'https://pbs.twimg.com/alice2.jpg' })
    expect(rememberedViewer()?.avatarUrl).toBe('https://pbs.twimg.com/alice2.jpg')
  })

  it('깨진 값이 들어 있으면 없는 셈 친다', () => {
    window.localStorage.setItem('xdeck:viewer', '{이건 JSON 이 아니다')
    expect(rememberedViewer()).toBeNull()
  })
})
