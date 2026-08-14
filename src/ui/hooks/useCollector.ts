/**
 * 수집 파이프라인의 덱 쪽 절반.
 *
 * 최상위 문서가 담당하는 컬럼은 같은 문서의 수집기가, 나머지는 같은 오리진의 숨은
 * 프레임이 채운다. 양쪽 모두 `window` 의 message 로 도착하므로 받는 경로는 하나다.
 * x.com DOM 을 아는 코드는 여기에 한 줄도 없다 — 전부 content script 쪽에 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadRecent, pruneTweets, saveTweets, type StoredItem } from '@core/db'
import { CHANNEL, isFrameMessage, type DeckCommand, type FrameMessage } from '@core/messages'
import { parseTimelinePayload } from '@core/parser'
import type { Settings } from '@core/settings'
import {
  isNotification,
  isNotificationKind,
  TIMELINE_KINDS,
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
/** 새로고침을 누른 뒤 응답을 기다리는 한계. */
const REFRESH_TIMEOUT_MS = 8_000
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

const emptyColumn = (kind: TimelineKind): ColumnState => ({
  status: { kind, state: 'idle', lastReceivedAt: null, pendingCount: null },
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

const initialColumns = (): ColumnMap => byKind(emptyColumn)

/**
 * 이 컬럼에 실제로 보여줄 항목만 남긴다.
 *
 * 멘션은 게시물만 담는다. 알림 화면은 전체 목록과 멘션 목록을 둘 다 불러오므로
 * 귀속이 한 번 빗나가면 두 컬럼이 똑같아진다. 받을 때만 거르면 그전에 저장된
 * 기록은 그대로 남으므로, 읽어 올릴 때도 같은 잣대를 댄다.
 */
function visibleFor(kind: TimelineKind, items: StoredItem[]): StoredItem[] {
  return kind === 'mentions' ? items.filter((item) => !isNotification(item)) : items
}

/** id 중복 없이 새 항목을 앞에 붙이고 렌더 상한까지 자른다. */
function prepend(incoming: StoredItem[], current: StoredItem[]): StoredItem[] {
  if (incoming.length === 0) return current
  const known = new Set(current.map((t) => t.key))
  const fresh = incoming.filter((t) => !known.has(t.key))
  if (fresh.length === 0) return current
  return [...fresh, ...current].slice(0, RENDER_CAP)
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

        const hold = holds.current[kind] && settingsRef.current.holdWhileScrolled
        return {
          ...prev,
          [kind]: {
            ...column,
            status,
            degraded,
            tweets: hold ? column.tweets : prepend(inserted, column.tweets),
            buffered: hold ? prepend(inserted, column.buffered) : [],
          },
        }
      })
    })
  }, [settleRefresh])

  // 최상위 문서의 수집기와 자식 프레임 모두 같은 오리진에서 같은 형태로 보낸다.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isFrameMessage(event.data)) return
      // 최상위 문서가 되던진 것과 자식 프레임이 보낸 것은 발신 창으로 갈린다.
      // 대타로 채운 컬럼을 프레임이 살아 있다고 착각하지 않으려면 이 구분이 필요하다.
      if (event.data.type === 'timeline' && event.source !== window) {
        frameSeen.current[event.data.role] = Date.now()
      }
      handleMessage(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleMessage])

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
      const canServe = settingsRef.current.columns.filter((kind) => !isNotificationKind(kind))
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
      for (const kind of settingsRef.current.columns) {
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
        [kind]: { ...column, tweets: prepend(column.buffered, column.tweets), buffered: [] },
      }
    })
  }, [])

  const setHold = useCallback((kind: TimelineKind, hold: boolean) => {
    holds.current[kind] = hold
  }, [])

  const refresh = useCallback(
    (kind: TimelineKind, options?: { quiet?: boolean }) => {
      // 자동 새로고침은 화면에 흔적을 남기지 않는다. 새 글이 있으면 그게 곧 응답이다.
      if (options?.quiet) {
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
      const oldest = columnsRef.current[kind].tweets.at(-1)?.capturedAt
      const older = await loadRecent(kind, PAGE_SIZE, oldest)
      setColumns((prev) => {
        const column = prev[kind]
        const known = new Set(column.tweets.map((t) => t.key))
        const fresh = visibleFor(kind, older).filter((t) => !known.has(t.key))
        return {
          ...prev,
          [kind]: {
            ...column,
            tweets: [...column.tweets, ...fresh],
            hasMore: older.length === PAGE_SIZE,
          },
        }
      })
    } finally {
      loadingMore.current[kind] = false
    }
  }, [])

  const loginNeededFor = useMemo(
    () => TIMELINE_KINDS.find((kind) => columns[kind].status.state === 'login-required') ?? null,
    [columns],
  )

  return { columns, loginNeededFor, rotating, registerFrame, reportFrame, flush, setHold, refresh, loadMore }
}
