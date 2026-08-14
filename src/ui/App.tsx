import { useCallback, useEffect, useState } from 'react'
import type { DeckLayout } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import { CollectorFrame } from './components/CollectorFrame'
import { DeckColumn, type ColumnReorder } from './components/DeckColumn'
import { PostComposer } from './components/PostComposer'
import { SettingsPanel } from './components/SettingsPanel'
import { TopBar } from './components/TopBar'
import { useCollector } from './hooks/useCollector'
import { fontStack } from './lib/fonts'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useSettings } from './hooks/useSettings'

/**
 * 두 컬럼을 늘어놓을 자리가 있는지 재는 두 자.
 *
 * 좌우로 놓으려면 폭이, 위아래로 쌓으려면 높이가 있어야 한다. 둘 중 하나만
 * 충분해도 두 컬럼을 다 띄울 수 있다 — 세로로 긴 창에서 탭으로 가르던 것이
 * 폭만 보고 판단한 탓이었다.
 */
const ROOM_SIDE_BY_SIDE = '(min-width: 900px)'
const ROOM_STACKED = '(min-height: 700px)'

/**
 * 내 게시·반응이 끝난 뒤 팔로잉을 다시 받기까지 두는 틈.
 * 곧바로 요청하면 방금 올린 글이 아직 타임라인에 실리지 않아 헛걸음이 된다.
 */
const AFTER_ACTION_DELAY_MS = 1_500

export interface AppProps {
  /** 이 문서가 직접 수집하는 컬럼. 나머지는 숨은 프레임이 맡는다. */
  hostKind: TimelineKind
  /** 덱을 통과 모드로 두어 아래 x.com 을 쓸 수 있게 한다. */
  onPassthrough: (enabled: boolean) => void
}

