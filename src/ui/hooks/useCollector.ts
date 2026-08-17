/**
 * 수집 파이프라인의 덱 쪽 절반.
 *
 * 최상위 문서가 담당하는 컬럼은 같은 문서의 수집기가, 나머지는 같은 오리진의 숨은
 * 프레임이 채운다. 양쪽 모두 `window` 의 message 로 도착하므로 받는 경로는 하나다.
 * x.com DOM 을 아는 코드는 여기에 한 줄도 없다 — 전부 content script 쪽에 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteTweet, loadRecent, pruneTweets, saveTweets, type StoredItem } from '@core/db'
import {
  CHANNEL,
  isComposedMessage,
  isDeletedMessage,
  isFrameMessage,
  type DeckCommand,
  type FrameMessage,
} from '@core/messages'
import { parseCreatedTweet, parseDeletedId, parseTimelinePayload } from '@core/parser'
import { wasLoggedOut } from '@core/session'
import { acceptsNewItems, collectedKinds, isPowerSaving, type Settings } from '@core/settings'
import {
  isNotification,
  isNotificationKind,
  notificationIdentity,
  TIMELINE_KINDS,
  type CollectorState,
  type CollectorStatus,
  type TimelineKind,
} from '@core/types'
import { commandHostCollector, hostOwns, primeHostCollector, setHostKinds } from '../hostCollector'

/** 한 컬럼이 DOM 에 유지하는 최대 카드 수. 넘으면 오래된 쪽을 잘라낸다. */
const RENDER_CAP = 400
/** 스크롤로 과거를 더 불러올 때의 한 페이지 크기. */
const PAGE_SIZE = 40
/** 프레임이 이 시간 안에 응답이 없으면 뜨지 못한 것으로 본다. */
const FRAME_TIMEOUT_MS = 25_000
/** 아직 한 건도 못 받은 컬럼을 최상위 문서가 대신 훑기까지 기다리는 시간. */
const PRIME_FIRST_MS = 5_000
/** 프레임이 아직 한 번도 타임라인을 내놓지 않았을 때, 컬럼이 이만큼 조용하면 다시 대신 훑는다. */
const PRIME_QUIET_MS = 15_000
/** 프레임이 살아 있는 컬럼은 이만큼 조용할 때만 손을 댄다. */
const PRIME_STALE_MS = 90_000
/** 대타 방문이 필요한지 살피는 주기. */
const PRIME_CHECK_MS = 2_500
/**
 * 새로고침을 누른 뒤 응답을 기다리는 한계.
 *
 * 수집기는 한 수단씩 밟아 올라간다 ([collector.ts](../../content/collector.ts) 의
 * 사다리). 사람이 누른 뒤에는 2.5 초 간격으로 네 칸을 다 밟으므로, 마지막 칸이
 * 응답을 물어올 때까지는 기다려야 한다 — 그 전에 '새 글 없음' 을 띄우면 바로 뒤에
 * 글이 쏟아지는 것과 어긋난다.
 */
const REFRESH_TIMEOUT_MS = 14_000
/** 새로고침 결과 안내를 띄워두는 시간. */
const NOTE_MS = 4_000
/** 보관 정책 적용 주기. */
const PRUNE_INTERVAL_MS = 10 * 60_000

export interface ColumnState {
  status: CollectorStatus
  /** 화면에 그려지는 목록. 최신이 앞. 알림 컬럼에는 게시물과 알림이 섞인다. */
  tweets: StoredItem[]
  /** 목록을 위로 올려둔 동안 대기시킨 새 항목. */
  buffered: StoredItem[]
  /** 더 불러올 과거 글이 남았는지. */
  hasMore: boolean
  /** 파싱이 폴백 경로로 떨어졌는지. 진단용. */
  degraded: boolean
  /** 새로고침을 눌러 응답을 기다리는 중인지. */
  refreshing: boolean
  /** 새로고침 결과 한 줄. 잠깐 띄웠다 지운다. */
  note: string | null
}

export type ColumnMap = Record<TimelineKind, ColumnState>

