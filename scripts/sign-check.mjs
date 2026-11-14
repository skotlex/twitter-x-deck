// Firefox 빌드를 AMO 에 서명 맡기기 전에 걸러낼 것들. scripts/sign-firefox.mjs 가 쓴다.
//
// 서명은 한 번 맡기면 되돌릴 수 없다 — AMO 는 받은 버전 번호를 다시 받아주지 않는다.
// 그래서 낡은 빌드를 맡겨 번호 하나를 헛되이 쓰는 일만은 미리 막는다.

/** web-ext 가 열쇠를 읽는 환경 변수. 이름이 정해져 있어 따로 넘기지 않아도 된다. */
export const KEY_ENV = 'WEB_EXT_API_KEY'
export const SECRET_ENV = 'WEB_EXT_API_SECRET'

/**
 * 서명을 맡기면 안 되는 사정들. 비어 있으면 맡겨도 된다.
 *
 * @param manifestVersion 구워 둔 Firefox 빌드의 manifest 버전. 빌드가 없으면 null
 * @param packageVersion  지금 package.json 의 버전
 */
export function signProblems({ manifestVersion, packageVersion, env = {} }) {
  const problems = []
  if (manifestVersion === null) {
    problems.push('Firefox 빌드가 없다. npm run build:ff 로 먼저 굽는다')
  } else if (manifestVersion !== packageVersion) {
    // 낡은 빌드를 맡기면 그 번호는 서명된 채 다시 쓸 수 없게 된다.
    problems.push(
      `구워 둔 빌드(${manifestVersion})가 package.json(${packageVersion})과 다르다. 다시 굽는다`,
    )
  }
  const missing = [KEY_ENV, SECRET_ENV].filter((name) => !(env[name] ?? '').trim())
  if (missing.length > 0) {
    problems.push(
      `${missing.join(' · ')} 가 비어 있다. AMO 개발자 허브의 API 열쇠(JWT issuer · secret)를 넣는다`,
    )
  }
  return problems
}

/**
 * 서명을 받은 뒤 dist-xpi 에서 지울 파일 이름들.
 *
 * 그 폴더에는 늘 마지막으로 받은 것만 남긴다 — 버전마다 쌓이면 어느 것을 설치할지
 * 헷갈린다. 이번 실행에서 새로 생긴 파일이 **하나라도 있을 때만** 나머지를 지운다.
 * 서명이 실패했는데 예전 것까지 지우면 설치할 것이 하나도 남지 않는다.
 * 폴더는 우리가 만든 것이 아니므로 건드리지 않는다.
 *
 * @param entries   폴더 안의 것들 (`isFile` 은 일반 파일인지)
 * @param startedAt 서명을 시작한 시각 (epoch ms). 이 뒤에 쓰인 파일이 새로 받은 것이다
 */
export function staleArtifacts(entries, startedAt) {
  const files = entries.filter((entry) => entry.isFile)
  const fresh = (entry) => entry.mtimeMs >= startedAt
  if (!files.some(fresh)) return []
  return files.filter((entry) => !fresh(entry)).map((entry) => entry.name)
}
