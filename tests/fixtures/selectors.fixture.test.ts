/**
 * 실제 x.com 화면을 상대로 셀렉터를 돌린다.
 *
 * 손으로 만든 DOM 은 우리가 상상한 x.com 이지 진짜 x.com 이 아니다. 이 파일은 그
 * 간극을 메운다 — 추측으로 넣은 셀렉터가 정말 걸리는지 여기서만 알 수 있다.
 *
 * 픽스처를 뜨는 방법은 [README.md](./README.md) 에 있다. 하나도 없으면 통째로 건너뛴다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  findFocalArticle,
  findPhotoTarget,
  findPrimaryTweetAction,
  findRefreshPill,
  findTab,
  findViewer,
  isLoggedOut,
  primaryColumn,
  readComposerText,
} from '../../src/content/selectors'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 파일 이름 → 그 화면이 앉아 있어야 할 x.com 주소. */
const PATH_OF: Record<string, string> = {
  'home.html': '/home',
  'pill.html': '/home',
  'composer.html': '/home',
  'notifications.html': '/notifications',
  'status.html': '/alice/status/1',
}

function fixtures(): string[] {
  try {
    return readdirSync(HERE).filter((name) => name.endsWith('.html'))
  } catch {
    return []
  }
}

/**
 * 픽스처를 지금 문서에 앉힌다.
 *
 * `<html>` 통째로 떠 온 파일이라 innerHTML 로 밀어 넣으면 문서가 겹쳐 들어간다.
 * 한 번 파싱한 뒤 body 안쪽만 옮긴다. 스크립트는 돌지 않는다 — 우리가 재려는 것은
 * 이미 그려진 DOM 이므로 그게 맞다.
 */
function load(name: string): void {
  const html = readFileSync(join(HERE, name), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body?.innerHTML ?? ''
  window.history.pushState({}, '', PATH_OF[name] ?? '/home')
}

const present = fixtures()
const has = (name: string): boolean => present.includes(name)

if (present.length === 0) {
  describe.skip('실제 x.com 픽스처', () => {
    it('tests/fixtures/README.md 를 보고 화면을 떠 넣으면 검사한다', () => {})
  })
}

describe.skipIf(!has('home.html'))('home.html — 홈 화면', () => {
  beforeAll(() => load('home.html'))

  it('로그인한 것으로 읽힌다', () => {
    expect(isLoggedOut()).toBe(false)
  })

  it('primaryColumn 이 있다 — 다른 셀렉터 대부분이 여기에 기댄다', () => {
    expect(primaryColumn()).not.toBeNull()
  })

  it('추천·팔로잉 탭을 찾는다', () => {
    const foryou = findTab('foryou')
    const following = findTab('following')
    expect(foryou).not.toBeNull()
    expect(following).not.toBeNull()
    // 위치 폴백으로 같은 것을 두 번 집었다면 라벨 매칭이 깨진 것이다.
    expect(foryou).not.toBe(following)
  })

  it('로그인한 계정을 읽는다', () => {
    const viewer = findViewer()
    expect(viewer?.handle).toBeTruthy()
    expect(viewer?.name).toBeTruthy()
  })

  it('알림 컬럼 탭은 집지 않는다 — 여기는 홈이다', () => {
    expect(findTab('notifications')).toBeNull()
    expect(findTab('mentions')).toBeNull()
  })
})

describe.skipIf(!has('notifications.html'))('notifications.html — 알림 화면', () => {
  beforeAll(() => load('notifications.html'))

  it('알림·멘션 탭을 찾는다', () => {
    const all = findTab('notifications')
    const mentions = findTab('mentions')
    expect(all).not.toBeNull()
    expect(mentions).not.toBeNull()
    expect(all).not.toBe(mentions)
  })

  it('홈 컬럼 탭은 집지 않는다', () => {
    expect(findTab('foryou')).toBeNull()
    expect(findTab('following')).toBeNull()
  })
})

describe.skipIf(!has('pill.html'))('pill.html — 새 게시물 알약', () => {
  beforeAll(() => load('pill.html'))

  it('알약을 찾는다', () => {
    expect(findRefreshPill()).not.toBeNull()
  })

  it('건수를 읽는다', () => {
    // 숫자를 못 읽으면 알약을 눌러도 몇 건이 들어올지 모른 채로 간다.
    expect(findRefreshPill()?.count).toBeGreaterThan(0)
  })
})

describe.skipIf(!has('status.html'))('status.html — 게시물 상세', () => {
  beforeAll(() => load('status.html'))

  it('주인공 게시물을 고른다', () => {
    expect(findFocalArticle(document)).not.toBeNull()
  })

  it('답글 상세에서 첫 article 을 그냥 집지 않는다', () => {
    const articles = [...document.querySelectorAll('[data-testid="primaryColumn"] article')]
    const focal = findFocalArticle(document)
    // 원글이 위에 함께 그려진 화면이라면 주인공은 첫 번째가 아니다.
    const hasParentAbove = articles.length > 1 && articles[0]?.querySelector('time a') !== null
    if (hasParentAbove) expect(focal).not.toBe(articles[0])
  })

  it('하트·리포스트 버튼을 찾는다', () => {
    expect(findPrimaryTweetAction(document, ['like', 'unlike'])).not.toBeNull()
    expect(findPrimaryTweetAction(document, ['retweet', 'unretweet'])).not.toBeNull()
  })

  /**
   * 사진 클릭을 가로채는 자리. 사진이 없는 글로 뜬 픽스처면 잴 것이 없어 그냥 지나간다 —
   * 이 항목까지 보려면 사진이 걸린 글의 상세를 떠야 한다.
   */
  it('사진을 누르면 라이트박스로 넘길 것을 읽는다', () => {
    const link = document.querySelector<HTMLAnchorElement>('a[href*="/photo/"]')
    if (!link) return

    const hit = findPhotoTarget(link.querySelector('img') ?? link)
    expect(hit).not.toBeNull()
    expect(hit?.media.length).toBeGreaterThan(0)
    expect(hit?.media[0]?.previewUrl).toContain('http')
    expect(hit?.sourceUrl).toMatch(/^https:\/\/x\.com\/[^/]+\/status\/\d+$/)
  })
})

describe.skipIf(!has('composer.html'))('composer.html — 작성창', () => {
  beforeAll(() => load('composer.html'))

  it('작성창을 찾는다', () => {
    expect(readComposerText(document)).not.toBeNull()
  })

  it('자리표시자를 사용자가 쓴 글로 읽지 않는다', () => {
    // 아무 것도 안 쓴 채로 뜬 작성창이라면 빈 문자열이어야 한다.
    // 여기서 '무슨 일이 일어나고 있나요?' 같은 안내가 나오면 창이 안 닫히는 그 버그다.
    const text = readComposerText(document) ?? ''
    expect(text).not.toMatch(/무슨 일이|What is happening|답글 게시하기|Post your reply/i)
  })
})
