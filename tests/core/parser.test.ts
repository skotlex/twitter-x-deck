/**
 * [parser.ts](../../src/core/parser.ts) 는 x.com 내부 GraphQL 응답을 우리 모델로 옮긴다.
 *
 * 이 파일이 재는 것은 '스키마가 바뀌었을 때 조용히 빈손이 되지 않는가' 다.
 * 파서는 실패해도 예외를 던지지 않게 만들어져 있어서, 깨져도 화면이 그냥 조용해질 뿐
 * 아무 데서도 티가 나지 않는다 — 그 침묵을 여기서 잡는다.
 */
import { describe, expect, it } from 'vitest'
import { parseCreatedTweet, parseDeletedId, parseTimelinePayload } from '@core/parser'
import { isNotification } from '@core/types'
import type { DeckItem, DeckNotification, Tweet } from '@core/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const CAPTURED_AT = 1_700_000_000_000

/** 최소한의 user_results.result. 실제 응답의 필드 이름을 그대로 쓴다. */
function user(handle: string, name = handle): Raw {
  return {
    __typename: 'User',
    rest_id: `u-${handle}`,
    core: { screen_name: handle, name },
    avatar: { image_url: `https://pbs.twimg.com/${handle}_normal.jpg` },
    is_blue_verified: false,
  }
}

/** 최소한의 tweet_results.result. 넘긴 값으로 legacy 를 덮어쓴다. */
function tweet(id: string, handle: string, legacy: Raw = {}): Raw {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: user(handle) } },
    legacy: {
      full_text: `post ${id}`,
      created_at: 'Wed Oct 10 20:19:24 +0000 2018',
      ...legacy,
    },
  }
}

/** tweet 목록을 정석 경로(instructions → entries)로 감싼다. */
function timeline(...tweets: Raw[]): string {
  return JSON.stringify({
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: tweets.map((t, i) => ({
                entryId: `tweet-${i}`,
                content: {
                  entryType: 'TimelineTimelineItem',
                  itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } },
                },
              })),
            },
          ],
        },
      },
    },
  })
}

const tweetsOf = (items: readonly DeckItem[]): Tweet[] =>
  items.filter((item): item is Tweet => !isNotification(item))

const notificationsOf = (items: readonly DeckItem[]): DeckNotification[] =>
  items.filter((item): item is DeckNotification => isNotification(item))

