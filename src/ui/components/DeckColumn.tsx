import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@core/settings'
import { TIMELINE_LABEL, type CollectorState, type TimelineKind } from '@core/types'
import type { ColumnState } from '../hooks/useCollector'
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

export interface DeckColumnProps {
  kind: TimelineKind
  column: ColumnState
  settings: Settings
  onFlush: (kind: TimelineKind) => void
  onHold: (kind: TimelineKind, hold: boolean) => void
  onRefresh: (kind: TimelineKind) => void
  onLoadMore: (kind: TimelineKind) => void
  onSwitchToTabMode: (kind: TimelineKind) => void
}

export function DeckColumn({
  kind,
  column,
  settings,
  onFlush,
  onHold,
  onRefresh,
  onLoadMore,
  onSwitchToTabMode,
}: DeckColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-surface md:rounded-2xl md:border">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-xl">
        <h2 className="text-[15px] font-semibold tracking-tight">{TIMELINE_LABEL[kind]}</h2>

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

        {column.degraded && (
          <span
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-warn"
            title="정석 파싱 경로가 실패해 전체 훑기로 대체 중이다. 선택자 점검이 필요하다."
          >
            폴백 파싱
          </span>
        )}

        <button
          type="button"
          onClick={() => onRefresh(kind)}
          className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`${TIMELINE_LABEL[kind]} 새로 받기`}
        >
          <RefreshIcon className="h-4 w-4" />
        </button>
      </header>

      {state === 'blocked' && (
        <div className="border-b border-line bg-surface-2 px-4 py-3">
          <p className="text-[13px] font-medium text-text">x.com 임베드가 차단됐다</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            덱 안에 숨겨 띄우는 방식이 막혔다. 이 페이지의 개발자 도구 콘솔에 남은 오류가 원인을
            말해준다. 당장 쓰려면 고정 탭으로 바꾼다 — x.com 탭이 하나 생긴다.
          </p>
          <button
            type="button"
            onClick={() => onSwitchToTabMode(kind)}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
          >
            고정 탭으로 전환
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {buffered > 0 && (
          <button
            type="button"
            onClick={scrollToTop}
            className="animate-fade absolute inset-x-0 top-2.5 z-20 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-lg shadow-black/25 transition-transform hover:scale-[1.03]"
          >
            <ArrowUpIcon className="h-3.5 w-3.5" />새 게시물 {buffered}개
          </button>
        )}

        <div ref={scrollRef} onScroll={handleScroll} className="scroll-thin h-full overflow-y-auto overscroll-contain">
          {column.tweets.length === 0 ? (
            <EmptyState state={state} />
          ) : (
            column.tweets.map((tweet, index) => (
              <TweetCard
                key={tweet.key}
                tweet={tweet}
                settings={settings}
                animate={settledRef.current && atTop && index < 12}
              />
            ))
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
      ? 'x.com 로그인이 필요하다.'
      : state === 'blocked'
        ? '수집기를 띄우지 못했다.'
        : state === 'streaming'
          ? '새 게시물을 기다리는 중.'
          : 'x.com 타임라인을 준비하는 중.'

  return (
    <div className="grid h-full place-items-center px-8 py-16 text-center">
      <div>
        <div className="mx-auto h-9 w-9 animate-pulse rounded-full bg-surface-3" />
        <p className="mt-4 text-[14px] text-muted">{copy}</p>
        <p className="mt-1 text-[12.5px] text-faint">수집한 게시물은 자동으로 이 자리에 쌓인다.</p>
      </div>
    </div>
  )
}
