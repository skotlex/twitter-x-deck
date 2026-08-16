/**
 * [format.ts](../../src/ui/lib/format.ts) 의 표시 규칙.
 *
 * 로케일에 따라 글자가 달라지는 부분(월 이름 등)은 정확한 문자열로 재지 않는다.
 * ICU 데이터가 바뀌면 깨지는데 그건 우리 로직이 잘못된 것이 아니다.
 * 대신 **어느 갈래로 갔는지** 와 경계값을 잰다.
 */
import { describe, expect, it } from 'vitest'
import { aspectRatio, formatCount, formatRelative, originalMediaUrl, sizedMediaUrl } from '@ui/lib/format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatCount', () => {
  it('0 도 감추지 않는다 — 반응이 없다는 것도 정보다', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(undefined)).toBe('0')
  })

  it('네 자리 미만은 그대로 보여준다', () => {
    expect(formatCount(1)).toBe('1')
    expect(formatCount(999)).toBe('999')
  })

  it('네 자리부터 짧게 줄인다', () => {
    expect(formatCount(1000)).not.toBe('1000')
    expect(formatCount(1000).length).toBeLessThan(5)
    expect(formatCount(1_234_567).length).toBeLessThan(8)
  })
})

describe('formatRelative', () => {
  const now = 1_700_000_000_000

  it('1분 안쪽은 방금 이다', () => {
    expect(formatRelative(now, now)).toBe('방금')
    expect(formatRelative(now - MINUTE + 1, now)).toBe('방금')
  })

  it('분·시간 단위로 내려 센다', () => {
    expect(formatRelative(now - MINUTE, now)).toBe('1분')
    expect(formatRelative(now - 59 * MINUTE, now)).toBe('59분')
    expect(formatRelative(now - HOUR, now)).toBe('1시간')
    expect(formatRelative(now - 23 * HOUR, now)).toBe('23시간')
  })

  it('하루가 넘으면 날짜로 바꾼다', () => {
    const text = formatRelative(now - DAY, now)
    expect(text).not.toMatch(/분$|시간$|방금/)
  })

  it('해가 넘어가면 연도까지 적는다', () => {
    const lastYear = Date.UTC(2022, 4, 3)
    expect(formatRelative(lastYear, now)).toContain('2022')
    // 같은 해면 연도를 빼서 짧게 둔다.
    expect(formatRelative(now - 40 * DAY, now)).not.toContain('2023')
  })

  it('미래 시각을 음수로 흘리지 않는다', () => {
    expect(formatRelative(now + HOUR, now)).toBe('방금')
  })
})

describe('originalMediaUrl', () => {
  it('pbs.twimg.com 이미지를 원본 크기로 되돌린다', () => {
    expect(originalMediaUrl('https://pbs.twimg.com/media/x.jpg?name=medium')).toBe(
      'https://pbs.twimg.com/media/x.jpg?name=orig',
    )
  })

  it('name 이 없으면 붙인다', () => {
    expect(originalMediaUrl('https://pbs.twimg.com/media/x.jpg')).toContain('name=orig')
  })

  it('다른 호스트는 손대지 않는다', () => {
    const url = 'https://video.twimg.com/clip/x.mp4?tag=1'
    expect(originalMediaUrl(url)).toBe(url)
  })

  it('주소로 못 읽으면 원본을 그대로 돌려준다', () => {
    expect(originalMediaUrl('pbs.twimg.com/깨진 주소')).toBe('pbs.twimg.com/깨진 주소')
  })
})

