/**
 * 하트·리포스트를 덱 안에서 끝낸다.
 *
 * 왜 이렇게 하는가 —
 * x.com 내부 뮤테이션을 우리가 직접 호출하려면 요청 서명(transaction id) 까지 위조해야 하고,
 * 그건 깨지기 쉬운 동시에 계정 위험을 진다. 공식 intent 페이지는 이제 게시물 페이지로
 * 그냥 넘겨버려서 덱을 벗어난다.
 *
 * 그래서 게시물 상세 페이지를 **보이지 않는 프레임에 띄우고 x.com 자신의 버튼을 누른다.**
 * 요청을 만드는 것도, 서명하는 것도, 낙관적 갱신도 전부 x.com 코드가 한다. 우리는 누르기만 한다.
 * 상세 페이지에서는 대상 게시물이 반드시 그려지므로 타임라인을 뒤지는 것보다 확실하다.
 *
 * 부모가 x.com 이라 프레임 문서를 직접 조작할 수 있어 content script 를 거칠 필요가 없다.
 */
import { describeFrameBlock, refreshRuleReport } from './frameBlock'
import {
  findFocalArticle,
  findMenuItem,
  findPrimaryTweetAction,
  findTranslateButton,
  readFocalTweetTexts,
  simulateClick,
} from './selectors'

/** 상세 페이지가 그려질 때까지 기다리는 한계. */
const LOAD_TIMEOUT_MS = 20_000
/** 게시물이 뜬 뒤 동작 버튼이 붙을 때까지 기다리는 한계. */
const BUTTON_TIMEOUT_MS = 8_000
/** 버튼 상태가 바뀔 때까지 기다리는 한계. */
const SETTLE_TIMEOUT_MS = 8_000
/** 번역문이 붙을 때까지 기다리는 한계. 사람이 기다리는 시간이라 넉넉히 준다. */
const TRANSLATE_TIMEOUT_MS = 12_000
/** 버튼이 그려진 뒤 x.com 이 핸들러를 붙일 틈. 이 전에 누르면 클릭이 그냥 삼켜진다. */
const HYDRATE_MS = 600
const POLL_MS = 120

export type TweetAction = 'like' | 'unlike' | 'repost' | 'unrepost'

/** 동작별로 누를 버튼과, 성공했는지 확인할 버튼. */
const PLAN: Record<TweetAction, { press: string[]; confirm?: string[]; done: string[] }> = {
  like: { press: ['like'], done: ['unlike'] },
  unlike: { press: ['unlike'], done: ['like'] },
  repost: { press: ['retweet'], confirm: ['retweetConfirm'], done: ['unretweet'] },
  unrepost: { press: ['unretweet'], confirm: ['unretweetConfirm'], done: ['retweet'] },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** 조건이 참이 될 때까지 기다린다. 시간을 넘기면 null. */
async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(POLL_MS)
  }
}

function createHiddenFrame(url: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  // 화면 밖으로 밀지 않는다 — 밖에 두면 렌더링이 멈춰 버튼이 그려지지 않는다.
  // 폭은 x.com 이 넓은 화면 배치를 쓰도록 넉넉히 준다. 좁으면 배치가 통째로 달라진다.
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:1100px;height:900px;opacity:0;pointer-events:none;border:0;z-index:-1'
  frame.setAttribute('aria-hidden', 'true')
  frame.src = url
  document.documentElement.append(frame)
  return frame
}

export class TweetActionError extends Error {}

/**
 * 프레임이 어떤 상태로 멈춰 있는지 한 줄로 요약한다.
 * 임베드가 막힌 것인지, 떴는데 안 그려진 것인지, 엉뚱한 곳으로 튕긴 것인지를 가른다.
 */
function describeFrame(frame: HTMLIFrameElement): string {
  let doc: Document | null
  try {
    doc = frame.contentDocument
  } catch {
    return `교차 출처로 떨어졌습니다 · 임베드 차단 — ${describeFrameBlock()}`
  }
  if (!doc) return `문서를 읽을 수 없습니다 · 임베드 차단 — ${describeFrameBlock()}`
  if (doc.location.href === 'about:blank') return `아직 빈 문서입니다 (${doc.readyState})`
  return `${doc.location.pathname} · ${doc.readyState} · article ${doc.querySelectorAll('article').length}개`
}

