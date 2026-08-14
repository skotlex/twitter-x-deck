import type { DeckLayout, Settings } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import type { ColumnMap } from '../hooks/useCollector'
import {
  ColumnsIcon,
  EyeIcon,
  MoonIcon,
  QuoteIcon,
  RowsIcon,
  SettingsIcon,
  SunIcon,
  TabsIcon,
  XLogoIcon,
} from './icons'

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
  /** 컬럼이 둘 이상인지. 하나뿐이면 배치를 고를 이유가 없다. */
  canArrange: boolean
  /** 지금 실제로 그리고 있는 배치. 저장된 설정과 다를 수 있다 (창이 좁으면 눕는다). */
  layout: DeckLayout
  /** 지금 창 크기에서 고를 수 있는 배치. 못 쓰는 것은 눌리지 않게 막는다. */
  layoutAvailable: Record<DeckLayout, boolean>
  onChangeLayout: (layout: DeckLayout) => void
  /** 새 게시물 작성창을 연다. */
  onCompose: () => void
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
  canArrange,
  layout,
  layoutAvailable,
  onChangeLayout,
  onCompose,
}: TopBarProps) {
  const total = settings.columns.reduce((sum, kind) => sum + columns[kind].tweets.length, 0)

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-3 backdrop-blur-xl sm:px-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-text text-canvas">
          <XLogoIcon className="h-4 w-4" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Deck</span>
      </div>

      {canArrange && (
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="컬럼 배치">
          {(
            [
              { value: 'columns', label: '좌우로 나란히', Icon: ColumnsIcon },
              { value: 'rows', label: '위아래로 쌓기', Icon: RowsIcon },
              { value: 'tabs', label: '탭으로 하나씩', Icon: TabsIcon },
            ] as const
          ).map(({ value, label, Icon }) => {
            // 눌린 표시는 저장된 설정이 아니라 지금 그려지는 배치를 가리킨다.
            // 창이 좁아 눕힌 경우, 설정을 가리키면 화면과 어긋나 고장난 것처럼 보인다.
            const selected = layout === value
            const enabled = layoutAvailable[value]
            return (
              <button
                key={value}
                type="button"
                disabled={!enabled}
                onClick={() => onChangeLayout(value)}
                aria-pressed={selected}
                aria-label={label}
                title={enabled ? label : `${label} — 지금 창 크기로는 쓸 수 없다`}
                className={`grid h-7 w-8 place-items-center rounded-md transition-colors disabled:cursor-not-allowed ${
                  selected
                    ? 'bg-surface text-text shadow-sm'
                    : enabled
                      ? 'text-faint hover:text-text'
                      : 'text-faint/40'
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      )}

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
          onClick={onCompose}
          className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-button px-3.5 text-[13px] font-semibold text-button-text transition-colors hover:bg-button-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title="새 게시물 작성"
        >
          <QuoteIcon className="h-4 w-4" />
          <span className="hidden sm:block">글쓰기</span>
        </button>

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