describe('sizedMediaUrl — 그 자리에 필요한 만큼만 받기', () => {
  const PHOTO = 'https://pbs.twimg.com/media/x.jpg?name=medium'

  /**
   * 디코딩 메모리는 화면에 그려지는 크기가 아니라 받은 픽셀 수로 정해진다.
   * 예전에는 파싱 시점에 1200px 로 굳혀 두어, 컬럼이 340px 이든 1200px 이든 같은
   * 사진을 받았다.
   */
  it('좁은 자리에는 작은 사진을 고른다', () => {
    expect(sizedMediaUrl(PHOTO, 460)).toContain('name=small')
  })

  it('넓은 자리에는 큰 사진을 고른다', () => {
    expect(sizedMediaUrl(PHOTO, 900)).toContain('name=medium')
  })

  it('경계값은 그 단계로 담는다 — 딱 맞으면 키울 이유가 없다', () => {
    expect(sizedMediaUrl(PHOTO, 680)).toContain('name=small')
    expect(sizedMediaUrl(PHOTO, 681)).toContain('name=medium')
  })

  /**
   * 목록에서 2048px(`large`) 를 들고 있을 이유가 없다. 넓은 컬럼 + 고DPI 화면에서
   * 상한 없이 계산하면 지금보다 큰 사진을 받게 되어, 메모리를 줄이려던 것이
   * 정반대로 간다. 확대해서 볼 때는 라이트박스가 `originalMediaUrl` 로 원본을 받는다.
   */
  it('아무리 넓어도 medium 을 넘지 않는다', () => {
    expect(sizedMediaUrl(PHOTO, 5000)).toContain('name=medium')
    expect(sizedMediaUrl(PHOTO, Number.POSITIVE_INFINITY)).toContain('name=medium')
  })

  it('정사각 크롭인 thumb 은 절대 고르지 않는다', () => {
    for (const needed of [1, 10, 149, 150, 151]) {
      expect(sizedMediaUrl(PHOTO, needed), String(needed)).not.toContain('name=thumb')
    }
  })

  /** `name` 을 덮어쓰는 방식이라 이미 저장된 글에도 그대로 듣는다. */
  it('이미 박혀 있는 크기를 덮어쓴다 — 저장값을 옮길 필요가 없다', () => {
    expect(sizedMediaUrl('https://pbs.twimg.com/media/x.jpg?name=medium', 400)).toBe(
      'https://pbs.twimg.com/media/x.jpg?name=small',
    )
  })

  it('name 이 없으면 붙인다', () => {
    expect(sizedMediaUrl('https://pbs.twimg.com/media/x.jpg', 400)).toContain('name=small')
  })

  it('다른 파라미터는 건드리지 않는다', () => {
    expect(sizedMediaUrl('https://pbs.twimg.com/media/x.jpg?format=jpg&name=medium', 400)).toContain(
      'format=jpg',
    )
  })

  it('다른 호스트는 손대지 않는다 — 영상은 크기 이름이 없다', () => {
    const url = 'https://video.twimg.com/clip/x.mp4?tag=1'
    expect(sizedMediaUrl(url, 400)).toBe(url)
  })

  it('주소로 못 읽으면 원본을 그대로 돌려준다', () => {
    expect(sizedMediaUrl('pbs.twimg.com/깨진 주소', 400)).toBe('pbs.twimg.com/깨진 주소')
  })

  /** 라이트박스는 이 값을 쓰지 않고 원본으로 갈아 끼운다. 둘이 어긋나면 안 된다. */
  it('라이트박스로 넘어가면 크기 제한이 풀린다', () => {
    expect(originalMediaUrl(sizedMediaUrl(PHOTO, 400))).toContain('name=orig')
  })
})

describe('aspectRatio', () => {
  it('크기를 모르면 16:9 로 둔다', () => {
    expect(aspectRatio(0, 0)).toBeCloseTo(16 / 9)
    expect(aspectRatio(100, 0)).toBeCloseTo(16 / 9)
  })

  it('원본 비율을 그대로 쓴다', () => {
    expect(aspectRatio(1200, 800)).toBeCloseTo(1.5)
  })

  it('너무 길쭉하거나 납작한 것은 잘라낸다 — 한 장이 화면을 다 먹으면 안 된다', () => {
    expect(aspectRatio(100, 1000)).toBe(0.6)
    expect(aspectRatio(1000, 100)).toBe(2.2)
  })
})
