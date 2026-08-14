/**
 * x.com DOM 접근을 한곳에 모아둔다.
 *
 * 여기 있는 선택자는 x.com UI 개편 때 가장 먼저 깨지는 부분이다.
 * 수리할 때 다른 파일을 건드릴 일이 없도록 전부 이 모듈에만 둔다.
 * 각 함수는 선택자 여러 개를 순서대로 시도하고, 마지막에는 텍스트 기반으로 찾아낸다.
 */
import type { TimelineKind } from '@core/types'

/** 탭 라벨 후보. 언어 설정이 무엇이든 걸리도록 주요 로케일을 넣어둔다. */
const TAB_LABELS: Record<TimelineKind, string[]> = {
  foryou: ['for you', '추천', 'おすすめ', 'para ti', 'pour vous', 'für dich'],
  following: ['following', '팔로우 중', '팔로잉', 'フォロー中', 'siguiendo', 'abonnements', 'gefolgt'],
}

/** 탭 순서 폴백. x.com 홈은 항상 추천이 먼저다. */
const TAB_FALLBACK_INDEX: Record<TimelineKind, number> = { foryou: 0, following: 1 }

/** '3개의 게시물 보기' / 'Show 3 posts' 등에서 건수를 뽑는다. */
const PILL_COUNT_RE = /(\d[\d,.\s]*)\s*(?:개(?:의)?\s*)?(?:new\s+)?(?:게시물|포스트|posts?|tweets?)/i

const norm = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * React 합성 이벤트까지 확실히 태우기 위해 포인터 시퀀스를 통째로 발생시킨다.
 *
 * click 은 **한 번만** 보낸다. 여기서 `el.click()` 을 덧붙이면 클릭이 두 번 나가는데,
 * 탭처럼 몇 번을 눌러도 같은 곳은 멀쩡해도 하트·리포스트 같은 토글은 눌렀다가
 * 곧바로 취소돼 버린다. React 는 루트에서 click 을 듣기 때문에 디스패치한 이벤트
 * 하나로 충분하다.
 */
export function simulateClick(el: Element): void {
  const options = { bubbles: true, cancelable: true, composed: true, view: window }
  el.dispatchEvent(new PointerEvent('pointerdown', options))
  el.dispatchEvent(new MouseEvent('mousedown', options))
  el.dispatchEvent(new PointerEvent('pointerup', options))
  el.dispatchEvent(new MouseEvent('mouseup', options))
  el.dispatchEvent(new MouseEvent('click', options))
}

export function primaryColumn(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')
}

/** 홈 타임라인의 탭 목록. 고정한 리스트가 섞여 있어도 그대로 돌려준다. */
function homeTabs(): HTMLElement[] {
  const tablist =
    primaryColumn()?.querySelector<HTMLElement>('[role="tablist"]') ??
    document.querySelector<HTMLElement>('[role="tablist"]')
  if (!tablist) return []
  return [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')].filter(isVisible)
}

/** 원하는 타임라인의 탭 요소를 찾는다. 라벨 우선, 실패하면 위치로 잡는다. */
export function findTab(kind: TimelineKind): HTMLElement | null {
  const tabs = homeTabs()
  if (tabs.length === 0) return null

  const labels = TAB_LABELS[kind]
  const byLabel = tabs.find((tab) => {
    const text = norm(tab.textContent)
    return labels.some((label) => text === label || text.startsWith(label))
  })
  if (byLabel) return byLabel

  return tabs[TAB_FALLBACK_INDEX[kind]] ?? null
}

export function isTabSelected(tab: HTMLElement): boolean {
  return tab.getAttribute('aria-selected') === 'true'
}

/**
 * 사이드바의 홈 링크. 이미 홈에 있을 때 누르면 타임라인을 맨 위로 올리며 새로 받아온다.
 * 탭 재클릭이 안 먹을 때의 두 번째 카드.
 */
export function findHomeNavLink(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="AppTabBar_Home_Link"], nav a[href="/home"]',
  )
}

/**
 * x.com 의 '새 게시물 불러오기' 단축키(`.`) 를 눌러준다.
 * DOM 선택자에 전혀 기대지 않는 경로라 UI 개편에 가장 강하다.
 */
