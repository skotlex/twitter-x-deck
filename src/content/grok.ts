/**
 * 덱 쪽 Grok 번역 창구.
 *
 * 카드가 화면에 들어오면 여기에 번역을 부탁하고, 실제 요청은 MAIN world 인터셉터가
 * 보낸다 ([core/grok](../core/grok.ts)). 이 파일은 그 사이에서 **얼마나 자주 물을지** 를
 * 맡는다 — 외국어 글이 많은 컬럼을 훑으면 순식간에 수십 건이 쌓이는데, 그걸 한꺼번에
 * 보내면 x.com 이 요청 과다로 막는다.
 *
 *   - 한 번에 하나씩, 사이를 띄워 보낸다. 1분에 보내는 수에도 상한을 둔다
 *   - 같은 글은 한 번만 묻는다. 받은 번역은 저장소에 쟁여 새로고침 뒤에도 다시 묻지 않는다
 *   - 차례가 오기 전에 카드가 사라졌거나 화면을 지나쳐 갔으면 묻지 않는다
 *   - 요청 과다로 막히면 풀릴 때까지 묻지 않는다. 그동안 카드는 원문만 보여준다
 *   - 연달아 실패하면 5분 쉬었다가 다시 묻는다 — 영영 그만두면 지나가는 장애 뒤로 들어온
 *     글이 전부 원문으로 남는다
 *   - x.com 이 거절한 글(4xx)만 '못 옮긴다' 로 기억한다. 시간 초과 · 서버 오류는 다시 묻는다
 *   - 실패 이유는 개발자 도구 콘솔에 `[X Deck] Grok 번역 실패` 로 남긴다
 *
 * Grok 번역은 덤이다. 못 받으면 조용히 비켜서고, 사용자는 Papago 로 옮기면 된다.
 */
import { loadGrokTranslation, saveGrokTranslation } from '@core/db'
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
/** 이만큼 연달아 실패하면 잠시 쉰다. x.com 쪽에 장애가 있다는 뜻이다. */
const FAIL_STREAK = 5
/** 연달아 실패했을 때 쉬는 시간. 영영 그만두지는 않는다 — 지나가는 장애일 수 있다. */
const FAILURE_PAUSE_MS = 5 * 60_000
/** 기억해 두는 번역 수. 넘으면 오래된 것부터 잊는다. */
const CACHE_LIMIT = 2000

export type GrokOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string; limited?: boolean; retryAt?: number; status?: number }

/**
 * 이 실패가 그 글에 대한 최종 판정인지.
 *
 * x.com 이 그 요청을 거절한 것(4xx, 요청 과다 제외)만 그렇다. 시간 초과 · 서버 오류 ·
 * 빈 응답은 그때 사정이라 나중에 다시 물으면 받을 수 있다.
 */
const isFinal = (outcome: Extract<GrokOutcome, { ok: false }>): boolean =>
  !outcome.limited &&
  outcome.status !== undefined &&
  outcome.status >= 400 &&
  outcome.status < 500 &&
  outcome.status !== 429

/** 인터셉터에 한 번 묻는 길. 시험에서는 가짜로 바꿔 끼운다. */
export type GrokTransport = (tweetId: string, lang: string) => Promise<GrokOutcome>

/**
 * 받은 번역을 쟁여두는 자리. 새로고침해도 다시 묻지 않게 한다.
 *
 * 메모리에 없을 때만 들여다보며, 여기서 찾으면 줄을 서지 않는다 — 요청이 아니라서
 * 간격도 상한도 들지 않는다. 받아낸 번역만 넣는다. 못 옮긴다는 판정은 넣지 않는다 —
 * 그건 그때 사정일 수 있다.
 */
export interface GrokStore {
  load(key: string): Promise<string | null>
  save(key: string, text: string): Promise<void>
}

export interface GrokClientOptions {
  transport: GrokTransport
  store?: GrokStore
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

