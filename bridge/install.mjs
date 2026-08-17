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
 * 등록이 손대는 자리는 `HKEY_CURRENT_USER` 와 이 폴더뿐이다 — 관리자 권한이 필요 없고,
 * 해제하면 흔적이 남지 않는다.
 *
 * 등록하는 김에 `codex` · `claude` 도 최신으로 받아둔다. 브리지가 부르는 것이 그 둘이고,
 * 판이 낡으면 넘어지는 쪽은 브리지가 아니라 그쪽이다. 받기 싫으면 `--skip-update`.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
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

/**
 * 브리지가 부르는 두 명령.
 *
 * 하나만 깔아 쓰는 사람도 있어서 (덱은 있는 쪽으로 알아서 간다) **깔려 있지 않은 것을
 * 여기서 새로 깔지 않는다.** 둘 다 없을 때만 둘 다 깐다 — 그때는 사진 번역 자체가
 * 돌지 않으므로 브리지를 등록할 이유도 없기 때문이다.
 */
const ENGINES = [
  { command: 'codex', pkg: '@openai/codex' },
  { command: 'claude', pkg: '@anthropic-ai/claude-code' },
]

/**
 * 명령을 조용히 한 번 돌려보고 그 말을 받아온다. 실패는 빈 문자열이다.
 *
 * 셸을 거친다. 윈도우에서 `npm` · `codex` · `claude` 는 npm 이 깔아둔 `.cmd` 스크립트인데,
 * Node 는 셸 없이 `.cmd` 를 부르는 것을 막아 두었기 때문이다. 명령줄을 통째로 넘기는 것은
 * 인자 배열과 셸을 함께 쓰면 경고를 찍기 때문이고 — 그 경고가 사용자 콘솔 창에 그대로
 * 뜬다. 넘기는 값은 전부 이 파일 안의 상수라 셸에 실려도 새어 나갈 자리가 없다.
 */
function ask(commandLine) {
  try {
    return execSync(commandLine, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    }).trim()
  } catch {
    return ''
  }
}

/** 그 명령이 이 PC 에 있는지. */
function installed(command) {
  try {
    execFileSync('where', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * `codex` · `claude` 를 최신으로 받는다.
 *
 * npm 이 깔아둔 것만 npm 으로 갱신한다. 네이티브 설치본을 npm 으로 덮으면 같은 명령이
 * 두 벌이 되어 어느 쪽이 뜨는지 알 수 없게 되므로, 그런 것은 손대지 않고 알려만 준다.
 *
 * 여기서 무엇이 실패해도 등록은 이미 끝나 있다. 망이 끊겨 있다고 브리지까지 못 쓰게
 * 만들지 않는다 — 한 줄 알려주고 넘어간다.
 */
function updateEngines() {
  console.log('')
  const root = ask('npm root -g')
  if (!root || !existsSync(root)) {
    console.log('  건너뜀 codex · claude 갱신 (npm 을 찾지 못했습니다)')
    return
  }

  const managed = (pkg) => existsSync(join(root, ...pkg.split('/')))
  const bare = ENGINES.every(({ command }) => !installed(command))

  for (const { command, pkg } of ENGINES) {
    if (!managed(pkg)) {
      if (installed(command)) {
        console.log(`  건너뜀 ${command} (npm 으로 깔린 것이 아닙니다. 쓰던 방식으로 갱신하세요)`)
        continue
      }
      if (!bare) {
        console.log(`  건너뜀 ${command} (깔려 있지 않습니다. 쓰려면 npm i -g ${pkg})`)
        continue
      }
    }

    console.log(`  ${managed(pkg) ? '갱신' : '설치'}  ${command} (${pkg}) — 조금 걸립니다`)
    try {
      execSync(`npm install -g ${pkg}@latest --no-fund --no-audit --loglevel=error`, {
        stdio: 'inherit',
      })
      const said = ask(`${command} --version`).split(/[\r\n]/)[0]
      console.log(`  완료  ${command}${said ? ` ${said}` : ''}`)
    } catch {
      console.log(`  건너뜀 ${command} (내려받지 못했습니다 — 망 연결을 확인하세요)`)
    }
  }
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

  // 등록이 먼저다. 내려받기는 오래 걸리고 망을 타므로, 여기서 무엇이 어긋나도
  // 브리지는 이미 쓸 수 있는 상태여야 한다.
  if (!process.argv.includes('--skip-update')) updateEngines()

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
