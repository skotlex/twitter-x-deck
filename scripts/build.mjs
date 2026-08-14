// 확장 번들 빌드 오케스트레이터.
//   1) vite   → deck.html(React) + background.js(ESM 서비스 워커)
//   2) esbuild → interceptor.js / bridge.js (content script 는 ESM 불가 → IIFE 단일 파일)
//   3) manifest.json, rules.json, 아이콘을 dist 로 복사
//
// --watch 를 주면 2·3 을 감시 모드로 돌리고 vite 도 watch 빌드로 띄운다.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as esbuild from 'esbuild'
import { build as viteBuild } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const watch = process.argv.includes('--watch')

/** content script 는 반드시 의존성까지 인라인된 단일 IIFE 여야 한다. */
const CONTENT_SCRIPTS = [
  { entry: 'src/injected/interceptor.ts', out: 'interceptor.js' },
  { entry: 'src/content/bridge.ts', out: 'bridge.js' },
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
  logLevel: 'info',
  alias: {
    '@core': resolve(root, 'src/core'),
  },
})

async function main() {
  // vite 가 emptyOutDir 로 dist 를 비우므로 반드시 vite 를 먼저 돌린 뒤 나머지를 얹는다.
  if (watch) {
    await viteBuild({ build: { watch: {} } })
    await copyStatic()
    const contexts = await Promise.all(CONTENT_SCRIPTS.map((s) => esbuild.context(esbuildOptions(s))))
    await Promise.all(contexts.map((c) => c.watch()))
    console.log('\n[x-deck] watch 모드로 실행 중. dist/ 를 chrome://extensions 에 로드해라.')
    return
  }

  await viteBuild()
  await copyStatic()
  await Promise.all(CONTENT_SCRIPTS.map((s) => esbuild.build(esbuildOptions(s))))
  console.log('\n[x-deck] 빌드 완료 → dist/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
