/**
 * 브리지가 실패를 어떻게 옮겨 적는지.
 *
 * 이 문구가 곧 사용자가 보는 전부다. 명령이 왜 넘어졌는지는 로그에 남지 않으므로,
 * 여기서 사정을 흘리면 그 실패는 아무 데도 기록되지 않는다.
 *
 * `.mjs` 인 것은 브리지가 빌드 없이 도는 순수 Node 코드이기 때문이다 (의존성 없음).
 */
import { describe, expect, it } from 'vitest'
import { configComplaint, explain, firstLine, lastLine, noImageReason } from '../../bridge/messages.mjs'

describe('firstLine · lastLine — 잡소리 걷어내기', () => {
  const noisy = [
    'Reading prompt from stdin...',
    '(node:1234) ExperimentalWarning: something',
    '',
    '진짜 첫 줄',
    'codex_models_manager: failed to load models',
    '진짜 마지막 줄',
  ].join('\n')

  it('진행 안내·노드 경고·내부 로그는 건너뛴다', () => {
    expect(firstLine(noisy)).toBe('진짜 첫 줄')
    expect(lastLine(noisy)).toBe('진짜 마지막 줄')
  })

  it('쓸 줄이 없으면 빈 문자열이다', () => {
    expect(firstLine('\n\n')).toBe('')
    expect(lastLine(undefined)).toBe('')
  })
})

describe('noImageReason — 그림 없이 멀쩡히 끝났을 때', () => {
  /**
   * OpenAI 의 안전 필터가 그림 생성을 거부하면 codex 는 0 으로 끝나고, 왜 막혔는지는
   * 마지막 말에만 남는다. 그것을 버리고 '다시 시도해 보세요' 로 뭉개면 몇 번을 눌러도
   * 같은 자리에 선다 — 실제로 그랬다.
   */
  it('codex 가 남긴 사정을 그대로 옮긴다', () => {
    const said = '이미지 생성이 안전 시스템에 의해 차단되어 결과가 생성되지 않았습니다.'
    const message = noImageReason(`Reading prompt from stdin...\n${said}\n`)

    expect(message).toContain(said)
    // 되풀이해서 풀리는 일이 아니므로 갈 곳을 함께 적는다.
    expect(message).toContain('글자만 옮기기')
    expect(message).not.toContain('다시 시도')
  })

  it('아무 말도 없으면 갈 곳만 적는다', () => {
    const message = noImageReason('')
    expect(message).toContain('그림을 만들지 못했습니다')
    expect(message).toContain('글자만 옮기기')
    expect(message).not.toContain('—')
  })

  it('길게 늘어놓은 말은 한 줄에 담길 만큼만 자른다', () => {
    const message = noImageReason('가'.repeat(500))
    expect(message.length).toBeLessThan(260)
    expect(message).toContain('…')
  })

  it('여러 줄로 말했으면 마지막 말을 집는다', () => {
    // codex 는 `exec` 에서 최종 답만 stdout 으로 내지만, 판에 따라 앞에 진행 줄이 붙는다.
    const message = noImageReason('작업을 시작합니다\n그림 생성이 거부되었습니다')
    expect(message).toContain('그림 생성이 거부되었습니다')
    expect(message).not.toContain('작업을 시작합니다')
  })
})

describe('explain — 넘어진 명령의 사정', () => {
  const result = (patch) => ({ stdout: '', stderr: '', code: 1, timedOut: false, ...patch })

  it('시간 초과·사용량 한도·로그인 풀림을 우리 말로 바꾼다', () => {
    expect(explain('Codex', result({ timedOut: true }))).toContain('시간 안에')
    expect(explain('Codex', result({ stderr: 'Error: rate limit exceeded' }))).toContain('사용량 한도')
    expect(explain('Claude', result({ stderr: 'not logged in' }))).toContain('로그인')
  })

  it('짚이는 것이 없으면 원문 한 줄을 덧붙인다', () => {
    expect(explain('Codex', result({ stderr: 'weird failure 42' }))).toBe(
      'Codex 가 실패했습니다 — weird failure 42',
    )
  })
})

describe('configComplaint — codex 설정이 안 맞을 때', () => {
  it('무엇이 문제인지 그대로 올려보낸다', () => {
    const said = 'Error loading config.toml: invalid value for key `model_reasoning_effort`'
    expect(configComplaint(said)).toContain('invalid value for key `model_reasoning_effort`')
  })

  it('그 사정이 아니면 null 이다', () => {
    expect(configComplaint('그냥 다른 오류')).toBeNull()
  })
})
