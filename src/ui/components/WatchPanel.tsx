import { useEffect } from 'react'
import type { Settings } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import type { ColumnState } from '../hooks/useCollector'
import { unreadLabel } from '../lib/unread'
import { DeckColumn } from './DeckColumn'
import { BellIcon, CloseIcon } from './icons'

export interface WatchPanelProps {
  /** 컬럼 없이 지켜보는 타임라인들. 둘 이상이면 위쪽에서 갈아 끼운다. */
  kinds: TimelineKind[]
  active: TimelineKind
  column: ColumnState
  settings: Settings
  unreadFor: (kind: TimelineKind) => number
  onSelect: (kind: TimelineKind) => void
  onClose: () => void
  onFlush: (kind: TimelineKind) => void
  onHold: (kind: TimelineKind, hold: boolean) => void
  onBusy: (kind: TimelineKind, busy: boolean) => void
  onRefresh: (kind: TimelineKind) => void
  onTogglePowerSave: (kind: TimelineKind) => void
  onLoadMore: (kind: TimelineKind) => void
  rotating: boolean
  onActed: () => void
}

/**
 * 지켜보는 타임라인을 덱 위에 겹쳐 펼치는 판.
 *
 * 안쪽은 컬럼과 같은 `DeckColumn` 이다 — 답글·하트·리포스트도, 새 글 알약도, 스크롤로
 * 과거 글을 잇는 것도 컬럼에서 하던 그대로다. 카드가 띄우는 작성창과 게시물 창은
 * `z-[60]` 이라 이 판(z-50) 위로 올라온다.
 *
 * 폭을 영구히 먹지 않는 것이 이 판의 존재 이유다. 좁은 창에서 추천·팔로잉을 나란히
 * 둔 채로 멘션을 확인하고 닫으면 원래 배치가 그대로 남는다.
 */
export function WatchPanel({
  kinds,
  active,
  column,
  settings,
  unreadFor,
  onSelect,
  onClose,
  onFlush,
  onHold,
  onBusy,
  onRefresh,
  onTogglePowerSave,
  onLoadMore,
  rotating,
  onActed,
}: WatchPanelProps) {
  useEffect(() => {
    // 덮개가 키 이벤트를 아래 x.com 으로 못 가게 끊으므로 캡처 단계로 받는다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /**
   * 판을 닫을 때 '내려 읽는 중' 표시를 걷는다.
   *
   * 목록을 내린 채로 닫으면 그 표시가 남아, 보이지도 않는 컬럼이 새 글을 계속
   * 알약으로만 쌓아둔다 — 종의 안 본 수도 그만큼 늦게 는다.
   */
  useEffect(() => () => onHold(active, false), [active, onHold])

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="지켜보는 타임라인"
        className="animate-fade fixed inset-y-0 right-0 z-50 flex w-[min(480px,100%)] flex-col overflow-hidden border-l border-line bg-canvas shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 px-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <BellIcon className="h-4 w-4 text-muted" />
            지켜보는 타임라인
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="닫기"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        {kinds.length > 1 && (
          <nav className="flex shrink-0 gap-1 px-3 pb-2" aria-label="지켜보는 타임라인 선택">
            {kinds.map((kind) => {
              const selected = kind === active
              const unread = unreadFor(kind)
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onSelect(kind)}
                  aria-pressed={selected}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    selected ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                  }`}
                >
                  {TIMELINE_LABEL[kind]}
                  {!selected && unread > 0 && (
                    <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-white">
                      {unreadLabel(unread)}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        )}

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <DeckColumn
            kind={active}
            column={column}
            settings={settings}
            onFlush={onFlush}
            onHold={onHold}
            onBusy={onBusy}
            onRefresh={onRefresh}
            onTogglePowerSave={onTogglePowerSave}
            onLoadMore={onLoadMore}
            rotating={rotating}
            reorder={null}
            onActed={onActed}
          />
        </div>
      </aside>
    </>
  )
}
