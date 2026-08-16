import { useState } from 'react'
import type { DeckLayout, Settings } from '@core/settings'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import type { ViewerInfo } from '../../content/selectors'
import type { ColumnMap } from '../hooks/useCollector'
import { unreadLabel } from '../lib/unread'
import {
  ArchiveIcon,
  BellIcon,
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
  /** x.com 로그아웃 화면으로 데려간다. */
  onLogout: () => void
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
  /** 컬럼 없이 지켜보는 타임라인. 비어 있으면 종을 달지 않는다. */
  watching: TimelineKind[]
  /** 지켜보는 타임라인에 덱을 연 뒤로 쌓인, 아직 안 본 글 수. */
  unread: number
  /** 지켜보기 판을 펼친다. */
  onOpenWatch: () => void
  /** 지금 로그인한 계정. 아직 못 읽었으면 null. */
  viewer: ViewerInfo | null
  /**
   * 내 프로필 창을 연다.
   *
   * 창은 이 상단 바가 아니라 덱 뿌리에서 그린다. 상단 바에는 backdrop-blur 가
   * 걸려 있는데, 그런 요소는 그 안의 fixed 자식에게 기준 상자가 되어버린다 —
   * 화면 전체를 덮어야 할 창이 56px 짜리 머리글 안에 갇힌다.
   */
  onOpenProfile: () => void
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
  watching,
  unread,
  onOpenWatch,
  viewer,
  onOpenProfile,
  onLogout,
}: TopBarProps) {
  const total = settings.columns.reduce((sum, kind) => sum + columns[kind].tweets.length, 0)
  const [stashOpen, setStashOpen] = useState(false)

  return (
    // 아래 선은 두지 않는다. 컬럼 상자가 배경과 이미 갈려 있어 한 겹 더 그으면
    // 화면 위쪽만 무거워진다.
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 bg-canvas/85 px-3 backdrop-blur-xl sm:px-4">
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

        {/*
          컬럼으로 띄우지 않고 지켜보는 타임라인이 있을 때만 단다. 안 본 수는 배지로
          얹되 아이콘 자리를 밀지 않는다 — 수가 늘고 줄 때마다 옆 단추들이 흔들린다.
        */}
        {watching.length > 0 && (
          <button
            type="button"
            onClick={onOpenWatch}
            className="relative grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={`${watching.map((kind) => TIMELINE_LABEL[kind]).join(' · ')} 보기${
              unread > 0 ? ` — 안 본 글 ${unread}개` : ''
            }`}
            title={`${watching.map((kind) => TIMELINE_LABEL[kind]).join(' · ')} 보기`}
          >
            <BellIcon className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-accent px-1 text-center text-[10.5px] font-semibold leading-[17px] tabular-nums text-white">
                {unreadLabel(unread)}
              </span>
            )}
          </button>
        )}

        {viewer && (
          <ViewerMenu viewer={viewer} onOpenProfile={onOpenProfile} onLogout={onLogout} />
        )}

        <button
          type="button"
          onClick={onCompose}
          className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-button px-3.5 text-[13px] font-semibold text-button-text transition-colors hover:bg-button-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title="새 게시물 작성"
        >
          <QuoteIcon className="h-4 w-4" />
          <span className="hidden sm:block">글쓰기</span>
        </button>

        {/*
          말풍선은 fixed 가 아니라 absolute 로 띄운다. 상단 바에 backdrop-blur 가
          걸려 있어 fixed 는 이 머리글 안에 갇힌다. 바깥을 눌러 닫는 것도 덮개 대신
          버튼의 포커스가 떠나는 것으로 받는다 — 그 덮개 역시 갇히기 때문이다.
        */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setStashOpen((prev) => !prev)}
            onBlur={() => setStashOpen(false)}
            aria-expanded={stashOpen}
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="보관량 보기"
            title="보관량 보기"
          >
            <ArchiveIcon className="h-4 w-4" />
          </button>

          {stashOpen && (
            <div
              role="status"
              className="animate-fade absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] tabular-nums text-text shadow-lg shadow-black/20"
            >
              {total.toLocaleString('ko-KR')}건 보관
            </div>
          )}
        </div>

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

/**
 * 내 프로필 사진. 누르면 무엇을 할지 먼저 고르게 한다 —
 * 리포스트 버튼과 같은 방식이다. 프로필 보기와 로그아웃은 무게가 너무 달라서,
 * 사진을 눌렀다는 것만으로 어느 한쪽이 일어나면 안 된다.
 */
function ViewerMenu({
  viewer,
  onOpenProfile,
  onLogout,
}: {
  viewer: ViewerInfo
  onOpenProfile: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="relative mr-1.5 shrink-0"
      // 바깥을 눌러 닫는 길. 화면을 덮는 판은 쓸 수 없다 — 상단 바의 backdrop-blur 가
      // fixed 자식을 이 머리글 안에 가둔다(위 보관량 말풍선과 같은 사정). 그래서 초점이
      // 이 상자 밖으로 나가는 것으로 받는다. 메뉴 항목도 버튼이라 그리로 옮겨간
      // 초점은 안쪽으로 세어, 항목을 누르는 순간 메뉴가 먼저 닫혀 클릭을 잃는 일이 없다.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOpen(false)
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        // 테두리는 평소에도 둘러둔다 — 사진이 어두우면 배경과 붙어 버튼인지 안 보인다.
        // border 가 아니라 ring 을 쓰는 이유는 사진과 선 사이의 여백 때문이다.
        // border 는 사진에 딱 붙지만 ring 은 offset 만큼 띄워 두를 수 있다.
        className="block rounded-full ring-2 ring-line-strong ring-offset-2 ring-offset-canvas transition-shadow hover:ring-button focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`${viewer.name} 계정 메뉴`}
        title={`@${viewer.handle}`}
      >
        {viewer.avatarUrl ? (
          <img
            src={viewer.avatarUrl}
            alt={viewer.name}
            className="block h-8 w-8 rounded-full bg-surface-2 object-cover"
          />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-muted">
            {viewer.handle.slice(0, 2).toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg shadow-black/30"
        >
          <p className="truncate px-3 py-1.5 text-[12px] text-faint">@{viewer.handle}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenProfile()
            }}
            className="flex w-full items-center px-3 py-2 text-left text-[13px] text-text transition-colors hover:bg-surface-2"
          >
            프로필 보기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full items-center px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-surface-2"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
