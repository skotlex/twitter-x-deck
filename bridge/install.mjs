/**
 * 네이티브 메시징 호스트 등록/해제.
 *
 * 브라우저가 `bridge/host.mjs` 를 알아서 켜려면 두 가지가 있어야 한다 —
 * 무엇을 실행할지 적은 매니페스트 JSON 하나와, 그 JSON 이 어디 있는지 가리키는
 * 레지스트리 값 하나.
 *
 * 확장이 이걸 스스로 할 수는 없다. 할 수 있다면 임의의 확장이 브라우저로 하여금
 * 아무 실행파일이나 켜게 만들 수 있다는 뜻이라, 막혀 있는 것이 맞다. 그래서 이
 * 한 번만 사람이 돌린다.
 *
 * 손대는 자리는 `HKEY_CURRENT_USER` 와 이 폴더뿐이다 — 관리자 권한이 필요 없고,
 * 해제하면 흔적이 남지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 확장 ID. `manifest.json` 의 `key` 가 정하는 값이라 모든 사용자에게 동일하다. */
const EXTENSION_ID = 'jihknelglpffneboofhddbohkjnlodne'

const HOST_NAME = 'com.xdeck.bridge'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, `${HOST_NAME}.json`)
const launcherPath = join(here, 'host.bat')

/**
 * 크로미움 계열은 저마다 자기 자리를 본다. 깔려 있지 않은 브라우저에 써도 해가 없다 —
 * 그 브라우저를 나중에 깔면 그대로 동작한다.
 */
const BROWSER_KEYS = [
  ['Chrome', 'Software\\Google\\Chrome'],
  ['Edge', 'Software\\Microsoft\\Edge'],
  ['Chromium', 'Software\\Chromium'],
  ['Brave', 'Software\\BraveSoftware\\Brave-Browser'],
  ['Whale', 'Software\\Naver\\Whale'],
]

function registryPath(base) {
  return `HKCU\\${base}\\NativeMessagingHosts\\${HOST_NAME}`
}

function install() {
  if (process.platform !== 'win32') {
    console.error('지금은 윈도우만 지원합니다.')
    process.exit(1)
  }

  // 윈도우는 네이티브 호스트로 실행 파일만 받는다. .mjs 를 직접 가리킬 수 없어
  // node 를 부르는 한 줄짜리 배치를 끼운다.
  writeFileSync(launcherPath, ['@echo off', `node "%~dp0host.mjs" %*`, ''].join('\r\n'), 'utf8')

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        name: HOST_NAME,
        description: 'X Deck 사진 번역 브리지',
        path: launcherPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  for (const [label, base] of BROWSER_KEYS) {
    try {
      execFileSync(
        'reg',
        ['add', registryPath(base), '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
        { stdio: 'ignore' },
      )
      console.log(`  등록  ${label}`)
    } catch {
      console.log(`  건너뜀 ${label} (등록하지 못했습니다)`)
    }
  }

  console.log('')
  console.log('  브리지를 등록했습니다.')
  console.log(`  확장 ID  ${EXTENSION_ID}`)
  console.log('')
  console.log('  브라우저를 완전히 껐다 켠 뒤, 덱의 설정 › 번역 에서 상태를 확인하세요.')
  console.log('  이제 터미널을 띄워둘 필요가 없습니다 — 필요할 때 브라우저가 알아서 켭니다.')
  console.log('')
}

function uninstall() {
  for (const [label, base] of BROWSER_KEYS) {
    try {
      execFileSync('reg', ['delete', registryPath(base), '/f'], { stdio: 'ignore' })
      console.log(`  해제  ${label}`)
    } catch {
      // 애초에 없던 것. 지울 것이 없으면 그것으로 됐다.
    }
  }
  for (const path of [manifestPath, launcherPath]) {
    try {
      unlinkSync(path)
    } catch {
      // 이미 없다.
    }
  }
  console.log('')
  console.log('  브리지 등록을 해제했습니다.')
  console.log('')
}

if (process.argv.includes('--uninstall')) uninstall()
else install()
