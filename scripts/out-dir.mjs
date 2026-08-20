/**
 * 빌드 결과를 어디에 놓을지 정한다.
 *
 * 기본은 저장소 안의 `dist/` 다. 다만 저장소가 OneDrive 같은 동기화 폴더 안에 있으면
 * 브라우저가 시작할 때 그 폴더를 읽지 못해 **압축해제 확장을 통째로 버리는** 일이 있다.
 * 동기화 도구가 파일에 걸어두는 자리표시자를 브라우저보다 늦게 풀어주기 때문이다.
 * 그래서 결과만 동기화 밖으로 내보낼 수 있게 한다.
 *
 *   npm run build -- --out C:\ext\x-deck    한 번만 다른 곳에 굽는다
 *   XDECK_OUT=C:\ext\x-deck                 정해두고 계속 쓴다 (dev 도 함께 따라간다)
 *
 * 명령줄이 환경 변수를 이긴다.
 */
import { isAbsolute, relative, resolve } from 'node:path'

/** 이 이름이 있으면 우리가 구워 둔 자리로 본다. 빌드가 중간에 죽어도 남는 것들이다. */
const OUR_MARKS = ['manifest.json', 'deck.js']

/** 브라우저가 확장을 얹으며 만들어 넣는 폴더. 우리 것이 아니지만 남의 것도 아니다. */
const BROWSER_LEFTOVERS = ['_metadata']

function fromArgv(argv) {
  const flag = argv.indexOf('--out')
  if (flag !== -1) {
    const value = argv[flag + 1]
    if (!value || value.startsWith('--')) {
      throw new Error('--out 뒤에 폴더 경로가 없다 (예: --out C:\\ext\\x-deck)')
    }
    return value
  }

  const inline = argv.find((arg) => arg.startsWith('--out='))
  if (inline) {
    const value = inline.slice('--out='.length)
    if (!value) throw new Error('--out= 뒤에 폴더 경로가 없다 (예: --out=C:\\ext\\x-deck)')
    return value
  }

  return null
}

/**
 * 결과를 놓을 절대 경로.
 *
 * 상대 경로는 **명령을 친 자리**(`cwd`) 기준으로 푼다 — 사용자가 적은 그대로 읽히는 쪽이다.
 */
export function outDirFrom({ argv = [], env = {}, cwd, root }) {
  const chosen = fromArgv(argv) ?? (env.XDECK_OUT ?? '').trim()
  if (!chosen) return resolve(root, 'dist')
  return resolve(cwd, chosen)
}

/**
 * 그 자리를 지우고 새로 구워도 되는지 본다.
 *
 * `--out` 은 손으로 적는 값이라 오타 한 번에 엉뚱한 폴더를 통째로 날릴 수 있다.
 * 비어 있거나 우리가 구워 둔 흔적이 있을 때만 손댄다.
 *
 * @param entries 그 폴더에 지금 들어 있는 이름들
 */
export function reusableOutDir(entries) {
  const meaningful = entries.filter((name) => !BROWSER_LEFTOVERS.includes(name))
  if (meaningful.length === 0) return true
  return OUR_MARKS.some((mark) => meaningful.includes(mark))
}

/**
 * 그 자리가 동기화 폴더 안인지.
 *
 * 막지는 않는다 — 되던 사람의 빌드를 갑자기 끊을 이유가 없다. 확장이 재시작 뒤
 * 사라지는 증상을 만났을 때 어디를 봐야 하는지만 알려준다.
 */
export function insideSyncedFolder(dir, env = {}) {
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean)
  return roots.some((syncRoot) => {
    const rel = relative(resolve(syncRoot), dir)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}
