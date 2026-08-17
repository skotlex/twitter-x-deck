/**
 * codex 가 자기 설정 파일 때문에 못 뜰 때 그 줄을 꺼준다.
 *
 * `~/.codex/config.toml` 은 codex 가 올라가면서 받아들이는 값이 바뀐다. 예전 판에서
 * 멀쩡하던 `service_tier = "default"` 가 다음 판에서는 "`fast` 또는 `flex` 여야 한다" 로
 * 거절당하는 식이다. 이때 codex 는 **아무 명령도 실행하지 않는다** — 로그인도, 상태
 * 확인도, 번역도 전부 같은 자리에서 멈춘다. 브리지 쪽에서 잘못한 것이 없는데도
 * 사용자에게는 확장이 고장 난 것으로 보인다.
 *
 * 그래서 codex 가 짚어준 그 줄만 주석으로 덮는다. 값을 새로 지어내지 않는다 — 무엇이
 * 맞는 값인지는 판마다 다르고, 지우면 codex 의 기본값으로 돌아가므로 그게 가장 안전하다.
 * 고치기 전 내용은 `config.toml.bak` 에 남기고, 꺼둔 줄도 지우지 않고 주석으로 남겨
 * 사용자가 무엇이 사라졌는지 파일만 열어도 알 수 있게 한다.
 *
 * 손대는 범위는 좁게 잡는다. 한 줄로 끝나는 `key = value` 만 건드리고, 표 머리(`[table]`)
 * 나 여러 줄에 걸친 값은 그대로 둔다 — 그런 것을 잘못 건드리면 멀쩡하던 설정까지
 * 무너진다. 손댈 수 없는 모양이면 아무 것도 하지 않고, 사용자에게 무엇이 문제인지
 * 그대로 올려보낸다 ([messages.mjs](./messages.mjs) 의 `configComplaint`).
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** 우리가 손대도 되는 파일. codex 가 알려준 경로라도 이 이름이 아니면 건드리지 않는다. */
const CONFIG_NAME = 'config.toml'

/** 한 번 뜨는 동안 허용하는 수리 횟수. 고쳐도 계속 같은 말이 나오면 그만둔다. */
export const REPAIR_LIMIT = 3

/**
 * 설정 때문에 넘어진 것인지 가려낸다.
 *
 * codex 판에 따라 말투가 둘이다.
 *   - `Error loading configuration: C:\...\config.toml:3:16: unknown variant ...`
 *   - `Error loading config.toml: invalid value for key ...`
 * 앞의 것만 몇 번째 줄인지 알려준다. 줄 번호가 없으면 어디를 꺼야 할지 모르므로
 * 고치지 않고 사정만 옮긴다.
 */
export function configFault(stderr) {
  const match = /Error loading config(?:uration|\.toml)\s*:\s*(.+)/.exec(String(stderr ?? ''))
  if (!match) return null

  const said = match[1].trim()
  // 윈도우 경로에도 `:` 가 들어 있다. `.toml` 을 기준으로 잘라야 드라이브 문자와
  // 줄 번호를 헷갈리지 않는다.
  const located = /^(.*\.toml):(\d+):(\d+):\s*(.+)$/.exec(said)
  if (!located) return { path: null, line: null, column: null, detail: said }

  return {
    path: located[1],
    line: Number(located[2]),
    column: Number(located[3]),
    detail: located[4].trim(),
  }
}

/** 한 줄 안에서 값이 끝났는지. 배열·중괄호·따옴표가 열린 채면 다음 줄로 이어진다. */
function selfContained(value) {
  if (value.includes('"""') || value.includes("'''")) return false
  const count = (pattern) => (value.match(pattern) ?? []).length
  if (count(/\[/g) !== count(/\]/g)) return false
  if (count(/\{/g) !== count(/\}/g)) return false
  if (count(/"/g) % 2 !== 0) return false
  if (count(/'/g) % 2 !== 0) return false
  return true
}

/**
 * 문제가 된 줄을 주석으로 덮은 글월을 돌려준다. 손댈 수 없는 모양이면 `null`.
 *
 * 줄 수를 늘리거나 줄이지 않는다. codex 는 고친 파일을 다시 읽고 또 다른 줄을 짚을 수
 * 있는데, 그 줄 번호가 우리가 방금 밀어낸 만큼 어긋나면 엉뚱한 줄을 끄게 된다.
 */
export function repairConfigText(text, fault) {
  if (!fault?.line) return null
  const lines = String(text ?? '').split('\n')
  const index = fault.line - 1
  const target = lines[index]
  if (typeof target !== 'string') return null

  // 줄 끝의 `\r` 은 그대로 둔다. CRLF 파일을 LF 로 바꿔 돌려주지 않는다.
  const eol = target.endsWith('\r') ? '\r' : ''
  const body = eol ? target.slice(0, -1) : target

  if (/^\s*#/.test(body)) return null // 이미 꺼져 있다. 여기가 원인이면 우리가 할 일이 없다
  if (/^\s*\[/.test(body)) return null // 표 머리. 지우면 그 아래 값들이 통째로 갈 곳을 잃는다
  const assignment = /^\s*([^=#[\]]+?)\s*=\s*(.+?)\s*$/.exec(body)
  if (!assignment) return null
  if (!selfContained(assignment[2])) return null

  lines[index] = `# ${body}  # x-deck: codex 가 읽지 못해 꺼둠${eol}`
  return { text: lines.join('\n'), key: assignment[1], line: fault.line }
}

/**
 * 짚어준 파일에서 그 줄을 실제로 꺼준다. 고쳤으면 무엇을 껐는지, 아니면 `null`.
 *
 * 고치기 전 내용을 `config.toml.bak` 으로 먼저 옮긴다. 우리가 잘못 짚었더라도
 * 사용자가 되돌릴 자리는 남아 있어야 한다.
 */
export function repairConfigFile(fault) {
  if (!fault?.path || !fault.line) return null
  if (!fault.path.replace(/[\\]/g, '/').toLowerCase().endsWith(`/${CONFIG_NAME}`)) return null

  let before = ''
  try {
    before = readFileSync(fault.path, 'utf8')
  } catch {
    return null
  }

  const repaired = repairConfigText(before, fault)
  if (!repaired) return null

  try {
    writeFileSync(`${fault.path}.bak`, before)
    writeFileSync(fault.path, repaired.text)
  } catch {
    return null
  }
  return { key: repaired.key, line: repaired.line, path: fault.path }
}
