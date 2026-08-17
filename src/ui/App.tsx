import { useCallback, useEffect, useRef, useState } from 'react'
import { collectedKinds, watchedKinds, type DeckLayout } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import { openLogout } from '../content/actions'
import { CollectorFrame } from './components/CollectorFrame'
import { DeckColumn, type ColumnReorder } from './components/DeckColumn'
import { PostComposer } from './components/PostComposer'
import { SettingsPanel } from './components/SettingsPanel'
import { TopBar } from './components/TopBar'
import { WatchPanel } from './components/WatchPanel'
import { XPageModal } from './components/XPageModal'
import { useCollector } from './hooks/useCollector'
import { pauseHostCollector } from './hostCollector'
import { fontStack } from './lib/fonts'
import { countUniqueSince, type UnreadSlice } from './lib/unread'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useSettings } from './hooks/useSettings'
import { useViewer } from './hooks/useViewer'

/**
 * 컬럼 하나가 제구실을 하는 최소 크기와, 컬럼 바깥에서 먹는 자리.
 *
 * 자리가 되는지는 컬럼 개수에 따라 재야 한다. 고정된 잣대 하나로 재면 넷을
 * 늘어놓을 수 있는 창에서도 둘을 못 늘어놓는 일이 생긴다 — 둘일 때 요구하던
 * 폭이 넷일 때 컬럼 하나에 돌아가는 폭보다 넓었던 탓이다.
 */
const MIN_COLUMN_WIDTH = 340
const MIN_COLUMN_HEIGHT = 300
/** 컬럼 사이 간격(gap-3)과 덱 좌우 여백(p-3), 그리고 위쪽 막대가 먹는 높이. */
const DECK_GAP = 12
const DECK_INSET = 24
const TOP_BAR_HEIGHT = 56

/** 컬럼 개수만큼 늘어놓을 자리가 있는지 재는 자. */
function roomFor(axis: 'width' | 'height', count: number): string {
  const min = axis === 'width' ? MIN_COLUMN_WIDTH : MIN_COLUMN_HEIGHT
  const chrome = axis === 'width' ? 0 : TOP_BAR_HEIGHT
  return `(min-${axis}: ${count * min + (count - 1) * DECK_GAP + DECK_INSET + chrome}px)`
}

/**
 * 내 게시·반응이 끝난 뒤 팔로잉을 다시 받아보는 시각들.
 *
 * 한 번만 받으면 놓친다. 곧바로 요청하면 방금 올린 글이 아직 타임라인에 실리지
 * 않았고, 늦게 한 번만 요청하면 그때까지 화면이 비어 있다. 몇 번에 나눠 확인해야
 * 빨리 실린 경우와 늦게 실린 경우를 모두 잡는다.
 */
const AFTER_ACTION_TRIES_MS = [1_500, 5_000, 12_000]

export interface AppProps {
  /** 이 문서가 직접 수집하는 컬럼. 나머지는 숨은 프레임이 맡는다. */
  hostKind: TimelineKind
  /** 덱을 통과 모드로 두어 아래 x.com 을 쓸 수 있게 한다. */
  onPassthrough: (enabled: boolean) => void
}

