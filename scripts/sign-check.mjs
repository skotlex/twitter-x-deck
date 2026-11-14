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