const emptyColumn = (kind: TimelineKind, state: CollectorState = 'idle'): ColumnState => ({
  status: { kind, state, lastReceivedAt: null, pendingCount: null },
  tweets: [],
  buffered: [],
  hasMore: true,
  degraded: false,
  refreshing: false,
  note: null,
})

/** 컬럼 종류마다 같은 값을 채운 표. 종류가 늘어도 빠뜨리는 자리가 없다. */
function byKind<T>(make: (kind: TimelineKind) => T): Record<TimelineKind, T> {
  return Object.fromEntries(TIMELINE_KINDS.map((kind) => [kind, make(kind)])) as Record<
    TimelineKind,
    T
  >
}

/**
 * 첫 화면의 컬럼들.
 *
 * 지난번에 로그아웃으로 판정났다면 그 상태로 시작한다. 그러지 않으면 수집기가 다시
 * 판단하는 1초 사이에 보관된 글이 떴다가 로그인 화면으로 밀려나 화면이 튄다.
 * 힌트가 틀렸더라도 수집기의 첫 판정이 곧바로 덮어쓴다.
 */
const initialColumns = (): ColumnMap =>
  byKind((kind) =>
    // 이 문서가 담당하는 컬럼에만 건다. 프레임 담당까지 걸면 그 프레임이 상태를
    // 알려줄 때까지 덱이 비켜선 채로 남는데, 프레임은 덱이 뜬 뒤에야 만들어진다.
    emptyColumn(kind, wasLoggedOut() && hostOwns(kind) ? 'login-required' : 'idle'),
  )

/**
 * 이 컬럼에 실제로 보여줄 항목만 남긴다.
 *
 * 멘션은 게시물만 담는다. 알림 화면은 전체 목록과 멘션 목록을 둘 다 불러오므로
 * 귀속이 한 번 빗나가면 두 컬럼이 똑같아진다. 받을 때만 거르면 그전에 저장된
 * 기록은 그대로 남으므로, 읽어 올릴 때도 같은 잣대를 댄다.
 */
function visibleFor(kind: TimelineKind, items: StoredItem[]): StoredItem[] {
  const kept = kind === 'mentions' ? items.filter((item) => !isNotification(item)) : items
  return dedupeNotifications([...kept].sort(newestFirst(kind)))
}

/**
 * 같은 알림이 여러 줄로 보이지 않게 거른다. 최신이 앞인 목록을 받아 앞의 것을 남긴다.
 *
 * 저장소는 열쇠로 이미 가려낸다. 여기서 한 번 더 보는 것은 **예전 방식(x.com 의 id)
 * 으로 쌓인 줄** 때문이다 — 그 줄들은 새로 받는 것과 열쇠가 달라 짝지어지지 않는다.
 * 보관 정리가 걷어내지만, 그전에도 화면에는 한 줄만 보여야 한다.
 */
function dedupeNotifications(items: StoredItem[]): StoredItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!isNotification(item)) return true
    const identity = notificationIdentity(item)
    if (identity === null) return true
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/**
 * 최신이 앞. 무엇을 '최신' 으로 볼지는 컬럼에 따라 다르다.
 *
 * **홈 컬럼(추천 · 팔로잉)은 관측 시각이 자리를 정한다.** 알고리즘 타임라인이라 글
 * 자체의 시각은 뒤죽박죽이고, 방금 받아온 것이 위에 오는 것이 스트림의 뜻이다. 한
 * 응답으로 들어온 것들은 관측 시각이 모두 같으므로 그 안에서는 글의 시각으로 가른다.
 *
 * **알림 컬럼(알림 · 멘션)은 글의 시각이 정한다.** x.com 의 알림 화면 자체가 시간
 * 순서라 사용자도 그렇게 읽는다. 여기서 관측 시각을 앞세우면 사흘 전 알림이 방금
 * 다시 관측됐다는 이유만으로 어제 온 답글 위에 앉는다 — 실제로 그렇게 보였다.
 * 알림은 id 에도 시간 순서가 없어 관측 시각을 버금 기준으로 둔다.
 */
