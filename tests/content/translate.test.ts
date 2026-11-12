/**
 * [translate.ts](../../src/content/translate.ts) 의 **도착 언어** 규칙.
 *
 * 번역문이 한국어 대신 영어로 돌아오던 회귀에 대응한다. 두 갈래로 샜다 —
 *   1) 도착 언어를 브라우저 언어에서 뽑아, 브라우저 UI 가 한국어가 아니면 영어가 됐다
 *   2) 한국어 글에 x.com 이 엉뚱한 언어 코드를 붙여 오면 번역을 권하게 되는데,
 *      출발과 도착이 같아지면 Papago 가 도착 언어를 영어로 바꿔버린다
 *
 * 프레임을 띄우는 쪽(실제 번역)은 여기서 잴 수 없다 — 남의 사이트가 필요하다.
 */
import { describe, expect, it } from 'vitest'
import {
  looksKorean,
  papagoSource,
  papagoTarget,
  READING_LANG,
  untranslated,
  wrongLanguage,
} from '../../src/content/translate'

describe('READING_LANG', () => {
  it('브라우저 언어와 무관하게 한국어다', () => {
    expect(READING_LANG).toBe('ko')
  })
})

describe('papagoTarget', () => {
  it('지역 꼬리표를 떼고 넘긴다', () => {
    expect(papagoTarget('ko-KR')).toBe('ko')
    expect(papagoTarget('JA')).toBe('ja')
  })

  it('중국어만 번체·간체를 가른다', () => {
    expect(papagoTarget('zh-TW')).toBe('zh-TW')
    expect(papagoTarget('zh')).toBe('zh-CN')
  })

  it('모르는 코드는 영어가 아니라 읽는 언어로 간다', () => {
    expect(papagoTarget('sw')).toBe('ko')
    expect(papagoTarget('')).toBe('ko')
  })
})

describe('looksKorean', () => {
  it('한국어 글을 한국어로 본다', () => {
    expect(looksKorean('오늘 날씨가 참 좋네요')).toBe(true)
    expect(looksKorean('신작 게임 OST 가 너무 좋다')).toBe(true)
  })

  it('한국어가 아닌 글은 그대로 번역 대상이다', () => {
    expect(looksKorean('The quick brown fox jumps over the lazy dog')).toBe(false)
    expect(looksKorean('今日はいい天気ですね')).toBe(false)
  })

  it('한글이 몇 글자 섞였다고 한국어로 보지 않는다', () => {
    expect(looksKorean('I finally tried 김치 and it was delicious')).toBe(false)
  })

  it('주소는 세지 않는다 — 링크만 붙은 짧은 글에서 비율이 흔들린다', () => {
    expect(looksKorean('좋다 https://example.com/some/very/long/path/to/an/article')).toBe(true)
  })

  it('글자가 없으면 판단하지 않는다', () => {
    expect(looksKorean('')).toBe(false)
    expect(looksKorean('123 !!! 🙂')).toBe(false)
  })
})

describe('papagoSource', () => {
  it('x.com 이 붙인 언어를 Papago 가 받는 이름으로 옮긴다', () => {
    expect(papagoSource('en')).toBe('en')
    expect(papagoSource('JA')).toBe('ja')
    expect(papagoSource('zh')).toBe('zh-CN')
    expect(papagoSource('zh-TW')).toBe('zh-TW')
  })

  it('모르거나 Papago 가 못 받는 언어는 auto 로 둔다', () => {
    expect(papagoSource('auto')).toBe('auto')
    expect(papagoSource('')).toBe('auto')
    expect(papagoSource('sw')).toBe('auto')
    expect(papagoSource('qme')).toBe('auto')
  })

  it('도착 언어와 같은 출발 언어는 적지 않는다 — Papago 가 도착 언어를 바꿔버린다', () => {
    expect(papagoSource('ko')).toBe('auto')
  })
})

describe('untranslated', () => {
  /*
   * Papago 가 도착 언어를 영어로 바꿔 쓰면 영어 글은 원문이 그대로 돌아온다.
   * 그건 번역문이 아니다 — 받으면 영어 '번역' 이 카드에 붙는다.
   */
  it('원문이 그대로 돌아오면 번역되지 않은 것이다', () => {
    const source = "a woman who can't sustain a nipple piercing is just a girl"
    expect(untranslated(source, source)).toBe(true)
  })

  it('공백 · 줄바꿈 · 대소문자 차이는 같은 글로 본다', () => {
    expect(untranslated('Hello  world\nagain', 'hello world again')).toBe(true)
  })

  it('옮겨진 글은 번역이다', () => {
    expect(untranslated('Hello world', '안녕 세상')).toBe(false)
  })
})

describe('wrongLanguage', () => {
  /*
   * 포르투갈어 글을 한국어로 부탁했는데 Papago 가 도착 언어를 영어로 바꿔 영어 번역문을
   * 돌려줬다. 원문과 다른 글이라 `untranslated` 로는 못 거른다.
   */
  it('한국어를 부탁했는데 한글이 한 글자도 없으면 다른 언어로 옮긴 것이다', () => {
    expect(wrongLanguage("a woman who can't sustain a nipple piercing is just a girl", 'ko')).toBe(true)
  })

  it('한글이 있으면 한국어 번역으로 본다 — 이름 · 해시태그가 섞여도 된다', () => {
    expect(wrongLanguage('#NewJeans 의 신곡 by @ADOR 를 확인하세요', 'ko')).toBe(false)
  })

  it('한국어가 아닌 도착 언어는 따지지 않는다', () => {
    expect(wrongLanguage('a woman who', 'en')).toBe(false)
  })
})
