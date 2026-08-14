import { useCallback, useEffect, useState } from 'react'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import { CollectorFrame } from './components/CollectorFrame'
import { DeckColumn } from './components/DeckColumn'
import { SettingsPanel } from './components/SettingsPanel'
import { TopBar } from './components/TopBar'
import { useCollector } from './hooks/useCollector'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useSettings } from './hooks/useSettings'

/** 이 폭 아래로는 컬럼을 하나만 띄우고 상단 탭으로 전환한다. */
const DECK_BREAKPOINT = '(min-width: 900px)'

export interface AppProps {
  /** 이 문서가 직접 수집하는 컬럼. 나머지는 숨은 프레임이 맡는다. */
  hostKind: TimelineKind
  /** 덱을 통과 모드로 두어 아래 x.com 을 쓸 수 있게 한다. */
  onPassthrough: (enabled: boolean) => void
}

export function App({ hostKind, onPassthrough }: AppProps) {
  const { settings, update } = useSettings()
  const collector = useCollector(settings, hostKind)
  const isDeck = useMediaQuery(DECK_BREAKPOINT)
  const [activeColumn, setActiveColumn] = useState<TimelineKind>(hostKind)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')

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

  const handleLoadMore = useCallback(
    (kind: TimelineKind) => {
      void collector.loadMore(kind)
    },
    [collector],
  )

  const visibleColumns = isDeck ? settings.columns : settings.columns.filter((kind) => kind === activeColumn)
  const collectorKinds = settings.columns.filter((kind) => kind !== hostKind)

  return (
    <div
      className={`xdeck flex h-full flex-col ${passthrough ? 'pointer-events-none' : ''}`}
      data-theme={resolvedTheme}
      data-passthrough={passthrough ? 'true' : 'false'}
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
          />

          <main className="flex min-h-0 flex-1 gap-3 overflow-hidden p-0 md:p-3">
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
              />
            ))}
          </main>

          <SettingsPanel
            open={settingsOpen}
            settings={settings}
            onUpdate={update}
            onClose={() => setSettingsOpen(false)}
          />
        </>
      )}

      {/* 통과 모드에서도 수집은 계속 돌아야 하므로 프레임은 항상 남겨둔다. */}
      {collectorKinds.map((kind) => (
        <CollectorFrame key={kind} kind={kind} register={collector.registerFrame} />
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
