/**
 * 어느 브라우저용으로 구울지 정한다.
 *
 * 소스는 하나다. 브라우저마다 다른 것은 매니페스트 몇 줄과 번들의 문법 수준뿐이라,
 * 저장소의 `manifest.json` 은 크로미움 기준으로 두고 Firefox 용은 빌드할 때 고쳐 쓴다.
 *
 *   npm run build                      크로미움 (Chrome · Edge …) → dist/
 *   npm run build -- --target firefox  Firefox → dist-firefox/
 *
 * Firefox 가 크로미움과 다르게 읽는 자리:
 *   - 백그라운드: 서비스 워커를 받지 않는다. 같은 파일을 `background.scripts` 로 싣는다
 *   - 확장 ID: `key` 를 읽지 않는다. `browser_specific_settings.gecko.id` 로 못박는다
 *     (없으면 임시 로드마다 ID 가 바뀌어 `storage.sync` 가 이어지지 않는다)
 *   - 최소 버전: MAIN world 콘텐츠 스크립트를 매니페스트로 싣는 것이 128 부터다
 */

/** Firefox 에서 이 확장을 가리키는 ID. AMO 서명을 한 번 받으면 바꿀 수 없다. */
export const GECKO_ID = 'x-deck@xdeck'

export const TARGETS = {
  chromium: {
    /** esbuild · vite 가 맞출 문법 수준. manifest 의 minimum_chrome_version 과 같이 간다 */
    syntax: 'chrome120',
    /** 아무것도 안 주면 굽는 자리 (저장소 기준) */
    dir: 'dist',
    /** 굽는 자리를 정해두는 환경 변수 */
    envKey: 'XDECK_OUT',
    /** 다 구운 뒤 어디에 로드하라고 알려줄지 */
    loadAt: 'chrome://extensions',
  },
  firefox: {
    syntax: 'firefox128',
    dir: 'dist-firefox',
    // 크로미움 쪽과 같은 변수를 읽으면 한쪽 빌드가 다른 쪽 결과를 덮는다.
    envKey: 'XDECK_OUT_FIREFOX',
    loadAt: 'about:debugging#/runtime/this-firefox',
    minVersion: '128.0',
  },
}

/** 명령줄에서 `--target <이름>` 또는 `--target=<이름>` 을 읽는다. 없으면 크로미움. */
export function targetFrom(argv = []) {
  let value = null
  const flag = argv.indexOf('--target')
  if (flag !== -1) {
    value = argv[flag + 1]
    if (!value || value.startsWith('--')) {
      throw new Error('--target 뒤에 대상이 없다 (예: --target firefox)')
    }
  } else {
    const inline = argv.find((arg) => arg.startsWith('--target='))
    if (inline !== undefined) value = inline.slice('--target='.length)
  }

  if (value === null) return 'chromium'
  if (!Object.hasOwn(TARGETS, value)) {
    throw new Error(`모르는 대상: ${value || '(빈 값)'} — ${Object.keys(TARGETS).join(' · ')} 중 하나`)
  }
  return value
}

/**
 * 출력 폴더에 쓸 매니페스트를 만든다. 넘겨받은 객체는 건드리지 않는다.
 *
 * @param manifest 저장소의 manifest.json (크로미움 기준)
 * @param target   'chromium' | 'firefox'
 * @param version  package.json 의 version
 */
export function manifestFor(manifest, target, version) {
  const out = structuredClone(manifest)
  out.version = version
  if (target !== 'firefox') return out

  // Firefox 는 둘 다 모르는 키라 경고만 남긴다. 로드 화면을 어지럽히지 않게 걷어낸다.
  delete out.key
  delete out.minimum_chrome_version

  const worker = out.background?.service_worker
  if (worker) out.background = { scripts: [worker] }

  out.browser_specific_settings = {
    ...out.browser_specific_settings,
    gecko: {
      ...out.browser_specific_settings?.gecko,
      id: GECKO_ID,
      strict_min_version: TARGETS.firefox.minVersion,
    },
  }
  return out
}
