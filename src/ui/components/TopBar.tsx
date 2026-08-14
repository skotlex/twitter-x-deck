import type { Settings } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import type { ColumnMap } from '../hooks/useCollector'
import { EyeIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'

export interface TopBarProps {
  columns: ColumnMap
  settings: Settings
  /** 'system' 이 풀린 실제 테마. */
  theme: 'dark' | 'light'
  /** 좁은 화면에서 현재 보고 있는 컬럼. 넓은 화면이면 null. */
  activeColumn: TimelineKind | null
  onSelectColumn: (kind: TimelineKind) => void
  onToggleTheme: () => void
  onOpenSettings: () => void
  /** 덱을 비켜 아래 x.com 을 보여준다. */
  onPeek: () => void
}

export function TopBar({
  columns,
  settings,
  theme,
  activeColumn,
  onSelectColumn,
  onToggleTheme,
  onOpenSettings,
  onPeek,
}: TopBarProps) {
  const total = settings.columns.reduce((sum, kind) => sum + columns[kind].tweets.length, 0)

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-3 backdrop-blur-xl sm:px-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-text text-[13px] font-black text-canvas">
          X
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Deck</span>
      </div>

      {activeColumn !== null && (
        <nav className="mx-auto flex rounded-full bg-surface-2 p-0.5" aria-label="타임라인 선택">
          {settings.columns.map((kind) => {
            const selected = kind === activeColumn
            const waiting = columns[kind].buffered.length
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onSelectColumn(kind)}
                aria-pressed={selected}
                className={`relative rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  selected ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                {TIMELINE_LABEL[kind]}
                {!selected && waiting > 0 && (
                  <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            )
          })}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-1 hidden text-[12.5px] tabular-nums text-faint sm:block">
          {total.toLocaleString('ko-KR')}건 보관
        </span>

        <button
          type="button"
          onClick={onPeek}
          className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="x.com 원본 보기"
          title="x.com 원본 보기"
        >
          <EyeIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="테마 전환"
        >
          {theme === 'light' ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="설정 열기"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
