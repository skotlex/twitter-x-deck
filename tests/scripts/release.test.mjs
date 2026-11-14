/**
 * [release.mjs](../../scripts/release.mjs) — 사용자가 `npm run sign:ff` 로 구울 때 버전을
 * 하나 올리고, AI 가 모아둔 `[Unreleased]` 를 그 버전으로 굳히는 규칙.
 */
import { describe, expect, it } from 'vitest'
import { nextVersion, releaseChangelog } from '../../scripts/release.mjs'

describe('nextVersion — 자리마다 한 자리 숫자', () => {
  it('마지막 자리에 하나를 더한다', () => {
    expect(nextVersion('1.0.0')).toBe('1.0.1')
    expect(nextVersion('1.0.2')).toBe('1.0.3')
  })

  it('10 이 되면 0 으로 두고 앞자리를 올린다', () => {
    expect(nextVersion('1.0.9')).toBe('1.1.0')
    expect(nextVersion('1.9.9')).toBe('2.0.0')
  })

  it('더 올릴 자리가 없거나 모양이 다르면 멈춘다 — 사람이 정할 판올림이다', () => {
    expect(() => nextVersion('9.9.9')).toThrow()
    expect(() => nextVersion('1.10.0')).toThrow()
    expect(() => nextVersion('1.0')).toThrow()
  })
})

describe('releaseChangelog — [Unreleased] 를 이번 버전으로', () => {
  const head = '# Changelog\n\n머리말\n\n'
  const older = '## [1.0.2] - 2026-11-14\n\n### 버그 수정\n\n- 예전 항목\n'

  it('모아둔 항목의 머리를 이번 버전과 날짜로 바꾼다', () => {
    const text = `${head}## [Unreleased]\n\n### 버그 수정\n\n- 새 항목\n\n${older}`
    const { text: next, released } = releaseChangelog(text, '1.0.3', '2026-11-15')
    expect(released).toBe(true)
    expect(next).toBe(`${head}## [1.0.3] - 2026-11-15\n\n### 버그 수정\n\n- 새 항목\n\n${older}`)
  })

  it('CRLF 파일에서도 찾는다', () => {
    const text = `${head}## [Unreleased]\r\n\r\n- 새 항목\r\n`
    expect(releaseChangelog(text, '1.0.3', '2026-11-15').text).toContain('## [1.0.3] - 2026-11-15\r\n')
  })

  it('모아둔 것이 없으면 손대지 않는다 — 버전만 오르고 기록할 것은 없다', () => {
    const text = `${head}${older}`
    expect(releaseChangelog(text, '1.0.3', '2026-11-15')).toEqual({ text, released: false })
  })
})
