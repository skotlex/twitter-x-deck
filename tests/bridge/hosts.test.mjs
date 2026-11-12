/**
 * [hosts.mjs](../../bridge/hosts.mjs) — 브리지를 어느 브라우저에 어떤 모양으로 등록하는지.
 *
 * 등록이 틀려도 오류는 나지 않는다. 브라우저가 조용히 브리지를 못 찾을 뿐이라,
 * 덱에는 "등록되지 않았습니다" 만 뜨고 원인은 보이지 않는다. 그래서 각 브라우저가
 * 실제로 읽는 자리와 키, 그리고 **확장이 실제로 갖게 될 ID** 와 맞는지를 여기서 잰다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHROMIUM_EXTENSION_ID,
  HOST_NAME,
  REGISTRATIONS,
  hostManifest,
  manifestFileName,
  registryPath,
} from '../../bridge/hosts.mjs'
import { manifestFor } from '../../scripts/target.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(here, '../../manifest.json'), 'utf8'))

/** 크롬이 공개키에서 확장 ID 를 만드는 방식: SHA-256 앞 16바이트를 a~p 로 적는다. */
function chromiumIdFromKey(key) {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
}

describe('확장 ID', () => {
  it('크로미움용 ID 가 manifest.json 의 key 와 맞는다', () => {
    expect(CHROMIUM_EXTENSION_ID).toBe(chromiumIdFromKey(manifest.key))
  })

  it('Firefox 용 ID 가 Firefox 빌드의 gecko.id 와 맞는다', () => {
    const firefox = manifestFor(manifest, 'firefox', '0.0.0')
    expect(hostManifest('firefox', 'x').allowed_extensions).toEqual([
      firefox.browser_specific_settings.gecko.id,
    ])
  })
})

describe('hostManifest', () => {
  const launcher = 'C:\\bridge\\host.bat'

  it('크로미움은 allowed_origins 로만 허락한다', () => {
    const out = hostManifest('chromium', launcher)
    expect(out).toMatchObject({ name: HOST_NAME, path: launcher, type: 'stdio' })
    expect(out.allowed_origins).toEqual([`chrome-extension://${CHROMIUM_EXTENSION_ID}/`])
    expect(out).not.toHaveProperty('allowed_extensions')
  })

  it('Firefox 는 allowed_extensions 로만 허락한다', () => {
    const out = hostManifest('firefox', launcher)
    expect(out).toMatchObject({ name: HOST_NAME, path: launcher, type: 'stdio' })
    expect(out).not.toHaveProperty('allowed_origins')
  })

  it('계열마다 파일이 따로다 — 서로의 키를 모르는 브라우저가 거부하지 않게', () => {
    expect(manifestFileName('chromium')).not.toBe(manifestFileName('firefox'))
  })
})

describe('REGISTRATIONS', () => {
  it('Firefox 는 Mozilla 자리에 등록한다', () => {
    const firefox = REGISTRATIONS.filter((r) => r.family === 'firefox')
    expect(firefox.map((r) => registryPath(r.base))).toEqual([
      `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`,
    ])
  })

  it('크로미움 계열 다섯은 그대로 남아 있다', () => {
    const chromium = REGISTRATIONS.filter((r) => r.family === 'chromium').map((r) => r.label)
    expect(chromium).toEqual(['Chrome', 'Edge', 'Chromium', 'Brave', 'Whale'])
  })
})
