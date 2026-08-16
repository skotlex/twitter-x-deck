/**
 * 이미지 번역 브리지 — 네이티브 메시징 호스트.
 *
 * 확장은 파일도 프로세스도 만질 수 없다. 그런데 우리가 쓰려는 것은 이 PC 에 깔린
 * `codex` · `claude` 명령이고, 그 둘은 구독 계정으로 로그인되어 있다 — 별도 API 키가
 * 아니라 사용자가 이미 내고 있는 요금제를 그대로 쓴다. 그 사이를 잇는 것이 이 파일이다.
 *
 * **사용자가 직접 띄우지 않는다.** 브라우저가 확장의 부름을 받아 이 프로그램을 켜고,
 * 연결이 끊기면 함께 내린다. 터미널을 열어둘 이유도, 포트를 맞출 이유도 없다.
 *
 * 말은 표준 입출력으로 오간다 — 4바이트 길이(리틀엔디언) 뒤에 UTF-8 JSON 한 덩이.
 * 그래서 이 파일은 **stdout 에 아무 것도 함부로 찍으면 안 된다.** 로그 한 줄이 곧
 * 깨진 프레임이 된다. 할 말이 있으면 stderr 로 보낸다.
 *
 * 로그인도 여기서 한다. `codex login` 은 브라우저를 열어 사람이 직접 마치는 절차라
 * 확장 안에서는 시작조차 할 수 없다. 콘솔 창을 하나 띄워주고, 확장은 끝났는지를
 * 다시 물어보는 것까지만 한다.
 *
 * 의존성은 없다. Node 18 이상이면 그대로 돈다.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 한 덩이로 보낼 수 있는 크기.
 *
 * 브라우저는 호스트가 보내는 메시지를 1MB 로 끊는다. 다시 그린 그림은 그보다 크므로
 * (2MB 안팎) 답을 잘라 여러 덩이로 보낸다. 넘길 때 여유를 두는 이유는 프레임에 붙는
 * 껍데기(id·순번 따위)도 같은 한도 안에 들어가야 하기 때문이다.
 */
const CHUNK_LIMIT = 512 * 1024

/** 한 번의 번역에 허용하는 시간. 이미지 재생성은 1분을 넘기기도 한다. */
const TRANSLATE_TIMEOUT_MS = 300_000

/** 로그인 여부를 묻는 짧은 호출. 답이 오래 걸릴 이유가 없다. */
const PROBE_TIMEOUT_MS = 60_000

/** 상태를 매번 다시 재지 않는다. 확장이 설정 화면을 여닫을 때마다 CLI 를 띄우면 느리다. */
const STATUS_CACHE_MS = 30_000

/**
 * 누가 부를 수 있는지는 이제 우리가 가리지 않는다.
 *
 * 예전에는 localhost 에 서버를 열어두고 헤더로 걸렀다. 지금은 브라우저가 이 프로그램을
 * 직접 켜고 표준 입출력으로만 말을 건다 — 등록해 둔 확장(`allowed_origins`)이 아니면
 * 애초에 켜지지도 않으므로, 통로 자체가 하나뿐이다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 명령 실행
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 명령 하나를 끝까지 돌리고 결과를 모은다.
 *
 * 윈도우에서 `codex` · `claude` 는 npm 이 깔아둔 셸 스크립트라 셸을 거쳐야 찾는다.
 * 인자에 사용자가 넣은 값은 없다 — 프롬프트는 상수이고 경로는 우리가 만든다.
 */
function run(command, args, timeoutMs, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      windowsHide: true,
    })

    // 긴 글월은 인자가 아니라 여기로 넘긴다. 윈도우에서는 셸을 거쳐야 명령을 찾는데,
    // 줄바꿈과 따옴표가 든 글을 인자에 실으면 그 셸의 따옴표 규칙에 걸려 조각난다 —
    // 그러면 codex 는 프롬프트를 못 찾고 stdin 을 보다가 비어 있다고 답한다.
    // 줄 것이 없을 때도 닫아야 한다. 열어두면 더 올 줄 알고 기다린다.
    if (typeof input === 'string') child.stdin?.write(input)
    child.stdin?.end()

    let stdout = ''
    let stderr = ''
    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill()
      resolve({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    const finish = (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut: false })
    }

    child.on('error', (error) => {
      stderr += String(error?.message ?? error)
      finish(null)
    })
    child.on('close', finish)
  })
}

