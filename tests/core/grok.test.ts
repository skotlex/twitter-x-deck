/**
 * [grok.ts](../../src/core/grok.ts) 의 응답 해석.
 *
 * 실제 요청은 x.com 계정이 있어야 해서 여기서 잴 수 없다. 응답 모양만 잰다 —
 * 조각마다 객체가 이어 붙어 오는 흐름이라 그 끊어 읽기가 가장 깨지기 쉽다.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  GROK_RATE_LIMIT_CODE,
  isGrokAsk,
  isGrokReply,
  readGrokStream,
} from '../../src/core/grok'
import { CHANNEL } from '../../src/core/messages'

describe('readGrokStream', () => {
  it('이어 붙은 조각을 하나로 잇는다', () => {
    const raw = '{"result":{"text":"오늘은 "}}{"result":{"text":"날씨가 좋다"}}'
    expect(readGrokStream(raw)).toEqual({ text: '오늘은 날씨가 좋다', errorCodes: [], malformed: false })
  })

  it('조각 사이의 줄바꿈과 공백은 무시한다', () => {
    const raw = '{"result":{"text":"가"}}\n  {"result":{"text":"나"}}\n'
    expect(readGrokStream(raw).text).toBe('가나')
  })

  it('문자열 안의 중괄호와 이스케이프된 따옴표에 속지 않는다', () => {
    const raw = '{"result":{"text":"{괄호} \\"인용\\" \\\\"}}{"result":{"text":"끝"}}'
    expect(readGrokStream(raw).text).toBe('{괄호} "인용" \\끝')
  })

  it('문서 하나로 온 응답도 읽는다', () => {
    expect(readGrokStream('{"result":{"text":"한 번에","source_lang":"ja"}}').text).toBe('한 번에')
  })

  it('글자가 없는 조각은 건너뛴다', () => {
    const raw = '{"result":{"text":"가"}}{"result":{}}{"meta":1}{"result":{"text":"나"}}'
    expect(readGrokStream(raw).text).toBe('가나')
  })

  it('요청 과다 오류 코드를 집어낸다', () => {
    const raw = '{"errors":[{"code":88,"message":"Rate limit exceeded"}]}'
    expect(readGrokStream(raw).errorCodes).toEqual([GROK_RATE_LIMIT_CODE])
  })

  it('닫히지 않은 객체는 깨진 응답으로 본다', () => {
    const out = readGrokStream('{"result":{"text":"가"}}{"result":{"text":"나')
    expect(out.text).toBe('가')
    expect(out.malformed).toBe(true)
  })

  it('JSON 이 아닌 조각도 깨진 응답으로 본다', () => {
    expect(readGrokStream('{nope}').malformed).toBe(true)
  })

  it('빈 응답은 빈 번역문이다', () => {
    expect(readGrokStream('')).toEqual({ text: '', errorCodes: [], malformed: false })
  })
})

describe('decodeEntities', () => {
  it('이름 엔티티를 푼다', () => {
    expect(decodeEntities('A &amp; B &lt;3 &gt; &quot;x&quot;')).toBe('A & B <3 > "x"')
  })

  it('숫자 엔티티를 푼다', () => {
    expect(decodeEntities('&#39;a&#39; &#x1F600;')).toBe("'a' 😀")
  })

  it('모르는 엔티티는 그대로 둔다', () => {
    expect(decodeEntities('&unknown; & 그냥')).toBe('&unknown; & 그냥')
  })
})

describe('메시지 판별', () => {
  it('부탁과 대답을 가른다', () => {
    const ask = { channel: CHANNEL, type: 'grok-ask', id: 'a', tweetId: '1', lang: 'ko' }
    const reply = { channel: CHANNEL, type: 'grok-result', id: 'a', text: '번역' }
    expect(isGrokAsk(ask)).toBe(true)
    expect(isGrokReply(ask)).toBe(false)
    expect(isGrokReply(reply)).toBe(true)
    expect(isGrokAsk(reply)).toBe(false)
  })

  it('다른 채널의 메시지는 받지 않는다', () => {
    expect(isGrokAsk({ channel: 'other', type: 'grok-ask', id: 'a', tweetId: '1' })).toBe(false)
  })
})
