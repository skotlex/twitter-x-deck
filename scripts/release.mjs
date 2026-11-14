// 사용자가 구울 때(npm run sign:ff) 버전을 하나 올리는 규칙. scripts/sign-firefox.mjs 가 쓴다.
//
// AI 는 고친 것을 CHANGELOG 의 `## [Unreleased]` 에 모아 두기만 하고 버전은 건드리지 않는다.
// 버전은 실제로 구워 서명받는 순간에만 오른다 — AMO 는 한 번 서명한 번호를 다시 받지 않으므로,
// 번호를 쓰는 때와 올리는 때가 같아야 번호가 헛되이 비지 않는다.

/**
 * 다음 버전. 세 자리 모두 한 자리 숫자(0~9)만 쓴다.
 * 마지막 자리에 하나를 더하고, 10 이 되면 0 으로 두고 앞자리를 올린다.
 * `9.9.9` 다음처럼 더 올릴 자리가 없거나 모양이 다르면 멈춘다 — 사람이 정할 판올림이다.
 */
export function nextVersion(version) {
  if (!/^\d\.\d\.\d$/.test(version)) {
    throw new Error(`버전 ${version} 은 한 자리 숫자 세 개(X.Y.Z) 모양이 아니다`)
  }
  const digits = version.split('.').map(Number)
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    digits[at] += 1
    if (digits[at] < 10) return digits.join('.')
    digits[at] = 0
  }
  throw new Error(`${version} 다음은 자리가 넘친다. package.json 의 버전을 직접 정한다`)
}

const UNRELEASED = /^## \[Unreleased\][ \t]*(?=\r?$)/m

/**
 * 모아둔 `## [Unreleased]` 머리를 `## [버전] - 날짜` 로 바꾼다.
 * 모아둔 것이 없으면 그대로 돌려준다 — 그 버전은 CHANGELOG 에 블록 없이 건너뛰어진다.
 */
export function releaseChangelog(text, version, date) {
  if (!UNRELEASED.test(text)) return { text, released: false }
  return { text: text.replace(UNRELEASED, `## [${version}] - ${date}`), released: true }
}

/** 지금 이 컴퓨터 기준의 날짜 (YYYY-MM-DD). */
export function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
