/**
 * [lightboxNav.ts](../../src/ui/lib/lightboxNav.ts) 의 사진 넘기기.
 *
 * 마지막 사진에서 '다음' 을 누르면 첫 사진으로 되돌아갔다. 끝에 닿았는지 알 수 없고,
 * 타래라면 다음 글의 사진으로 이어져야 할 자리였다.
 */
import { describe, expect, it } from 'vitest'
import type { DeckNotification, Tweet, TweetMedia } from '@core/types'
import { stepPhoto, threadMedia } from '@ui/lib/lightboxNav'

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
