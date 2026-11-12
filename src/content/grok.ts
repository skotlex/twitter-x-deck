/**
 * 덱 쪽 Grok 번역 창구.
 *
 * 카드가 화면에 들어오면 여기에 번역을 부탁하고, 실제 요청은 MAIN world 인터셉터가
 * 보낸다 ([core/grok](../core/grok.ts)). 이 파일은 그 사이에서 **얼마나 자주 물을지** 를
 * 맡는다 — 외국어 글이 많은 컬럼을 훑으면 순식간에 수십 건이 쌓이는데, 그걸 한꺼번에
 * 보내면 x.com 이 요청 과다로 막는다.
 *
 *   - 한 번에 하나씩, 사이를 띄워 보낸다. 1분에 보내는 수에도 상한을 둔다
 *   - 같은 글은 한 번만 묻는다. 받은 번역은 이 탭이 살아 있는 동안 기억한다
 *   - 차례가 오기 전에 카드가 사라졌으면 묻지 않는다
 *   - 요청 과다로 막히면 풀릴 때까지 묻지 않는다. 그동안 카드는 원문만 보여준다
 *   - 이유 없이 연달아 실패하면 이 탭에서는 더 묻지 않는다 — x.com 이 길을 바꿨다는 뜻이다
 *
 * Grok 번역은 덤이다. 못 받으면 조용히 비켜서고, 사용자는 Papago 로 옮기면 된다.
 */
import { CHANNEL } from '@core/messages'
import { isGrokReply, type GrokReply } from '@core/grok'

/** 묻는 사이의 간격. */
const SPACING_MS = 600
/** 1분 동안 보내는 요청 상한. */
const PER_MINUTE = 20
/** 인터셉터가 답하지 않을 때 기다리는 한계. 인터셉터가 없는 문서일 수도 있다. */
const REPLY_TIMEOUT_MS = 15_000
/** 막혔는데 언제 풀리는지 모를 때 쉬는 시간. */
const DEFAULT_PAUSE_MS = 60_000
/** 이만큼 연달아 실패하면 이 탭에서는 그만 묻는다. */
const GIVE_UP_AFTER = 5
/** 기억해 두는 번역 수. 넘으면 오래된 것부터 잊는다. */
const CACHE_LIMIT = 2000

export type GrokOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string; limited?: boolean; retryAt?: number }

/** 인터셉터에 한 번 묻는 길. 시험에서는 가짜로 바꿔 끼운다. */
export type GrokTransport = (tweetId: string, lang: string) => Promise<GrokOutcome>

