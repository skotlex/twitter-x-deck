// Firefox 빌드를 AMO 에 맡겨 서명받는다 (비공개 unlisted 채널).
//
//   npm run sign:ff     굽고 나서 서명까지 한 번에
//
// 열쇠는 .secrets/API_Info.txt(.gitignore 로 막아 둠)에서 읽는다. 환경 변수
// WEB_EXT_API_KEY · WEB_EXT_API_SECRET 가 있으면 그쪽이 이긴다. 열쇠는 명령줄이 아니라
// 환경으로만 넘기고, 화면에 찍지 않는다.
// 서명된 xpi 는 dist-xpi/ 에 떨어지고, 받은 뒤에는 그 폴더의 예전 파일을 지워 새것만 남긴다.
// 굽는 자리를 --out 이나 XDECK_OUT_FIREFOX 로 옮겨 두었으면 그 자리의 빌드를 맡긴다 —
// build.mjs 와 같은 규칙으로 찾는다.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outDirFrom } from './out-dir.mjs'
import { KEY_FILE, readKeyFile, signingEnv, signProblems, staleArtifacts } from './sign-check.mjs'
import { TARGETS } from './target.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const spec = TARGETS.firefox
const source = outDirFrom({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  root,
  dir: spec.dir,
  envKey: spec.envKey,
})
const artifacts = resolve(root, 'dist-xpi')

const readVersion = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version ?? null : null

const keyFile = resolve(root, KEY_FILE)
const env = signingEnv(process.env, existsSync(keyFile) ? readKeyFile(readFileSync(keyFile, 'utf8')) : {})

const problems = signProblems({
  manifestVersion: readVersion(resolve(source, 'manifest.json')),
  packageVersion: readVersion(resolve(root, 'package.json')),
  env,
})
if (problems.length > 0) {
  for (const problem of problems) console.error(`[x-deck] ${problem}`)
  process.exit(1)
}

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
const result = spawnSync(command, { stdio: 'inherit', shell: true, cwd: root, env })
if (result.status !== 0) process.exit(result.status ?? 1)

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
