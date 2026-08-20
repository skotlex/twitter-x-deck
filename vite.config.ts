import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

/**
 * 덱 UI 만 담당한다.
 *
 * 덱은 x.com 페이지에 얹히는 content script 라서 ESM 이 안 되고 단일 파일이어야 한다.
 * 그래서 IIFE 라이브러리 모드로 굽고, Tailwind CSS 는 `?inline` 로 받아 그림자 DOM 에
 * 직접 넣는다 (별도 CSS 파일을 로드할 방법이 없다).
 *
 * interceptor / bridge / background 는 CSS·JSX 가 없으므로 esbuild 가 맡는다
 * (scripts/build.mjs).
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // 기본 자리다. `--out`·`XDECK_OUT` 을 주면 scripts/build.mjs 가 갈아 끼운다.
    outDir: 'dist',
    // 청소는 scripts/build.mjs 가 먼저 한다. vite 가 지우면 esbuild 산출물이 날아간다.
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/mount.tsx', import.meta.url)),
      formats: ['iife'],
      name: 'XDeck',
      fileName: () => 'deck.js',
    },
  },
})
