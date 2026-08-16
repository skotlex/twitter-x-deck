import { useEffect, useState } from 'react'
import { clearAll } from '@core/db'
import type { BridgeStatus, TranslateEngineId } from '@core/messages'
import type { Settings } from '@core/settings'
import { TIMELINE_KINDS, TIMELINE_LABEL, type TimelineKind } from '@core/types'
import {
  ENGINE_LABEL,
  ENGINE_OUTPUT,
  fetchBridgeStatus,
  pickEngine,
  requestLogin,
} from '../../content/imageTranslate'
import { COMMON_FONTS, fontStack, loadLocalFontFamilies } from '../lib/fonts'
import { ArchiveIcon, CloseIcon, EyeIcon, RefreshIcon, SettingsIcon } from './icons'

function TranslateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path
        d="M4 5h10M9 3v2m0 0c0 4-2 7-5 9m3-4c0 2 3 4 6 4m1 6 4-10 4 10m-7-3h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

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

/** 타임라인 하나를 어떻게 다룰지. 셋 중 하나뿐이라 라디오처럼 고르게 한다. */
type TimelineMode = 'off' | 'column' | 'watch'

const MODE_LABEL: Record<TimelineMode, string> = {
  off: '끔',
  column: '컬럼',
  watch: '종',
}

const MODE_HINT: Record<TimelineMode, string> = {
  off: '받지 않습니다',
  column: '컬럼으로 띄웁니다',
  watch: '컬럼 없이 수집만 하고 상단 바의 종으로 알립니다',
}

function modeOf(columns: TimelineKind[], watch: TimelineKind[], kind: TimelineKind): TimelineMode {
  if (columns.includes(kind)) return 'column'
  if (watch.includes(kind)) return 'watch'
  return 'off'
}

/**
 * 타임라인마다 컬럼·종·끔을 고른다.
 *
 * 셋을 한 줄에 모아둔 이유가 있다. '컬럼에서 빼기' 와 '종에 넣기' 를 따로 두면, 폭이
 * 모자라 컬럼을 줄이려는 사람이 두 자리를 오가야 하고 — 무엇보다 넷을 다 컬럼으로
 * 켜 둔 사람에게는 종 자리가 텅 빈 채로 보인다. 정작 그 사람이 이 기능을 가장 필요로 한다.
 *
 * 컬럼 순서는 건드리지 않는다. 켤 때 뒤에 붙이고 끌 때 그 자리만 뺀다 —
 * 좌우 순서는 컬럼 머리글을 끌어 옮기는 쪽이 훨씬 직관적이라 거기에 맡긴다.
 * 마지막 컬럼은 빼지 못하게 막는다. 컬럼이 하나도 없는 덱은 빈 화면이다.
 */
