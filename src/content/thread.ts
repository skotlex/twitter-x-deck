/**
 * 컬럼에 실리지 않은 타래 글을 상세 페이지에서 받아온다.
 *
 * 홈 타임라인은 타래의 첫 글만 싣는 일이 흔하다. 사진을 넘기다 첫 글의 끝에 닿으면
 * 이어 쓴 답글의 사진으로 가야 하는데, 그 답글은 컬럼에 없다.
 *
 * 대화 쿼리를 우리가 직접 만들지 않는다 — 쿼리 id 와 기능 플래그가 x.com 배포마다
 * 바뀌어 금방 깨진다. 상세 페이지를 숨은 프레임에 띄우면 x.com 이 스스로 대화를
 * 받아오고, 인터셉터가 그 응답을 엿봐 넘겨준다. 받으면 곧바로 프레임을 거둔다.
 *
 * 받아오기는 덤이다. 못 받으면 컬럼에 있던 사진만으로 넘긴다.
 */
import { isThreadMessage } from '@core/messages'
import { parseTimelinePayload } from '@core/parser'
import { THREAD_FRAME_NAME } from '@core/role'
import { isNotification, type Tweet } from '@core/types'
import { createHiddenFrame, enqueue } from './frameQueue'

/** 상세 페이지가 대화를 받아올 때까지 기다리는 한계. */
const LOAD_TIMEOUT_MS = 20_000
/** 기억해 두는 타래 수. 넘으면 오래된 것부터 잊는다. */
const CACHE_LIMIT = 50

/** 글 id → 그 글의 상세 페이지에서 받은 대화. 받아낸 것만 넣는다. */
const cache = new Map<string, Tweet[]>()

export interface ThreadRequest {
  /** 대화에 든 글들. 못 받았거나 거뒀으면 빈 목록. */
  promise: Promise<Tweet[]>
  /** 라이트박스를 닫았다. 아직 차례가 안 왔으면 띄우지 않고, 떠 있으면 거둔다. */
  cancel: () => void
}

/** 이 글의 상세 페이지에 실린 대화를 받는다. */
export function loadThread(tweet: Tweet): ThreadRequest {
  const kept = cache.get(tweet.id)
  if (kept) return { promise: Promise.resolve(kept), cancel: () => {} }

  let cancelled = false
  let stop: (() => void) | null = null

  const promise = enqueue(() =>
    cancelled
      ? Promise.resolve<Tweet[]>([])
      : fetchThread(tweet, (abort) => {
          stop = abort
        }),
  ).then((tweets) => {
    if (tweets.length > 0) remember(tweet.id, tweets)
    return tweets
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      stop?.()
    },
  }
}

function remember(id: string, tweets: Tweet[]): void {
  cache.delete(id)
  cache.set(id, tweets)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * 숨은 프레임에 상세 페이지를 띄워 대화 응답 하나를 받는다.
 *
 * 응답이 그 글의 것인지는 풀어서 그 글이 들어 있는지로 가린다. 프레임은 줄을 서서
 * 하나씩 뜨지만, 앞 프레임의 응답이 늦게 닿아도 엉뚱한 대화를 받지 않게 한다.
 */
function fetchThread(tweet: Tweet, onStart: (abort: () => void) => void): Promise<Tweet[]> {
  return new Promise((resolve) => {
    const origin = window.location.origin
    const frame = createHiddenFrame(tweet.url, THREAD_FRAME_NAME)

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== origin || !isThreadMessage(event.data)) return
      const tweets = parseTimelinePayload(event.data.body, tweet.source).items.filter(
        (item): item is Tweet => !isNotification(item),
      )
      if (tweets.some((found) => found.id === tweet.id)) finish(tweets)
    }

    const timer = window.setTimeout(() => {
      console.info(`[X Deck] 타래를 받지 못했습니다 (${tweet.id})`)
      finish([])
    }, LOAD_TIMEOUT_MS)

    let done = false
    function finish(tweets: Tweet[]): void {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(tweets)
    }

    window.addEventListener('message', onMessage)
    onStart(() => finish([]))
  })
}