export function newestFirst(kind: TimelineKind): (a: StoredItem, b: StoredItem) => number {
  return isNotificationKind(kind)
    ? (a, b) => b.createdAt - a.createdAt || b.capturedAt - a.capturedAt
    : (a, b) => b.capturedAt - a.capturedAt || b.createdAt - a.createdAt
}

/** id 중복 없이 새 항목을 붙이고 렌더 상한까지 자른다. 자리는 컬럼의 차례가 정한다. */
function prepend(kind: TimelineKind, incoming: StoredItem[], current: StoredItem[]): StoredItem[] {
  if (incoming.length === 0) return current
  const known = new Set(current.map((t) => t.key))
  const fresh = incoming.filter((t) => !known.has(t.key))
  if (fresh.length === 0) return current
  return dedupeNotifications([...fresh, ...current].sort(newestFirst(kind))).slice(0, RENDER_CAP)
}

export interface Collector {
  columns: ColumnMap
  /** 로그인 화면을 띄워야 하는 컬럼. 없으면 null. */
  loginNeededFor: TimelineKind | null
  /** 프레임을 못 띄워 최상위 문서가 탭을 교대로 방문하는 중인지. */
  rotating: boolean
  registerFrame: (kind: TimelineKind, frame: HTMLIFrameElement | null) => void
  /** 프레임이 뜬 뒤 확인한 진단 문구를 전달한다. */
  reportFrame: (kind: TimelineKind, message: string) => void
  /** 대기 중인 새 글을 목록에 반영한다. */
  flush: (kind: TimelineKind) => void
  /** 스크롤 위치에 따라 새 글을 즉시 반영할지 대기시킬지 알린다. */
  setHold: (kind: TimelineKind, hold: boolean) => void
  /** 컬럼 안에서 영상 재생·번역처럼 방해하면 안 되는 일이 도는지 알린다. */
  setBusy: (kind: TimelineKind, busy: boolean) => void
  /**
   * 해당 컬럼을 강제로 새로 받아온다.
   * `quiet` 는 사람이 누른 게 아닐 때 쓴다 — 돌아가는 표시도 결과 안내도 내지 않는다.
   */
  refresh: (kind: TimelineKind, options?: { quiet?: boolean }) => void
  /** 과거 글을 한 페이지 더 읽어온다. */
  loadMore: (kind: TimelineKind) => Promise<void>
}

