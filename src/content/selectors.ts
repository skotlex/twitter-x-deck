/**
 * x.com DOM 접근을 한곳에 모아둔다.
 *
 * 여기 있는 선택자는 x.com UI 개편 때 가장 먼저 깨지는 부분이다.
 * 수리할 때 다른 파일을 건드릴 일이 없도록 전부 이 모듈에만 둔다.
 * 각 함수는 선택자 여러 개를 순서대로 시도하고, 마지막에는 텍스트 기반으로 찾아낸다.
 */
import { isNotificationKind, type TimelineKind } from '@core/types'

/** 탭 라벨 후보. 언어 설정이 무엇이든 걸리도록 주요 로케일을 넣어둔다. */
const TAB_LABELS: Record<TimelineKind, string[]> = {
  foryou: ['for you', '추천', 'おすすめ', 'para ti', 'pour vous', 'für dich'],
  following: ['following', '팔로우 중', '팔로잉', 'フォロー中', 'siguiendo', 'abonnements', 'gefolgt'],
  notifications: ['all', '전체', '모두', 'すべて', 'todas', 'toutes', 'alle'],
  mentions: ['mentions', '멘션', '답글', 'メンション', 'menciones', 'erwähnungen'],
}

/**
 * 탭 순서 폴백. 홈은 추천이 먼저고, 알림 페이지는 전체·인증됨·멘션 순이다.
 * 라벨이 하나도 안 걸릴 때만 쓰므로 정확할 필요는 없고 크게 어긋나지만 않으면 된다.
 */
const TAB_FALLBACK_INDEX: Record<TimelineKind, number> = {
  foryou: 0,
  following: 1,
  notifications: 0,
  mentions: 2,
}

/** 지금 문서가 알림 페이지인지. 홈에서 알림 탭을 찾다 엉뚱한 탭을 집는 걸 막는다. */
function onNotificationsPage(): boolean {
  return window.location.pathname.startsWith('/notifications')
}

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

/**
 * 원하는 타임라인의 탭 요소를 찾는다. 라벨 우선, 실패하면 위치로 잡는다.
 *
 * 페이지가 맞는지부터 본다. 홈에서 알림 탭을 찾으면 위치 폴백이 추천 탭을 집어
 * 엉뚱한 곳을 누르게 된다 — 서로 다른 화면의 탭 목록이라 섞이면 안 된다.
 */
