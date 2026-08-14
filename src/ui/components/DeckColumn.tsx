import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@core/settings'
import { isNotification, TIMELINE_LABEL, type CollectorState, type TimelineKind } from '@core/types'
import type { ColumnState } from '../hooks/useCollector'
import { NotificationCard } from './NotificationCard'
import { TweetCard } from './TweetCard'
import { ArrowUpIcon, RefreshIcon } from './icons'

/** 상단으로 완전히 올라온 것으로 볼 여유 픽셀. */
const TOP_THRESHOLD = 24
/** 바닥에 이만큼 가까워지면 과거 글을 더 읽는다. */
const LOAD_MORE_MARGIN = 800

const STATE_TONE: Record<CollectorState, string> = {
  idle: 'bg-faint',
  loading: 'bg-warn',
  'login-required': 'bg-danger',
  streaming: 'bg-success',
  blocked: 'bg-danger',
  error: 'bg-danger',
}

const STATE_LABEL: Record<CollectorState, string> = {
  idle: '대기',
  loading: '준비 중',
  'login-required': '로그인 필요',
  streaming: '수신 중',
  blocked: '차단됨',
  error: '오류',
}

/**
 * 컬럼을 드래그로 재배치하기 위한 연결. 재배치가 무의미한 화면(한 컬럼·좁은 폭)에서는 null.
 * 손잡이는 머리글이고, 놓는 자리는 컬럼 전체다.
 */
export interface ColumnReorder {
  /** 지금 끌고 있는 컬럼. 없으면 null. */
  dragging: TimelineKind | null
  onStart: (kind: TimelineKind) => void
  onEnd: () => void
  onDrop: (kind: TimelineKind) => void
}

export interface DeckColumnProps {
  kind: TimelineKind
  column: ColumnState
  settings: Settings
  onFlush: (kind: TimelineKind) => void
  onHold: (kind: TimelineKind, hold: boolean) => void
  onRefresh: (kind: TimelineKind) => void
  onLoadMore: (kind: TimelineKind) => void
  /** 최상위 문서가 탭을 교대로 방문하며 수집하는 중인지. */
  rotating: boolean
  reorder: ColumnReorder | null
  /** 카드에서 게시·반응이 끝났을 때. 그 결과가 실릴 컬럼을 새로 받는다. */
  onActed: () => void
}

