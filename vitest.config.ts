import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 테스트 전용 설정. `vite.config.ts` 를 재사용하지 않는다 —
 * 그쪽은 확장 번들을 굽기 위한 IIFE 라이브러리 모드고 react·tailwind 플러그인이
 * 물려 있어서, 테스트에 끌고 오면 굽는 설정과 재는 설정이 서로를 방해한다.
 *
 * 환경은 happy-dom 이다. 브라우저를 띄우지 않고 DOM 만 흉내 내므로 x.com 로그인이
 * 필요 없고, 셀렉터 검증을 CI 처럼 반복해서 돌릴 수 있다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    // 문서의 출처를 x.com 으로 둔다. 기본값(localhost)이면 셀렉터가 보는
    // `window.location.pathname` 을 테스트가 갈아 끼울 수 없다 — 교차 출처라 막힌다.
    environmentOptions: { happyDOM: { url: 'https://x.com/home' } },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/dom.ts'],
  },
})