export function App({ hostKind, onPassthrough }: AppProps) {
  const { settings, update } = useSettings()
  const collector = useCollector(settings, hostKind)
  const viewer = useViewer()
  // 늘어놓을 컬럼 수가 곧 필요한 자리다. 컬럼을 줄이면 좁은 창에서도 덱이 유지된다.
  const columnCount = settings.columns.length
  const canSideBySide = useMediaQuery(roomFor('width', columnCount))
  const canStack = useMediaQuery(roomFor('height', columnCount))

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
  const [profileOpen, setProfileOpen] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')
  const [dragKind, setDragKind] = useState<TimelineKind | null>(null)

  /** 컬럼 없이 종으로만 지켜보는 타임라인. */
  const watching = watchedKinds(settings)
  /** 겹쳐 펼친 지켜보기 판이 지금 보여주는 타임라인. 닫혀 있으면 null. */
  const [watchKind, setWatchKind] = useState<TimelineKind | null>(null)

  /**
   * 지켜보는 타임라인을 마지막으로 본 시각.
   *
   * 세는 출발점은 덱을 연 때다. 보관해둔 과거 글까지 안 본 것으로 세면 덱을 띄우는
   * 순간부터 종에 수백 건이 붙어 아무 것도 알려주지 못한다.
   */
  const openedAt = useRef(Date.now())
  const [seenAt, setSeenAt] = useState<Partial<Record<TimelineKind, number>>>({})

  /** 한 타임라인에서 안 본 것이 담길 자리. 대기시켜 둔 것도 안 본 것이다 — 판을 내려 읽다 닫으면 그쪽에 쌓인다. */
  const slicesFor = useCallback(
    (kind: TimelineKind): UnreadSlice[] => {
      const since = seenAt[kind] ?? openedAt.current
      const column = collector.columns[kind]
      return [
        { items: column.tweets, since },
        { items: column.buffered, since },
      ]
    },
    [collector.columns, seenAt],
  )

  const unreadFor = useCallback(
    (kind: TimelineKind) => countUniqueSince(slicesFor(kind)),
    [slicesFor],
  )
  /**
   * 종 하나에 지켜보는 타임라인이 모두 묶인다. 갈래별 수를 더하지 않는 이유는
   * 같은 멘션이 알림(전체)과 멘션 양쪽에 실려 오기 때문이다 — 더하면 한 건이 두 건이 된다.
   */
  const unread = countUniqueSince(watching.flatMap(slicesFor))

  /** 판에 띄운 동안은 보고 있는 것이다. 열 때와 닫을 때 양쪽에서 본 시각을 찍는다. */
  useEffect(() => {
    if (watchKind === null) return
    const kind = watchKind
    const mark = () => setSeenAt((prev) => ({ ...prev, [kind]: Date.now() }))
    mark()
    return mark
  }, [watchKind])

  // 설정에서 지켜보기를 껐는데 판이 그 타임라인을 띄운 채로 남아 있으면 닫는다.
  useEffect(() => {
    if (watchKind !== null && !watching.includes(watchKind)) setWatchKind(null)
  }, [watchKind, watching])

  // 로그인이 필요하면 덱을 비켜준다 — 아래에 x.com 공식 로그인 화면이 이미 떠 있다.
  const passthrough = peeking || collector.loginNeededFor !== null

  useEffect(() => {
    onPassthrough(passthrough)
    // 사용자가 직접 비켜달라고 한 동안에만 손을 뗀다. 그러지 않으면 사용자가 고른
    // 탭을 우리가 계속 되돌려 서로 싸운다.
    //
    // 로그인 때문에 비켜난 경우에는 멈추면 안 된다. 멈춘 수집기는 다시 판단하지
    // 않으므로, 한 번 로그인 필요로 새면 로그인이 멀쩡해도 그 상태에 갇힌다.
    pauseHostCollector(peeking)
  }, [onPassthrough, passthrough, peeking])

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
   * 컬럼 하나만 재우거나 깨운다.
   *
   * 전체 절전과 따로 논다 — 이쪽은 '이 컬럼은 원래 급하지 않다' 는 상시 지정이라,
   * 상단 바의 번개를 껐다 켜도 그대로 남아 있어야 한다.
   */
  const columnPowerSave = settings.powerSaveColumns
  const togglePowerSaveColumn = useCallback(
    (kind: TimelineKind) => {
      update({
        powerSaveColumns: columnPowerSave.includes(kind)
          ? columnPowerSave.filter((item) => item !== kind)
          : [...columnPowerSave, kind],
      })
    },
    [columnPowerSave, update],
  )

  /**
   * 내가 쓰거나 반응한 결과는 팔로잉 타임라인에 실린다. 그 컬럼만 조용히 다시 받아
   * 방금 한 일이 바로 보이게 한다 — 돌아가는 표시도 결과 안내도 내지 않는다.
   */
  const { refresh } = collector
  // 컬럼으로 띄우지 않고 지켜보기만 해도 받아둔다 — 그 목록을 펼쳤을 때 방금 한 일이 없으면 안 된다.
  const showsFollowing = collectedKinds(settings).includes('following')
  const actedTimers = useRef<number[]>([])
  const handleActed = useCallback(() => {
    if (!showsFollowing) return
    // 앞서 잡아둔 확인이 남아 있으면 겹치지 않게 걷어낸다.
    actedTimers.current.forEach(window.clearTimeout)
    actedTimers.current = AFTER_ACTION_TRIES_MS.map((delay) =>
      window.setTimeout(() => refresh('following', { quiet: true }), delay),
    )
  }, [refresh, showsFollowing])

  useEffect(() => () => actedTimers.current.forEach(window.clearTimeout), [])

  /**
   * 로그아웃. 덱을 먼저 비켜세우고 x.com 의 계정 메뉴를 열어 로그아웃까지 누른다.
   *
   * **마지막 확인은 사용자가 x.com 의 대화상자에서 직접 한다.** 계정에서 나가는 일을
   * 우리가 대신 눌러줄 이유가 없고, 비켜서지 않으면 그 대화상자가 덱 아래에 깔린다.
   *
   * 선택자가 어긋나 못 찾으면 비켜선 채로 둔다 — 사용자가 그 자리에서 직접 로그아웃할
   * 수 있고, '덱으로 돌아가기' 로 언제든 되돌아온다.
   */
  const handleLogout = useCallback(() => {
    setPeeking(true)
    void openLogout()
  }, [])

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
  // 띄우는 컬럼만이 아니라 지켜보는 타임라인까지 세운다 — 프레임이 없으면 그 타임라인은
  // 화면에서만 사라지는 게 아니라 한 건도 들어오지 않는다.
  const collectorKinds = collector.rotating
    ? []
    : collectedKinds(settings).filter((kind) => kind !== hostKind)

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
            powerSave={settings.powerSave}
            onTogglePowerSave={() => update({ powerSave: !settings.powerSave })}
            onPeek={() => setPeeking(true)}
            canArrange={settings.columns.length > 1}
            layout={layout}
            layoutAvailable={layoutAvailable}
            onChangeLayout={(next) => update({ layout: next })}
            onCompose={() => setComposing(true)}
            watching={watching}
            unread={unread}
            onOpenWatch={() =>
              // 안 본 것이 있는 쪽을 먼저 편다 — 종을 누른 이유가 대개 그것이다.
              setWatchKind(watching.find((kind) => unreadFor(kind) > 0) ?? watching[0] ?? null)
            }
            viewer={viewer}
            onOpenProfile={() => setProfileOpen(true)}
            onLogout={handleLogout}
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
                onBusy={collector.setBusy}
                onRefresh={collector.refresh}
                onTogglePowerSave={togglePowerSaveColumn}
                onLoadMore={handleLoadMore}
                rotating={collector.rotating}
                reorder={reorder}
                onActed={handleActed}
              />
            ))}
          </main>

          {watchKind && (
            <WatchPanel
              kinds={watching}
              active={watchKind}
              column={collector.columns[watchKind]}
              settings={settings}
              unreadFor={unreadFor}
              onSelect={setWatchKind}
              onClose={() => setWatchKind(null)}
              onFlush={collector.flush}
              onHold={collector.setHold}
              onBusy={collector.setBusy}
              onRefresh={collector.refresh}
              onTogglePowerSave={togglePowerSaveColumn}
              onLoadMore={handleLoadMore}
              rotating={collector.rotating}
              onActed={handleActed}
            />
          )}

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

          {profileOpen && viewer && (
            <XPageModal
              url={`https://x.com/${viewer.handle}`}
              handle={viewer.handle}
              label="님의 프로필"
              onClose={() => setProfileOpen(false)}
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
    // 화면 아래로 내린다. 위에 두면 x.com 의 추천·팔로잉 탭을 정확히 덮는다.
    <div className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-3">
      <div className="animate-fade pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface/95 px-4 py-2 shadow-lg shadow-black/25 backdrop-blur-xl">
        <span className="text-[13px] text-text">
          {reason
            ? `x.com 로그인이 필요합니다 — 로그인하면 ${TIMELINE_LABEL[reason]} 수집이 이어서 시작됩니다.`
            : 'x.com 원본을 보고 있습니다.'}
        </span>
        {canReturn && (
          <button
            type="button"
            onClick={onReturn}
            className="rounded-full bg-button px-3 py-1 text-[12.5px] font-semibold text-button-text transition-colors hover:bg-button-strong"
          >
            덱으로 돌아가기
          </button>
        )}
      </div>
    </div>
  )
}
