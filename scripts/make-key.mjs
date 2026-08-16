/**
 * 확장 ID 를 못박는 키를 만든다. **한 번만 돌리고 결과를 커밋한다.**
 *
 * 압축을 풀어 폴더째 얹는(unpacked) 방식으로 나눠주면, 크롬은 그 **폴더 경로**에서
 * 확장 ID 를 만들어낸다 — 사용자마다 경로가 다르니 ID 도 제각각이 된다. 그러면
 * 네이티브 호스트가 "누구의 부름을 받을지"(`allowed_origins`)를 미리 적어둘 수 없다.
 *
 * `manifest.json` 에 공개키를 넣어두면 ID 는 그 키에서 결정되어 경로와 무관해진다.
 * 모두가 같은 ID 를 갖게 되므로 등록 스크립트가 그 값을 박아 넣을 수 있다.
 *
 * 개인키는 쓰지 않는다. 스토어에 올리거나 .crx 로 서명할 때만 필요한데 우리는 둘 다
 * 하지 않는다 — 그래서 만들지도, 남기지도 않는다.
 */
import { createHash, generateKeyPairSync } from 'node:crypto'

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const der = publicKey.export({ type: 'spki', format: 'der' })

/**
 * 크롬이 ID 를 만드는 방식: 공개키(DER)의 SHA-256 앞 16바이트를 16진수로 펴고,
 * 숫자 0~f 를 글자 a~p 로 옮긴다. 32글자가 된다.
 */
const digest = createHash('sha256').update(der).digest('hex').slice(0, 32)
const id = [...digest].map((ch) => 'abcdefghijklmnop'[parseInt(ch, 16)]).join('')

console.log('manifest.json 의 "key" 에 넣을 값:')
console.log(der.toString('base64'))
console.log('')
console.log('이 키가 만드는 확장 ID:')
console.log(id)
