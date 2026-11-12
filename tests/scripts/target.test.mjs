/**
 * [target.mjs](../../scripts/target.mjs) — 어느 브라우저용으로 구울지, 그에 맞춰 매니페스트를
 * 어떻게 고치는지.
 *
 * 저장소의 manifest.json 은 크로미움 기준 하나뿐이다. Firefox 용은 여기서 고쳐 쓰므로,
 * 크로미움 결과가 **조금도 바뀌지 않는 것** 과 Firefox 가 못 읽는 키가 남지 않는 것을 같이 본다.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GECKO_ID, TARGETS, manifestFor, targetFrom } from '../../scripts/target.mjs'

// happy-dom 이 전역 URL 을 갈아 끼우므로 URL 객체 대신 경로 문자열로 연다.
const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(here, '../../manifest.json'), 'utf8'))

describe('targetFrom', () => {
  it('아무것도 안 주면 크로미움', () => {
    expect(targetFrom([])).toBe('chromium')
    expect(targetFrom(['--watch', '--out', 'C:\\ext'])).toBe('chromium')
  })

  it('--target 을 받는다', () => {
    expect(targetFrom(['--target', 'firefox'])).toBe('firefox')
    expect(targetFrom(['--target=firefox'])).toBe('firefox')
    expect(targetFrom(['--target', 'chromium'])).toBe('chromium')
  })

  it('모르는 대상이나 빈 값은 조용히 넘어가지 않는다', () => {
    expect(() => targetFrom(['--target', 'safari'])).toThrow()
    expect(() => targetFrom(['--target'])).toThrow()
    expect(() => targetFrom(['--target', '--watch'])).toThrow()
    expect(() => targetFrom(['--target='])).toThrow()
    expect(() => targetFrom(['--target', 'toString'])).toThrow()
  })
})

describe('manifestFor', () => {
  it('크로미움은 버전만 바꾸고 그대로 둔다', () => {
    const out = manifestFor(manifest, 'chromium', '9.9.9')
    expect(out).toEqual({ ...manifest, version: '9.9.9' })
  })

  it('넘겨받은 매니페스트는 건드리지 않는다', () => {
    const before = structuredClone(manifest)
    manifestFor(manifest, 'firefox', '9.9.9')
    expect(manifest).toEqual(before)
  })

  describe('firefox', () => {
    const out = manifestFor(manifest, 'firefox', '9.9.9')

    it('서비스 워커를 백그라운드 스크립트로 싣는다', () => {
      expect(out.background).toEqual({ scripts: [manifest.background.service_worker] })
    })

    it('ID 와 최소 버전을 못박는다', () => {
      expect(out.browser_specific_settings.gecko).toEqual({
        id: GECKO_ID,
        strict_min_version: TARGETS.firefox.minVersion,
      })
    })

    it('Firefox 가 모르는 키를 남기지 않는다', () => {
      expect(out).not.toHaveProperty('key')
      expect(out).not.toHaveProperty('minimum_chrome_version')
    })

    it('나머지는 크로미움과 같다 — 권한·콘텐츠 스크립트·규칙이 갈라지지 않는다', () => {
      expect(out.version).toBe('9.9.9')
      expect(out.permissions).toEqual(manifest.permissions)
      expect(out.host_permissions).toEqual(manifest.host_permissions)
      expect(out.content_scripts).toEqual(manifest.content_scripts)
      expect(out.declarative_net_request).toEqual(manifest.declarative_net_request)
    })
  })
})
