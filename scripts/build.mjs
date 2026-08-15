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
  { entry: 'src/offscreen/ocr.ts', out: 'offscreen.js' },
  { entry: 'src/background/service-worker.ts', out: 'background.js' },
]

/**
 * 글자 인식기(tesseract)가 실행 중에 불러 쓰는 파일들.
 *
 * 번들에 섞을 수 없다 — 워커는 별도 파일이어야 하고, 코어는 wasm 을 곁들여 스스로
 * 불러온다. 확장 안에 두고 그 주소를 넘긴다. 원격에서 받아오게 두면 확장 문서의
 * CSP 에 막히고, 오프라인에서도 못 쓴다.
 */
const CORE = 'node_modules/tesseract.js-core'
const VENDOR_FILES = [
  { from: 'node_modules/tesseract.js/dist/worker.min.js', to: 'vendor/tesseract-worker.js' },
  /*
   * 코어는 변종이 여섯 벌(SIMD 유무 × 엔진 종류)이고 다 합치면 44MB 다. 우리에게
   * 필요한 한 벌만 담는다 — 크롬은 SIMD 를 지원하고, 우리는 LSTM 엔진만 쓴다.
   * `.wasm.js` 는 wasm 을 품은 판이라 이것 하나로 돈다.
   */
  { from: `${CORE}/tesseract-core-simd-lstm.js`, to: 'vendor/core/tesseract-core-simd-lstm.js' },
  {
    from: `${CORE}/tesseract-core-simd-lstm.wasm.js`,
    to: 'vendor/core/tesseract-core-simd-lstm.wasm.js',
  },
  {
    from: `${CORE}/tesseract-core-simd-lstm.wasm`,
    to: 'vendor/core/tesseract-core-simd-lstm.wasm',
  },
]

async function copyStatic() {
  await mkdir(dist, { recursive: true })

  // manifest 의 version 은 package.json 을 단일 출처로 삼아 빌드 시 주입한다.
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  manifest.version = pkg.version
  await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  await cp(resolve(root, 'rules.json'), resolve(dist, 'rules.json'))
  await cp(resolve(root, 'src/offscreen/ocr.html'), resolve(dist, 'offscreen.html'))
  if (existsSync(resolve(root, 'icons'))) {
    await cp(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true })
  }

  for (const { from, to } of VENDOR_FILES) {
    const source = resolve(root, from)
    if (!existsSync(source)) throw new Error(`빌드에 필요한 파일이 없다: ${from}`)
    await cp(source, resolve(dist, to), { recursive: true })
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
