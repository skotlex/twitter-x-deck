import { useState } from 'react'
import { clearAll } from '@core/db'
import type { Settings } from '@core/settings'
import { TIMELINE_KINDS, TIMELINE_LABEL, type TimelineKind } from '@core/types'
import { COMMON_FONTS, fontStack, loadLocalFontFamilies } from '../lib/fonts'
import { ArchiveIcon, CloseIcon, EyeIcon, RefreshIcon, SettingsIcon } from './icons'

const FIELD =
  'rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-text">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

/** 트랙 44 × 24, 손잡이 18. 좌우 여백 3px 이 남아 잘려 보이지 않는다. */
const TRACK_WIDTH = 44
const KNOB_SIZE = 18
const KNOB_INSET = 3

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{ width: TRACK_WIDTH, height: 24 }}
      className={`relative shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        checked ? 'bg-accent' : 'bg-surface-3'
      }`}
    >
      {/* 위치·크기는 인라인 스타일로 못박는다. 유틸리티 조합에 기대면 빌드 설정에 따라 어긋난다. */}
      <span
        className="absolute rounded-full bg-white"
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          top: (24 - KNOB_SIZE) / 2,
          left: checked ? TRACK_WIDTH - KNOB_SIZE - KNOB_INSET : KNOB_INSET,
          transition: 'left 160ms ease',
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.25)',
        }}
      />
    </button>
  )
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  label: string
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(event) => {
        const picked = options.find((option) => String(option.value) === event.target.value)
        if (picked) onChange(picked.value)
      }}
      className={FIELD}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * 띄울 컬럼 고르기.
 *
 * 순서는 건드리지 않는다 — 켤 때 뒤에 붙이고, 끌 때 그 자리만 뺀다.
 * 좌우 순서는 컬럼 머리글을 끌어 옮기는 쪽이 훨씬 직관적이라 거기에 맡긴다.
 * 마지막 하나는 끄지 못하게 막는다. 컬럼이 하나도 없는 덱은 빈 화면이다.
 */