export interface GrokClientOptions {
  transport: GrokTransport
  spacingMs?: number
  perMinute?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface GrokRequest {
  /** 번역문. 못 받으면 null — 실패 이유는 카드가 알 필요가 없다. */
  promise: Promise<string | null>
  /** 카드가 사라졌다. 아직 차례가 안 왔으면 묻지 않는다. */
  cancel: () => void
}

interface Pending {
  tweetId: string
  lang: string
  waiters: number
  promise: Promise<string | null>
  resolve: (text: string | null) => void
}

export function createGrokClient(options: GrokClientOptions) {
  const spacing = options.spacingMs ?? SPACING_MS
  const perMinute = options.perMinute ?? PER_MINUTE
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  /** 받은 번역. null 은 '이 글은 Grok 이 못 옮긴다' 로 확정된 것. */
  const cache = new Map<string, string | null>()
  const pending = new Map<string, Pending>()
  const line: Pending[] = []
  const sent: number[] = []
  let pausedUntil = 0
  let failures = 0
  let pumping = false

  const key = (tweetId: string, lang: string) => `${lang}:${tweetId}`

  function remember(id: string, text: string | null): void {
    cache.delete(id)
    cache.set(id, text)
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  const givenUp = () => failures >= GIVE_UP_AFTER
  const paused = () => now() < pausedUntil

  /** 줄에 선 것을 다 돌려보낸다. 막혔을 때 카드가 마냥 기다리지 않게. */
  function releaseAll(): void {
    for (const job of line.splice(0)) {
      pending.delete(key(job.tweetId, job.lang))
      job.resolve(null)
    }
  }

  async function waitForSlot(): Promise<void> {
    for (;;) {
      const cutoff = now() - 60_000
      while (sent.length > 0 && (sent[0] ?? 0) <= cutoff) sent.shift()
      if (sent.length < perMinute) return
      await sleep((sent[0] ?? now()) + 60_000 - now())
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      while (line.length > 0) {
        if (paused() || givenUp()) {
          releaseAll()
          break
        }
        const job = line.shift()
        if (!job) break
        const id = key(job.tweetId, job.lang)
        if (job.waiters <= 0) {
          pending.delete(id)
          job.resolve(null)
          continue
        }

        await waitForSlot()
        sent.push(now())
        const outcome = await options.transport(job.tweetId, job.lang)
        pending.delete(id)

        if (outcome.ok) {
          failures = 0
          remember(id, outcome.text)
          job.resolve(outcome.text)
        } else if (outcome.limited) {
          // 막힌 것이지 이 글이 못 옮겨지는 게 아니다. 기억하지 않고 풀리면 다시 묻는다.
          pausedUntil = Math.max(outcome.retryAt ?? 0, now() + DEFAULT_PAUSE_MS)
          job.resolve(null)
        } else {
          failures += 1
          remember(id, null)
          job.resolve(null)
        }

        if (line.length > 0 && spacing > 0) await sleep(spacing)
      }
    } finally {
      pumping = false
    }
  }

  return {
    /** 이미 받은 번역. 아직 묻지 않았으면 undefined. */
    cached(tweetId: string, lang: string): string | null | undefined {
      return cache.get(key(tweetId, lang))
    },

    request(tweetId: string, lang: string): GrokRequest {
      const id = key(tweetId, lang)
      if (cache.has(id)) {
        return { promise: Promise.resolve(cache.get(id) ?? null), cancel: () => {} }
      }
      if (paused() || givenUp()) return { promise: Promise.resolve(null), cancel: () => {} }

      let job = pending.get(id)
      if (!job) {
        let resolve!: (text: string | null) => void
        const promise = new Promise<string | null>((done) => {
          resolve = done
        })
        job = { tweetId, lang, waiters: 0, promise, resolve }
        pending.set(id, job)
        line.push(job)
      }
      // 줄을 돌리기 전에 센다. 돌리는 쪽이 첫 차례를 그 자리에서 집어 가는데, 그때
      // 기다리는 카드가 0 이면 사라진 카드의 몫으로 보고 버린다.
      job.waiters += 1
      void pump()

      const current = job
      let cancelled = false
      return {
        promise: current.promise,
        cancel: () => {
          if (cancelled) return
          cancelled = true
          current.waiters -= 1
        },
      }
    },
  }
}

/** 같은 문서의 MAIN world 인터셉터에 묻는다. */
const askInterceptor: GrokTransport = (tweetId, lang) =>
  new Promise((resolve) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const origin = window.location.origin

    const timer = window.setTimeout(() => {
      finish()
      resolve({ ok: false, reason: 'Grok 번역이 응답하지 않았습니다' })
    }, REPLY_TIMEOUT_MS)

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || !isGrokReply(event.data)) return
      const reply: GrokReply = event.data
      if (reply.id !== id) return
      finish()
      if (reply.type === 'grok-result') resolve({ ok: true, text: reply.text })
      else {
        resolve({
          ok: false,
          reason: reply.reason,
          ...(reply.limited ? { limited: true } : {}),
          ...(reply.retryAt ? { retryAt: reply.retryAt } : {}),
        })
      }
    }

    function finish(): void {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ channel: CHANNEL, type: 'grok-ask', id, tweetId, lang }, origin)
  })

export const grok = createGrokClient({ transport: askInterceptor })
