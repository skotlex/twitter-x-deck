import { useState } from 'react'
import { clearAll } from '@core/db'
import type { Settings } from '@core/settings'
import { CloseIcon } from './icons'

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
      className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const TABS = [
  { id: 'collect', label: '수집' },
  { id: 'display', label: '표시' },
  { id: 'storage', label: '보관' },
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
        <header className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <h2 className="text-[15px] font-semibold tracking-tight">설정</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label="설정 닫기"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-line px-3 py-2" aria-label="설정 분류">
          {TABS.map((entry) => {
            const selected = entry.id === tab
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-pressed={selected}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selected ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`}
              >
                {entry.label}
              </button>
            )
          })}
        </nav>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {tab === 'collect' && (
            <div className="divide-y divide-line-soft">
              <Row
                label="새 게시물 자동 반영"
                hint="x.com 상단에 뜨는 '새 게시물 보기' 알림을 자동으로 눌러 다음 타임라인을 받아온다."
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
                hint="이 시간 동안 새 알림이 없으면 타임라인을 직접 다시 불러온다."
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
                hint="목록을 내려 읽는 동안에는 새 글을 끼워넣지 않고 상단 배지로 모아둔다."
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
              <Row
                label="카드 밀도"
                hint="조밀은 프로필 사진·글자·여백·미디어를 한꺼번에 줄여 한 화면에 글을 더 많이 넣는다."
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
                label="미디어 표시"
                hint="끄면 이미지·동영상을 불러오지 않아 트래픽이 줄어든다."
                control={
                  <Toggle
                    checked={settings.showMedia}
                    onChange={(next) => onUpdate({ showMedia: next })}
                    label="미디어 표시"
                  />
                }
              />
              <Row
                label="미디어 크기"
                hint="작게 둘수록 한 화면에 글이 많이 들어온다. 원본은 이미지를 눌러서 본다."
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
                hint="저장된 게시물을 전부 지운다. 되돌릴 수 없다."
                control={
                  <button
                    type="button"
                    onClick={() => {
                      void clearAll().then(() => setCleared(true))
                    }}
                    className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-surface-2"
                  >
                    {cleared ? '비웠음' : '비우기'}
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
