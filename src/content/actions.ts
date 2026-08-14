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
import { findMenuItem, findPrimaryTweetAction, simulateClick } from './selectors'

/** 상세 페이지가 그려질 때까지 기다리는 한계. */
const LOAD_TIMEOUT_MS = 20_000
/** 버튼 상태가 바뀔 때까지 기다리는 한계. */
const SETTLE_TIMEOUT_MS = 8_000
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
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:600px;height:900px;opacity:0;pointer-events:none;border:0;z-index:-1'
  frame.setAttribute('aria-hidden', 'true')
  frame.src = url
  document.documentElement.append(frame)
  return frame
}

export class TweetActionError extends Error {}

/**
 * 게시물 하나에 동작 하나를 수행한다.
 * 성공하면 조용히 끝나고, 실패하면 `TweetActionError` 를 던진다 — 호출한 쪽이 낙관적
 * 표시를 되돌릴 수 있게.
 */
export async function runTweetAction(tweetUrl: string, action: TweetAction): Promise<void> {
  const plan = PLAN[action]
  const frame = createHiddenFrame(tweetUrl)

  try {
    // 같은 오리진이라 프레임 문서를 그대로 읽는다. 못 읽으면 임베드가 막힌 것이다.
    const doc = await waitFor(() => {
      try {
        const candidate = frame.contentDocument
        return candidate && findPrimaryTweetAction(candidate, plan.press.concat(plan.done))
          ? candidate
          : null
      } catch {
        return null
      }
    }, LOAD_TIMEOUT_MS)

    if (!doc) throw new TweetActionError('게시물 페이지를 열지 못했다')

    // 이미 원하는 상태면 할 일이 없다 (다른 곳에서 먼저 눌렀을 때).
    if (findPrimaryTweetAction(doc, plan.done) && !findPrimaryTweetAction(doc, plan.press)) return

    const button = findPrimaryTweetAction(doc, plan.press)
    if (!button) throw new TweetActionError('버튼을 찾지 못했다')
    simulateClick(button)

    if (plan.confirm) {
      const confirm = await waitFor(() => findMenuItem(doc, plan.confirm ?? []), SETTLE_TIMEOUT_MS)
      if (!confirm) throw new TweetActionError('확인 메뉴가 뜨지 않았다')
      simulateClick(confirm)
    }

    const settled = await waitFor(() => findPrimaryTweetAction(doc, plan.done), SETTLE_TIMEOUT_MS)
    if (!settled) throw new TweetActionError('반영을 확인하지 못했다')
  } finally {
    frame.remove()
  }
}

/**
 * 답글은 글을 써야 하므로 x.com 화면이 필요하다. 탭을 갈아치우지 않고
 * 대화상자 크기의 팝업으로 띄워 덱을 그대로 남긴다.
 */
export function openReplyComposer(tweetId: string): void {
  window.open(
    `https://x.com/intent/post?in_reply_to=${tweetId}`,
    `xdeck-reply-${tweetId}`,
    'width=620,height=760,noopener,noreferrer',
  )
}
