/**
 * 브리지를 어느 브라우저에 어떤 모양으로 등록할지.
 *
 * 등록은 두 가지로 이뤄진다 — 무엇을 실행할지 적은 호스트 매니페스트 JSON 과,
 * 그 JSON 의 자리를 가리키는 레지스트리 값. 크로미움 계열과 Firefox 는 둘 다 다르게 읽는다.
 *
 *   크로미움: `allowed_origins` 에 `chrome-extension://<ID>/`. ID 는 manifest.json 의 `key` 가 정한다
 *   Firefox : `allowed_extensions` 에 `browser_specific_settings.gecko.id`
 *
 * 서로의 키를 모르는 브라우저가 매니페스트를 거부할 수 있어 파일을 따로 둔다.
 * 실제로 쓰고 지우는 일은 install.mjs 가 한다. 여기는 무엇을 쓸지만 정한다.
 */
import { GECKO_ID } from '../scripts/target.mjs'

export const HOST_NAME = 'com.xdeck.bridge'

/** 크로미움 계열 확장 ID. `manifest.json` 의 `key` 에서 나오는 값이라 모든 사용자에게 같다. */
export const CHROMIUM_EXTENSION_ID = 'jihknelglpffneboofhddbohkjnlodne'

export { GECKO_ID }

/**
 * 등록할 자리. 깔려 있지 않은 브라우저에 써도 해가 없다 — 나중에 깔면 그대로 동작한다.
 * `base` 아래의 `NativeMessagingHosts\<이름>` 을 본다는 점은 둘 다 같다.
 */
export const REGISTRATIONS = [
  { label: 'Chrome', base: 'Software\\Google\\Chrome', family: 'chromium' },
  { label: 'Edge', base: 'Software\\Microsoft\\Edge', family: 'chromium' },
  { label: 'Chromium', base: 'Software\\Chromium', family: 'chromium' },
  { label: 'Brave', base: 'Software\\BraveSoftware\\Brave-Browser', family: 'chromium' },
  { label: 'Whale', base: 'Software\\Naver\\Whale', family: 'chromium' },
  { label: 'Firefox', base: 'Software\\Mozilla', family: 'firefox' },
]

export const FAMILIES = ['chromium', 'firefox']

export function registryPath(base) {
  return `HKCU\\${base}\\NativeMessagingHosts\\${HOST_NAME}`
}

/** 그 계열이 읽을 호스트 매니페스트의 파일 이름 (bridge/ 안). */
export function manifestFileName(family) {
  return family === 'firefox' ? `${HOST_NAME}.firefox.json` : `${HOST_NAME}.json`
}

/**
 * 그 계열이 읽을 호스트 매니페스트.
 *
 * @param family       'chromium' | 'firefox'
 * @param launcherPath 브라우저가 켤 실행 파일의 절대 경로 (host.bat)
 */
export function hostManifest(family, launcherPath) {
  const common = {
    name: HOST_NAME,
    description: 'X Deck 사진 번역 브리지',
    path: launcherPath,
    type: 'stdio',
  }
  return family === 'firefox'
    ? { ...common, allowed_extensions: [GECKO_ID] }
    : { ...common, allowed_origins: [`chrome-extension://${CHROMIUM_EXTENSION_ID}/`] }
}