describe('parseTimelinePayload — 정석 경로', () => {
  it('entries 안의 게시물을 순서대로 뽑는다', () => {
    const result = parseTimelinePayload(
      timeline(tweet('1', 'alice'), tweet('2', 'bob')),
      'foryou',
      CAPTURED_AT,
    )

    expect(result.degraded).toBe(false)
    expect(result.items).toHaveLength(2)
    const [first, second] = tweetsOf(result.items)
    expect(first?.id).toBe('1')
    expect(first?.author.handle).toBe('alice')
    expect(first?.source).toBe('foryou')
    expect(first?.url).toBe('https://x.com/alice/status/1')
    expect(second?.id).toBe('2')
  })

  it('아바타를 _bigger 로 올린다', () => {
    const { items } = parseTimelinePayload(timeline(tweet('1', 'alice')), 'foryou', CAPTURED_AT)
    expect(tweetsOf(items)[0]?.author.avatarUrl).toBe('https://pbs.twimg.com/alice_bigger.jpg')
  })

  it('대화 스레드(module)에 묶여 온 게시물도 뽑는다', () => {
    const body = JSON.stringify({
      data: {
        instructions: [
          {
            entries: [
              {
                entryId: 'conversation-1',
                content: {
                  entryType: 'TimelineTimelineModule',
                  items: [
                    {
                      item: {
                        itemContent: {
                          itemType: 'TimelineTweet',
                          tweet_results: { result: tweet('10', 'alice') },
                        },
                      },
                    },
                    {
                      item: {
                        itemContent: {
                          itemType: 'TimelineTweet',
                          tweet_results: { result: tweet('11', 'alice') },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    })

    const { items, degraded } = parseTimelinePayload(body, 'following', CAPTURED_AT)
    expect(degraded).toBe(false)
    expect(tweetsOf(items).map((t) => t.id)).toEqual(['10', '11'])
  })

  it('같은 게시물이 두 번 실려 와도 하나만 남긴다', () => {
    const { items } = parseTimelinePayload(
      timeline(tweet('1', 'alice'), tweet('1', 'alice')),
      'foryou',
      CAPTURED_AT,
    )
    expect(items).toHaveLength(1)
  })
})

describe('parseTimelinePayload — degraded 판정', () => {
  /**
   * 이건 실제로 났던 회귀다. 새 글이 없는 평범한 응답까지 전부 '폴백' 으로 표시돼서
   * 진단 배지가 늘 켜져 있었다. 비었다는 것과 못 읽었다는 것은 다르다.
   */
  it('새 글이 없는 응답은 폴백으로 세지 않는다', () => {
    const { items, degraded } = parseTimelinePayload(timeline(), 'foryou', CAPTURED_AT)
    expect(items).toHaveLength(0)
    expect(degraded).toBe(false)
  })

  it('instructions 를 못 찾으면 전체 훑기로 건지고 degraded 를 세운다', () => {
    const body = JSON.stringify({ data: { some_new_shape: { rows: [tweet('7', 'alice')] } } })
    const { items, degraded } = parseTimelinePayload(body, 'foryou', CAPTURED_AT)

    expect(degraded).toBe(true)
    expect(tweetsOf(items).map((t) => t.id)).toEqual(['7'])
  })

  it('전체 훑기에서 인용 원본이 최상위 항목으로 중복되지 않는다', () => {
    const quoted = tweet('100', 'bob')
    const outer = { ...tweet('200', 'alice'), quoted_status_result: { result: quoted } }
    const body = JSON.stringify({ data: { unknown_shape: [outer] } })

    const { items, degraded } = parseTimelinePayload(body, 'foryou', CAPTURED_AT)
    expect(degraded).toBe(true)
    // 인용 원본(100)은 카드 안에 이미 실려 있다. 목록에 또 세우면 같은 글이 두 줄이 된다.
    expect(tweetsOf(items).map((t) => t.id)).toEqual(['200'])
    expect(tweetsOf(items)[0]?.quoted?.id).toBe('100')
  })
})

describe('parseTimelinePayload — 리포스트와 인용', () => {
  it('리포스트는 원본이 본체이고 겉 계정은 repostedBy 로 남는다', () => {
    const original = tweet('1', 'alice', { full_text: '원본 글' })
    const wrapper = tweet('2', 'bob', { retweeted_status_result: { result: original } })

    const { items } = parseTimelinePayload(timeline(wrapper), 'following', CAPTURED_AT)
    const [post] = tweetsOf(items)

    expect(post?.id).toBe('1')
    expect(post?.text).toBe('원본 글')
    expect(post?.author.handle).toBe('alice')
    expect(post?.repostedBy?.handle).toBe('bob')
  })

  it('리포스트 여부는 겉 껍데기의 retweeted 를 따른다', () => {
    const original = tweet('1', 'alice', { retweeted: false })
    const wrapper = tweet('2', 'bob', {
      retweeted: true,
      retweeted_status_result: { result: original },
    })

    const { items } = parseTimelinePayload(timeline(wrapper), 'following', CAPTURED_AT)
    expect(tweetsOf(items)[0]?.viewer?.reposted).toBe(true)
  })

  it('인용은 한 겹만 펼친다', () => {
    const inner = tweet('1', 'carol')
    const middle = { ...tweet('2', 'bob'), quoted_status_result: { result: inner } }
    const outer = { ...tweet('3', 'alice'), quoted_status_result: { result: middle } }

    const [post] = tweetsOf(parseTimelinePayload(timeline(outer), 'foryou', CAPTURED_AT).items)
    expect(post?.quoted?.id).toBe('2')
    expect(post?.quoted?.quoted).toBeUndefined()
  })

  it('TweetWithVisibilityResults 래퍼를 벗긴다', () => {
    const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: tweet('5', 'alice') }
    const { items } = parseTimelinePayload(timeline(wrapped), 'foryou', CAPTURED_AT)
    expect(tweetsOf(items)[0]?.id).toBe('5')
  })

  it('툼스톤 같은 낯선 typename 은 버린다', () => {
    const tombstone = { __typename: 'TweetTombstone', tombstone: { text: '이 게시물은 없습니다' } }
    const { items } = parseTimelinePayload(
      timeline(tombstone, tweet('1', 'alice')),
      'foryou',
      CAPTURED_AT,
    )
    expect(tweetsOf(items).map((t) => t.id)).toEqual(['1'])
  })
})

describe('본문 정규화', () => {
  const textOf = (legacy: Raw, extra: Raw = {}): string => {
    const raw = { ...tweet('1', 'alice', legacy), ...extra }
    return tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)[0]?.text ?? ''
  }

  it('display_text_range 뒤에 붙는 미디어 링크를 잘라낸다', () => {
    const text = textOf({
      full_text: '사진 붙임 https://t.co/abc',
      display_text_range: [0, 6],
    })
    expect(text).toBe('사진 붙임')
  })

  it('display_text_range 를 코드포인트 단위로 자른다', () => {
    // 이모지는 UTF-16 두 칸을 쓴다. 문자열 인덱스로 자르면 서로게이트가 반쪽만 남아 깨진다.
    const text = textOf({ full_text: '👍👍👍 뒤', display_text_range: [0, 3] })
    expect(text).toBe('👍👍👍')
  })

  it('t.co 링크를 원래 주소로 되돌린다', () => {
    const text = textOf({
      full_text: '여기 봐 https://t.co/short',
      entities: { urls: [{ url: 'https://t.co/short', expanded_url: 'https://example.com/page' }] },
    })
    expect(text).toBe('여기 봐 https://example.com/page')
  })

  it('HTML 엔티티를 되돌린다', () => {
    expect(textOf({ full_text: 'a &amp; b &lt;c&gt;' })).toBe('a & b <c>')
  })

  it('긴 글은 note_tweet 의 전문을 쓴다', () => {
    const text = textOf(
      { full_text: '앞부분만 잘린 글…' },
      { note_tweet: { note_tweet_results: { result: { text: '잘리지 않은 전문' } } } },
    )
    expect(text).toBe('잘리지 않은 전문')
  })

  it('note_tweet 이 있으면 display_text_range 로 자르지 않는다', () => {
    const text = textOf(
      { full_text: '짧은 판', display_text_range: [0, 2] },
      { note_tweet: { note_tweet_results: { result: { text: '전문 그대로 남아야 한다' } } } },
    )
    expect(text).toBe('전문 그대로 남아야 한다')
  })
})

describe('미디어', () => {
  const mediaOf = (media: Raw[]): Tweet['media'] => {
    const raw = tweet('1', 'alice', { extended_entities: { media } })
    return tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)[0]?.media ?? []
  }

  it('사진의 크기와 미리보기 주소를 읽는다', () => {
    const [photo] = mediaOf([
      {
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/x.jpg',
        original_info: { width: 1200, height: 800 },
        ext_alt_text: '설명',
      },
    ])
    expect(photo?.kind).toBe('photo')
    expect(photo?.previewUrl).toBe('https://pbs.twimg.com/media/x.jpg?name=medium')
    expect(photo).toMatchObject({ width: 1200, height: 800, altText: '설명' })
  })

  it('영상은 비트레이트가 가장 높은 mp4 를 고른다', () => {
    const [video] = mediaOf([
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/media/v.jpg',
        original_info: { width: 1280, height: 720 },
        video_info: {
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video/hls.m3u8' },
            { content_type: 'video/mp4', bitrate: 832000, url: 'https://video/low.mp4' },
            { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video/high.mp4' },
          ],
        },
      },
    ])
    expect(video?.kind).toBe('video')
    expect(video?.playbackUrl).toBe('https://video/high.mp4')
  })

  it('GIF 는 비트레이트가 0 이어도 재생 주소를 잡는다', () => {
    const [gif] = mediaOf([
      {
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg',
        video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: 'https://g.mp4' }] },
      },
    ])
    expect(gif?.kind).toBe('animated_gif')
    expect(gif?.playbackUrl).toBe('https://g.mp4')
  })
})

describe('통계', () => {
  it('legacy 아래 값을 읽는다', () => {
    const raw = tweet('1', 'alice', {
      reply_count: 3,
      retweet_count: 12,
      favorite_count: 400,
      quote_count: 1,
      bookmark_count: 7,
    })
    const [post] = tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)
    expect(post?.stats).toMatchObject({
      replies: 3,
      reposts: 12,
      likes: 400,
      quotes: 1,
      bookmarks: 7,
    })
  })

  it('스키마 이행 중 tweet 바로 아래로 오는 값도 읽는다', () => {
    const raw = { ...tweet('1', 'alice'), favorite_count: 99 }
    const [post] = tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)
    expect(post?.stats.likes).toBe(99)
  })

  it('조회수는 문자열로 와도 숫자로 만든다', () => {
    const raw = { ...tweet('1', 'alice'), views: { count: '12345' } }
    const [post] = tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)
    expect(post?.stats.views).toBe(12345)
  })
})

