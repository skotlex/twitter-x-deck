/**
 * codex 설정 자동 수리.
 *
 * 실제로 겪은 일이다 — `service_tier = "default"` 하나 때문에 codex 가 아예 뜨지 않아
 * 로그인 창을 띄워도 그 자리에서 에러만 뱉었다. 그 줄을 짚어 꺼주는 것이 여기다.
 * 잘못 짚으면 멀쩡한 설정을 무너뜨리므로, 손대도 되는 모양인지 가리는 쪽을 더 많이 잰다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFault, repairConfigFile, repairConfigText } from '../../bridge/codex-config.mjs'

/** 실제로 뱉은 말 그대로. 윈도우 경로라 `:` 가 여러 번 나온다. */
const WINDOWS_SAID =
  'Error loading configuration: C:\Users\USER\.codex\config.toml:3:16: unknown variant `default`, expected `fast` or `flex`'

describe('configFault — 설정 때문에 넘어졌는지', () => {
  it('경로에 든 드라이브 문자를 줄 번호로 헷갈리지 않는다', () => {
    expect(configFault(WINDOWS_SAID)).toEqual({
      path: 'C:\Users\USER\.codex\config.toml',
      line: 3,
      column: 16,
      detail: 'unknown variant `default`, expected `fast` or `flex`',
    })
  })

  it('줄 번호를 안 알려주는 옛 말투도 사정만은 집어낸다', () => {
    const fault = configFault('Error loading config.toml: invalid value for key `model_reasoning_effort`')
    expect(fault?.line).toBeNull()
    expect(fault?.detail).toContain('invalid value')
  })

  it('설정 이야기가 아니면 null 이다', () => {
    expect(configFault('그냥 다른 오류')).toBeNull()
  })
})

describe('repairConfigText — 짚어준 줄만 끈다', () => {
  const config = ['model = "gpt-5.6-sol"', 'model_reasoning_effort = "low"', 'service_tier = "default"', '', '[windows]', 'sandbox = "elevated"'].join('\n')

  it('문제가 된 줄을 주석으로 덮고 나머지는 건드리지 않는다', () => {
    const repaired = repairConfigText(config, configFault(WINDOWS_SAID))
    expect(repaired?.key).toBe('service_tier')
    expect(repaired.text).toContain('# service_tier = "default"')
    expect(repaired.text).toContain('model = "gpt-5.6-sol"')
    expect(repaired.text).toContain('sandbox = "elevated"')
  })

  it('줄 수는 그대로 둔다 — 다음에 짚어줄 줄 번호가 어긋나면 엉뚱한 줄을 끈다', () => {
    const repaired = repairConfigText(config, configFault(WINDOWS_SAID))
    expect(repaired.text.split('\n')).toHaveLength(config.split('\n').length)
  })

  it('CRLF 파일을 LF 로 바꿔 돌려주지 않는다', () => {
    const crlf = 'a = 1\r\nservice_tier = "default"\r\n'
    const repaired = repairConfigText(crlf, { path: 'x/config.toml', line: 2, column: 16, detail: '' })
    expect(repaired.text).toBe('a = 1\r\n# service_tier = "default"  # x-deck: codex 가 읽지 못해 꺼둠\r\n')
  })

  it('표 머리는 건드리지 않는다 — 그 아래 값들이 갈 곳을 잃는다', () => {
    expect(repairConfigText('[windows]\nsandbox = "elevated"', { line: 1 })).toBeNull()
  })

  it('여러 줄에 걸친 값은 그대로 둔다', () => {
    expect(repairConfigText('items = [\n  1,\n]', { line: 1 })).toBeNull()
    expect(repairConfigText('note = """\n여러 줄\n"""', { line: 1 })).toBeNull()
  })

  it('이미 꺼져 있는 줄이나 없는 줄에는 손대지 않는다', () => {
    expect(repairConfigText('# service_tier = "default"', { line: 1 })).toBeNull()
    expect(repairConfigText('a = 1', { line: 9 })).toBeNull()
    expect(repairConfigText('a = 1', { line: null })).toBeNull()
  })
})

describe('repairConfigFile — 파일에 실제로 적용', () => {
  const write = (name, text) => {
    const path = join(mkdtempSync(join(tmpdir(), 'xdeck-')), name)
    writeFileSync(path, text)
    return path
  }

  it('고치기 전 내용을 .bak 에 남긴다', () => {
    const before = 'model = "x"\nservice_tier = "default"\n'
    const path = write('config.toml', before)
    const done = repairConfigFile({ path, line: 2, column: 16, detail: '' })

    expect(done?.key).toBe('service_tier')
    expect(readFileSync(path, 'utf8')).toContain('# service_tier')
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(before)
  })

  it('config.toml 이 아닌 파일은 codex 가 짚어줘도 건드리지 않는다', () => {
    const path = write('auth.json', 'service_tier = "default"\n')
    expect(repairConfigFile({ path, line: 1 })).toBeNull()
    expect(readFileSync(path, 'utf8')).toBe('service_tier = "default"\n')
  })

  it('없는 파일에는 아무 일도 일어나지 않는다', () => {
    expect(repairConfigFile({ path: join(tmpdir(), 'xdeck-없는', 'config.toml'), line: 1 })).toBeNull()
  })
})
