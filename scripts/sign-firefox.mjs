// 버전을 하나 올려 Firefox 용으로 굽고, AMO 에 맡겨 서명받는다 (비공개 unlisted 채널).
//
//   npm run sign:ff     버전 올림 → 굽기 → 서명 → CHANGELOG 정리 → 커밋
//
// 굽는 것은 사용자가 이 명령으로 직접 한다. AI 는 고친 것을 CHANGELOG 의 `## [Unreleased]` 에
// 모아 둘 뿐 버전을 올리지 않는다. 버전은 이 명령이 돌 때마다 하나씩 오른다 (scripts/release.mjs).
//
//   1) package.json 의 버전을 다음 번호로 올린다
//   2) Firefox 용으로 굽는다 (build.mjs 가 그 버전을 manifest 에 주입한다)
//   3) AMO 에 맡겨 서명받고, dist-xpi/ 에는 방금 받은 xpi 하나만 남긴다
//   4) CHANGELOG 의 `## [Unreleased]` 를 `## [버전] - 오늘` 로 바꾸고
//      package.json · CHANGELOG.md 두 파일만 커밋한다
//
// 2)·3) 에서 넘어지면 package.json 을 되돌린다 — 쓰지 못한 번호를 올려 둔 채 남기지 않는다.
//
// 열쇠는 .secrets/API_Info.txt(.gitignore 로 막아 둠)에서 읽는다. 환경 변수
// WEB_EXT_API_KEY · WEB_EXT_API_SECRET 가 있으면 그쪽이 이긴다. 열쇠는 명령줄이 아니라
// 환경으로만 넘기고, 화면에 찍지 않는다.
// 굽는 자리를 --out 이나 XDECK_OUT_FIREFOX 로 옮겨 두었으면 그 자리에서 굽고 맡긴다.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outDirFrom } from './out-dir.mjs'
import { localDate, nextVersion, releaseChangelog } from './release.mjs'
import { KEY_ENV, KEY_FILE, readKeyFile, SECRET_ENV, signingEnv, signProblems, staleArtifacts } from './sign-check.mjs'
import { TARGETS } from './target.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const spec = TARGETS.firefox
const source = outDirFrom({ argv, env: process.env, cwd: process.cwd(), root, dir: spec.dir, envKey: spec.envKey })
const artifacts = resolve(root, 'dist-xpi')
const packageFile = resolve(root, 'package.json')
const changelogFile = resolve(root, 'CHANGELOG.md')

function fail(message) {
  console.error(`[x-deck] ${message}`)
  process.exit(1)
}

// 열쇠가 없으면 버전을 올리기 전에 멈춘다. 굽고 나서야 알면 그 사이 시간만 버린다.
const keyFile = resolve(root, KEY_FILE)
const env = signingEnv(process.env, existsSync(keyFile) ? readKeyFile(readFileSync(keyFile, 'utf8')) : {})
if (![KEY_ENV, SECRET_ENV].every((name) => (env[name] ?? '').trim())) {
  fail(`AMO 열쇠가 없다. ${KEY_FILE} 에 ${KEY_ENV} · ${SECRET_ENV} 를 적는다`)
}

// 1) 버전을 올린다. 넘어지면 이 글 그대로 되돌린다.
const packageText = readFileSync(packageFile, 'utf8')
const current = JSON.parse(packageText).version
let version
try {
  version = nextVersion(current)
} catch (err) {
  fail(err.message)
}
const restorePackage = () => writeFileSync(packageFile, packageText)
writeFileSync(packageFile, packageText.replace(`"version": "${current}"`, `"version": "${version}"`))
console.log(`[x-deck] 버전 ${current} → ${version}`)

function abort(message) {
  restorePackage()
  fail(`${message} — package.json 을 ${current} 로 되돌렸다`)
}

// 2) 굽는다. 셸을 거치지 않으므로 공백이 든 경로도 그대로 넘어간다.
const built = spawnSync(process.execPath, [resolve(root, 'scripts/build.mjs'), '--target', 'firefox', ...argv], {
  stdio: 'inherit',
  cwd: process.cwd(),
})
if (built.status !== 0) abort('굽지 못했다')

const readVersion = (file) => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).version ?? null) : null)
const problems = signProblems({ manifestVersion: readVersion(resolve(source, 'manifest.json')), packageVersion: version, env })
if (problems.length > 0) abort(problems.join(' / '))

// 3) 서명받는다.
console.log(`[x-deck] ${source} 를 AMO 에 맡긴다 (unlisted) → ${artifacts}`)
// Windows 의 npx 는 .cmd 라 셸을 거쳐야 뜬다. 셸에는 명령 한 줄로 넘기고, 공백이 든
// 경로(저장소 폴더 이름부터 그렇다)는 따옴표로 감싸야 한 덩어리로 넘어간다.
const quote = (path) => `"${path}"`
const command = [
  'npx --yes web-ext sign --channel unlisted',
  `--source-dir ${quote(source)}`,
  `--artifacts-dir ${quote(artifacts)}`,
].join(' ')
// 파일 시각은 시스템 시계보다 조금 뒤처져 찍히기도 한다. 이번에 받은 파일을 예전 것으로
// 잘못 세지 않게 시작 시각을 2초 앞당겨 잡는다.
const startedAt = Date.now() - 2_000
const signed = spawnSync(command, { stdio: 'inherit', shell: true, cwd: root, env })
if (signed.status !== 0) {
  abort(
    `서명받지 못했다. AMO 가 '이미 있는 버전' 이라며 거절했다면 ${version} 은 이미 쓰인 번호다 — ` +
      `package.json 을 ${version} 으로 직접 올려 두고 다시 돌린다`,
  )
}

// dist-xpi 에는 방금 받은 것만 남긴다. 새로 받은 파일이 없으면 아무것도 지우지 않는다.
const entries = existsSync(artifacts)
  ? readdirSync(artifacts, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      mtimeMs: entry.isFile() ? statSync(resolve(artifacts, entry.name)).mtimeMs : 0,
    }))
  : []
for (const name of staleArtifacts(entries, startedAt)) {
  rmSync(resolve(artifacts, name))
  console.log(`[x-deck] 예전 파일을 지웠다: ${name}`)
}

// 4) 모아둔 변경을 이번 버전으로 굳히고, 두 파일만 커밋한다. 다른 작업 중인 변경은 건드리지 않는다.
const { text: changelog, released } = releaseChangelog(readFileSync(changelogFile, 'utf8'), version, localDate())
if (released) writeFileSync(changelogFile, changelog)
else console.log('[x-deck] CHANGELOG 에 [Unreleased] 가 없어 버전만 올렸다')

const committed = spawnSync(
  'git',
  ['commit', '--quiet', '-m', `${version} 으로 구워 AMO 서명을 받는다`, '--', 'package.json', 'CHANGELOG.md'],
  { stdio: 'inherit', cwd: root },
)
if (committed.status === 0) console.log(`[x-deck] ${version} 을 커밋했다`)
else console.error('[x-deck] 커밋하지 못했다. package.json · CHANGELOG.md 를 직접 커밋한다')