function ColumnPicker({
  columns,
  onChange,
}: {
  columns: TimelineKind[]
  onChange: (next: TimelineKind[]) => void
}) {
  return (
    <div className="py-3.5">
      <p className="text-[14px] font-medium text-text">띄울 컬럼</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
        켠 컬럼마다 x.com 화면을 하나씩 열어 수집합니다. 많이 켤수록 느려집니다.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {TIMELINE_KINDS.map((kind) => {
          const on = columns.includes(kind)
          const last = on && columns.length === 1
          return (
            <button
              key={kind}
              type="button"
              disabled={last}
              aria-pressed={on}
              title={last ? '컬럼은 최소 하나 남겨야 합니다' : TIMELINE_LABEL[kind]}
              onClick={() =>
                onChange(on ? columns.filter((item) => item !== kind) : [...columns, kind])
              }
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                on
                  ? 'border-transparent bg-button text-button-text'
                  : 'border-line text-muted hover:text-text'
              }`}
            >
              {TIMELINE_LABEL[kind]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 글꼴 고르기.
 *
 * 목록은 미리 채워둘 수 없다 — 브라우저가 로컬 글꼴을 사용자가 직접 누른 순간에만,
 * 그것도 허락을 받아야 내준다. 그래서 처음에는 흔한 글꼴 몇 개만 놓고, 누르면
 * 그 자리에서 진짜 목록으로 갈아끼운다.
 */
function FontPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [families, setFamilies] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 고른 글꼴이 후보에 없을 수도 있다 (목록을 바꾸기 전에 저장해둔 값). 항상 남겨둔다.
  const listed = families ?? COMMON_FONTS
  const options = value && !listed.includes(value) ? [value, ...listed] : listed

  const load = () => {
    setLoading(true)
    setNote(null)
    void loadLocalFontFamilies().then((result) => {
      setLoading(false)
      if (result.ok) {
        setFamilies(result.families)
        setNote(`${result.families.length.toLocaleString('ko-KR')}개를 불러왔습니다.`)
        return
      }
      setNote(
        result.reason === 'unsupported'
          ? '이 브라우저는 설치된 글꼴 목록을 내주지 않습니다. 아래 후보에서 고를 수 있습니다.'
          : '글꼴 목록 접근이 거절됐습니다. 주소창의 권한 설정에서 허용하면 다시 시도할 수 있습니다.',
      )
    })
  }

  return (
    <div className="py-3.5">
      <p className="text-[14px] font-medium text-text">글꼴</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
        덱 전체에 쓸 글꼴입니다. 이 PC 에 설치된 글꼴을 불러와 고를 수 있습니다.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <select
          aria-label="글꼴"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`min-w-0 flex-1 ${FIELD}`}
        >
          <option value="">기본</option>
          {options.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>

        {families === null && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-progress disabled:text-faint"
          >
            {loading ? '읽는 중' : '내 글꼴 불러오기'}
          </button>
        )}
      </div>

      <p
        className="mt-2 truncate rounded-lg bg-surface-2 px-2.5 py-2 text-[14px] text-muted"
        style={{ fontFamily: fontStack(value) }}
      >
        다람쥐 헌 쳇바퀴에 타고파 — Sphinx of black quartz 0123
      </p>

      {note && <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{note}</p>}
    </div>
  )
}

const TABS = [
  { id: 'collect', label: '수집', Icon: RefreshIcon },
  { id: 'display', label: '표시', Icon: EyeIcon },
  { id: 'storage', label: '보관', Icon: ArchiveIcon },
] as const

type TabId = (typeof TABS)[number]['id']

export interface SettingsPanelProps {
  open: boolean
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsPanel({ open, settings, onUpdate, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>('collect')
  const [cleared, setCleared] = useState(false)
  if (!open) return null

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="설정"
        aria-modal="true"
        className="animate-fade fixed inset-y-0 right-0 z-50 flex w-[min(420px,100%)] flex-col overflow-hidden border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center px-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <SettingsIcon className="h-4 w-4 text-muted" />
            설정
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="설정 닫기"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 px-3 py-2" aria-label="설정 분류">
          {TABS.map(({ id, label, Icon }) => {
            const selected = id === tab
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={selected}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selected ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </nav>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {tab === 'collect' && (
            <div className="divide-y divide-line-soft">
              <Row
                label="새 게시물 자동 반영"
                hint="x.com 상단에 뜨는 '새 게시물 보기' 알림을 자동으로 눌러 다음 타임라인을 받아옵니다."
                control={
                  <Toggle
                    checked={settings.autoAdvance}
                    onChange={(next) => onUpdate({ autoAdvance: next })}
                    label="새 게시물 자동 반영"
                  />
                }
              />
              <Row
                label="유휴 강제 갱신"
                hint="이 시간 동안 새 알림이 없으면 타임라인을 직접 다시 불러옵니다."
                control={
                  <Select
                    label="유휴 강제 갱신 주기"
                    value={settings.idleRefreshMs}
                    onChange={(next) => onUpdate({ idleRefreshMs: next })}
                    options={[
                      { value: 0, label: '사용 안 함' },
                      { value: 60_000, label: '1분' },
                      { value: 120_000, label: '2분' },
                      { value: 300_000, label: '5분' },
                    ]}
                  />
                }
              />
              <Row
                label="스크롤 중 대기"
                hint="목록을 내려 읽는 동안에는 새 글을 끼워넣지 않고 상단 배지로 모아둡니다."
                control={
                  <Toggle
                    checked={settings.holdWhileScrolled}
                    onChange={(next) => onUpdate({ holdWhileScrolled: next })}
                    label="스크롤 중 대기"
                  />
                }
              />
            </div>
          )}

          {tab === 'display' && (
            <div className="divide-y divide-line-soft">
              <ColumnPicker
                columns={settings.columns}
                onChange={(next) => onUpdate({ columns: next })}
              />
              <Row
                label="x.com 열면 덱으로"
                hint="끄면 확장 아이콘을 눌러야 덱이 뜹니다. 게시물·프로필 주소는 어느 쪽이든 원본 그대로입니다."
                control={
                  <Toggle
                    checked={settings.autoMount}
                    onChange={(next) => onUpdate({ autoMount: next })}
                    label="x.com 열면 덱으로"
                  />
                }
              />
              <Row
                label="테마"
                control={
                  <Select
                    label="테마"
                    value={settings.theme}
                    onChange={(next) => onUpdate({ theme: next })}
                    options={[
                      { value: 'system', label: '시스템' },
                      { value: 'dark', label: '다크' },
                      { value: 'light', label: '라이트' },
                    ]}
                  />
                }
              />
              <FontPicker
                value={settings.fontFamily}
                onChange={(next) => onUpdate({ fontFamily: next })}
              />
              <Row
                label="카드 밀도"
                hint="조밀은 프로필 사진·글자·여백·미디어를 한꺼번에 줄여 한 화면에 글을 더 많이 넣습니다."
                control={
                  <Select
                    label="카드 밀도"
                    value={settings.density}
                    onChange={(next) => onUpdate({ density: next })}
                    options={[
                      { value: 'comfortable', label: '기본' },
                      { value: 'compact', label: '조밀' },
                    ]}
                  />
                }
              />
              <Row
                label="컬럼 테두리"
                hint="컬럼 상자를 두르는 선입니다. 끄면 컬럼끼리 경계 없이 이어져 보입니다."
                control={
                  <Toggle
                    checked={settings.columnBorder}
                    onChange={(next) => onUpdate({ columnBorder: next })}
                    label="컬럼 테두리"
                  />
                }
              />
              <Row
                label="카드 구분선"
                hint="게시물 사이를 가르는 선입니다. 끄면 목록이 하나로 이어져 보입니다."
                control={
                  <Toggle
                    checked={settings.cardDivider}
                    onChange={(next) => onUpdate({ cardDivider: next })}
                    label="카드 구분선"
                  />
                }
              />
              <Row
                label="미디어 표시"
                hint="라벨은 무엇이 붙어 있는지만 알려주고, 누르면 그 자리에서 펼칩니다. 숨김은 아예 불러오지 않아 트래픽이 줄어듭니다."
                control={
                  <Select
                    label="미디어 표시"
                    value={settings.mediaMode}
                    onChange={(next) => onUpdate({ mediaMode: next })}
                    options={[
                      { value: 'show', label: '바로 표시' },
                      { value: 'label', label: '라벨만' },
                      { value: 'hide', label: '숨김' },
                    ]}
                  />
                }
              />
              <Row
                label="자동 재생"
                hint="동영상·GIF 에 마우스를 올리면 소리 없이 미리 재생합니다. 끄면 눌러야 재생됩니다."
                control={
                  <Toggle
                    checked={settings.hoverPlay}
                    onChange={(next) => onUpdate({ hoverPlay: next })}
                    label="자동 재생"
                  />
                }
              />
              <Row
                label="미디어 크기"
                hint="작게 둘수록 한 화면에 글이 많이 들어옵니다. 원본은 이미지를 눌러서 봅니다."
                control={
                  <Select
                    label="미디어 크기"
                    value={settings.mediaSize}
                    onChange={(next) => onUpdate({ mediaSize: next })}
                    options={[
                      { value: 'small', label: '작게' },
                      { value: 'medium', label: '보통' },
                      { value: 'large', label: '크게' },
                      { value: 'full', label: '원본 비율' },
                    ]}
                  />
                }
              />
            </div>
          )}

          {tab === 'storage' && (
            <div className="divide-y divide-line-soft">
              <Row
                label="보관 기간"
                control={
                  <Select
                    label="보관 기간"
                    value={settings.retentionDays}
                    onChange={(next) => onUpdate({ retentionDays: next })}
                    options={[
                      { value: 1, label: '1일' },
                      { value: 3, label: '3일' },
                      { value: 7, label: '7일' },
                      { value: 14, label: '14일' },
                      { value: 30, label: '30일' },
                    ]}
                  />
                }
              />
              <Row
                label="컬럼당 최대"
                control={
                  <Select
                    label="컬럼당 최대 보관 건수"
                    value={settings.maxPerColumn}
                    onChange={(next) => onUpdate({ maxPerColumn: next })}
                    options={[
                      { value: 500, label: '500건' },
                      { value: 1_000, label: '1,000건' },
                      { value: 2_000, label: '2,000건' },
                      { value: 5_000, label: '5,000건' },
                    ]}
                  />
                }
              />
              <Row
                label="보관 데이터 비우기"
                hint="저장된 게시물을 전부 지웁니다. 되돌릴 수 없습니다."
                control={
                  <button
                    type="button"
                    onClick={() => {
                      void clearAll().then(() => setCleared(true))
                    }}
                    className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-surface-2"
                  >
                    {cleared ? '비웠습니다' : '비우기'}
                  </button>
                }
              />
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
