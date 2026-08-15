// 확장 번들 빌드 오케스트레이터.
//   1) dist 청소
//   2) vite    → deck.js (덱 UI. IIFE + CSS 인라인)
//   3) esbuild → interceptor.js / bridge.js / papago.js / background.js (CSS·JSX 없는 단일 IIFE)
//   4) manifest.json 과 아이콘을 dist 로 복사
//
// --watch 를 주면 감시 모드로 돈다.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as esbuild from 'esbuild'
import { build as viteBuild } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const watch = process.argv.includes('--watch')

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

async function main() {
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })

  if (watch) {
    await viteBuild({ build: { watch: {} } })
    const contexts = await Promise.all(PLAIN_SCRIPTS.map((s) => esbuild.context(esbuildOptions(s))))
    await Promise.all(contexts.map((c) => c.watch()))
    await copyStatic()
    console.log('\n[x-deck] watch 모드로 실행 중. dist/ 를 chrome://extensions 에 로드해라.')
    return
  }

  await viteBuild()
  await Promise.all(PLAIN_SCRIPTS.map((s) => esbuild.build(esbuildOptions(s))))
  await copyStatic()
  console.log('\n[x-deck] 빌드 완료 → dist/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
