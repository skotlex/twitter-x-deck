/**
 * [sign-check.mjs](../../scripts/sign-check.mjs) — AMO 에 서명을 맡기기 전에 거르는 것.
 *
 * AMO 는 한 번 받은 버전 번호를 다시 받지 않는다. 낡은 빌드를 맡기면 번호 하나를
 * 되돌릴 수 없이 써버리므로, 맡기기 전에 막는 것이 이 파일의 핵심이다.
 */
import { describe, expect, it } from 'vitest'
import { signProblems, staleArtifacts } from '../../scripts/sign-check.mjs'

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

describe('staleArtifacts — 서명 뒤 dist-xpi 에서 지울 것', () => {
  const startedAt = 1_000_000

  it('이번에 받은 파일만 남기고 예전 파일은 지운다', () => {
    const entries = [
      { name: 'old-1.0.0.xpi', mtimeMs: startedAt - 86_400_000, isFile: true },
      { name: 'x-deck-1.0.1-unsigned.xpi', mtimeMs: startedAt - 60_000, isFile: true },
      { name: 'new-1.0.1.xpi', mtimeMs: startedAt + 30_000, isFile: true },
    ]
    expect(staleArtifacts(entries, startedAt)).toEqual(['old-1.0.0.xpi', 'x-deck-1.0.1-unsigned.xpi'])
  })

  it('새 파일이 없으면 아무것도 지우지 않는다 — 서명이 실패했을 때 남은 것까지 잃지 않게', () => {
    const entries = [{ name: 'old-1.0.0.xpi', mtimeMs: startedAt - 60_000, isFile: true }]
    expect(staleArtifacts(entries, startedAt)).toEqual([])
  })

  it('폴더는 건드리지 않는다', () => {
    const entries = [
      { name: 'keep', mtimeMs: startedAt - 60_000, isFile: false },
      { name: 'new-1.0.1.xpi', mtimeMs: startedAt + 1, isFile: true },
    ]
    expect(staleArtifacts(entries, startedAt)).toEqual([])
  })
})