export function findTab(kind: TimelineKind): HTMLElement | null {
  if (isNotificationKind(kind) !== onNotificationsPage()) return null

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
 * 알약에 실릴 수 있는 문구. 숫자를 못 읽는 판(그냥 '새 게시물 보기')도 있어 함께 본다.
 */
const PILL_LABEL_RE = /새\s*(게시물|포스트|트윗)|new\s+(posts?|tweets?)|show\s+\d/i

/**
 * 후보 하나가 정말 '새 게시물 보기' 알약인지 가린다.
 *
 * **문구가 없으면 알약이 아니다.** x.com 은 알약이 앉을 자리를 미리 만들어 두고 새
 * 글이 생겼을 때만 채우는데, 그 빈 자리를 알약으로 세면 누를 때마다 아무 일도 일어나지
 * 않는다. 그러면 자동 갱신도 수동 새로고침도 그 자리에서 멈춘 채 되살아나지 못한다 —
 * 실제로 모든 컬럼이 첫 적재 뒤로 조용해지고 새로고침 버튼도 먹지 않았다.
 */
function asPill(element: HTMLElement | null | undefined): PillHit | null {
  if (!element || !isVisible(element)) return null
  const text = element.textContent ?? ''
  const count = readCount(text)
  if (count === null && !PILL_LABEL_RE.test(text)) return null
  return { element, count }
}

/**
 * 타임라인 상단의 '새 게시물 보기' 알림을 찾는다.
 * data-testid 를 먼저 보고, 없으면 상단에 떠 있는 버튼의 문구로 판별한다.
 */
export function findRefreshPill(): PillHit | null {
  const scope = primaryColumn() ?? document.body
  if (!scope) return null

  const direct =
    asPill(scope.querySelector<HTMLElement>('[data-testid="pillToRefresh"]')) ??
    asPill(
      scope
        .querySelector<HTMLElement>('[data-testid="pillLabel"]')
        ?.closest<HTMLElement>('[role="button"], button'),
    )
  if (direct) return direct

  const buttons = [...scope.querySelectorAll<HTMLElement>('[role="button"], button')]
  for (const button of buttons) {
    // 알림 알약은 항상 컬럼 최상단에 떠 있다. 아래쪽 버튼은 후보에서 뺀다.
    if (button.getBoundingClientRect().top > 220) continue
    const hit = asPill(button)
    // 문구로 찾을 때는 숫자가 있는 것만 믿는다. 상단에는 '새 게시물' 이라는 말이
    // 들어간 다른 버튼(작성 버튼 등)이 함께 있을 수 있다.
    if (hit?.count != null) return hit
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

/**
 * 덱 안 상세 창에서 x.com 의 바깥 껍데기를 지우는 스타일.
 *
 * 게시물 상세를 프레임으로 띄우면 좌측 내비게이션과 우측 추천 칸까지 따라온다.
 * 좁은 창에서는 정작 볼 게시물과 답글이 밀려나므로 본문만 남긴다.
 * 실패해도 잃는 건 화면이 조금 지저분해지는 것뿐이라 조용히 넘어가도 된다.
 *
 * 게시물 칸의 **폭은 건드리지 않는다**. x.com 은 조상 요소들에 폭을 고정해두어
 * 여기서 100% 를 줘봐야 그 고정값을 따라갈 뿐이고, 억지로 늘리면 반응형 규칙과
 * 다투다 안쪽 내용이 잘린다. 창 크기를 이 칸에 맞추는 쪽이 훨씬 튼튼하다.
 */
export const HIDE_X_CHROME_CSS = `
header[role="banner"],
[data-testid="sidebarColumn"],
[data-testid="BottomBar"] { display: none !important; }
[data-testid="primaryColumn"] { max-width: 100% !important; border: 0 !important; margin: 0 auto !important; }
`

/**
 * 작성창에 지금 들어 있는 글. 편집기를 못 찾으면 null.
 *
 * 자리표시자 문구까지 딸려 들어오지만 상관없다 — 이 값은 처음 열렸을 때와
 * 비교하는 데만 쓰므로, 변하지 않는 것은 저절로 상쇄된다. 인용처럼 처음부터
 * 내용이 들어 있는 경우도 같은 이유로 알아서 걸러진다.
 */
export function readComposerText(doc: Document): string | null {
  const editor = doc.querySelector('[data-testid^="tweetTextarea_"]')
  return editor ? (editor.textContent ?? '') : null
}

/** 사진·GIF 를 붙여뒀는지. 글은 안 썼어도 이건 지우면 아까운 것이다. */
export function hasComposerAttachment(doc: Document): boolean {
  return doc.querySelector('[data-testid="attachments"]') !== null
}

export interface ViewerInfo {
  handle: string
  name: string
  avatarUrl: string
}

/**
 * 지금 로그인한 계정. x.com 사이드바에서 읽어낸다.
 *
 * 핸들은 프로필 링크의 주소가 가장 확실하다 — 화면이 좁아 이름이 안 그려져도 링크는 남는다.
 * 아직 안 그려졌으면 null 을 준다. 부르는 쪽이 잠시 뒤 다시 물어보면 된다.
 */
export function findViewer(): ViewerInfo | null {
  const link = document.querySelector<HTMLAnchorElement>('[data-testid="AppTabBar_Profile_Link"]')
  const handle = (link?.getAttribute('href') ?? '').replace(/^\//, '').split('/')[0] ?? ''
  if (!handle) return null

  const switcher = document.querySelector<HTMLElement>(
    '[data-testid="SideNav_AccountSwitcher_Button"]',
  )
  const avatarUrl = (switcher ?? link)?.querySelector<HTMLImageElement>('img')?.src ?? ''
  // 이름은 계정 전환 버튼 안에 있다. 좁은 화면에서는 아예 없으므로 핸들로 대신한다.
  const name = [...(switcher?.querySelectorAll('span') ?? [])]
    .map((span) => span.textContent?.trim() ?? '')
    .find((text) => text && !text.startsWith('@'))

  return { handle, name: name || handle, avatarUrl }
}

/**
 * 로그인이 풀렸는지 판단한다.
 *
 * 로그인 화면으로 옮겨갔거나 로그인 UI 가 실제로 그려졌을 때만 참이다.
 * '무엇이 아직 안 보인다' 는 근거로 삼지 않는다 — 문서가 뜬 직후에는 로그인
 * 여부와 상관없이 아무 것도 안 그려져 있어서, 그걸 로그아웃으로 읽으면 멀쩡히
 * 로그인한 사람에게 로그인하라는 화면을 띄우게 된다.
 */
export function isLoggedOut(): boolean {
  const path = window.location.pathname
  if (path.startsWith('/i/flow/login') || path === '/login' || path === '/i/flow/signup') return true
  return Boolean(document.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]'))
}
