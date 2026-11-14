/**
 * [lightboxNav.ts](../../src/ui/lib/lightboxNav.ts) 의 사진 넘기기.
 *
 * 마지막 사진에서 '다음' 을 누르면 첫 사진으로 되돌아갔다. 끝에 닿았는지 알 수 없고,
 * 타래라면 다음 글의 사진으로 이어져야 할 자리였다.
 */
import { describe, expect, it } from 'vitest'
import type { DeckNotification, Tweet, TweetMedia } from '@core/types'
import { followGroups, mayContinueThread, stepPhoto, threadMedia } from '@ui/lib/lightboxNav'

describe('stepPhoto — 한 글 안', () => {
  it('묶음 안에서는 한 장씩 옮긴다', () => {
    expect(stepPhoto([3], { group: 0, index: 0 }, 1)).toEqual({ group: 0, index: 1 })
    expect(stepPhoto([3], { group: 0, index: 2 }, -1)).toEqual({ group: 0, index: 1 })
  })

  it('마지막 사진에서 다음으로 가도 첫 사진으로 돌아가지 않는다', () => {
    expect(stepPhoto([3], { group: 0, index: 2 }, 1)).toBeNull()
  })

  it('첫 사진에서 이전으로 가도 마지막 사진으로 돌아가지 않는다', () => {
    expect(stepPhoto([3], { group: 0, index: 0 }, -1)).toBeNull()
  })

  it('한 장뿐이면 어느 쪽으로도 가지 않는다', () => {
    expect(stepPhoto([1], { group: 0, index: 0 }, 1)).toBeNull()
    expect(stepPhoto([1], { group: 0, index: 0 }, -1)).toBeNull()
  })
})

describe('stepPhoto — 타래', () => {
  it('글의 마지막 사진에서 다음은 다음 글의 첫 사진이다', () => {
    expect(stepPhoto([2, 3], { group: 0, index: 1 }, 1)).toEqual({ group: 1, index: 0 })
  })

  it('글의 첫 사진에서 이전은 앞 글의 마지막 사진이다', () => {
    expect(stepPhoto([2, 3], { group: 1, index: 0 }, -1)).toEqual({ group: 0, index: 1 })
  })

  it('타래의 마지막 사진에서는 멈춘다', () => {
    expect(stepPhoto([2, 3], { group: 1, index: 2 }, 1)).toBeNull()
    expect(stepPhoto([2, 3], { group: 0, index: 0 }, -1)).toBeNull()
  })

  it('사진이 없는 묶음은 건너뛴다', () => {
    expect(stepPhoto([1, 0, 2], { group: 0, index: 0 }, 1)).toEqual({ group: 2, index: 0 })
    expect(stepPhoto([1, 0, 2], { group: 2, index: 0 }, -1)).toEqual({ group: 0, index: 0 })
  })
})

