/**
 * [sign-check.mjs](../../scripts/sign-check.mjs) — AMO 에 서명을 맡기기 전에 거르는 것.
 *
 * AMO 는 한 번 받은 버전 번호를 다시 받지 않는다. 낡은 빌드를 맡기면 번호 하나를
 * 되돌릴 수 없이 써버리므로, 맡기기 전에 막는 것이 이 파일의 핵심이다.
 */
import { describe, expect, it } from 'vitest'
import { signProblems } from '../../scripts/sign-check.mjs'

const keys = { WEB_EXT_API_KEY: 'user:1:2', WEB_EXT_API_SECRET: 'secret' }

describe('signProblems', () => {
  it('새로 구운 빌드와 열쇠가 있으면 맡긴다', () => {
    expect(signProblems({ manifestVersion: '1.0.1', packageVersion: '1.0.1', env: keys })).toEqual([])
  })

  it('빌드가 없으면 막는다', () => {
    expect(signProblems({ manifestVersion: null, packageVersion: '1.0.1', env: keys })).toHaveLength(1)
  })

  it('버전을 올린 뒤 다시 굽지 않은 빌드는 막는다', () => {
    const [problem] = signProblems({ manifestVersion: '1.0.0', packageVersion: '1.0.1', env: keys })
    expect(problem).toContain('1.0.0')
    expect(problem).toContain('1.0.1')
  })

  it('열쇠가 하나라도 비어 있으면 막는다', () => {
    const [problem] = signProblems({
      manifestVersion: '1.0.1',
      packageVersion: '1.0.1',
      env: { WEB_EXT_API_KEY: 'user:1:2', WEB_EXT_API_SECRET: '  ' },
    })
    expect(problem).toContain('WEB_EXT_API_SECRET')
    expect(problem).not.toContain('WEB_EXT_API_KEY')
  })
})