/** 시도 결과. 실패는 어느 단계에서 멈췄는지까지 들고 온다 — 사용자에게 그대로 보여준다. */
type Attempt =
  | 'done'
  | '확인 메뉴가 뜨지 않았습니다'
  | '눌러도 버튼이 그대로입니다'
  | '버튼이 사라졌습니다'

/** 원하는 상태에 도달했는지. done 버튼이 생겼거나, 누를 버튼이 사라졌으면 된 것이다. */
function reached(doc: Document, plan: { press: string[]; done: string[] }): boolean {
  if (findPrimaryTweetAction(doc, plan.done)) return true
  // 우리가 모르는 testid 로 바뀌었어도, 누를 버튼이 없어졌다면 눌린 것이다.
  return findFocalArticle(doc) !== null && !findPrimaryTweetAction(doc, plan.press)
}

/**
 * 버튼을 한 번 누르고 상태가 바뀌는지까지 지켜본다.
 *
 * 시작할 때 누를 버튼이 남아 있는지부터 본다 — 이미 원하는 상태라면 아무 것도
 * 건드리지 않는다. 재시도가 방금 성공한 동작을 되돌리지 않게 하는 잠금이다.
 */
async function attempt(
  doc: Document,
  plan: { press: string[]; confirm?: string[]; done: string[] },
): Promise<Attempt> {
  if (reached(doc, plan)) return 'done'

  const button = findPrimaryTweetAction(doc, plan.press)
  if (!button) return '버튼이 사라졌습니다'
  simulateClick(button)

  if (plan.confirm) {
    const confirm = await waitFor(() => findMenuItem(doc, plan.confirm ?? []), SETTLE_TIMEOUT_MS)
    if (!confirm) return '확인 메뉴가 뜨지 않았습니다'
    simulateClick(confirm)
  }

  const settled = await waitFor(() => (reached(doc, plan) ? true : null), SETTLE_TIMEOUT_MS)
  return settled ? 'done' : '눌러도 버튼이 그대로입니다'
}

/**
 * 게시물 하나에 동작 하나를 수행한다.
 * 성공하면 조용히 끝나고, 실패하면 `TweetActionError` 를 던진다 — 호출한 쪽이 낙관적
 * 표시를 되돌릴 수 있게.
 */
export async function runTweetAction(tweetUrl: string, action: TweetAction): Promise<void> {
  const plan = PLAN[action]
  const frame = createHiddenFrame(tweetUrl)

  try {
    // 단계를 나눠 기다린다. 어디서 멈췄는지가 그대로 실패 메시지가 된다.
    // 같은 오리진이라 프레임 문서를 그대로 읽는다. 못 읽으면 임베드가 막힌 것이다.
    const doc = await waitFor(() => {
      try {
        const candidate = frame.contentDocument
        return candidate && findFocalArticle(candidate) ? candidate : null
      } catch {
        return null
      }
    }, LOAD_TIMEOUT_MS)

    if (!doc) {
      // 규칙이 요청에 걸렸는지는 요청이 나간 뒤에 물어야 의미가 있다.
      await refreshRuleReport()
      throw new TweetActionError(`게시물 페이지가 뜨지 않았습니다 (${describeFrame(frame)})`)
    }
    // isLoggedOut 은 자기 문서만 보므로 프레임 문서는 여기서 직접 확인한다.
    if (doc.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]')) {
      throw new TweetActionError('x.com 로그인이 풀렸습니다')
    }

    const ready = await waitFor(
      () => findPrimaryTweetAction(doc, plan.press.concat(plan.done)),
      BUTTON_TIMEOUT_MS,
    )
    if (!ready) throw new TweetActionError('동작 버튼을 찾지 못했습니다')

    // 버튼이 그려진 것과 누를 수 있는 것은 다르다. 핸들러가 붙을 틈을 준다.
    await sleep(HYDRATE_MS)

    // 첫 클릭이 삼켜졌으면 한 번 더 눌러본다. 누를 버튼이 아직 남아 있을 때만
    // 다시 누르므로, 이미 반영된 동작을 되돌릴 일은 없다.
    const first = await attempt(doc, plan)
    if (first === 'done') return
    const second = await attempt(doc, plan)
    if (second === 'done') return

    throw new TweetActionError(second)
  } finally {
    frame.remove()
  }
}

