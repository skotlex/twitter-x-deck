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

export function App() {
  const { settings, update } = useSettings()
  const collector = useCollector(settings)
  const isDeck = useMediaQuery(DECK_BREAKPOINT)
  const [activeColumn, setActiveColumn] = useState<TimelineKind>('foryou')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 'system' 은 여기서 실제 값으로 풀어 항상 data-theme 를 명시한다 (CSS 에 분기를 두지 않기 위해).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  const toggleTheme = useCallback(() => {
    update({ theme: settings.theme === 'light' ? 'dark' : 'light' })
  }, [settings.theme, update])

  const handleLoadMore = useCallback(
    (kind: TimelineKind) => {
      void collector.loadMore(kind)
    },
    [collector],
  )

  const visibleColumns = isDeck ? settings.columns : settings.columns.filter((kind) => kind === activeColumn)

  return (
    <div className="flex h-full flex-col bg-canvas text-text">
      <TopBar
        columns={collector.columns}
        settings={settings}
        activeColumn={isDeck ? null : activeColumn}
        onSelectColumn={setActiveColumn}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
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
            onSwitchToTabMode={collector.switchToTabMode}
          />
        ))}
      </main>

      {collector.loginNeededFor && (
        <LoginOverlay kind={collector.loginNeededFor} />
      )}

      {settings.columns.map((kind) => (
        <CollectorFrame
          key={kind}
          kind={kind}
          mode={collector.mode[kind]}
          expanded={collector.loginNeededFor === kind}
          register={collector.registerFrame}
        />
      ))}

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onUpdate={update}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

/**
 * 로그인 안내. 실제 입력은 이 위에 겹쳐 뜨는 x.com 프레임이 받는다 —
 * 우리는 자격 증명을 만지지 않고, x.com 공식 로그인 화면을 그대로 보여줄 뿐이다.
 */
function LoginOverlay({ kind }: { kind: TimelineKind }) {
  return (
    <div className="animate-fade fixed inset-0 z-40 bg-black/70 backdrop-blur-sm">
      <div className="mx-auto max-w-[520px] px-4 pt-5 text-center">
        <p className="text-[15px] font-semibold text-white">x.com 로그인이 필요하다</p>
        <p className="mt-1 text-[13px] text-white/70">
          아래 창은 x.com 로그인 화면 그대로다. 로그인하면 {TIMELINE_LABEL[kind]} 수집이 이어서 시작된다.
        </p>
      </div>
    </div>
  )
}
