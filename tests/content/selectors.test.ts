/**
 * [selectors.ts](../../src/content/selectors.ts) 는 x.com DOM 에 손을 대는 유일한 자리다.
 * UI 개편 때 가장 먼저 깨지는 곳이고, 깨져도 예외가 나지 않고 그냥 조용해진다.
 *
 * 여기서는 **손으로 만든 최소 DOM** 으로 판단 규칙을 잰다. 진짜 x.com 화면을 상대로
 * 재는 것은 [tests/fixtures](../fixtures/README.md) 쪽이다. 둘은 목적이 다르다 —
 * 이 파일은 "규칙이 맞는가", 저쪽은 "지금 x.com 에 실제로 걸리는가" 를 본다.
 *
 * 각 테스트는 소스 주석에 '실제로 그랬다' 고 적혀 있는 과거 회귀에 대응한다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  findAccountMenuButton,
  findFocalArticle,
  findLogoutMenuItem,
  findPhotoTarget,
  findPrimaryTweetAction,
  findRefreshPill,
  findTab,
  findViewer,
  hasComposerAttachment,
  isLoggedOut,
  isOnPageFor,
  isTabSelected,
  readComposerText,
  simulateClick,
} from '../../src/content/selectors'

/**
 * 지금 문서의 주소를 갈아 끼운다. 홈이냐 알림이냐로 갈리는 판단이 많다.
 * 출처는 vitest.config.ts 에서 x.com 으로 고정해 뒀다.
 */
function setPath(path: string): void {
  window.history.pushState({}, '', path)
}

/** primaryColumn 으로 감싼 화면 하나를 세운다. */
function render(html: string): void {
  document.body.innerHTML = `<div data-testid="primaryColumn">${html}</div>`
}

beforeEach(() => {
  document.body.innerHTML = ''
  setPath('/home')
})

describe('isOnPageFor — 화면과 컬럼이 맞는지', () => {
  it('홈에서는 홈 컬럼만 수집할 수 있다', () => {
    setPath('/home')
    expect(isOnPageFor('foryou')).toBe(true)
    expect(isOnPageFor('following')).toBe(true)
    expect(isOnPageFor('notifications')).toBe(false)
    expect(isOnPageFor('mentions')).toBe(false)
  })

  it('알림 화면에서는 알림 컬럼만 수집할 수 있다', () => {
    setPath('/notifications')
    expect(isOnPageFor('notifications')).toBe(true)
    expect(isOnPageFor('mentions')).toBe(true)
    expect(isOnPageFor('foryou')).toBe(false)
  })

  it('멘션 하위 주소도 알림 화면으로 본다', () => {
    setPath('/notifications/mentions')
    expect(isOnPageFor('mentions')).toBe(true)
  })
})

