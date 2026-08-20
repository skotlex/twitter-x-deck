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
import { looksKorean, papagoTarget, READING_LANG } from '../../src/content/translate'

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
