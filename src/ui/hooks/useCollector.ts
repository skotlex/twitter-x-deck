/**
 * 수집 파이프라인의 덱 쪽 절반.
 *
 * 최상위 문서가 담당하는 컬럼은 같은 문서의 수집기가, 나머지는 같은 오리진의 숨은
 * 프레임이 채운다. 양쪽 모두 `window` 의 message 로 도착하므로 받는 경로는 하나다.
 * x.com DOM 을 아는 코드는 여기에 한 줄도 없다 — 전부 content script 쪽에 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadRecent, pruneTweets, saveTweets, type StoredTweet } from '@core/db'
import { CHANNEL, isFrameMessage, type DeckCommand, type FrameMessage } from '@core/messages'
import { parseTimelinePayload } from '@core/parser'
import type { Settings } from '@core/settings'
import { TIMELINE_KINDS, type CollectorStatus, type TimelineKind } from '@core/types'
import { commandHostCollector, hostOwns, setHostKinds } from '../hostCollector'

/** 한 컬럼이 DOM 에 유지하는 최대 카드 수. 넘으면 오래된 쪽을 잘라낸다. */
const RENDER_CAP = 400
/** 스크롤로 과거를 더 불러올 때의 한 페이지 크기. */
const PAGE_SIZE = 40
/** 프레임이 이 시간 안에 응답이 없으면 뜨지 못한 것으로 본다. */
const FRAME_TIMEOUT_MS = 25_000
/** 보관 정책 적용 주기. */
const PRUNE_INTERVAL_MS = 10 * 60_000

export interface ColumnState {
  status: CollectorStatus
  /** 화면에 그려지는 목록. 최신이 앞. */
  tweets: StoredTweet[]
  /** 목록을 위로 올려둔 동안 대기시킨 새 글. */
  buffered: StoredTweet[]
  /** 더 불러올 과거 글이 남았는지. */
  hasMore: boolean
  /** 파싱이 폴백 경로로 떨어졌는지. 진단용. */
  degraded: boolean
}

export type ColumnMap = Record<TimelineKind, ColumnState>

const emptyColumn = (kind: TimelineKind): ColumnState => ({
  status: { kind, state: 'idle', lastReceivedAt: null, pendingCount: null },
  tweets: [],
  buffered: [],
  hasMore: true,
  degraded: false,
})

const initialColumns = (): ColumnMap => ({
  foryou: emptyColumn('foryou'),
  following: emptyColumn('following'),
})

/** id 중복 없이 새 글을 앞에 붙이고 렌더 상한까지 자른다. */
function prepend(incoming: StoredTweet[], current: StoredTweet[]): StoredTweet[] {
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
  /** 해당 컬럼을 강제로 새로 받아온다. */
  refresh: (kind: TimelineKind) => void
  /** 과거 글을 한 페이지 더 읽어온다. */
  loadMore: (kind: TimelineKind) => Promise<void>
}

export function useCollector(settings: Settings, hostKind: TimelineKind): Collector {
  const [columns, setColumns] = useState<ColumnMap>(initialColumns)
  const [rotating, setRotating] = useState(false)

  const frames = useRef(new Map<TimelineKind, HTMLIFrameElement>())
  const holds = useRef<Record<TimelineKind, boolean>>({ foryou: false, following: false })
  const loadingMore = useRef<Record<TimelineKind, boolean>>({ foryou: false, following: false })
  const settingsRef = useRef(settings)
  settingsRef.current = settings
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
    const { tweets, degraded } = parseTimelinePayload(message.body, kind, capturedAt)
    // 게시물이 하나도 없는 응답은 파싱 상태의 근거가 못 된다 — 판정을 그대로 유지한다.
    if (tweets.length === 0) return

    void saveTweets(tweets).then((inserted) => {
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
  }, [])

  // 최상위 문서의 수집기와 자식 프레임 모두 같은 오리진에서 같은 형태로 보낸다.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isFrameMessage(event.data)) return
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
        for (const [kind, tweets] of results) {
          next[kind] = { ...next[kind], tweets, hasMore: tweets.length === PAGE_SIZE }
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
      const stalled = TIMELINE_KINDS.filter(
        (kind) => !hostOwns(kind) && columnsRef.current[kind].status.state === 'idle',
      )
      if (stalled.length === 0) return

      setRotating(true)
      setHostKinds([...settingsRef.current.columns])
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
    (kind: TimelineKind) => {
      sendCommand(kind, 'refresh')
    },
    [sendCommand],
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
        const fresh = older.filter((t) => !known.has(t.key))
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