/**
 * `config.toml` 이 지금 codex 판과 안 맞는 흔한 경우.
 *
 * 값 하나가 어긋나면 codex 는 아예 뜨지 않는다. 남의 설정 파일을 말없이 고치지
 * 않는다 — 무엇을 고쳐야 하는지 그대로 올려보내고 판단은 사용자가 한다.
 */
function configComplaint(stderr) {
  const match = /Error loading config\.toml:\s*(.+)/.exec(stderr)
  if (!match) return null
  return `~/.codex/config.toml 을 codex 가 읽지 못합니다 — ${match[1].trim()}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 로그인 상태
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 자격증명 파일을 뜯어보지 않는다.
 *
 * 파일의 모양은 판이 바뀌면 함께 바뀌고, 비밀값을 우리가 만질 이유도 없다.
 * 짧은 명령을 한 번 시켜보고 답이 오면 로그인된 것이다 — 판이 바뀌어도 이 판정은
 * 그대로 맞는다.
 */
/**
 * `codex login status` 하나면 끝난다.
 *
 * 예전에는 에이전트를 통째로 한 번 돌려보고 그 출력에서 로그인 여부를 짐작했다.
 * 두 가지가 나빴다 — 그 출력에는 모델 목록이 통째로 섞여 나와 정규식이 엉뚱한 데
 * 걸렸고(로그인돼 있는데도 아니라고 답했다), 무엇보다 **설정 화면을 열 때마다 진짜
 * 모델 호출이 나가 구독 사용량을 태웠다.** 묻기만 하는 명령으로 바꾼다.
 */
async function probeCodex() {
  const result = await run('codex', ['login', 'status'], PROBE_TIMEOUT_MS)
  const said = `${result.stdout}${result.stderr}`

  if (result.code === null && /ENOENT|not recognized|command not found/i.test(result.stderr)) {
    return { installed: false, loggedIn: false, note: 'codex 명령을 찾지 못했습니다.' }
  }

  const complaint = configComplaint(result.stderr)
  if (complaint) return { installed: true, loggedIn: false, note: complaint }

  if (result.timedOut) {
    return { installed: true, loggedIn: false, note: 'codex 가 시간 안에 답하지 않았습니다.' }
  }
  if (result.code === 0 && /logged in/i.test(said)) return { installed: true, loggedIn: true }
  return {
    installed: true,
    loggedIn: false,
    note: firstLine(said) || '로그인이 필요합니다.',
  }
}

async function probeClaude() {
  const result = await run(
    'claude',
    ['-p', '"reply with OK and nothing else"', '--output-format', 'json'],
    PROBE_TIMEOUT_MS,
  )

  if (result.code === null && /ENOENT|not recognized|command not found/i.test(result.stderr)) {
    return { installed: false, loggedIn: false, note: 'claude 명령을 찾지 못했습니다.' }
  }
  if (result.timedOut) {
    return { installed: true, loggedIn: false, note: 'claude 가 시간 안에 답하지 않았습니다.' }
  }
  if (/login|unauthor|not authenticated/i.test(result.stderr)) {
    return { installed: true, loggedIn: false, note: '로그인이 필요합니다.' }
  }
  if (result.code !== 0) {
    return { installed: true, loggedIn: false, note: firstLine(result.stderr) || '실행에 실패했습니다.' }
  }
  return { installed: true, loggedIn: true }
}

/**
 * 사람에게 보여줄 만한 줄만 골라낸다.
 *
 * CLI 들은 stderr 로 잡소리를 많이 한다 — 진행 상황("Reading prompt from stdin..."),
 * 노드 경고, 모델 목록을 못 읽었다는 내부 로그 따위다. 그중 첫 줄을 집어 그대로
 * 올려보내면 진짜 실패 이유는 가려지고 영어 잡음만 사용자 앞에 뜬다.
 */
const NOISE = [
  /reading (prompt|additional input) from stdin/i,
  /^\s*\(?node:\d+\)?/i,
  /DeprecationWarning|ExperimentalWarning/i,
  /codex_models_manager|failed to (load|refresh) models/i,
  /^\s*$/,
]

function firstLine(text) {
  return (
    String(text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !NOISE.some((pattern) => pattern.test(line))) ?? ''
  )
}

/**
 * 실패를 우리 말로 옮긴다.
 *
 * 남의 명령이 뱉은 영어를 그대로 올리면 읽는 사람이 무엇을 해야 할지 알 수 없다.
 * 짚이는 것은 우리 문장으로 바꾸고, 정말 모르는 것만 원문을 덧붙인다.
 */
function explain(kind, result) {
  const said = `${result.stdout}${result.stderr}`
  if (result.timedOut) return `${kind} 가 시간 안에 끝내지 못했습니다.`
  if (/rate limit|quota|usage limit|too many requests/i.test(said)) {
    return `${kind} 의 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.`
  }
  if (/not logged in|please run|unauthor|authentication/i.test(said)) {
    return `${kind} 로그인이 풀렸습니다. 설정에서 다시 로그인하세요.`
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|offline/i.test(said)) {
    return `${kind} 가 서버에 닿지 못했습니다. 網 연결을 확인하세요.`.replace('網', '망')
  }
  const detail = firstLine(said)
  return detail ? `${kind} 가 실패했습니다 — ${detail}` : `${kind} 가 실패했습니다.`
}

let statusCache = { at: 0, value: null }

async function readStatus(force) {
  if (!force && statusCache.value && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.value
  }
  const [codex, claude] = await Promise.all([probeCodex(), probeClaude()])
  const value = { codex, claude }
  statusCache = { at: Date.now(), value }
  return value
}

/**
 * 로그인 절차를 사람 앞에 띄운다.
 *
 * 브라우저를 열고 사람이 마쳐야 하는 일이라 우리가 대신 끝낼 수 없다. 창을 띄우는
 * 데까지만 하고, 끝났는지는 확장이 상태를 다시 물어 확인한다.
 */
function startLogin(engine) {
  const command = engine === 'codex' ? 'codex login' : 'claude /login'
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', 'cmd', '/k', command], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell app "Terminal" to do script "${command}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
    return true
  }
  spawn('x-terminal-emulator', ['-e', command], { detached: true, stdio: 'ignore' }).unref()
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 번역
// ─────────────────────────────────────────────────────────────────────────────

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex')
const GENERATED = join(CODEX_HOME, 'generated_images')

/** 번역 직전의 산출물 목록. 새로 생긴 파일을 이 차이로 가려낸다. */
function snapshotGenerated() {
  const seen = new Set()
  let entries = []
  try {
    entries = readdirSync(GENERATED, { withFileTypes: true })
  } catch {
    return seen
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(GENERATED, entry.name)
    try {
      for (const file of readdirSync(dir)) seen.add(join(dir, file))
    } catch {
      // 도중에 사라진 폴더. 무시한다.
    }
  }
  return seen
}

/**
 * 새로 생긴 그림 파일 하나를 찾는다.
 *
 * codex 가 최종 메시지로 알려주는 경로는 믿을 수 없다 — 치환되지 않은 `_image_id_.png`
 * 가 그대로 오는 것을 확인했다. 실제로 디스크에 무엇이 늘었는지로만 가린다.
 * 그래서 번역은 한 번에 하나씩만 돌린다 (아래 `queue`).
 */
function findNewImage(before) {
  const after = snapshotGenerated()
  let newest = null
  for (const path of after) {
    if (before.has(path)) continue
    if (!/\.(png|jpe?g|webp)$/i.test(path)) continue
    try {
      const at = statSync(path).mtimeMs
      if (!newest || at > newest.at) newest = { path, at }
    } catch {
      // 방금 사라졌다. 무시한다.
    }
  }
  return newest?.path ?? null
}

const CODEX_PROMPT = [
  'Use case: text-localization',
  'Input images: Image 1: edit target',
  'Primary request: Translate every visible Japanese or English text in the image into natural Korean, and redraw the image with the Korean text in place of the original text.',
  'Constraints: change ONLY the text. Keep the artwork, character, layout, colours, framing and the ORIGINAL ASPECT RATIO exactly as they are. Vertical Japanese writing must stay vertical Korean text, read right column first and top to bottom. Match the original typography, weight, colour and glow/outline effects. Leave logos, brand marks and Latin proper nouns untouched unless they have an official Korean form.',
  'Avoid: re-cropping, re-framing, changing the aspect ratio, adding or removing any element, watermarks.',
  '',
  'Do not ask any follow-up question. Produce exactly one image.',
].join('\n')

async function translateWithCodex(imagePath) {
  const before = snapshotGenerated()
  const result = await run(
    'codex',
    ['exec', '--skip-git-repo-check', '-s', 'read-only', '-i', `"${imagePath}"`],
    TRANSLATE_TIMEOUT_MS,
    CODEX_PROMPT,
  )

  const complaint = configComplaint(result.stderr)
  if (complaint) throw new Error(complaint)

  const produced = findNewImage(before)
  if (!produced) {
    // 그림이 안 나온 것과 명령이 넘어진 것은 원인이 다르다. 넘어졌으면 그 사정을 옮겨준다.
    if (result.timedOut || result.code !== 0) throw new Error(explain('Codex', result))
    throw new Error('Codex 가 번역된 이미지를 만들지 못했습니다. 다시 시도해 보세요.')
  }

  const bytes = readFileSync(produced)
  const type = produced.toLowerCase().endsWith('.webp')
    ? 'image/webp'
    : /\.jpe?g$/i.test(produced)
      ? 'image/jpeg'
      : 'image/png'
  return {
    kind: 'image',
    dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
    engine: 'codex',
  }
}

const CLAUDE_PROMPT = (imagePath) =>
  [
    `Read the image at ${imagePath}.`,
    'Extract every piece of visible text, then translate each into natural Korean.',
    'Japanese vertical writing (縦書き) reads top-to-bottom, right column first — follow that order.',
    'For speech bubbles, order them right-to-left, top-to-bottom.',
    'Reply with ONLY a JSON array, no prose and no code fence:',
    '[{"source":"<original text>","korean":"<Korean translation>"}]',
    'If the image has no text at all, reply with [].',
  ].join('\n')

async function translateWithClaude(imagePath) {
  const result = await run(
    'claude',
    ['-p', '--output-format', 'json', '--allowed-tools', 'Read'],
    TRANSLATE_TIMEOUT_MS,
    CLAUDE_PROMPT(imagePath),
  )

  if (result.timedOut || result.code !== 0) throw new Error(explain('Claude', result))

  // 바깥은 claude 가 씌운 봉투다. 우리가 부탁한 답은 그 안의 `result` 문자열에 있다.
  let inner = result.stdout
  try {
    const envelope = JSON.parse(result.stdout)
    if (typeof envelope?.result === 'string') inner = envelope.result
  } catch {
    // 봉투가 아니면 통째로 본다.
  }

  const items = parsePairs(inner)
  if (!items) throw new Error('Claude 의 답을 읽지 못했습니다. 다시 시도해 보세요.')
  return { kind: 'text', items, engine: 'claude' }
}

/** 답에서 배열만 건져낸다. 코드 울타리나 앞뒤 설명이 섞여 와도 견딘다. */
function parsePairs(text) {
  const candidates = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) candidates.push(fenced[1])
  const bare = /\[[\s\S]*\]/.exec(text)
  if (bare?.[0]) candidates.push(bare[0])
  candidates.push(text)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim())
      if (!Array.isArray(parsed)) continue
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          source: String(item.source ?? ''),
          korean: String(item.korean ?? ''),
        }))
        .filter((item) => item.source.length > 0 || item.korean.length > 0)
    } catch {
      // 다음 후보로.
    }
  }
  return null
}

/**
 * 번역은 한 번에 하나만.
 *
 * codex 결과는 '무엇이 새로 생겼는지' 로 찾는다. 둘이 동시에 돌면 서로의 결과를
 * 집어간다. 남의 서버를 여러 개 동시에 두드리지 않는 기존 방침과도 같은 결이다.
 */
let queue = Promise.resolve()

function enqueue(task) {
  const next = queue.then(task, task)
  // 실패가 줄을 끊지 않게 한다.
  queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function downloadImage(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('https 주소만 받습니다.')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`이미지를 받아오지 못했습니다 (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const dir = join(tmpdir(), 'xdeck-image-translate')
  mkdirSync(dir, { recursive: true })
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.png`
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

async function translate(engine, imageUrl) {
  const path = await downloadImage(imageUrl)
  try {
    return engine === 'claude' ? await translateWithClaude(path) : await translateWithCodex(path)
  } finally {
    try {
      rmSync(path, { force: true })
    } catch {
      // 지우지 못해도 번역 결과에는 영향이 없다.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 표준 입출력
// ─────────────────────────────────────────────────────────────────────────────

/** 한 덩이를 내보낸다. 길이(4바이트 리틀엔디언)를 앞에 붙이는 것이 이 통로의 약속이다. */
function writeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([header, body]))
}

/**
 * 답 하나를 보낸다. 크면 잘라서 여러 덩이로 나간다.
 *
 * 브라우저가 한 덩이를 1MB 로 끊으므로 다시 그린 그림은 통째로 보낼 수 없다.
 * 받는 쪽은 `seq` 를 세어 `total` 만큼 모은 뒤 이어 붙여 원래 글로 되돌린다.
 * 대부분의 답은 한 덩이로 끝나지만 셈하는 방식은 똑같이 둔다 — 예외를 만들면
 * 그 예외에서만 어긋난다.
 */
function reply(id, value) {
  const text = JSON.stringify(value)
  const total = Math.max(1, Math.ceil(text.length / CHUNK_LIMIT))
  for (let seq = 0; seq < total; seq += 1) {
    writeFrame({ id, seq, total, body: text.slice(seq * CHUNK_LIMIT, (seq + 1) * CHUNK_LIMIT) })
  }
}

async function handle(message) {
  const { id, type } = message
  if (typeof id !== 'string') return

  try {
    if (type === 'status') {
      reply(id, { ok: true, engines: await readStatus(message.force === true) })
      return
    }

    if (type === 'login') {
      const engine = message.engine === 'claude' ? 'claude' : 'codex'
      startLogin(engine)
      // 다음에 물으면 다시 재게 한다. 방금 로그인을 마쳤을 수 있다.
      statusCache = { at: 0, value: null }
      reply(id, { ok: true, engine })
      return
    }

    if (type === 'translate') {
      if (typeof message.imageUrl !== 'string') {
        reply(id, { error: '이미지 주소가 없습니다.' })
        return
      }
      const engine = message.engine === 'claude' ? 'claude' : 'codex'
      reply(id, { ok: true, ...(await enqueue(() => translate(engine, message.imageUrl))) })
      return
    }

    reply(id, { error: `모르는 요청입니다: ${String(type)}` })
  } catch (cause) {
    reply(id, { error: cause instanceof Error ? cause.message : String(cause) })
  }
}

/**
 * 들어오는 덩이를 모아 읽는다.
 *
 * 표준 입력은 흐름이라 한 번에 한 덩이씩 얌전히 오지 않는다. 길이만큼 모이면 그만큼
 * 잘라 처리하고 나머지는 다음 것으로 남긴다.
 */
let inbox = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  inbox = Buffer.concat([inbox, chunk])
  for (;;) {
    if (inbox.length < 4) return
    const size = inbox.readUInt32LE(0)
    if (inbox.length < 4 + size) return
    const body = inbox.subarray(4, 4 + size)
    inbox = inbox.subarray(4 + size)
    try {
      void handle(JSON.parse(body.toString('utf8')))
    } catch {
      // 읽지 못한 덩이는 버린다. 짝이 될 id 를 모르니 답할 자리도 없다.
    }
  }
})

// 브라우저가 연결을 끊으면 우리도 물러난다. 남아 도는 프로세스를 만들지 않는다.
process.stdin.on('end', () => process.exit(0))
