/**
 * 브리지가 사람에게 건네는 문구.
 *
 * [host.mjs](./host.mjs) 에서 떼어 둔 이유는 하나다 — 저 파일은 표준 입출력에 붙어
 * 있어서 불러오는 것만으로 프로세스가 돌기 시작한다. 실패를 어떻게 옮겨 적는지는
 * 명령을 한 번도 띄우지 않고 잴 수 있어야 하고, 그 자리가 여기다.
 *
 * 남의 명령이 뱉은 영어를 그대로 올리면 읽는 사람이 무엇을 해야 할지 알 수 없다.
 * 짚이는 것은 우리 문장으로 바꾸고, 정말 모르는 것만 원문을 덧붙인다.
 */

/**
 * 사람에게 보여줄 것이 못 되는 줄.
 *
 * CLI 들은 stderr 로 잡소리를 많이 한다 — 진행 상황("Reading prompt from stdin..."),
 * 노드 경고, 모델 목록을 못 읽었다는 내부 로그 따위다. 그중 한 줄을 집어 그대로
 * 올려보내면 진짜 실패 이유는 가려지고 영어 잡음만 사용자 앞에 뜬다.
 */
const NOISE = [
  /reading (prompt|additional input) from stdin/i,
  /^\s*\(?node:\d+\)?/i,
  /DeprecationWarning|ExperimentalWarning/i,
  /codex_models_manager|failed to (load|refresh) models/i,
  /^\s*$/,
]

/** 잡소리를 걷어낸 줄들. */
function usefulLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !NOISE.some((pattern) => pattern.test(line)))
}

export function firstLine(text) {
  return usefulLines(text)[0] ?? ''
}

/** 마지막으로 한 말. `codex exec` 는 최종 답만 stdout 으로 내므로 대개 이 한 줄이다. */
export function lastLine(text) {
  return usefulLines(text).at(-1) ?? ''
}

/** 한 줄에 담을 만큼만. 화면 한 줄에 들어가야 읽힌다. */
function clip(text, limit = 160) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/**
 * `config.toml` 이 지금 codex 판과 안 맞는 흔한 경우.
 *
 * 값 하나가 어긋나면 codex 는 아예 뜨지 않는다. 남의 설정 파일을 말없이 고치지
 * 않는다 — 무엇을 고쳐야 하는지 그대로 올려보내고 판단은 사용자가 한다.
 */
export function configComplaint(stderr) {
  const match = /Error loading config\.toml:\s*(.+)/.exec(stderr)
  if (!match) return null
  return `~/.codex/config.toml 을 codex 가 읽지 못합니다 — ${match[1].trim()}`
}

/** 실패를 우리 말로 옮긴다. */
export function explain(kind, result) {
  const said = `${result.stdout}${result.stderr}`
  if (result.timedOut) return `${kind} 가 시간 안에 끝내지 못했습니다.`
  if (/rate limit|quota|usage limit|too many requests/i.test(said)) {
    return `${kind} 의 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.`
  }
  if (/not logged in|please run|unauthor|authentication/i.test(said)) {
    return `${kind} 로그인이 풀렸습니다. 설정에서 다시 로그인하세요.`
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|offline/i.test(said)) {
    return `${kind} 가 서버에 닿지 못했습니다. 망 연결을 확인하세요.`
  }
  const detail = firstLine(said)
  return detail ? `${kind} 가 실패했습니다 — ${detail}` : `${kind} 가 실패했습니다.`
}

/**
 * 그림 한 장 없이 멀쩡히 끝났을 때의 사정.
 *
 * **codex 의 마지막 말을 버리면 안 된다.** 그림 생성이 OpenAI 의 안전 필터에 걸리면
 * (`safety_violations`) 명령은 0 으로 끝나고 우리가 보는 것은 '새 그림이 없다' 뿐이다.
 * 왜 막혔는지는 오직 그 마지막 말에만 남아 있는데, 그것을 '다시 시도해 보세요' 로
 * 뭉개면 몇 번을 눌러도 같은 자리에 선다 — 실제로 그랬다.
 *
 * 되풀이해서 풀리는 일이 아니므로 갈 곳도 함께 적는다. 글자만 옮기기는 그림을 만들지
 * 않으니 이 벽에 걸리지 않는다.
 */
export function noImageReason(stdout) {
  const said = lastLine(stdout)
  return [
    `Codex 가 그림을 만들지 못했습니다${said ? ` — ${clip(said)}` : '.'}`,
    "번역 방식을 '글자만 옮기기' 로 바꾸면 이 사진도 옮길 수 있습니다.",
  ].join(' ')
}