export function App({ hostKind, onPassthrough }: AppProps) {
  const { settings, update } = useSettings()
  const collector = useCollector(settings, hostKind)
  const canSideBySide = useMediaQuery(ROOM_SIDE_BY_SIDE)
  const canStack = useMediaQuery(ROOM_STACKED)

  /**
   * 실제로 그릴 배치.
   *
   * 탭을 골랐으면 창이 아무리 넓어도 탭이다 — 그러라고 있는 선택지다.
   * 나머지는 자리가 되는 대로 눕힌다. 좌우로 놓을 폭이 없으면 위아래로,
   * 그마저 안 되면 탭으로 떨어진다. 저장된 설정은 건드리지 않아 창을 다시
   * 키우면 고른 배치로 돌아온다.
   */
  const layout: DeckLayout =
    settings.layout === 'tabs' ? 'tabs' : canSideBySide ? settings.layout : canStack ? 'rows' : 'tabs'
  const isDeck = layout !== 'tabs'

  /** 지금 창에서 고를 수 있는 배치. 못 쓰는 것을 눌리게 두면 눌러도 안 바뀌어 고장으로 보인다. */
  const layoutAvailable: Record<DeckLayout, boolean> = {
    columns: canSideBySide,
    rows: canSideBySide || canStack,
    tabs: true,
  }
  const [activeColumn, setActiveColumn] = useState<TimelineKind>(hostKind)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')
  const [dragKind, setDragKind] = useState<TimelineKind | null>(null)

  // 로그인이 필요하면 덱을 비켜준다 — 아래에 x.com 공식 로그인 화면이 이미 떠 있다.
  const passthrough = peeking || collector.loginNeededFor !== null

  useEffect(() => {
    onPassthrough(passthrough)
  }, [onPassthrough, passthrough])

  // 'system' 은 여기서 실제 값으로 풀어 항상 명시한다 (CSS 에 분기를 두지 않기 위해).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      setResolvedTheme(settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  const toggleTheme = useCallback(() => {
    update({ theme: resolvedTheme === 'light' ? 'dark' : 'light' })
  }, [resolvedTheme, update])

  /**
   * 내가 쓰거나 반응한 결과는 팔로잉 타임라인에 실린다. 그 컬럼만 조용히 다시 받아
   * 방금 한 일이 바로 보이게 한다 — 돌아가는 표시도 결과 안내도 내지 않는다.
   */
  const { refresh } = collector
  const showsFollowing = settings.columns.includes('following')
  const handleActed = useCallback(() => {
    if (!showsFollowing) return
    window.setTimeout(() => refresh('following', { quiet: true }), AFTER_ACTION_DELAY_MS)
  }, [refresh, showsFollowing])

  const handleLoadMore = useCallback(
    (kind: TimelineKind) => {
      void collector.loadMore(kind)
    },
    [collector],
  )

  const visibleColumns = isDeck ? settings.columns : settings.columns.filter((kind) => kind === activeColumn)

  /**
   * 끌어온 컬럼을 놓은 컬럼 자리에 꽂는다.
   * 오른쪽으로 끌었으면 대상 뒤, 왼쪽으로 끌었으면 대상 앞 — 컬럼이 둘이면 자리 맞바꿈이다.
   */
  const moveColumn = (from: TimelineKind, to: TimelineKind) => {
    if (from === to) return
    const forward = settings.columns.indexOf(from) < settings.columns.indexOf(to)
    const rest = settings.columns.filter((kind) => kind !== from)
    const at = rest.indexOf(to)
    if (at < 0) return
    rest.splice(forward ? at + 1 : at, 0, from)
    update({ columns: rest })
  }

  // 컬럼이 하나뿐이거나 한 번에 하나만 보이는 폭에서는 순서를 바꿀 자리가 없다.
  const reorder: ColumnReorder | null =
    isDeck && settings.columns.length > 1
      ? {
          dragging: dragKind,
          onStart: setDragKind,
          onEnd: () => setDragKind(null),
          onDrop: (target) => {
            if (dragKind) moveColumn(dragKind, target)
            setDragKind(null)
          },
        }
      : null
  // 교대 수집으로 넘어갔으면 프레임은 더 이상 쓸모가 없다.
  const collectorKinds = collector.rotating ? [] : settings.columns.filter((kind) => kind !== hostKind)

  return (
    <div
      className={`xdeck flex h-full flex-col ${passthrough ? 'pointer-events-none' : ''}`}
      data-theme={resolvedTheme}
      data-passthrough={passthrough ? 'true' : 'false'}
      style={{ fontFamily: fontStack(settings.fontFamily) }}
    >
      {passthrough ? (
        <PassthroughBanner
          reason={collector.loginNeededFor}
          onReturn={() => setPeeking(false)}
          canReturn={collector.loginNeededFor === null}
        />
      ) : (
        <>
          <TopBar
            columns={collector.columns}
            settings={settings}
            theme={resolvedTheme}
            activeColumn={isDeck ? null : activeColumn}
            onSelectColumn={setActiveColumn}
            onToggleTheme={toggleTheme}
            onOpenSettings={() => setSettingsOpen(true)}
            onPeek={() => setPeeking(true)}
            canArrange={settings.columns.length > 1}
            layout={layout}
            layoutAvailable={layoutAvailable}
            onChangeLayout={(next) => update({ layout: next })}
            onCompose={() => setComposing(true)}
          />

          <main
            className={`flex min-h-0 flex-1 gap-3 overflow-hidden p-0 md:p-3 ${
              isDeck && layout === 'rows' ? 'flex-col' : ''
            }`}
          >
            {visibleColumns.map((kind) => (
              <DeckColumn
                key={kind}
                kind={kind}
                column={collector.columns[kind]}
                settings={settings}
                onFlush={collector.flush}
                onHold={collector.setHold}
                onRefresh={collector.refresh}
                onLoadMore={handleLoadMore}
                rotating={collector.rotating}
                reorder={reorder}
                onActed={handleActed}
              />
            ))}
          </main>

          <SettingsPanel
            open={settingsOpen}
            settings={settings}
            onUpdate={update}
            onClose={() => setSettingsOpen(false)}
          />

          {composing && (
            <PostComposer
              mode="post"
              onPosted={handleActed}
              onClose={() => setComposing(false)}
            />
          )}
        </>
      )}

      {/* 통과 모드에서도 수집은 계속 돌아야 하므로 프레임은 항상 남겨둔다. */}
      {collectorKinds.map((kind) => (
        <CollectorFrame
          key={kind}
          kind={kind}
          register={collector.registerFrame}
          onReport={collector.reportFrame}
        />
      ))}
    </div>
  )
}

/**
 * 통과 모드의 유일한 UI. 덱이 비켜난 동안 아래 x.com 을 그대로 쓸 수 있다.
 * 로그인도 이 상태에서 x.com 공식 화면으로 진행한다 — 자격 증명이 확장을 거치지 않는다.
 */
function PassthroughBanner({
  reason,
  onReturn,
  canReturn,
}: {
  reason: TimelineKind | null
  onReturn: () => void
  canReturn: boolean
}) {
  return (
    <div className="pointer-events-none flex justify-center p-3">
      <div className="animate-fade pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface/95 px-4 py-2 shadow-lg shadow-black/25 backdrop-blur-xl">
        <span className="text-[13px] text-text">
          {reason
            ? `x.com 로그인이 필요하다 — 로그인하면 ${TIMELINE_LABEL[reason]} 수집이 이어서 시작된다.`
            : 'x.com 원본을 보고 있다.'}
        </span>
        {canReturn && (
          <button
            type="button"
            onClick={onReturn}
            className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-strong"
          >
            덱으로 돌아가기
          </button>
        )}
      </div>
    </div>
  )
}