export function DeckColumn({
  kind,
  column,
  settings,
  onFlush,
  onHold,
  onRefresh,
  onLoadMore,
  rotating,
  reorder,
  onActed,
}: DeckColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
  // 이 컬럼 위에 다른 컬럼이 떠 있는지. 놓을 자리를 눈에 보이게 한다.
  const [over, setOver] = useState(false)
  // 첫 렌더에 쌓여 있던 글까지 애니메이션이 터지지 않게 최초 목록은 제외한다.
  const settledRef = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      settledRef.current = true
    }, 600)
    return () => window.clearTimeout(timer)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const top = el.scrollTop <= TOP_THRESHOLD
    setAtTop(top)
    onHold(kind, !top)

    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_MARGIN && column.hasMore) {
      onLoadMore(kind)
    }
  }, [column.hasMore, kind, onHold, onLoadMore])

  const scrollToTop = useCallback(() => {
    onFlush(kind)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [kind, onFlush])

  const { state, pendingCount } = column.status
  const buffered = column.buffered.length
  const dragging = reorder?.dragging ?? null
  // 자기 자신 위로는 놓을 수 없다 — 표시도 하지 않는다.
  const dropTarget = dragging !== null && dragging !== kind

  return (
    <section
      onDragOver={(event) => {
        if (!dropTarget) return
        // 기본 동작을 막아야 이 자리가 '놓을 수 있는 곳' 이 된다.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={(event) => {
        // 안쪽 요소 사이를 오갈 때도 leave 가 오므로 컬럼 밖으로 나간 것만 본다.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOver(false)
      }}
      onDrop={(event) => {
        if (!dropTarget) return
        event.preventDefault()
        setOver(false)
        reorder?.onDrop(kind)
      }}
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-surface transition-[opacity,box-shadow] md:rounded-2xl md:border ${
        dragging === kind ? 'opacity-40' : ''
      } ${over && dropTarget ? 'ring-2 ring-accent' : ''}`}
    >
      <header
        draggable={reorder !== null}
        onDragStart={(event) => {
          // 머리글 안의 버튼을 누른 것까지 드래그로 삼지 않는다.
          if (event.target instanceof HTMLElement && event.target.closest('button')) {
            event.preventDefault()
            return
          }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', kind)
          reorder?.onStart(kind)
        }}
        onDragEnd={() => {
          setOver(false)
          reorder?.onEnd()
        }}
        className={`sticky top-0 z-10 flex select-none items-center gap-2.5 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-xl ${
          reorder ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <h2
          className="text-[15px] font-semibold tracking-tight"
          title={reorder ? '끌어서 컬럼 순서 바꾸기' : undefined}
        >
          {TIMELINE_LABEL[kind]}
        </h2>

        <span
          className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted"
          title={column.status.message ?? STATE_LABEL[state]}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_TONE[state]}`} />
          {STATE_LABEL[state]}
        </span>

        {pendingCount !== null && pendingCount > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            대기 {pendingCount}
          </span>
        )}

        {rotating && (
          <span
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted"
            title="숨은 프레임을 띄우지 못해 한 문서가 두 탭을 번갈아 방문하며 수집합니다. 갱신이 그만큼 늦습니다."
          >
            교대 수집
          </span>
        )}

        {column.note && (
          <span className="animate-fade rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
            {column.note}
          </span>
        )}

        {column.degraded && (
          <span
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-warn"
            title="정석 파싱 경로가 실패해 전체 훑기로 대체 중입니다. 선택자 점검이 필요합니다."
          >
            폴백 파싱
          </span>
        )}

        <button
          type="button"
          onClick={() => onRefresh(kind)}
          disabled={column.refreshing}
          className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-progress disabled:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`${TIMELINE_LABEL[kind]} 새로 받기`}
          title={column.refreshing ? '새 글을 받아오는 중' : `${TIMELINE_LABEL[kind]} 새로 받기`}
        >
          <RefreshIcon className={`h-4 w-4 ${column.refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {state === 'blocked' && (
        <div className="border-b border-line bg-surface-2 px-4 py-3">
          <p className="text-[13px] font-medium text-text">수집기를 띄우지 못했습니다</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {column.status.message ?? `${TIMELINE_LABEL[kind]} 수집기가 응답하지 않습니다.`}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-button px-3 py-1.5 text-[13px] font-semibold text-button-text transition-colors hover:bg-button-strong"
          >
            탭 새로고침
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {buffered > 0 && (
          <button
            type="button"
            onClick={scrollToTop}
            className="animate-fade absolute inset-x-0 top-2.5 z-20 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-button px-3.5 py-1.5 text-[13px] font-semibold text-button-text shadow-lg shadow-black/25 transition-transform hover:scale-[1.03]"
          >
            <ArrowUpIcon className="h-3.5 w-3.5" />새 게시물 {buffered}개
          </button>
        )}

        <div ref={scrollRef} onScroll={handleScroll} className="scroll-thin h-full overflow-y-auto overscroll-contain">
          {column.tweets.length === 0 ? (
            <EmptyState state={state} />
          ) : (
            column.tweets.map((item, index) =>
              isNotification(item) ? (
                <NotificationCard
                  key={item.key}
                  notification={item}
                  settings={settings}
                  animate={settledRef.current && atTop && index < 12}
                />
              ) : (
                <TweetCard
                  key={item.key}
                  tweet={item}
                  settings={settings}
                  animate={settledRef.current && atTop && index < 12}
                  onActed={onActed}
                />
              ),
            )
          )}

          {column.tweets.length > 0 && !column.hasMore && (
            <p className="py-8 text-center text-[13px] text-faint">보관된 게시물의 끝</p>
          )}
        </div>
      </div>
    </section>
  )
}

function EmptyState({ state }: { state: CollectorState }) {
  const copy =
    state === 'login-required'
      ? 'x.com 로그인이 필요합니다.'
      : state === 'blocked'
        ? '수집기를 띄우지 못했습니다.'
        : state === 'streaming'
          ? '새 게시물을 기다리는 중입니다.'
          : 'x.com 타임라인을 준비하는 중입니다.'

  return (
    <div className="grid h-full place-items-center px-8 py-16 text-center">
      <div>
        <div className="mx-auto h-9 w-9 animate-pulse rounded-full bg-surface-3" />
        <p className="mt-4 text-[14px] text-muted">{copy}</p>
        <p className="mt-1 text-[12.5px] text-faint">수집한 게시물은 자동으로 이 자리에 쌓입니다.</p>
      </div>
    </div>
  )
}