/**
 * 게시물 하나를 번역해 그 글월을 돌려준다.
 *
 * 번역은 x.com 이 한다 — 우리는 상세 페이지를 숨은 프레임에 띄우고 x.com 이 본문
 * 아래 달아둔 '번역하기' 를 누른 뒤, 새로 붙은 본문 조각을 읽어올 뿐이다.
 * 하트·리포스트와 같은 방식이라 번역 API 주소도, 요청 서명도, 별도 키도 필요 없다.
 * x.com 이 번역기를 Grok 으로 갈아 끼워도 우리 쪽은 그대로 따라간다.
 */
export async function runTweetTranslation(tweetUrl: string): Promise<string> {
  const frame = createHiddenFrame(tweetUrl)

  try {
    const doc = await waitFor(() => {
      try {
        const candidate = frame.contentDocument
        return candidate && findFocalArticle(candidate) ? candidate : null
      } catch {
        return null
      }
    }, LOAD_TIMEOUT_MS)

    if (!doc) {
      await refreshRuleReport()
      throw new TweetActionError(`게시물 페이지가 뜨지 않았습니다 (${describeFrame(frame)})`)
    }
    if (doc.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]')) {
      throw new TweetActionError('x.com 로그인이 풀렸습니다')
    }

    const ready = await waitFor(() => findTranslateButton(doc), BUTTON_TIMEOUT_MS)
    if (!ready) {
      throw new TweetActionError('x.com 이 이 글에는 번역을 제공하지 않습니다')
    }
    // 버튼이 그려진 것과 누를 수 있는 것은 다르다. 핸들러가 붙을 틈을 준다.
    await sleep(HYDRATE_MS)

    // 누르기 전의 본문 조각을 기억해두고, 새로 붙는 조각을 번역문으로 본다.
    const before = readFocalTweetTexts(doc)
    const grab = async (): Promise<string | null> => {
      const button = findTranslateButton(doc)
      // 버튼이 사라졌다면 앞선 클릭이 먹은 것이다. 결과만 기다린다.
      if (button) simulateClick(button)
      return await waitFor(() => {
        const added = readFocalTweetTexts(doc).find((text) => !before.includes(text))
        return added ?? null
      }, TRANSLATE_TIMEOUT_MS)
    }

    // 첫 클릭이 삼켜졌으면 한 번 더 눌러본다 — 하트·리포스트와 같은 이유다.
    const translated = (await grab()) ?? (await grab())
    if (!translated) throw new TweetActionError('번역이 돌아오지 않았습니다')
    return translated
  } finally {
    frame.remove()
  }
}

/** 글을 써야 끝나는 동작. 셋 다 x.com 작성 화면을 그대로 빌려 쓴다. */
export type ComposeMode = 'reply' | 'quote' | 'post'

/** 대상 게시물에서 작성 화면이 필요로 하는 것만 추린 것. */
export interface ComposeTarget {
  id: string
  url: string
}

/**
 * 작성 화면 주소. 덱 안 대화상자와 새 창이 같은 곳을 본다.
 *
 * 새 글은 전용 작성 페이지가 따로 있어 그쪽이 깔끔하다. 답글·인용은 그런 주소가
 * 없어 intent 를 쓰는데, 이건 홈으로 리다이렉트되며 작성란만 미리 채워준다.
 */
export function composerUrl(mode: ComposeMode, target?: ComposeTarget): string {
  if (mode === 'post' || !target) return 'https://x.com/compose/post'
  // 인용은 본문에 원문 주소를 실어 보낸다 — x.com 이 그걸 인용 카드로 바꿔 단다.
  return mode === 'quote'
    ? `https://x.com/intent/post?url=${encodeURIComponent(target.url)}`
    : `https://x.com/intent/post?in_reply_to=${target.id}`
}

/**
 * 작성창을 새 창으로 띄운다.
 * 평소에는 덱 안 대화상자로 처리하고, 그게 막혔을 때만 쓰는 뒷문이다.
 */
export function openComposerPopup(mode: ComposeMode, target?: ComposeTarget): void {
  window.open(
    composerUrl(mode, target),
    `xdeck-${mode}-${target?.id ?? 'new'}`,
    'width=620,height=760,noopener,noreferrer',
  )
}
