import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// 덱 페이지(React) 와 백그라운드 서비스 워커만 담당한다.
// content script 는 IIFE 단일 파일이어야 하므로 scripts/build.mjs 에서 esbuild 로 따로 만든다.
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    // MV3 확장 페이지의 CSP 는 인라인 스크립트를 막는다. vite 가 심는 preload 폴리필도 예외가 아니다.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        deck: fileURLToPath(new URL('./deck.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/service-worker.ts', import.meta.url)),
      },
      output: {
        // 서비스 워커 경로는 manifest 에 고정돼 있어 해시를 붙이지 않는다.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
