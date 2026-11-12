/**
 * [papagoUrl.ts](../../src/content/papagoUrl.ts) — Papago 에 무엇을 어떤 주소로 부탁하는지.
 *
 * Papago 는 주소 형식을 `sk`·`tk`·`st` 에서 `sl`·`tl`·`text` 로 바꿨다. 옛 이름으로
 * 보내면 글월은 옮겨 받으면서 도착 언어만 버려, 한국어를 부탁해도 영어가 돌아왔다
 * (`?sk=auto&tk=ko&st=…` 가 `?sl=pt&tl=en&text=…` 로 다시 쓰였다).
 */
import { describe, expect, it } from 'vitest'
import { PAPAGO_ORIGIN, PAPAGO_PARAM } from '@core/messages'
import { papagoUrl, retargetSearch, URL_TEXT_LIMIT } from '../../src/content/papagoUrl'

describe('papagoUrl', () => {
  const url = new URL(papagoUrl('Sempre coloque uma vírgula', 'ko', 'abc'))
  const params = url.searchParams

  it('Papago 의 지금 이름으로 부탁한다', () => {
    expect(url.origin).toBe(PAPAGO_ORIGIN)
    expect(params.get('sl')).toBe('auto')
    expect(params.get('tl')).toBe('ko')
    expect(params.get('text')).toBe('Sempre coloque uma vírgula')
    expect(params.get(PAPAGO_PARAM)).toBe('abc')
  })

  it('옛 이름은 싣지 않는다 — 버려지는 값이 섞이면 어느 쪽이 먹는지 알 수 없다', () => {
    for (const legacy of ['sk', 'tk', 'st']) expect(params.has(legacy)).toBe(false)
  })

  it('주소에 담기엔 긴 글은 싣지 않는다 — 프레임이 직접 넣는다', () => {
    const long = new URL(papagoUrl('가'.repeat(URL_TEXT_LIMIT), 'ko', 'abc'))
    expect(long.searchParams.has('text')).toBe(false)
    expect(long.searchParams.get('tl')).toBe('ko')
  })
})

describe('retargetSearch', () => {
  /*
   * Papago 는 출발 언어가 `auto` 면 `tl` 을 버리고 영어로 다시 쓴다. 출발 언어를 적어 주면
   * `tl=ko` 를 따른다 — `?sl=pt&tl=ko&text=…` 는 그대로 남아 한국어 번역문이 뜨는 것을
   * 사용자가 확인했다. 그래서 다시 띄울 때는 Papago 가 감지해 적어 둔 출발 언어를 쓴다.
   */
  it('Papago 가 도착 언어를 영어로 바꿔 썼으면, 감지한 출발 언어를 적어 다시 잡는다', () => {
    // 실제로 Papago 가 다시 써 놓은 주소 그대로다.
    const next = retargetSearch('?sl=pt&tl=en&text=Sempre+coloque+uma+v%C3%ADrgula', 'ko', 'abc')
    expect(next).not.toBeNull()
    const params = new URLSearchParams(next ?? '')
    expect(params.get('sl')).toBe('pt')
    expect(params.get('tl')).toBe('ko')
    expect(params.get('text')).toBe('Sempre coloque uma vírgula')
    expect(params.get(PAPAGO_PARAM)).toBe('abc')
  })

  it('다시 잡은 주소는 다시 건드리지 않는다 — 되풀이하지 않는다', () => {
    const next = retargetSearch('?sl=pt&tl=en&text=hi', 'ko', 'abc') ?? ''
    expect(retargetSearch(next, 'ko', 'abc')).toBeNull()
  })

  it('감지한 언어가 없으면 auto 로 둔다', () => {
    const params = new URLSearchParams(retargetSearch('?tl=en&text=hi', 'ko', 'abc') ?? '')
    expect(params.get('sl')).toBe('auto')
    expect(params.get('tl')).toBe('ko')
  })

  it('이미 도착 언어로 쓰인 글이면 다시 띄우지 않는다 — 옮길 것이 없다', () => {
    expect(retargetSearch('?sl=ko&tl=en&text=안녕', 'ko', 'abc')).toBeNull()
  })

  it('옛 이름으로 어긋난 주소도 알아본다', () => {
    const next = retargetSearch('?sk=pt&tk=en&st=hi', 'ko', 'abc')
    const params = new URLSearchParams(next ?? '')
    expect(params.get('sl')).toBe('pt')
    expect(params.get('tl')).toBe('ko')
    expect(params.has('sk')).toBe(false)
    expect(params.has('tk')).toBe(false)
  })

  it('맞게 앉아 있으면 그대로 둔다', () => {
    expect(retargetSearch('?sl=pt&tl=ko&text=hi', 'ko', 'abc')).toBeNull()
  })

  it('도착 언어가 주소에 아예 없으면 건드리지 않는다 — 판단할 근거가 없다', () => {
    expect(retargetSearch('?text=hi', 'ko', 'abc')).toBeNull()
    expect(retargetSearch('?sl=pt&tl=en', '', 'abc')).toBeNull()
  })
})