describe('알림', () => {
  const notificationEntry = (item: Raw): string =>
    JSON.stringify({
      data: {
        instructions: [
          { entries: [{ entryId: 'notification-1', content: { itemContent: item } }] },
        ],
      },
    })

  it('아이콘 이름을 우리 종류로 옮긴다', () => {
    const cases: Array<[string, string]> = [
      ['heart_icon', 'like'],
      ['retweet_icon', 'repost'],
      ['person_icon', 'follow'],
      ['mention_icon', 'mention'],
      ['bell_icon_we_dont_know', 'other'],
    ]

    for (const [name, expected] of cases) {
      const body = notificationEntry({
        itemType: 'TimelineNotification',
        id: `n-${name}`,
        notification_icon: name,
        message: { text: '알림 문구' },
        timestamp_ms: '1700000000000',
      })
      const [notification] = notificationsOf(
        parseTimelinePayload(body, 'notifications', CAPTURED_AT).items,
      )
      expect(notification?.icon, name).toBe(expected)
    }
  })

  it('초 단위로 온 시각을 밀리초로 올린다', () => {
    const body = notificationEntry({
      itemType: 'TimelineNotification',
      id: 'n-1',
      notification_icon: 'heart_icon',
      message: { text: '좋아요' },
      timestamp_ms: 1_700_000_000,
    })
    const [notification] = notificationsOf(
      parseTimelinePayload(body, 'notifications', CAPTURED_AT).items,
    )
    expect(notification?.createdAt).toBe(1_700_000_000_000)
  })

  it('문구가 비어도 빈 카드로 두지 않는다', () => {
    const body = notificationEntry({
      itemType: 'TimelineNotification',
      id: 'n-2',
      notification_icon: 'person_icon',
      template: { user_results: { result: user('alice', '앨리스') } },
    })
    const [notification] = notificationsOf(
      parseTimelinePayload(body, 'notifications', CAPTURED_AT).items,
    )
    expect(notification?.text).toBe('앨리스님의 새 알림')
    expect(notification?.actors[0]?.handle).toBe('alice')
  })

  it('알림이 가리키는 게시물을 목록에 또 세우지 않는다', () => {
    const target = tweet('42', 'alice')
    const body = JSON.stringify({
      data: {
        instructions: [
          {
            entries: [
              {
                entryId: 'notification-1',
                content: {
                  itemContent: {
                    itemType: 'TimelineNotification',
                    id: 'n-3',
                    notification_icon: 'heart_icon',
                    message: { text: '누군가 좋아합니다' },
                    template: { target_objects: [target] },
                  },
                },
              },
              {
                entryId: 'tweet-1',
                content: {
                  entryType: 'TimelineTimelineItem',
                  itemContent: { itemType: 'TimelineTweet', tweet_results: { result: target } },
                },
              },
            ],
          },
        ],
      },
    })

    const { items } = parseTimelinePayload(body, 'notifications', CAPTURED_AT)
    expect(notificationsOf(items)[0]?.target?.id).toBe('42')
    expect(tweetsOf(items)).toHaveLength(0)
  })
})