  /** 기다리는 카드가 없는 몫을 줄에서 걷어낸다. 화면을 지나쳐 간 카드의 몫이다. */
  function dropAbandoned(): void {
    for (let i = line.length - 1; i >= 0; i -= 1) {
      const job = line[i]
      if (!job || job.waiters > 0) continue
      line.splice(i, 1)
      pending.delete(key(job.tweetId, job.lang))
      job.resolve(null)
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        dropAbandoned()
        if (line.length === 0) break
        if (paused()) {
          releaseAll()
          break
        }
        // 자리가 날 때까지 기다린 **뒤에** 누구를 물을지 고른다. 먼저 고르면 그사이
        // 화면을 지나쳐 간 카드의 몫이 차례를 쥔 채 나가고, 지금 보이는 글은 그 뒤로 밀린다.
        await waitForSlot()
        dropAbandoned()
        const job = line.shift()
        if (!job) break
        const id = key(job.tweetId, job.lang)
        sent.push(now())
        const outcome = await options.transport(job.tweetId, job.lang)
        pending.delete(id)

        if (outcome.ok) {
          failures = 0
          remember(id, outcome.text)
          options.store?.save(id, outcome.text).catch(() => {})
          job.resolve(outcome.text)
        } else {
          // 원인은 화면에 띄우지 않는다 — 번역은 덤이다. 대신 개발자 도구에서 찾을 수 있게 남긴다.
          console.info(`[X Deck] Grok 번역 실패 (${job.tweetId}): ${outcome.reason}`)

          if (outcome.limited) {
            // 막힌 것이지 이 글이 못 옮겨지는 게 아니다. 기억하지 않고 풀리면 다시 묻는다.
            pausedUntil = Math.max(outcome.retryAt ?? 0, now() + DEFAULT_PAUSE_MS)
          } else {
            if (isFinal(outcome)) remember(id, null)
            failures += 1
            if (failures >= FAIL_STREAK) {
              failures = 0
              pausedUntil = Math.max(pausedUntil, now() + FAILURE_PAUSE_MS)
            }
          }
          job.resolve(null)
        }

        if (line.length > 0 && spacing > 0) await sleep(spacing)
      }
    } finally {
      pumping = false
    }
  }

  /**
   * 새 부탁을 받는다. 쟁여둔 것이 있으면 그걸로 끝내고, 없을 때만 줄에 세운다.
   *
   * 막혀 있는 동안에도 쟁여둔 것은 꺼내 준다 — 묻는 게 아니니 막힐 이유가 없다.
   */
  async function enter(job: Pending): Promise<void> {
    const id = key(job.tweetId, job.lang)
    if (options.store) {
      let kept: string | null = null
      try {
        kept = await options.store.load(id)
      } catch {
        // 저장소를 못 열면 그냥 묻는다.
      }
      if (kept) {
        pending.delete(id)
        remember(id, kept)
        job.resolve(kept)
        return
      }
    }
    if (paused()) {
      pending.delete(id)
      job.resolve(null)
      return
    }
    line.push(job)
    void pump()
  }

  return {
    /**
     * 몇 ms 뒤에 다시 물어야 받아줄지. 막혀 있지 않으면 0.
     *
     * 번역 없이 돌아간 카드가 언제 다시 부탁할지 정하는 데 쓴다. 결과가 null 인데
     * `cached` 도 undefined 면, 그 글은 아직 판정이 나지 않은 것이다.
     */
    nextAttemptIn(): number {
      return Math.max(0, pausedUntil - now())
    },

    /** 이미 받은 번역. 아직 묻지 않았으면 undefined. */
    cached(tweetId: string, lang: string): string | null | undefined {
      return cache.get(key(tweetId, lang))
    },

    request(tweetId: string, lang: string): GrokRequest {
      const id = key(tweetId, lang)
      if (cache.has(id)) {
        return { promise: Promise.resolve(cache.get(id) ?? null), cancel: () => {} }
      }

      let job = pending.get(id)
      const fresh = !job
      if (!job) {
        let resolve!: (text: string | null) => void
        const promise = new Promise<string | null>((done) => {
          resolve = done
        })
        job = { tweetId, lang, waiters: 0, promise, resolve }
        pending.set(id, job)
      }
      // 줄에 세우기 전에 센다. 돌리는 쪽이 첫 차례를 그 자리에서 집어 가는데, 그때
      // 기다리는 카드가 0 이면 사라진 카드의 몫으로 보고 버린다.
      job.waiters += 1
      if (fresh) void enter(job)

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
          ...(reply.status ? { status: reply.status } : {}),
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

export const grok = createGrokClient({
  transport: askInterceptor,
  store: { load: loadGrokTranslation, save: saveGrokTranslation },
})
