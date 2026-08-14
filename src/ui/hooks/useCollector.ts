/**
 * 수집 파이프라인의 덱 쪽 절반.
 *
 * 프레임(또는 폴백 탭)에서 올라온 메시지를 받아 파싱 → 저장 → 화면 반영까지 잇고,
 * 컬럼별 상태와 조작 함수를 컴포넌트에 넘긴다.
 * x.com DOM 을 아는 코드는 여기에 한 줄도 없다 — 전부 content script 쪽에 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadRecent, pruneTweets, saveTweets, type StoredTweet } from '@core/db'
import { CHANNEL, isFrameMessage, type DeckCommand, type FrameMessage } from '@core/messages'
import { parseTimelinePayload } from '@core/parser'
import type { Settings } from '@core/settings'
import { TIMELINE_KINDS, type CollectorStatus, type TimelineKind } from '@core/types'

const X_ORIGIN = 'https://x.com'
/** 한 컬럼이 DOM 에 유지하는 최대 카드 수. 넘으면 오래된 쪽을 잘라낸다. */
const RENDER_CAP = 400
/** 스크롤로 과거를 더 불러올 때의 한 페이지 크기. */
const PAGE_SIZE = 40
/** 프레임이 이 시간 안에 응답이 없으면 임베드가 막힌 것으로 보고 탭 모드로 넘어간다. */
const FRAME_TIMEOUT_MS = 20_000
/** 보관 정책 적용 주기. */
const PRUNE_INTERVAL_MS = 10 * 60_000

export type CollectorMode = 'frame' | 'tab'

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
  mode: Record<TimelineKind, CollectorMode>
  /** 로그인 화면을 띄워야 하는 컬럼. 없으면 null. */
  loginNeededFor: TimelineKind | null
  registerFrame: (kind: TimelineKind, frame: HTMLIFrameElement | null) => void
  /** 대기 중인 새 글을 목록에 반영한다. */
  flush: (kind: TimelineKind) => void
  /** 스크롤 위치에 따라 새 글을 즉시 반영할지 대기시킬지 알린다. */
  setHold: (kind: TimelineKind, hold: boolean) => void
  /** 해당 컬럼을 강제로 새로 받아온다. */
  refresh: (kind: TimelineKind) => void
  /** 임베드가 막혔을 때 사용자가 직접 고정 탭 모드로 넘어간다. */
  switchToTabMode: (kind: TimelineKind) => void
  /** 과거 글을 한 페이지 더 읽어온다. */
  loadMore: (kind: TimelineKind) => Promise<void>
}

export function useCollector(settings: Settings): Collector {
  const [columns, setColumns] = useState<ColumnMap>(initialColumns)
  const [mode, setMode] = useState<Record<TimelineKind, CollectorMode>>({
    foryou: 'frame',
    following: 'frame',
  })

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

  const sendCommand = useCallback((kind: TimelineKind, command: DeckCommand['command']) => {
    const message: DeckCommand = { channel: CHANNEL, type: 'command', command }
    const frame = frames.current.get(kind)
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(message, X_ORIGIN)
      return
    }
    // 폴백 탭 모드에서는 백그라운드가 해당 탭으로 중계한다.
    void chrome.runtime
      .sendMessage({ channel: CHANNEL, type: 'background', action: 'relay-command', role: kind, command })
      .catch(() => {})
  }, [])

  /** 프레임에서 올라온 메시지 하나를 처리한다. */
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
    if (tweets.length === 0) {
      if (degraded) setColumns((prev) => ({ ...prev, [kind]: { ...prev[kind], degraded: true } }))
      return
    }

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

  // 프레임(postMessage) 과 폴백 탭(runtime message) 양쪽에서 같은 형태로 받는다.
  useEffect(() => {
    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== X_ORIGIN || !isFrameMessage(event.data)) return
      handleMessage(event.data)
    }
    const onRuntimeMessage = (message: unknown) => {
      if (isFrameMessage(message)) handleMessage(message)
    }

    window.addEventListener('message', onWindowMessage)
    chrome.runtime.onMessage.addListener(onRuntimeMessage)
    return () => {
      window.removeEventListener('message', onWindowMessage)
      chrome.runtime.onMessage.removeListener(onRuntimeMessage)
    }
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
   * 임베드가 막혔다고 판단되면 상태만 'blocked' 로 올린다.
   * 예전에는 여기서 곧바로 고정 탭을 열었지만, 확장을 켰다는 이유로 탭이 두 개 튀어나오는 건
   * 사용자가 원한 동작이 아니다. 전환은 컬럼 배너의 버튼으로만 일어난다.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setColumns((prev) => {
        let changed = false
        const next = { ...prev }
        for (const kind of TIMELINE_KINDS) {
          // 여태 'idle' 이면 브리지가 한 번도 말을 걸지 않은 것 — 프레임이 뜨지 못했다는 뜻.
          if (prev[kind].status.state !== 'idle') continue
          next[kind] = {
            ...prev[kind],
            status: {
              ...prev[kind].status,
              state: 'blocked',
              message: 'x.com 임베드가 차단됐다.',
            },
          }
          changed = true
        }
        return changed ? next : prev
      })
    }, FRAME_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])

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

  const switchToTabMode = useCallback((kind: TimelineKind) => {
    setMode((prev) => ({ ...prev, [kind]: 'tab' }))
    setColumns((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], status: { ...prev[kind].status, state: 'loading', message: undefined } },
    }))
    void chrome.runtime
      .sendMessage({ channel: CHANNEL, type: 'background', action: 'open-fallback-tab', role: kind })
      .catch(() => {})
  }, [])

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

  return { columns, mode, loginNeededFor, registerFrame, flush, setHold, refresh, switchToTabMode, loadMore }
}
