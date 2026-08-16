/**
 * 이미지 번역 브리지.
 *
 * 확장은 파일도 프로세스도 만질 수 없다. 그런데 우리가 쓰려는 것은 이 PC 에 깔린
 * `codex` · `claude` 명령이고, 그 둘은 구독 계정으로 로그인되어 있다 — 별도 API 키가
 * 아니라 사용자가 이미 내고 있는 요금제를 그대로 쓴다. 그래서 확장과 명령 사이를
 * 잇는 작은 서버가 하나 필요하다. 이 파일이 그것이다.
 *
 * 로그인도 여기서 한다. `codex login` 은 브라우저를 열어 사람이 직접 마치는 절차라
 * 확장 안에서는 시작조차 할 수 없다. 브리지가 콘솔 창을 하나 띄워주고, 확장은
 * 상태를 다시 물어보는 것까지만 한다.
 *
 * 의존성은 없다. Node 18 이상이면 그대로 돈다.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 처음 시도할 포트와, 막혔을 때 훑어볼 개수.
 *
 * 확장은 이 범위를 차례로 두드려 우리를 찾는다. 그래서 여기 값이 바뀌면
 * `src/background/service-worker.ts` 의 같은 값도 함께 바뀌어야 한다.
 */
const PORT_BASE = Number(process.env.XDECK_BRIDGE_PORT ?? 8765)
const PORT_TRIES = 16

/** 우리라는 표시. 확장이 이 값을 보고 같은 포트에 있는 남의 서버와 가려낸다. */
const SERVICE = 'x-deck-bridge'

/** 한 번의 번역에 허용하는 시간. 이미지 재생성은 1분을 넘기기도 한다. */
const TRANSLATE_TIMEOUT_MS = 300_000

/** 로그인 여부를 묻는 짧은 호출. 답이 오래 걸릴 이유가 없다. */
const PROBE_TIMEOUT_MS = 60_000

/** 상태를 매번 다시 재지 않는다. 확장이 설정 화면을 여닫을 때마다 CLI 를 띄우면 느리다. */
const STATUS_CACHE_MS = 30_000

/**
 * 부르는 쪽이 우리 확장이 맞는지 가린다.
 *
 * 열쇠를 주고받지 않는다. 웹페이지는 이 헤더를 붙이려는 순간 브라우저가 먼저
 * 예비 요청(preflight)을 보내는데, 우리는 그것을 허락하지 않으므로 본 요청 자체가
 * 나가지 못한다. 확장은 호스트 권한이 있어 그 검사를 거치지 않는다.
 *
 * 그래서 막아야 할 것(다른 웹사이트)은 막히고, 사용자는 아무것도 붙여넣지 않아도 된다.
 * 이 PC 에서 도는 프로그램은 무엇이든 흉내 낼 수 있지만, 그건 열쇠를 파일에 두던
 * 예전 방식도 마찬가지였다 — 그 파일을 읽으면 그만이었다.
 */