describe('망가진 입력', () => {
  it('JSON 이 아니면 예외 대신 빈 결과를 준다', () => {
    expect(parseTimelinePayload('<!doctype html>', 'foryou', CAPTURED_AT)).toEqual({
      items: [],
      degraded: false,
    })
  })

  it('빈 본문도 마찬가지다', () => {
    expect(parseTimelinePayload('', 'foryou', CAPTURED_AT).items).toEqual([])
  })

  it('id 가 없는 게시물은 버린다', () => {
    const noId = { __typename: 'Tweet', legacy: { full_text: 'id 없음' } }
    expect(parseTimelinePayload(timeline(noId), 'foryou', CAPTURED_AT).items).toEqual([])
  })

  it('created_at 을 못 읽으면 수집 시각으로 대신한다', () => {
    const raw = tweet('1', 'alice', { created_at: '알 수 없는 형식' })
    const [post] = tweetsOf(parseTimelinePayload(timeline(raw), 'foryou', CAPTURED_AT).items)
    expect(post?.createdAt).toBe(CAPTURED_AT)
  })
})

describe('parseCreatedTweet / parseDeletedId', () => {
  it('방금 올린 글을 정석 경로에서 꺼낸다', () => {
    const body = JSON.stringify({
      data: { create_tweet: { tweet_results: { result: tweet('900', 'alice') } } },
    })
    expect(parseCreatedTweet(body, 'foryou', CAPTURED_AT)?.id).toBe('900')
  })

  it('응답 모양이 바뀌어도 전체 훑기로 건진다', () => {
    const body = JSON.stringify({ data: { renamed_mutation: { result: tweet('901', 'alice') } } })
    expect(parseCreatedTweet(body, 'foryou', CAPTURED_AT)?.id).toBe('901')
  })

  it('건질 게 없으면 null 이다', () => {
    expect(parseCreatedTweet('{}', 'foryou', CAPTURED_AT)).toBeNull()
    expect(parseCreatedTweet('not json', 'foryou', CAPTURED_AT)).toBeNull()
  })

  it('삭제 요청에서 게시물 id 를 읽는다', () => {
    expect(parseDeletedId(JSON.stringify({ variables: { tweet_id: '55' } }))).toBe('55')
    expect(parseDeletedId(JSON.stringify({ variables: { tweetId: '56' } }))).toBe('56')
    expect(parseDeletedId(JSON.stringify({ variables: {} }))).toBeNull()
    expect(parseDeletedId('not json')).toBeNull()
  })
})
