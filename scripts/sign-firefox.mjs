// Firefox 빌드를 AMO 에 맡겨 서명받는다 (비공개 unlisted 채널).
//
//   npm run sign:ff     굽고 나서 서명까지 한 번에
//
// 열쇠는 환경 변수 WEB_EXT_API_KEY · WEB_EXT_API_SECRET 로 받는다. 저장소에 두지 않는다.
// 서명된 xpi 는 dist-xpi/ 에 떨어진다. 굽는 자리를 --out 이나 XDECK_OUT_FIREFOX 로
// 옮겨 두었으면 그 자리의 빌드를 맡긴다 — build.mjs 와 같은 규칙으로 찾는다.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outDirFrom } from './out-dir.mjs'
import { signProblems } from './sign-check.mjs'
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

const problems = signProblems({
  manifestVersion: readVersion(resolve(source, 'manifest.json')),
  packageVersion: readVersion(resolve(root, 'package.json')),
  env: process.env,
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
const result = spawnSync(command, { stdio: 'inherit', shell: true, cwd: root })
process.exit(result.status ?? 1)