describe('threadMedia — 컬럼 카드에서 연 사진의 타래', () => {
  function photo(name: string): TweetMedia {
    return { kind: 'photo', previewUrl: `https://pbs.twimg.com/media/${name}.jpg`, width: 1, height: 1 }
  }

  /** 컬럼에 실린 글 하나. 대화와 답글 대상은 넘긴 값으로 덮는다. */
  function post(id: string, handle: string, photos: string[], extra: Partial<Tweet> = {}): Tweet {
    return {
      id,
      createdAt: 0,
      text: '',
      author: { id: `u-${handle}`, handle, name: handle, avatarUrl: '', verified: false },
      media: photos.map(photo),
      stats: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: 0 },
      url: `https://x.com/${handle}/status/${id}`,
      source: 'following',
      capturedAt: 0,
      ...extra,
    }
  }

  const root = post('100', 'alice', ['a1'], { conversationId: '100' })
  const second = post('101', 'alice', ['b1', 'b2'], { conversationId: '100', replyToHandle: 'alice' })
  const third = post('102', 'Alice', ['c1'], { conversationId: '100', replyToHandle: 'ALICE' })

  const urls = (hit: ReturnType<typeof threadMedia>) =>
    hit.groups.map((group) => group.media.map((item) => item.previewUrl.split('/').pop()))

  it('첫 글의 사진을 누르면 이어 쓴 글의 사진까지 글 순서대로 묶는다', () => {
    // 컬럼은 최신 글이 위에 온다. 타래는 쓴 순서로 넘겨야 한다.
    const hit = threadMedia([third, second, root], root, 0)
    expect(urls(hit)).toEqual([['a1.jpg'], ['b1.jpg', 'b2.jpg'], ['c1.jpg']])
    expect(hit.group).toBe(0)
    expect(hit.index).toBe(0)
  })

  it('가운데 글을 누르면 그 글의 그 사진부터 연다', () => {
    const hit = threadMedia([root, second, third], second, 1)
    expect(hit.group).toBe(1)
    expect(hit.index).toBe(1)
  })

  it('다른 사람의 답글은 섞지 않는다', () => {
    const other = post('103', 'bob', ['d1'], { conversationId: '100', replyToHandle: 'alice' })
    expect(urls(threadMedia([root, other, second], root, 0))).toEqual([['a1.jpg'], ['b1.jpg', 'b2.jpg']])
  })

  it('같은 사람이라도 남에게 단 답글은 타래가 아니다', () => {
    const answer = post('104', 'alice', ['e1'], { conversationId: '100', replyToHandle: 'bob' })
    expect(urls(threadMedia([root, answer], root, 0))).toEqual([['a1.jpg']])
  })

  it('사진 없는 글은 묶음을 만들지 않는다', () => {
    const textOnly = post('105', 'alice', [], { conversationId: '100', replyToHandle: 'alice' })
    expect(urls(threadMedia([root, textOnly, third], root, 0))).toEqual([['a1.jpg'], ['c1.jpg']])
  })

  it('리포스트로 같은 글이 두 번 실려도 한 번만 담는다', () => {
    const reposted = { ...second, repostedBy: root.author }
    expect(urls(threadMedia([root, second, reposted], root, 0))).toEqual([['a1.jpg'], ['b1.jpg', 'b2.jpg']])
  })

  it('대화를 모르는 예전 글은 그 글 하나만 연다', () => {
    const legacy = post('200', 'alice', ['f1', 'f2'])
    const hit = threadMedia([legacy, post('201', 'alice', ['g1'])], legacy, 1)
    expect(urls(hit)).toEqual([['f1.jpg', 'f2.jpg']])
    expect(hit.index).toBe(1)
  })

  it('컬럼에 없는 답글도 받아온 대화와 합치면 다음 글로 이어진다', () => {
    // 컬럼에는 첫 글만 실려 있다. 이어 쓴 답글은 상세 페이지에서 받아온 것이다.
    const fetched = [root, second, third]
    const hit = threadMedia([root, ...fetched], root, 0)
    expect(urls(hit)).toEqual([['a1.jpg'], ['b1.jpg', 'b2.jpg'], ['c1.jpg']])
    expect(hit.group).toBe(0)
  })

  it('컬럼의 글이 대화를 몰라도 받아온 같은 글이 알면 타래로 묶는다', () => {
    // 대화 정보가 생기기 전에 저장된 글. 상세 페이지에서 받은 같은 글에는 실려 있다.
    const stale = post('100', 'alice', ['a1'])
    const hit = threadMedia([stale, root, second], stale, 0)
    expect(urls(hit)).toEqual([['a1.jpg'], ['b1.jpg', 'b2.jpg']])
    expect(hit.group).toBe(0)
  })

  it('알림이 섞인 컬럼에서도 글만 본다', () => {
    const notice: DeckNotification = {
      kind: 'notification',
      id: 'n1',
      createdAt: 0,
      text: '',
      icon: 'like',
      actors: [],
      source: 'notifications',
      capturedAt: 0,
    }
    expect(urls(threadMedia([notice, root, second], root, 0))).toHaveLength(2)
  })
})

describe('mayContinueThread — 상세 페이지에서 타래를 받아올지', () => {
  function post(extra: Partial<Tweet>): Tweet {
    return {
      id: '100',
      createdAt: 0,
      text: '',
      author: { id: 'u-alice', handle: 'alice', name: 'alice', avatarUrl: '', verified: false },
      media: [],
      stats: { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: 0 },
      url: 'https://x.com/alice/status/100',
      source: 'following',
      capturedAt: 0,
      ...extra,
    }
  }
  const stats = { replies: 0, reposts: 0, likes: 0, quotes: 0, bookmarks: 0 }

  it('답글이 달린 글이면 아래로 이어 쓴 글이 있을 수 있다', () => {
    expect(mayContinueThread(post({ stats: { ...stats, replies: 2 } }))).toBe(true)
  })

  it('자기에게 단 답글이면 위로 앞 글이 있다', () => {
    expect(mayContinueThread(post({ replyToHandle: 'Alice' }))).toBe(true)
  })

  it('답글도 없고 남에게 단 답글도 아니면 받아올 것이 없다', () => {
    expect(mayContinueThread(post({}))).toBe(false)
    expect(mayContinueThread(post({ replyToHandle: 'bob' }))).toBe(false)
  })
})

describe('followGroups — 라이트박스를 연 채로 묶음이 늘었을 때', () => {
  const group = (name: string, size = 1) => ({
    media: Array.from({ length: size }, (_, at) => ({
      kind: 'photo' as const,
      previewUrl: `https://pbs.twimg.com/media/${name}${at}.jpg`,
      width: 1,
      height: 1,
    })),
    sourceUrl: `https://x.com/alice/status/${name}`,
  })

  it('보던 글 앞에 묶음이 끼어들어도 보던 사진에 머문다', () => {
    const before = [group('2', 3)]
    const after = [group('1'), group('2', 3), group('3')]
    expect(followGroups(before, after, { group: 0, index: 2 })).toEqual({ group: 1, index: 2 })
  })

  it('보던 글이 새 목록에 없으면 자리를 그대로 둔다', () => {
    expect(followGroups([group('2')], [group('9')], { group: 0, index: 0 })).toEqual({ group: 0, index: 0 })
  })
})
