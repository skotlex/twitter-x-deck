// 확장 번들 빌드 오케스트레이터.
//   1) 출력 폴더 청소
//   2) vite    → deck.js (덱 UI. IIFE + CSS 인라인)
//   3) esbuild → interceptor.js / bridge.js / papago.js / background.js (CSS·JSX 없는 단일 IIFE)
//   4) manifest.json 과 아이콘을 출력 폴더로 복사
//
// --watch 를 주면 감시 모드로 돈다.
// --out <폴더> (또는 XDECK_OUT) 을 주면 그리로 굽는다 — scripts/out-dir.mjs 참고.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import * as esbuild from 'esbuild'
import { build as viteBuild } from 'vite'
import { insideSyncedFolder, outDirFrom, reusableOutDir } from './out-dir.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

/**
 * 사람이 고쳐 칠 수 있는 잘못은 스택 없이 한 줄로 알린다.
 *
 * 배치 파일로 두 번 눌러 실행하는 길이 있어, 창에 남는 마지막 줄이 곧 안내문이다.
 * 스택이 깔리면 정작 읽어야 할 문장이 위로 밀려 올라간다.
 */
function fail(message) {
  console.error(`[x-deck] ${message}`)
  process.exit(1)
}

const dist = (() => {
  try {
    return outDirFrom({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), root })
  } catch (err) {
    return fail(err.message)
  }
})()

/** 로그에 적을 이름. 저장소 안이면 짧게, 밖이면 절대 경로 그대로 보여준다. */
const label = relative(root, dist).startsWith('..') ? dist : `${relative(root, dist)}/`

const PLAIN_SCRIPTS = [
  { entry: 'src/injected/interceptor.ts', out: 'interceptor.js' },
  { entry: 'src/content/bridge.ts', out: 'bridge.js' },
  { entry: 'src/content/papago.ts', out: 'papago.js' },
  { entry: 'src/background/service-worker.ts', out: 'background.js' },
]


async function copyStatic() {
  await mkdir(dist, { recursive: true })

  // manifest 의 version 은 package.json 을 단일 출처로 삼아 빌드 시 주입한다.
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  manifest.version = pkg.version
  await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  await cp(resolve(root, 'rules.json'), resolve(dist, 'rules.json'))
  if (existsSync(resolve(root, 'icons'))) {
    await cp(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true })
  }

}

/** @returns {import('esbuild').BuildOptions} */
const esbuildOptions = ({ entry, out }) => ({
  entryPoints: [resolve(root, entry)],
  outfile: resolve(dist, out),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  alias: {
    '@core': resolve(root, 'src/core'),
  },
})

/**
 * 출력 폴더를 비운다.
 *
 * `--out` 은 손으로 적는 값이다. 오타 하나로 남의 폴더를 통째로 날리지 않도록,
 * 비어 있거나 우리가 구워 둔 자리일 때만 지운다.
 */
async function cleanOut() {
  if (existsSync(dist) && !reusableOutDir(await readdir(dist))) {
    fail(`${dist} 에는 이 확장의 빌드 결과가 아닌 것이 들어 있다. 빈 폴더나 지난 빌드 결과만 지운다.`)
  }
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
}

/** 동기화 폴더 안이면 알려만 준다. 재시작 뒤 확장이 사라지는 증상이 여기서 온다. */
function warnIfSynced() {
  if (!insideSyncedFolder(dist, process.env)) return
  console.log(
    `\n[x-deck] 경고: ${dist} 는 동기화 폴더 안이다.\n` +
      '         브라우저가 시작할 때 이 폴더를 못 읽어 확장을 버리는 일이 있다.\n' +
      '         --out 또는 XDECK_OUT 으로 동기화 밖에 구워 그쪽을 로드해라.',
  )
}

async function main() {
  await cleanOut()

  if (watch) {
    await viteBuild({ build: { outDir: dist, watch: {} } })
    const contexts = await Promise.all(PLAIN_SCRIPTS.map((s) => esbuild.context(esbuildOptions(s))))
    await Promise.all(contexts.map((c) => c.watch()))
    await copyStatic()
    console.log(`\n[x-deck] watch 모드로 실행 중. ${label} 를 chrome://extensions 에 로드해라.`)
    warnIfSynced()
    return
  }

  await viteBuild({ build: { outDir: dist } })
  await Promise.all(PLAIN_SCRIPTS.map((s) => esbuild.build(esbuildOptions(s))))
  await copyStatic()
  console.log(`\n[x-deck] 빌드 완료 → ${label}`)
  warnIfSynced()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