describe('findTab', () => {
  const tablist = (...labels: string[]): string =>
    `<div role="tablist">${labels
      .map((label) => `<div role="tab" aria-selected="false">${label}</div>`)
      .join('')}</div>`

  it('한국어 라벨로 홈 탭을 찾는다', () => {
    render(tablist('추천', '팔로우 중'))
    expect(findTab('foryou')?.textContent).toBe('추천')
    expect(findTab('following')?.textContent).toBe('팔로우 중')
  })

  it('영어·일본어 화면에서도 같은 탭을 찾는다', () => {
    render(tablist('For you', 'Following'))
    expect(findTab('foryou')?.textContent).toBe('For you')
    expect(findTab('following')?.textContent).toBe('Following')

    render(tablist('おすすめ', 'フォロー中'))
    expect(findTab('foryou')?.textContent).toBe('おすすめ')
    expect(findTab('following')?.textContent).toBe('フォロー中')
  })

  it('라벨이 하나도 안 걸리면 위치로 잡는다', () => {
    render(tablist('알 수 없는 첫 탭', '알 수 없는 둘째 탭'))
    expect(findTab('foryou')?.textContent).toBe('알 수 없는 첫 탭')
    expect(findTab('following')?.textContent).toBe('알 수 없는 둘째 탭')
  })

  /**
   * 홈에서 알림 탭을 찾으면 위치 폴백이 추천 탭(0번)을 집는다.
   * 그대로 누르면 엉뚱한 화면을 새로 고치게 된다.
   */
  it('화면이 다르면 위치 폴백으로도 집지 않는다', () => {
    setPath('/home')
    render(tablist('추천', '팔로우 중'))
    expect(findTab('notifications')).toBeNull()
    expect(findTab('mentions')).toBeNull()

    setPath('/notifications')
    expect(findTab('foryou')).toBeNull()
    expect(findTab('following')).toBeNull()
  })

  it('안 보이는 탭은 후보에서 뺀다', () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <div role="tablist">
          <div role="tab" data-test-hidden="true">숨은 탭</div>
          <div role="tab">추천</div>
        </div>
      </div>`
    expect(findTab('foryou')?.textContent).toBe('추천')
  })

  it('탭이 없으면 null 이다', () => {
    render('<div>탭 없는 화면</div>')
    expect(findTab('foryou')).toBeNull()
  })

  it('선택된 탭을 구분한다', () => {
    render(`
      <div role="tablist">
        <div role="tab" aria-selected="true">추천</div>
        <div role="tab" aria-selected="false">팔로우 중</div>
      </div>`)
    expect(isTabSelected(findTab('foryou')!)).toBe(true)
    expect(isTabSelected(findTab('following')!)).toBe(false)
  })
})

describe('findRefreshPill', () => {
  it('data-testid 로 알약을 찾고 건수를 읽는다', () => {
    render('<div data-testid="pillToRefresh" role="button">3개의 게시물 보기</div>')
    expect(findRefreshPill()?.count).toBe(3)
  })

  it('영어 문구에서도 건수를 읽는다', () => {
    render('<div data-testid="pillToRefresh" role="button">Show 12 posts</div>')
    expect(findRefreshPill()?.count).toBe(12)
  })

  it('천 단위 구분 쉼표를 걷어낸다', () => {
    render('<div data-testid="pillToRefresh" role="button">1,234개의 게시물 보기</div>')
    expect(findRefreshPill()?.count).toBe(1234)
  })

  it('숫자 없는 문구여도 알약으로 인정하되 건수는 null 이다', () => {
    render('<div data-testid="pillToRefresh" role="button">새 게시물 보기</div>')
    const hit = findRefreshPill()
    expect(hit).not.toBeNull()
    expect(hit?.count).toBeNull()
  })

  /**
   * x.com 은 알약이 앉을 자리를 미리 만들어 두고 새 글이 생겼을 때만 채운다.
   * 그 빈 자리를 알약으로 세면 눌러도 아무 일이 없고, 자동 갱신도 수동 새로고침도
   * 거기서 멈춘 채 되살아나지 못한다.
   */
  it('문구가 비어 있는 빈 자리는 알약이 아니다', () => {
    render('<div data-testid="pillToRefresh" role="button"></div>')
    expect(findRefreshPill()).toBeNull()
  })

  it('안 보이는 알약은 세지 않는다', () => {
    render(
      '<div data-testid="pillToRefresh" role="button" data-test-hidden="true">3개의 게시물 보기</div>',
    )
    expect(findRefreshPill()).toBeNull()
  })

  it('pillLabel 만 있으면 감싼 버튼을 집는다', () => {
    render('<div role="button" id="wrap"><span data-testid="pillLabel">5개의 게시물 보기</span></div>')
    const hit = findRefreshPill()
    expect(hit?.element.id).toBe('wrap')
    expect(hit?.count).toBe(5)
  })

  it('testid 가 없으면 상단 버튼의 문구로 찾는다', () => {
    render('<div role="button" data-test-top="80">7개의 게시물 보기</div>')
    expect(findRefreshPill()?.count).toBe(7)
  })

  it('상단에서 멀리 떨어진 버튼은 알약으로 보지 않는다', () => {
    render('<div role="button" data-test-top="600">7개의 게시물 보기</div>')
    expect(findRefreshPill()).toBeNull()
  })

  /**
   * 상단에는 '새 게시물' 이라는 말이 들어간 다른 버튼(작성 버튼 등)이 함께 있다.
   * 문구로 찾을 때는 숫자가 있는 것만 믿는다.
   */
  it('문구로 찾을 때는 숫자 없는 상단 버튼을 믿지 않는다', () => {
    render('<div role="button" data-test-top="40">새 게시물 작성</div>')
    expect(findRefreshPill()).toBeNull()
  })

  it('알약이 없으면 null 이다', () => {
    render('<article>평범한 게시물</article>')
    expect(findRefreshPill()).toBeNull()
  })
})

describe('findFocalArticle — 상세 화면의 주인공 고르기', () => {
  /**
   * 답글의 상세 페이지에는 원글이 위에 먼저 그려진다. 첫 article 을 그냥 집으면
   * 엉뚱한 글에 하트를 누르게 된다. 주인공은 시각이 링크로 감싸여 있지 않다.
   */
  it('시각이 링크로 감싸이지 않은 article 을 고른다', () => {
    render(`
      <article id="parent"><a href="/a/status/1"><time datetime="2024-01-01"></time></a></article>
      <article id="focal"><time datetime="2024-01-02"></time></article>
      <article id="reply"><a href="/c/status/3"><time datetime="2024-01-03"></time></a></article>`)
    expect(findFocalArticle(document)?.id).toBe('focal')
  })

  it('가려낼 수 없으면 첫 article 로 물러선다', () => {
    render(`
      <article id="first"><a href="/a/status/1"><time></time></a></article>
      <article id="second"><a href="/b/status/2"><time></time></a></article>`)
    expect(findFocalArticle(document)?.id).toBe('first')
  })

  it('주인공 안의 동작 버튼만 집는다', () => {
    render(`
      <article id="parent">
        <a href="/a/status/1"><time></time></a>
        <div data-testid="like" id="parent-like"></div>
      </article>
      <article id="focal">
        <time></time>
        <div data-testid="like" id="focal-like"></div>
      </article>`)
    expect(findPrimaryTweetAction(document, ['like'])?.id).toBe('focal-like')
  })

  it('동작 버튼 후보를 순서대로 시도한다', () => {
    render('<article><time></time><div data-testid="unlike" id="target"></div></article>')
    expect(findPrimaryTweetAction(document, ['like', 'unlike'])?.id).toBe('target')
    expect(findPrimaryTweetAction(document, ['bookmark'])).toBeNull()
  })
})

describe('readComposerText — 작성창 내용 읽기', () => {
  /**
   * x.com 은 '답글 게시하기' 같은 안내를 편집기와 같은 접두사(`tweetTextarea_0_label`)로
   * 그리고, 그것이 편집기보다 문서 앞쪽에 오기도 한다. 접두사만 보고 집으면 안내 문구를
   * 사용자가 쓴 글로 읽고, 아무 것도 안 썼는데 '쓰던 글이 있다' 며 창이 안 닫힌다.
   */
  it('자리표시자가 편집기보다 앞에 있어도 편집기를 집는다', () => {
    document.body.innerHTML = `
      <div data-testid="tweetTextarea_0_label">답글 게시하기</div>
      <div data-testid="tweetTextarea_0">쓰던 글</div>`
    expect(readComposerText(document)).toBe('쓰던 글')
  })

  it('편집기 안에 들어앉은 자리표시자는 빼고 읽는다', () => {
    document.body.innerHTML = `
      <div data-testid="tweetTextarea_0"><span data-testid="placeholder_label">무슨 일이 일어나고 있나요?</span></div>`
    expect(readComposerText(document)).toBe('')
  })

  it('접두사만 맞는 편집기도 찾아낸다', () => {
    document.body.innerHTML = '<div data-testid="tweetTextarea_1">둘째 칸</div>'
    expect(readComposerText(document)).toBe('둘째 칸')
  })

  it('편집기가 없으면 null 이다', () => {
    document.body.innerHTML = '<div>작성창 없음</div>'
    expect(readComposerText(document)).toBeNull()
  })

  it('붙여둔 사진을 알아본다', () => {
    document.body.innerHTML = '<div data-testid="attachments"><img /></div>'
    expect(hasComposerAttachment(document)).toBe(true)
    document.body.innerHTML = ''
    expect(hasComposerAttachment(document)).toBe(false)
  })
})

describe('findViewer — 로그인한 계정 읽기', () => {
  it('프로필 링크 주소에서 핸들을 읽는다', () => {
    document.body.innerHTML = `
      <a data-testid="AppTabBar_Profile_Link" href="/alice"></a>
      <div data-testid="SideNav_AccountSwitcher_Button">
        <img src="https://pbs.twimg.com/alice.jpg" />
        <span>앨리스</span><span>@alice</span>
      </div>`
    expect(findViewer()).toEqual({
      handle: 'alice',
      name: '앨리스',
      avatarUrl: 'https://pbs.twimg.com/alice.jpg',
    })
  })

  it('이름이 안 그려진 좁은 화면에서는 핸들로 대신한다', () => {
    document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/alice"></a>'
    expect(findViewer()?.name).toBe('alice')
  })

  it('아직 안 그려졌으면 null 을 준다 — 부르는 쪽이 다시 물어본다', () => {
    document.body.innerHTML = '<div>사이드바 없음</div>'
    expect(findViewer()).toBeNull()
  })

  it('사진이 배경 그림으로만 그려졌어도 읽는다', () => {
    document.body.innerHTML = `
      <a data-testid="AppTabBar_Profile_Link" href="/alice"></a>
      <div data-testid="SideNav_AccountSwitcher_Button">
        <div style="background-image: url(&quot;https://pbs.twimg.com/alice.jpg&quot;)"></div>
        <span>앨리스</span>
      </div>`
    expect(findViewer()?.avatarUrl).toBe('https://pbs.twimg.com/alice.jpg')
  })

  it('계정 전환 버튼이 아직 없으면 내 아바타 칸에서 사진을 읽는다', () => {
    document.body.innerHTML = `
      <a data-testid="AppTabBar_Profile_Link" href="/alice"></a>
      <div data-testid="UserAvatar-Container-alice">
        <img src="https://pbs.twimg.com/alice.jpg" />
      </div>`
    expect(findViewer()?.avatarUrl).toBe('https://pbs.twimg.com/alice.jpg')
  })

  it('남의 아바타는 집지 않는다 — 타임라인에도 같은 칸이 있다', () => {
    document.body.innerHTML = `
      <a data-testid="AppTabBar_Profile_Link" href="/alice"></a>
      <div data-testid="UserAvatar-Container-bob">
        <img src="https://pbs.twimg.com/bob.jpg" />
      </div>`
    expect(findViewer()?.avatarUrl).toBe('')
  })

  it('계정 메뉴와 로그아웃 항목을 찾는다', () => {
    document.body.innerHTML = `
      <div data-testid="SideNav_AccountSwitcher_Button"></div>
      <div role="menuitem">@alice 계정에서 로그아웃</div>`
    expect(findAccountMenuButton(document)).not.toBeNull()
    expect(findLogoutMenuItem(document)?.textContent).toContain('로그아웃')
  })
})

describe('isLoggedOut', () => {
  /**
   * `isLoggedOut` 은 모듈 최상단에서 `window.location` 을 읽는다.
   * 로그인 화면 판정은 주소·UI·문구 세 단계를 순서대로 본다.
   */
  it('로그인 흐름 주소에 있으면 로그아웃으로 본다', async () => {
    const { isLoggedOut } = await import('../../src/content/selectors')
    for (const path of ['/login', '/signup', '/i/flow/login', '/i/flow/signup']) {
      setPath(path)
      expect(isLoggedOut(), path).toBe(true)
    }
  })

  it('로그인 UI 가 그려져 있으면 로그아웃으로 본다', async () => {
    const { isLoggedOut } = await import('../../src/content/selectors')
    setPath('/home')
    document.body.innerHTML = '<div data-testid="loginButton">로그인</div>'
    expect(isLoggedOut()).toBe(true)

    document.body.innerHTML = '<a href="/i/flow/login">계속하려면 로그인</a>'
    expect(isLoggedOut()).toBe(true)
  })

  /**
   * 게시물 안에 '로그인' 이 들어 있을 뿐인 링크를 근거로 삼으면 멀쩡히 로그인한
   * 사람의 덱이 통째로 비켜서 버린다.
   */
  it('게시물 본문 안의 로그인 이라는 말은 근거로 삼지 않는다', async () => {
    const { isLoggedOut } = await import('../../src/content/selectors')
    setPath('/home')
    document.body.innerHTML = '<article><a href="/some/post">로그인</a></article>'
    expect(isLoggedOut()).toBe(false)
  })

  it('문서가 아직 비어 있는 것을 로그아웃으로 읽지 않는다', async () => {
    const { isLoggedOut } = await import('../../src/content/selectors')
    setPath('/home')
    document.body.innerHTML = ''
    expect(isLoggedOut()).toBe(false)
  })

  it('긴 문장 안에 로그인 이 섞여 있는 것도 근거로 삼지 않는다', async () => {
    const { isLoggedOut } = await import('../../src/content/selectors')
    setPath('/home')
    document.body.innerHTML = '<div role="button">로그인 상태를 유지하려면 여기를 누르세요</div>'
    expect(isLoggedOut()).toBe(false)
  })
})

describe('매 tick 도는 순회가 타임라인 길이를 타지 않는지', () => {
  /**
   * 수집기는 `isLoggedOut()` 과 `findRefreshPill()` 을 **매 tick(1초)** 부르고,
   * 같은 문서가 컬럼 수만큼 떠 있다. 이 둘이 문서 전체를 훑으면 타임라인이 쌓일수록
   * 비용이 함께 자란다 — 실제로 x.com 탭 하나가 CPU 70% 대를 계속 붙들었고,
   * 그동안 다른 프로그램에서 끊김이 나타났다.
   *
   * 여기서 재는 것은 결과가 아니라 **무엇을 만졌는가** 다. 결과만 보면 게시물 안을
   * 수만 번 만진 뒤 전부 버리는 구현도 똑같이 통과한다.
   */

  /** 게시물 카드 하나. 문서의 버튼·링크는 절대다수가 이 안에 들어 있다. */
  const CARD = `<article>
    <a href="/someone">보낸 사람</a>
    <a href="/someone/status/1"><time></time></a>
    <div role="button">답글</div>
    <div role="button">리포스트</div>
    <div role="button">마음에 들어요</div>
    <div role="button">공유하기</div>
  </article>`

  /** 게시물 밖 버튼. 사이드바·추천 칸에도 버튼이 잔뜩 있다. */
  const ASIDE = '<div role="button" data-test-top="400">팔로우</div>'

  /**
   * 게시물 **안** 요소를 하나라도 만지면 센다.
   *
   * 옛 구현은 문서의 버튼·링크를 전부 받아 각각 `closest('article')` 로 걸러냈다.
   * 결과는 맞았지만 걸러내려고 매번 전부 만졌다. 만지지 않는 것과 만진 뒤 버리는
   * 것을 가르려면 접근 자체를 세는 수밖에 없다.
   */
  function watchInsideArticles(): { touches: () => number; restore: () => void } {
    const text = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent')!
    const rect = Element.prototype.getBoundingClientRect
    const nodes = [...document.querySelectorAll('article *')]
    let touches = 0

    for (const node of nodes) {
      const bump = <T>(run: () => T): T => {
        touches += 1
        return run()
      }
      Object.defineProperty(node, 'textContent', {
        configurable: true,
        get: () => bump(() => text.get!.call(node) as string),
      })
      Object.defineProperty(node, 'closest', {
        configurable: true,
        value: (selector: string) => bump(() => Element.prototype.closest.call(node, selector)),
      })
      Object.defineProperty(node, 'matches', {
        configurable: true,
        value: (selector: string) => bump(() => Element.prototype.matches.call(node, selector)),
      })
      Object.defineProperty(node, 'getBoundingClientRect', {
        configurable: true,
        value: () => bump(() => rect.call(node)),
      })
    }

    return {
      touches: () => touches,
      restore: () => {
        for (const node of nodes) {
          for (const key of ['textContent', 'closest', 'matches', 'getBoundingClientRect']) {
            Reflect.deleteProperty(node, key)
          }
        }
      },
    }
  }

  /** `getBoundingClientRect` 호출 수. 브라우저에서는 한 번마다 강제 레이아웃이 걸린다. */
  function countRects(): { calls: () => number; restore: () => void } {
    const original = Element.prototype.getBoundingClientRect
    let calls = 0
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      calls += 1
      return original.call(this)
    }
    return {
      calls: () => calls,
      restore: () => {
        Element.prototype.getBoundingClientRect = original
      },
    }
  }

  it('isLoggedOut 은 게시물 안을 만지지 않는다', () => {
    render(CARD.repeat(200))
    const probe = watchInsideArticles()
    const answer = isLoggedOut()
    probe.restore()

    expect(answer).toBe(false)
    expect(probe.touches()).toBe(0)
  })

  it('findRefreshPill 은 게시물 안을 만지지 않는다', () => {
    render(CARD.repeat(200))
    const probe = watchInsideArticles()
    const hit = findRefreshPill()
    probe.restore()

    expect(hit).toBeNull()
    expect(probe.touches()).toBe(0)
  })

  /**
   * 게시물 밖에도 버튼은 많다. 그것들까지 위치를 재면 매 tick 마다 강제 레이아웃이
   * 수백 번 걸린다 — 메인 스레드가 그 자리에서 멎는, 끊김을 만드는 종류의 작업이다.
   * 알약인지는 문구로 먼저 가릴 수 있고, 그러면 위치를 잴 후보가 거의 남지 않는다.
   */
  it('findRefreshPill 은 문구로 거른 뒤에만 위치를 잰다', () => {
    render(ASIDE.repeat(300))
    const rects = countRects()
    const hit = findRefreshPill()
    rects.restore()

    expect(hit).toBeNull()
    expect(rects.calls()).toBeLessThanOrEqual(10)
  })

  it('타임라인이 길어도 상단 알약은 그대로 찾는다', () => {
    render(`<div role="button" data-test-top="80">7개의 게시물 보기</div>${CARD.repeat(200)}`)
    expect(findRefreshPill()?.count).toBe(7)
  })

  it('게시물이 쌓여 있어도 게시물 밖 로그인 버튼은 찾아낸다', () => {
    render(`${CARD.repeat(200)}<div role="button">로그인</div>`)
    expect(isLoggedOut()).toBe(true)
  })
})

describe('simulateClick', () => {
  /**
   * click 을 두 번 보내면 탭처럼 몇 번을 눌러도 같은 곳은 멀쩡해도, 하트·리포스트
   * 같은 토글은 눌렀다가 곧바로 취소돼 버린다.
   */
  it('click 을 정확히 한 번만 보낸다', () => {
    document.body.innerHTML = '<button id="target">하트</button>'
    const target = document.getElementById('target')!

    let clicks = 0
    target.addEventListener('click', () => {
      clicks += 1
    })
    simulateClick(target)

    expect(clicks).toBe(1)
  })

  it('React 가 듣는 포인터 시퀀스를 함께 태운다', () => {
    document.body.innerHTML = '<button id="target">하트</button>'
    const target = document.getElementById('target')!

    const seen: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(type, () => seen.push(type))
    }
    simulateClick(target)

    expect(seen).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })

  it('이벤트가 위로 올라간다 — React 는 루트에서 듣는다', () => {
    document.body.innerHTML = '<div id="root"><button id="target">하트</button></div>'
    let bubbled = 0
    document.getElementById('root')!.addEventListener('click', () => {
      bubbled += 1
    })
    simulateClick(document.getElementById('target')!)
    expect(bubbled).toBe(1)
  })
})

/**
 * 상세 창 안의 사진 클릭을 가로채는 판정.
 *
 * 프레임에 그대로 맡기면 사진이 그 창 크기 안에서만 커져 사진 번역을 걸 수 없었다.
 */
describe('findPhotoTarget — 상세 창에서 누른 사진', () => {
  /** 사진이 걸린 게시물 한 덩이. 사진마다 `/photo/N` 링크가 감싸는 짜임이다. */
  function photos(status: string, srcs: string[]): string {
    return srcs
      .map(
        (src, at) =>
          `<a href="${status}/photo/${at + 1}">
             <div data-testid="tweetPhoto"><img src="${src}" alt="사진 ${at + 1}"></div>
           </a>`,
      )
      .join('')
  }

  const A = 'https://pbs.twimg.com/media/a.jpg?name=small'
  const B = 'https://pbs.twimg.com/media/b.jpg?name=small'
  const C = 'https://pbs.twimg.com/media/c.jpg?name=small'

  function click(selector: string) {
    return findPhotoTarget(document.querySelector(selector))
  }

  it('그 글의 사진을 모아 누른 자리부터 연다', () => {
    render(`<article>${photos('/alice/status/1', [A, B])}</article>`)

    const hit = click('a[href$="/photo/2"] img')

    expect(hit?.media.map((item) => item.previewUrl)).toEqual([A, B])
    expect(hit?.index).toBe(1)
    expect(hit?.sourceUrl).toBe('https://x.com/alice/status/1')
    expect(hit?.media[0]?.altText).toBe('사진 1')
  })

  it('인용글 사진이 원글 묶음에 섞이지 않는다', () => {
    // 인용글은 같은 article 안에 그려지지만 다른 글이다. 함께 담으면 화살표를 눌렀을 때
    // 보고 있던 글에 없는 사진이 딸려 나온다.
    render(`
      <article>
        ${photos('/alice/status/1', [A, B])}
        <div>${photos('/bob/status/9', [C])}</div>
      </article>
    `)

    const origin = click('a[href="/alice/status/1/photo/1"] img')
    expect(origin?.media).toHaveLength(2)

    const quoted = click('a[href="/bob/status/9/photo/1"] img')
    expect(quoted?.media.map((item) => item.previewUrl)).toEqual([C])
    expect(quoted?.sourceUrl).toBe('https://x.com/bob/status/9')
  })

  it('한 사진에 링크가 둘이면 한 번만 담는다', () => {
    render(`
      <article>
        <a href="/alice/status/1/photo/1"><img src="${A}"></a>
        <a href="/alice/status/1/photo/1"><img src="${A}"></a>
      </article>
    `)

    expect(click('a img')?.media).toHaveLength(1)
  })

  it('사진 링크가 아니면 손대지 않는다 — 답글도 프로필도 저쪽 화면이 맡는다', () => {
    render(`
      <article>
        <a href="/alice/status/1">원문</a>
        <a href="/alice">프로필</a>
        <div data-testid="videoPlayer"><video src="blob:x"></video></div>
      </article>
    `)

    expect(click('a[href="/alice/status/1"]')).toBeNull()
    expect(click('a[href="/alice"]')).toBeNull()
    expect(click('video')).toBeNull()
    expect(findPhotoTarget(null)).toBeNull()
  })

  it('그림이 아직 안 붙은 링크는 담지 않는다', () => {
    render(`<article><a href="/alice/status/1/photo/1"><div data-testid="tweetPhoto"></div></a></article>`)

    expect(click('a')).toBeNull()
  })
})