function fromOurExtension(req) {
  if (req.headers['x-deck-bridge'] !== '1') return false
  // 웹페이지가 보낸 것은 받지 않는다. 확장 워커의 요청에는 사이트 출처가 붙지 않는다.
  const origin = req.headers.origin
  if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 명령 실행
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 명령 하나를 끝까지 돌리고 결과를 모은다.
 *
 * 윈도우에서 `codex` · `claude` 는 npm 이 깔아둔 셸 스크립트라 셸을 거쳐야 찾는다.
 * 인자에 사용자가 넣은 값은 없다 — 프롬프트는 상수이고 경로는 우리가 만든다.
 */
function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      windowsHide: true,
    })

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
async function probeCodex() {
  const result = await run(
    'codex',
    ['exec', '--skip-git-repo-check', '-s', 'read-only', '"reply with OK and nothing else"'],
    PROBE_TIMEOUT_MS,
  )

  if (result.code === null && /ENOENT|not recognized|command not found/i.test(result.stderr)) {
    return { installed: false, loggedIn: false, note: 'codex 명령을 찾지 못했습니다.' }
  }

  const complaint = configComplaint(result.stderr)
  if (complaint) return { installed: true, loggedIn: false, note: complaint }

  if (result.timedOut) {
    return { installed: true, loggedIn: false, note: 'codex 가 시간 안에 답하지 않았습니다.' }
  }
  if (/not logged in|please (run )?(`)?codex login|unauthor/i.test(result.stderr + result.stdout)) {
    return { installed: true, loggedIn: false, note: '로그인이 필요합니다.' }
  }
  if (result.code !== 0) {
    return { installed: true, loggedIn: false, note: firstLine(result.stderr) || '실행에 실패했습니다.' }
  }
  return { installed: true, loggedIn: true }
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

function firstLine(text) {
  return String(text ?? '').split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
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
    [
      'exec',
      '--skip-git-repo-check',
      '-s',
      'read-only',
      '-i',
      JSON.stringify(imagePath),
      JSON.stringify(CODEX_PROMPT),
    ],
    TRANSLATE_TIMEOUT_MS,
  )

  const complaint = configComplaint(result.stderr)
  if (complaint) throw new Error(complaint)
  if (result.timedOut) throw new Error('codex 가 시간 안에 끝내지 못했습니다.')

  const produced = findNewImage(before)
  if (!produced) {
    throw new Error(firstLine(result.stderr) || '번역된 이미지가 생성되지 않았습니다.')
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
    [
      '-p',
      JSON.stringify(CLAUDE_PROMPT(imagePath)),
      '--output-format',
      'json',
      '--allowed-tools',
      'Read',
    ],
    TRANSLATE_TIMEOUT_MS,
  )

  if (result.timedOut) throw new Error('claude 가 시간 안에 끝내지 못했습니다.')
  if (result.code !== 0) {
    throw new Error(firstLine(result.stderr) || 'claude 실행에 실패했습니다.')
  }

  // 바깥은 claude 가 씌운 봉투다. 우리가 부탁한 답은 그 안의 `result` 문자열에 있다.
  let inner = result.stdout
  try {
    const envelope = JSON.parse(result.stdout)
    if (typeof envelope?.result === 'string') inner = envelope.result
  } catch {
    // 봉투가 아니면 통째로 본다.
  }

  const items = parsePairs(inner)
  if (!items) throw new Error('번역 결과를 읽지 못했습니다.')
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
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 응답에 CORS 허가를 붙이지 않는다.
 *
 * 허가를 내주지 않으면 브라우저는 웹페이지가 받은 답을 읽지 못하게 막는다.
 * 우리를 부르는 확장 워커는 호스트 권한으로 오므로 그 허가가 필요 없다.
 */
function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      // 주소만 오간다. 그보다 크면 우리 것이 아니다.
      if (raw.length > 64_000) reject(new Error('요청이 너무 큽니다.'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('본문을 읽지 못했습니다.'))
      }
    })
    req.on('error', reject)
  })
}

const server = createServer((req, res) => {
  void (async () => {
    // 예비 요청에 아무 허가도 내주지 않는다. 웹페이지의 본 요청은 여기서 끝난다.
    if (req.method === 'OPTIONS') return send(res, 403, { error: '허용하지 않습니다.' })

    if (!fromOurExtension(req)) {
      return send(res, 403, { error: '이 브리지는 X Deck 확장만 부를 수 있습니다.' })
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    try {
      // 포트를 훑는 확장이 가장 먼저 두드리는 자리. 아무 일도 하지 않고 곧바로 답한다 —
      // `/status` 는 CLI 를 실제로 돌려보므로 찾기용으로 쓰면 한참 걸린다.
      if (url.pathname === '/hello') {
        return send(res, 200, { service: SERVICE })
      }

      if (url.pathname === '/status') {
        const engines = await readStatus(url.searchParams.get('force') === '1')
        // `service` 는 우리라는 표시다. 확장이 포트를 훑을 때 이 값으로 가려낸다.
        return send(res, 200, { ok: true, service: SERVICE, engines })
      }

      if (url.pathname === '/login' && req.method === 'POST') {
        const body = await readBody(req)
        const engine = body.engine === 'claude' ? 'claude' : 'codex'
        startLogin(engine)
        statusCache = { at: 0, value: null }
        return send(res, 200, { ok: true, engine })
      }

      if (url.pathname === '/translate' && req.method === 'POST') {
        const body = await readBody(req)
        if (typeof body.imageUrl !== 'string') {
          return send(res, 400, { error: '이미지 주소가 없습니다.' })
        }
        const engine = body.engine === 'claude' ? 'claude' : 'codex'
        const result = await enqueue(() => translate(engine, body.imageUrl))
        return send(res, 200, { ok: true, ...result })
      }

      return send(res, 404, { error: '없는 자리입니다.' })
    } catch (cause) {
      return send(res, 500, { error: cause instanceof Error ? cause.message : String(cause) })
    }
  })()
})

/**
 * 빈 포트를 찾아 자리를 잡는다.
 *
 * 8765 가 늘 비어 있으리라는 보장이 없다. 다른 프로그램이 쓰고 있을 수도 있고,
 * 윈도우에서는 시스템이 미리 잡아둔 구간(Hyper-V 등)이라 아예 묶을 수 없기도 하다.
 * 이유를 가리지 않고 실패하면 다음 번호로 넘어간다 — 확장도 같은 범위를 훑으므로
 * 어느 자리에 앉든 찾아온다.
 */
let attempt = 0

/**
 * 알림은 여기 한 곳에만 건다.
 *
 * `server.listen(port, host, cb)` 는 부를 때마다 cb 를 'listening' 에 하나씩 쌓는데,
 * 실패한 시도의 cb 는 발화하지 못한 채 남아 있다가 다음 시도가 성공하는 순간 함께
 * 터진다 — 자리를 옮겨 앉고도 예전 번호를 같이 찍는다. 걸어두는 자리를 밖으로 빼고
 * 실제로 묶인 번호를 서버에게 물어 답이 하나만 나오게 한다.
 */
server.on('listening', () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : PORT_BASE
  console.log('')
  console.log('  X Deck 이미지 번역 브리지가 떴습니다.')
  console.log(`  주소   http://127.0.0.1:${port}`)
  if (port !== PORT_BASE) {
    console.log(`         (${PORT_BASE} 이 비어 있지 않아 ${port} 로 잡았습니다)`)
  }
  console.log('')
  console.log('  덱의 설정 › 번역 을 켜면 알아서 찾아옵니다. 붙여넣을 것은 없습니다.')
  console.log('')
})

server.on('error', (error) => {
  const code = error?.code
  if ((code === 'EADDRINUSE' || code === 'EACCES') && attempt + 1 < PORT_TRIES) {
    attempt += 1
    bind()
    return
  }
  if (code === 'EADDRINUSE' || code === 'EACCES') {
    console.error(
      `\n  ${PORT_BASE} 부터 ${PORT_BASE + PORT_TRIES - 1} 까지 빈 포트가 없습니다.\n` +
        '  XDECK_BRIDGE_PORT 로 다른 시작 번호를 지정해 다시 띄우세요.\n',
    )
  } else {
    console.error(`\n  브리지를 띄우지 못했습니다: ${error?.message ?? error}\n`)
  }
  process.exit(1)
})

// 127.0.0.1 에만 묶는다. 같은 망의 다른 기기가 들어올 자리를 만들지 않는다.
function bind() {
  server.listen(PORT_BASE + attempt, '127.0.0.1')
}

bind()