function TimelinePicker({
  columns,
  watch,
  onChange,
}: {
  columns: TimelineKind[]
  watch: TimelineKind[]
  onChange: (next: { columns: TimelineKind[]; watch: TimelineKind[] }) => void
}) {
  const apply = (kind: TimelineKind, mode: TimelineMode) => {
    const rest = {
      columns: columns.filter((item) => item !== kind),
      watch: watch.filter((item) => item !== kind),
    }
    if (mode === 'column') rest.columns = [...rest.columns, kind]
    if (mode === 'watch') rest.watch = [...rest.watch, kind]
    onChange(rest)
  }

  return (
    <div className="py-3.5">
      <p className="text-[14px] font-medium text-text">타임라인</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
        <b className="font-medium text-muted">컬럼</b>은 화면에 자리를 차지하고,{' '}
        <b className="font-medium text-muted">종</b>은 자리를 쓰지 않고 상단 바의 종에 안 본 수만
        띄웁니다. 창이 좁아 컬럼을 늘릴 수 없을 때 종으로 돌리면 배치를 지킨 채 확인할 수
        있습니다. 수집하는 값은 둘 다 같으므로 많이 켤수록 느려집니다.
      </p>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {TIMELINE_KINDS.map((kind) => {
          const mode = modeOf(columns, watch, kind)
          const last = mode === 'column' && columns.length === 1
          return (
            <div key={kind} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-[13.5px] text-text">{TIMELINE_LABEL[kind]}</span>
              <div
                className="flex shrink-0 rounded-lg bg-surface-2 p-0.5"
                role="group"
                aria-label={`${TIMELINE_LABEL[kind]} 다루기`}
              >
                {(['off', 'column', 'watch'] as TimelineMode[]).map((value) => {
                  const selected = value === mode
                  // 마지막 남은 컬럼은 다른 곳으로 옮기지 못하게 막는다.
                  const blocked = last && value !== 'column'
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={blocked}
                      aria-pressed={selected}
                      title={blocked ? '컬럼은 최소 하나 남겨야 합니다' : MODE_HINT[value]}
                      onClick={() => apply(kind, value)}
                      className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? 'bg-surface text-text shadow-sm'
                          : blocked
                            ? 'text-faint/40'
                            : 'text-faint hover:text-text'
                      }`}
                    >
                      {MODE_LABEL[value]}
                    </button>
                  )
                })}
              </div>
            </div>
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

/**
 * 사진 번역 설정.
 *
 * 여기서 켜는 것은 '쓰겠다는 뜻' 이지 '쓸 수 있다' 가 아니다. 번역은 이 PC 에 깔린
 * `codex` · `claude` 가 하고, 그 둘은 각자의 구독 계정으로 로그인돼 있어야 한다.
 * 그 로그인은 브라우저를 열어 사람이 마치는 절차라 확장 안에서 시작할 수 없어서,
 * 브리지가 콘솔 창을 띄워주고 여기서는 끝났는지를 다시 확인하는 것까지만 한다.
 */
function TranslateSettings({
  settings,
  onUpdate,
}: {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}) {
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = (force: boolean) => {
    setChecking(true)
    void fetchBridgeStatus(force)
      .then(setStatus)
      .catch(() => setStatus({ reachable: false, error: '브리지에 닿지 못했습니다.' }))
      .finally(() => setChecking(false))
  }

  // 켜져 있을 때만 물어본다. 꺼둔 사람에게 CLI 를 띄울 이유가 없다.
  useEffect(() => {
    if (settings.imageTranslate) check(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.imageTranslate])

  const engines = status?.engines
  const active = pickEngine(settings.imageTranslateEngine, engines)
  const bothReady = Boolean(engines?.codex.loggedIn && engines?.claude.loggedIn)

  return (
    <div className="divide-y divide-line-soft">
      <Row
        label="사진 번역 사용"
        hint="사진 속 일본어·영어를 한국어로 옮깁니다. 이 PC 의 codex · claude 명령과 그 구독 계정을 그대로 빌려 쓰며, 별도 API 키는 필요하지 않습니다."
        control={
          <Toggle
            checked={settings.imageTranslate}
            onChange={(next) => onUpdate({ imageTranslate: next })}
            label="사진 번역 사용"
          />
        }
      />

      {settings.imageTranslate && (
        <>
          <div className="py-3.5">
            <p className="text-[14px] font-medium text-text">브리지</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
              내려받은 폴더의 <code className="text-muted">install-bridge.bat</code> 을 한 번
              실행하면 끝입니다. 그 뒤로는 번역이 필요할 때 브라우저가 알아서 켜므로 띄워둘
              것도, 맞출 값도 없습니다.
            </p>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => check(true)}
                disabled={checking}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-progress disabled:text-faint"
              >
                {checking ? '확인 중' : '상태 다시 확인'}
              </button>
              {status && !status.reachable && (
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-danger">
                  {status.error}
                </span>
              )}
            </div>
          </div>

          {engines && (
            <div className="py-3.5">
              <p className="text-[14px] font-medium text-text">로그인</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
                로그인 단추를 누르면 콘솔 창이 하나 뜹니다. 거기서 절차를 마친 뒤 위의 상태 다시
                확인을 누르세요.
              </p>

              <div className="mt-2.5 flex flex-col gap-2">
                {(['codex', 'claude'] as TranslateEngineId[]).map((id) => {
                  const engine = engines[id]
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          engine.loggedIn ? 'bg-accent' : 'bg-surface-3'
                        }`}
                      />
                      <span className="text-[13px] font-medium text-text">{ENGINE_LABEL[id]}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-faint">
                        {engine.loggedIn ? `${ENGINE_OUTPUT[id]}로 번역합니다` : engine.note}
                      </span>
                      {!engine.loggedIn && engine.installed && (
                        <button
                          type="button"
                          onClick={() => void requestLogin(id)}
                          className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-medium text-text transition-colors hover:bg-surface-2"
                        >
                          로그인
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/*
            둘 다 준비된 사람에게만 고르라고 한다. 하나만 구독 중이면 고를 것이 없고,
            그때는 로그인된 쪽으로 알아서 간다.
          */}
          {bothReady && (
            <Row
              label="주로 쓸 명령"
              hint="Codex 는 글자를 바꿔 그림을 다시 그리고, Claude 는 읽은 글과 번역을 글자로 줍니다. 고른 쪽이 로그인돼 있지 않으면 나머지로 갑니다."
              control={
                <Select
                  label="주로 쓸 명령"
                  value={settings.imageTranslateEngine}
                  onChange={(next) => onUpdate({ imageTranslateEngine: next })}
                  options={[
                    { value: 'codex' as TranslateEngineId, label: 'Codex — 이미지' },
                    { value: 'claude' as TranslateEngineId, label: 'Claude — 텍스트' },
                  ]}
                />
              }
            />
          )}

          {/*
            Codex 만 갈린다. Claude 는 그림을 만들지 못해 늘 글이므로 물을 것이 없다.
            쓸 수 있는 명령이 Codex 로 정해진 뒤에만 보여준다.
          */}
          {active === 'codex' && (
            <Row
              label="Codex 결과"
              hint="그림은 글자를 바꿔 다시 그립니다 — 배치가 뜻을 갖는 포스터·만화에 어울리지만 한 장에 80초쯤 걸립니다. 글만 옮기면 훨씬 빠릅니다."
              control={
                <Select
                  label="Codex 결과"
                  value={settings.codexOutput}
                  onChange={(next) => onUpdate({ codexOutput: next })}
                  options={[
                    { value: 'image' as const, label: '이미지' },
                    { value: 'text' as const, label: '텍스트' },
                  ]}
                />
              }
            />
          )}

          {active === 'codex' && settings.codexOutput === 'text' && (
            <Row
              label="빠른 등급으로"
              hint="글을 옮기는 일은 약 14% 빨라집니다. 대신 구독 사용량을 더 씁니다. 그림을 다시 그릴 때는 등급이 듣지 않아 이 설정과 무관합니다."
              control={
                <Toggle
                  checked={settings.codexTextFast}
                  onChange={(next) => onUpdate({ codexTextFast: next })}
                  label="빠른 등급으로"
                />
              }
            />
          )}

          {status?.reachable && !active && (
            <p className="py-3.5 text-[12.5px] leading-relaxed text-danger">
              쓸 수 있는 명령이 없습니다. 위에서 하나 이상 로그인해야 사진 번역 단추가 뜹니다.
            </p>
          )}
        </>
      )}
    </div>
  )
}

const TABS = [
  { id: 'collect', label: '수집', Icon: RefreshIcon },
  { id: 'display', label: '표시', Icon: EyeIcon },
  { id: 'translate', label: '번역', Icon: TranslateIcon },
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
              <TimelinePicker
                columns={settings.columns}
                watch={settings.watch}
                onChange={(next) => onUpdate(next)}
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

          {tab === 'translate' && (
            <TranslateSettings settings={settings} onUpdate={onUpdate} />
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