export function useCollector(settings: Settings, hostKind: TimelineKind): Collector {
  const [columns, setColumns] = useState<ColumnMap>(initialColumns)
  const [rotating, setRotating] = useState(false)

  const frames = useRef(new Map<TimelineKind, HTMLIFrameElement>())
  const refreshTimers = useRef<Partial<Record<TimelineKind, number>>>({})
  const noteTimers = useRef<Partial<Record<TimelineKind, number>>>({})
  const holds = useRef<Record<TimelineKind, boolean>>(byKind(() => false))
  /** 영상 재생·번역처럼 지금 끼어들면 안 되는 일이 도는 컬럼. */
  const busy = useRef<Record<TimelineKind, boolean>>(byKind(() => false))
  const loadingMore = useRef<Record<TimelineKind, boolean>>(byKind(() => false))
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** 각 컬럼의 담당 프레임이 마지막으로 타임라인을 내놓은 시각. 프레임 생사의 유일한 근거다. */
  const frameSeen = useRef<Record<TimelineKind, number | null>>(byKind(() => null))
  // 콜백에서 최신 컬럼 상태를 읽되 의존성으로 끌어들이지 않기 위한 거울.
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const registerFrame = useCallback((kind: TimelineKind, frame: HTMLIFrameElement | null) => {
    if (frame) frames.current.set(kind, frame)
    else frames.current.delete(kind)
  }, [])

  const reportFrame = useCallback((kind: TimelineKind, message: string) => {
    setColumns((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], status: { ...prev[kind].status, message } },
    }))
  }, [])

  const sendCommand = useCallback((kind: TimelineKind, command: DeckCommand['command']) => {
    // 같은 문서의 수집기라면 함수를 그대로 부른다.
    if (commandHostCollector(kind, command)) return
    const message: DeckCommand = { channel: CHANNEL, type: 'command', command }
    frames.current.get(kind)?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  /**
   * 새로고침을 끝내고 결과를 한 줄로 알린다.
   *
   * 새로 온 글이 없을 때도 무언가 보여야 한다 — 눌렀는데 화면이 그대로면
   * 버튼이 죽은 것과 구별되지 않는다.
   */
  const settleRefresh = useCallback((kind: TimelineKind, note: string | null) => {
    window.clearTimeout(refreshTimers.current[kind])
    window.clearTimeout(noteTimers.current[kind])
    setColumns((prev) => ({ ...prev, [kind]: { ...prev[kind], refreshing: false, note } }))
    if (!note) return
    noteTimers.current[kind] = window.setTimeout(() => {
      setColumns((prev) =>
        prev[kind].note === note ? { ...prev, [kind]: { ...prev[kind], note: null } } : prev,
      )
    }, NOTE_MS)
  }, [])

  /** 수집기에서 올라온 메시지 하나를 처리한다. */
  const handleMessage = useCallback((message: FrameMessage) => {
    const kind = message.role

    if (message.type === 'status') {
      setColumns((prev) => ({
        ...prev,
        [kind]: {
          ...prev[kind],
          status: { ...prev[kind].status, state: message.state, message: message.message },
        },
      }))
      return
    }

    if (message.type === 'pending') {
      setColumns((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], status: { ...prev[kind].status, pendingCount: message.count } },
      }))
      return
    }

    /*
     * 안 켠 타임라인은 파싱하지도 저장하지도 않는다.
     *
     * 수집기는 담당 탭을 새로 받아오려고 옆 탭에 잠깐 들렀다 온다. 그 김에 우리가
     * 켜지도 않은 타임라인이 통째로 딸려 오는데, 예전에는 그것까지 전부 파싱해서
     * (응답 하나가 수 MB 다) IndexedDB 에 넣었다. 화면에 그릴 일도 없는 자료다 —
     * 새로고침을 누를 때마다 CPU 가 튀던 몫의 하나가 여기였다.
     *
     * 상태·알림 수는 위에서 이미 처리했다. 그쪽은 우리가 세운 수집기가 자기 담당
     * 컬럼에 대해서만 보내므로 걸러낼 것이 없다.
     */
    if (!collectedKinds(settingsRef.current).includes(kind)) return

    /*
     * 멈춰둔 컬럼에도 넣지 않는다. 같은 이유로 파싱 앞에 둔다.
     *
     * 담당 수집기를 세우는 것만으로는 컬럼이 멈추지 않는다 — 옆 컬럼의 수집기가
     * 홈 링크를 다시 누르거나 탭을 튕기면 추천 타임라인이 딸려 오고, 귀속이 정확한
     * 만큼 그대로 추천 컬럼에 쌓인다. 컬럼별 절전을 켜도 추천이 계속 갱신되던 자리다.
     */
    if (!acceptsNewItems(settingsRef.current, kind, columnsRef.current[kind].refreshing)) return

    // timeline: 파싱 → 저장 → 새로 들어온 것만 화면에 반영
    const capturedAt = Date.now()
    const parsed = parseTimelinePayload(message.body, kind, capturedAt)
    const { degraded } = parsed
    const items = visibleFor(kind, parsed.items as StoredItem[])
    // 건진 게 하나도 없는 응답은 파싱 상태의 근거가 못 된다 — 판정을 그대로 유지한다.
    if (items.length === 0) {
      if (columnsRef.current[kind].refreshing) settleRefresh(kind, '새 글 없음')
      return
    }

    void saveTweets(items).then((inserted) => {
      if (columnsRef.current[kind].refreshing) {
        settleRefresh(kind, inserted.length > 0 ? null : '새 글 없음')
      }
      setColumns((prev) => {
        const column = prev[kind]
        const status: CollectorStatus = {
          ...column.status,
          state: 'streaming',
          lastReceivedAt: capturedAt,
        }
        if (inserted.length === 0) return { ...prev, [kind]: { ...column, status, degraded } }

        /*
         * 새 글을 지금 끼워 넣을지, 알약으로 세워둘지.
         *
         * 스크롤 쪽은 설정을 따른다. 영상·번역 쪽은 설정과 무관하게 늘 세워둔다 —
         * 보고 있던 것이 새 글 높이만큼 아래로 밀려나는 일은 스크롤이 맨 위에
         * 있더라도 똑같이 방해가 된다.
         */
        const hold =
          (holds.current[kind] && settingsRef.current.holdWhileScrolled) || busy.current[kind]
        return {
          ...prev,
          [kind]: {
            ...column,
            status,
            degraded,
            tweets: hold ? column.tweets : prepend(kind, inserted, column.tweets),
            buffered: hold ? prepend(kind, inserted, column.buffered) : [],
          },
        }
      })
    })
  }, [settleRefresh])

  /**
   * 방금 올린 글을 목록에 바로 끼워 넣는다.
   *
   * 타임라인을 다시 받아오면 그 글이 실릴 때까지 기다려야 한다. 게시 응답에 그 글이
   * 통째로 들어 있으므로 그것만 넣으면 x.com 이 자기 화면에서 하는 것과 같아진다.
   */
  const ingestCreated = useCallback((body: string) => {
    const kind: TimelineKind = 'following'
    if (!collectedKinds(settingsRef.current).includes(kind)) return
    const created = parseCreatedTweet(body, kind)
    if (!created) return

    void saveTweets([created]).then((inserted) => {
      if (inserted.length === 0) return
      setColumns((prev) => ({ ...prev, [kind]: { ...prev[kind], tweets: prepend(kind, inserted, prev[kind].tweets) } }))
    })
  }, [])

  /** 지운 글을 목록과 저장소에서 걷어낸다. 어느 컬럼에 들어 있든 함께 지운다. */
  const ingestDeleted = useCallback((body: string) => {
    const id = parseDeletedId(body)
    if (!id) return

    void deleteTweet(id)
    setColumns((prev) => {
      const next = { ...prev }
      for (const kind of TIMELINE_KINDS) {
        const column = prev[kind]
        const tweets = column.tweets.filter((item) => item.id !== id)
        const buffered = column.buffered.filter((item) => item.id !== id)
        if (tweets.length === column.tweets.length && buffered.length === column.buffered.length) {
          continue
        }
        next[kind] = { ...column, tweets, buffered }
      }
      return next
    })
  }, [])

  // 최상위 문서의 수집기와 자식 프레임 모두 같은 오리진에서 같은 형태로 보낸다.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (isComposedMessage(event.data)) {
        ingestCreated(event.data.body)
        return
      }
      if (isDeletedMessage(event.data)) {
        ingestDeleted(event.data.body)
        return
      }
      if (!isFrameMessage(event.data)) return
      // 최상위 문서가 되던진 것과 자식 프레임이 보낸 것은 발신 창으로 갈린다.
      // 대타로 채운 컬럼을 프레임이 살아 있다고 착각하지 않으려면 이 구분이 필요하다.
      if (event.data.type === 'timeline' && event.source !== window) {
        frameSeen.current[event.data.role] = Date.now()
      }
      handleMessage(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleMessage, ingestCreated, ingestDeleted])

  /**
   * 듣기 시작하자마자 지금 상태를 물어본다.
   *
   * 최상위 문서의 수집기는 덱보다 **먼저** 뜬다. 그래서 그쪽이 처음 알린 상태는 듣는
   * 이가 없어 흘러가 버리고, 그 뒤로 상태가 그대로면 다시 알릴 일도 없다. 물어보지
   * 않으면 덱은 첫 화면을 계속 들고 있게 된다 — 지난 로그아웃 힌트로 시작한
   * 경우에는 로그인이 멀쩡한데도 비켜선 채로 남는다.
   */
  useEffect(() => {
    for (const kind of TIMELINE_KINDS) {
      if (hostOwns(kind)) sendCommand(kind, 'ping')
    }
  }, [sendCommand])

  // 저장해둔 최근 글을 먼저 그려서 빈 화면을 보여주지 않는다.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      TIMELINE_KINDS.map(async (kind) => [kind, await loadRecent(kind, PAGE_SIZE)] as const),
    ).then((results) => {
      if (cancelled) return
      setColumns((prev) => {
        const next = { ...prev }
        for (const [kind, stored] of results) {
          next[kind] = {
            ...next[kind],
            tweets: visibleFor(kind, stored),
            hasMore: stored.length === PAGE_SIZE,
          }
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 자식 프레임이 끝내 말을 걸지 않으면 교대 수집으로 넘어간다.
   *
   * 최상위 문서가 두 탭을 번갈아 방문하면 프레임 없이도 두 컬럼을 채울 수 있다.
   * 응답 귀속은 GraphQL operation 이름으로 하므로 어느 탭을 보고 있었는지와 무관하게 정확하다.
   * 대가는 지연 — 각 컬럼이 교대 주기만큼 늦게 갱신된다.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // 교대 수집은 최상위 문서가 자기 화면의 탭을 오가는 것이다. 알림 컬럼은
      // 다른 주소에 있어 이 문서가 대신해줄 수 없으므로 셈에서 뺀다.
      const canServe = collectedKinds(settingsRef.current).filter((kind) => !isNotificationKind(kind))
      const stalled = canServe.filter(
        (kind) => !hostOwns(kind) && columnsRef.current[kind].status.state === 'idle',
      )
      if (stalled.length === 0) return

      setRotating(true)
      setHostKinds(canServe)
      setColumns((prev) => {
        const next = { ...prev }
        for (const kind of stalled) {
          next[kind] = {
            ...prev[kind],
            status: { ...prev[kind].status, state: 'loading', message: '교대 수집으로 전환' },
          }
        }
        return next
      })
    }, FRAME_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [hostKind])

  /**
   * 프레임이 첫 타임라인을 내놓기 전까지 최상위 문서가 그 컬럼을 대신 채운다.
   *
   * 숨은 프레임은 x.com 을 처음부터 띄우는 데다, 떠도 기본 탭(추천)이 먼저라
   * 담당 타임라인까지 한참이 걸린다. 그동안 이미 떠 있는 최상위 문서가 그 탭을
   * 잠깐 들렀다 오면 같은 응답을 훨씬 먼저 받는다.
   *
   * 프레임이 한 번이라도 응답을 내놓으면 손을 뗀다 — 그 뒤로는 오래 조용할 때만 거든다.
   */
  useEffect(() => {
    // 교대 수집으로 넘어갔으면 최상위 문서가 이미 두 탭을 다 돌고 있다.
    if (rotating) return

    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      for (const kind of collectedKinds(settingsRef.current)) {
        // 멈춰둔 컬럼은 대신 훑지 않는다. 탭을 오가는 것이 곧 x.com 의 재렌더라,
        // 절전이 막으려던 바로 그 값을 이쪽으로 다시 치르게 된다.
        if (isPowerSaving(settingsRef.current, kind)) continue
        if (hostOwns(kind)) continue
        const seen = frameSeen.current[kind]
        const lastAny = columnsRef.current[kind].status.lastReceivedAt
        const quietFor = now - (lastAny ?? startedAt)
        const limit = lastAny === null ? PRIME_FIRST_MS : seen === null ? PRIME_QUIET_MS : PRIME_STALE_MS
        if (quietFor > limit) primeHostCollector(kind)
      }
    }, PRIME_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [rotating])

  // 보관 정책 적용.
  useEffect(() => {
    const prune = () => {
      void pruneTweets(settingsRef.current.retentionDays, settingsRef.current.maxPerColumn, TIMELINE_KINDS)
    }
    prune()
    const timer = window.setInterval(prune, PRUNE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const flush = useCallback((kind: TimelineKind) => {
    setColumns((prev) => {
      const column = prev[kind]
      if (column.buffered.length === 0) return prev
      return {
        ...prev,
        [kind]: { ...column, tweets: prepend(kind, column.buffered, column.tweets), buffered: [] },
      }
    })
  }, [])

  const setHold = useCallback((kind: TimelineKind, hold: boolean) => {
    holds.current[kind] = hold
  }, [])

  const setBusy = useCallback((kind: TimelineKind, next: boolean) => {
    busy.current[kind] = next
  }, [])

  const refresh = useCallback(
    (kind: TimelineKind, options?: { quiet?: boolean }) => {
      // 자동 새로고침은 화면에 흔적을 남기지 않는다. 새 글이 있으면 그게 곧 응답이다.
      if (options?.quiet) {
        // 멈춰둔 컬럼은 조용히도 두드리지 않는다 — 어차피 들이지 않을 응답이다.
        if (isPowerSaving(settingsRef.current, kind)) return
        sendCommand(kind, 'refresh')
        return
      }
      if (columnsRef.current[kind].refreshing) return
      window.clearTimeout(noteTimers.current[kind])
      setColumns((prev) => ({ ...prev, [kind]: { ...prev[kind], refreshing: true, note: null } }))
      sendCommand(kind, 'refresh')
      refreshTimers.current[kind] = window.setTimeout(() => {
        // 수집기가 멀쩡히 돌고 있는데 응답이 없었다면 x.com 이 받아올 게 없었던 것이다.
        // 그걸 '응답 없음' 이라 부르면 고장난 것처럼 읽힌다.
        const alive = columnsRef.current[kind].status.state === 'streaming'
        settleRefresh(kind, alive ? '새 글 없음' : '응답 없음')
      }, REFRESH_TIMEOUT_MS)
    },
    [sendCommand, settleRefresh],
  )

  const loadMore = useCallback(async (kind: TimelineKind) => {
    if (loadingMore.current[kind]) return
    loadingMore.current[kind] = true
    try {
      /*
       * 다음 페이지의 경계는 **가장 먼저 관측한 시각**이다. 저장소는 관측 시각으로
       * 줄지어 있는데(`by-source-captured`), 알림 컬럼은 화면에 글의 시각 순서로
       * 그려지므로 목록의 마지막 항목이 관측 시각까지 가장 이른 것이라는 보장이 없다 —
       * 그걸 경계로 삼으면 그보다 늦게 관측된 과거 글을 통째로 건너뛴다.
       * 홈 컬럼에서는 마지막 항목이 곧 최솟값이라 결과가 달라지지 않는다.
       */
      const loaded = columnsRef.current[kind].tweets
      const oldest = loaded.length > 0 ? Math.min(...loaded.map((item) => item.capturedAt)) : undefined
      const older = await loadRecent(kind, PAGE_SIZE, oldest)
      setColumns((prev) => {
        const column = prev[kind]
        const known = new Set(column.tweets.map((t) => t.key))
        const fresh = visibleFor(kind, older).filter((t) => !known.has(t.key))
        return {
          ...prev,
          [kind]: {
            ...column,
            tweets: dedupeNotifications([...column.tweets, ...fresh].sort(newestFirst(kind))),
            hasMore: older.length === PAGE_SIZE,
          },
        }
      })
    } finally {
      loadingMore.current[kind] = false
    }
  }, [])

  /**
   * 덱을 비켜세워야 하는 컬럼. 없으면 null.
   *
   * **이 문서가 담당하는 컬럼만 본다.** 비켜서는 것은 이 문서의 x.com 을 드러내는
   * 일이라, 로그인 화면이 뜰 자리도 여기다. 프레임이 로그인 필요를 알려오는 것은
   * 그 프레임이 아직 자리를 못 잡았을 때도 생기는데, 그것 때문에 멀쩡한 덱이 통째로
   * 비켜서면 돌아올 길이 없다 — 프레임 사정은 컬럼 배지로 알리는 것으로 충분하다.
   */
  const loginNeededFor = useMemo(
    () =>
      TIMELINE_KINDS.find(
        (kind) => hostOwns(kind) && columns[kind].status.state === 'login-required',
      ) ?? null,
    [columns],
  )

  return {
    columns,
    loginNeededFor,
    rotating,
    registerFrame,
    reportFrame,
    flush,
    setHold,
    setBusy,
    refresh,
    loadMore,
  }
}