export function pressLoadNewPostsShortcut(): void {
  const init: KeyboardEventInit = {
    key: '.',
    code: 'Period',
    keyCode: 190,
    which: 190,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit
  document.body?.focus()
  document.dispatchEvent(new KeyboardEvent('keydown', init))
  document.dispatchEvent(new KeyboardEvent('keyup', init))
}

export interface PillHit {
  element: HTMLElement
  /** 라벨에서 읽어낸 새 게시물 수. 못 읽으면 null. */
  count: number | null
}

/**
 * 타임라인 상단의 '새 게시물 보기' 알림을 찾는다.
 * data-testid 를 먼저 보고, 없으면 상단에 떠 있는 버튼의 문구로 판별한다.
 */
export function findRefreshPill(): PillHit | null {
  const scope = primaryColumn() ?? document.body
  if (!scope) return null

  const direct =
    scope.querySelector<HTMLElement>('[data-testid="pillToRefresh"]') ??
    scope.querySelector<HTMLElement>('[data-testid="pillLabel"]')?.closest<HTMLElement>('[role="button"], button')
  if (direct && isVisible(direct)) {
    return { element: direct, count: readCount(direct.textContent) }
  }

  const buttons = [...scope.querySelectorAll<HTMLElement>('[role="button"], button')]
  for (const button of buttons) {
    if (!isVisible(button)) continue
    // 알림 알약은 항상 컬럼 최상단에 떠 있다. 아래쪽 버튼은 후보에서 뺀다.
    if (button.getBoundingClientRect().top > 220) continue
    const count = readCount(button.textContent)
    if (count !== null) return { element: button, count }
  }

  return null
}

function readCount(text: string | null): number | null {
  const match = PILL_COUNT_RE.exec(text ?? '')
  if (!match?.[1]) return null
  const digits = match[1].replace(/[^\d]/g, '')
  return digits ? Number.parseInt(digits, 10) : null
}

/**
 * 상세 페이지에서 **주인공 게시물**의 article 을 고른다.
 *
 * 첫 article 을 그냥 집으면 안 된다 — 답글의 상세 페이지에는 원글이 위에 먼저
 * 그려져서 엉뚱한 글에 하트를 누르게 된다. 주인공은 시각 표시가 링크로 감싸여
 * 있지 않다는 점으로 가려낸다 (위아래 다른 글들은 시각이 자기 페이지로 가는 링크다).
 */
export function findFocalArticle(doc: Document): HTMLElement | null {
  const articles = [...doc.querySelectorAll<HTMLElement>('[data-testid="primaryColumn"] article')]
  const focal = articles.find((article) => {
    const time = article.querySelector('time')
    return time !== null && time.closest('a') === null
  })
  return focal ?? articles[0] ?? doc.querySelector<HTMLElement>('article')
}

/** 주인공 게시물에서 동작 버튼을 찾는다. */
export function findPrimaryTweetAction(doc: Document, testIds: string[]): HTMLElement | null {
  const article = findFocalArticle(doc)
  if (!article) return null
  for (const id of testIds) {
    const found = article.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    if (found) return found
  }
  return null
}

/**
 * 리포스트 확인 메뉴는 article 밖(문서 최상단)에 그려진다.
 * 그래서 범위를 좁히지 않고 문서 전체에서 찾는다.
 */
export function findMenuItem(doc: Document, testIds: string[]): HTMLElement | null {
  for (const id of testIds) {
    const found = doc.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    if (found) return found
  }
  return null
}

/** 로그인이 풀렸는지 판단한다. /home 밖으로 튕겼거나 로그인 UI 가 보이면 참. */
export function isLoggedOut(): boolean {
  const path = window.location.pathname
  if (path.startsWith('/i/flow/login') || path === '/login' || path === '/i/flow/signup') return true
  if (document.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]')) return true
  // 홈으로 보냈는데 홈이 아니면 로그아웃 상태의 랜딩으로 밀려난 것이다.
  if (path === '/' && !document.querySelector('[data-testid="primaryColumn"]')) return true
  return false
}

/** 타임라인이 실제로 그려졌는지. 상태 표시를 '스트리밍' 으로 올릴 근거. */
export function hasTimeline(): boolean {
  return Boolean(document.querySelector('[data-testid="primaryColumn"] [data-testid="tweet"], article[role="article"]'))
}
