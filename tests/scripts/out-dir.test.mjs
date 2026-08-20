/**
 * [out-dir.mjs](../../scripts/out-dir.mjs) — 빌드 결과를 어디에 놓을지 고르는 규칙.
 *
 * 저장소가 OneDrive 안에 있으면 브라우저가 시작할 때 그 폴더를 못 읽어 압축해제
 * 확장을 버린다. `--out` 은 그 자리를 동기화 밖으로 빼기 위한 것이라, **엉뚱한
 * 폴더를 지우지 않는 것** 이 이 파일의 핵심이다.
 *
 * 경로는 플랫폼마다 모양이 다르므로 문자열을 그대로 재지 않고 `resolve` 로 맞춰 잰다.
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insideSyncedFolder, outDirFrom, reusableOutDir } from '../../scripts/out-dir.mjs'

const root = resolve('/repo')
const cwd = resolve('/work')

describe('outDirFrom', () => {
  it('아무것도 안 주면 저장소의 dist', () => {
    expect(outDirFrom({ cwd, root })).toBe(resolve(root, 'dist'))
  })

  it('--out 을 받는다', () => {
    expect(outDirFrom({ argv: ['--out', '/ext/x-deck'], cwd, root })).toBe(resolve('/ext/x-deck'))
    expect(outDirFrom({ argv: ['--out=/ext/x-deck'], cwd, root })).toBe(resolve('/ext/x-deck'))
  })

  it('상대 경로는 명령을 친 자리 기준으로 푼다', () => {
    expect(outDirFrom({ argv: ['--out', 'build'], cwd, root })).toBe(resolve(cwd, 'build'))
  })

  it('XDECK_OUT 으로도 정한다', () => {
    expect(outDirFrom({ env: { XDECK_OUT: '/ext/x-deck' }, cwd, root })).toBe(resolve('/ext/x-deck'))
  })

  it('명령줄이 환경 변수를 이긴다', () => {
    const out = outDirFrom({ argv: ['--out', '/cli'], env: { XDECK_OUT: '/env' }, cwd, root })
    expect(out).toBe(resolve('/cli'))
  })

  it('빈 XDECK_OUT 은 없는 것으로 본다 — 빈 값에 저장소 뿌리를 내주지 않는다', () => {
    expect(outDirFrom({ env: { XDECK_OUT: '   ' }, cwd, root })).toBe(resolve(root, 'dist'))
  })

  it('경로 없는 --out 은 조용히 넘어가지 않는다', () => {
    expect(() => outDirFrom({ argv: ['--out'], cwd, root })).toThrow()
    expect(() => outDirFrom({ argv: ['--out', '--watch'], cwd, root })).toThrow()
    expect(() => outDirFrom({ argv: ['--out='], cwd, root })).toThrow()
  })
})

describe('reusableOutDir', () => {
  it('빈 폴더는 써도 된다', () => {
    expect(reusableOutDir([])).toBe(true)
  })

  it('지난 빌드 결과가 있으면 써도 된다', () => {
    expect(reusableOutDir(['manifest.json', 'deck.js', 'icons'])).toBe(true)
    expect(reusableOutDir(['deck.js'])).toBe(true)
  })

  it('브라우저가 남긴 것뿐이면 써도 된다', () => {
    expect(reusableOutDir(['_metadata'])).toBe(true)
  })

  it('남의 폴더는 지우지 않는다 — 오타 한 번에 날아가는 자리다', () => {
    expect(reusableOutDir(['사진', '이력서.docx'])).toBe(false)
    expect(reusableOutDir(['node_modules', 'package.json'])).toBe(false)
  })
})

describe('insideSyncedFolder', () => {
  const env = { OneDrive: resolve('/users/me/OneDrive') }

  it('동기화 폴더 안이면 알아본다', () => {
    expect(insideSyncedFolder(resolve('/users/me/OneDrive/work/dist'), env)).toBe(true)
    expect(insideSyncedFolder(resolve('/users/me/OneDrive'), env)).toBe(true)
  })

  it('밖이면 조용하다', () => {
    expect(insideSyncedFolder(resolve('/ext/x-deck'), env)).toBe(false)
    expect(insideSyncedFolder(resolve('/users/me/OneDriveTemp/dist'), env)).toBe(false)
  })

  it('동기화 폴더가 없는 환경에서는 아무 말도 하지 않는다', () => {
    expect(insideSyncedFolder(resolve('/ext/x-deck'), {})).toBe(false)
  })
})
