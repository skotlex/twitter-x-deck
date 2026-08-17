/**
 * 컬럼이 항목을 늘어놓는 차례.
 *
 * 무엇을 '최신' 으로 볼지가 컬럼마다 다르다는 것이 이 파일의 전부다. 알림 컬럼에
 * 관측 시각을 앞세웠더니 사흘 전 '마음에 들어 합니다' 가 어제 온 답글 위에 앉았다 —
 * 다시 관측됐다는 것 말고는 아무 이유가 없었다.
 */
import { describe, expect, it } from 'vitest'
import type { StoredItem } from '../../src/core/db'
import { newestFirst } from '../../src/ui/hooks/useCollector'

/** 차례를 가르는 데 필요한 두 값만 담은 항목. */
const item = (label: string, capturedAt: number, createdAt: number): StoredItem =>
  ({ key: label, id: label, capturedAt, createdAt }) as unknown as StoredItem

/** 늘어놓은 뒤의 이름 차례. */
const order = (kind: Parameters<typeof newestFirst>[0], items: StoredItem[]): string[] =>
  [...items].sort(newestFirst(kind)).map((entry) => entry.key)

/** 사흘 전 글인데 방금 다시 관측된 것, 그리고 어제 받아둔 어제 글. */
const 오래된_글_방금_관측 = item('오래된글', 500, 100)
const 어제_글_어제_관측 = item('어제글', 200, 300)

describe('newestFirst — 컬럼마다 다른 최신순', () => {
  it('홈 컬럼은 관측 시각이 앞선다 — 방금 받아온 것이 위다', () => {
    expect(order('foryou', [어제_글_어제_관측, 오래된_글_방금_관측])).toEqual(['오래된글', '어제글'])
    expect(order('following', [어제_글_어제_관측, 오래된_글_방금_관측])).toEqual(['오래된글', '어제글'])
  })

  it('알림 컬럼은 글의 시각이 앞선다 — 다시 관측됐다고 위로 오지 않는다', () => {
    expect(order('notifications', [오래된_글_방금_관측, 어제_글_어제_관측])).toEqual([
      '어제글',
      '오래된글',
    ])
    expect(order('mentions', [오래된_글_방금_관측, 어제_글_어제_관측])).toEqual([
      '어제글',
      '오래된글',
    ])
  })

  /** 한 응답으로 들어온 것들은 관측 시각이 모두 같다. 그때는 글의 시각이 가른다. */
  it('홈 컬럼에서 같은 뭉치는 글의 시각으로 가른다', () => {
    const 먼저 = item('먼저', 500, 100)
    const 나중 = item('나중', 500, 200)
    expect(order('foryou', [먼저, 나중])).toEqual(['나중', '먼저'])
  })

  /** 알림은 시각이 초 단위까지 같은 경우가 있다. 그때는 관측 시각이 가른다. */
  it('알림 컬럼에서 글의 시각이 같으면 관측 시각으로 가른다', () => {
    const 먼저 = item('먼저', 100, 300)
    const 나중 = item('나중', 200, 300)
    expect(order('notifications', [먼저, 나중])).toEqual(['나중', '먼저'])
  })
})
