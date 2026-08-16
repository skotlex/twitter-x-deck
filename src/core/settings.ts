/**
 * 사용자 설정. 단일 키로 저장한다.
 *
 * 저장 자리는 `sync` 다. `local` 은 확장을 지울 때 함께 지워져서, 다시 설치하면
 * 지정해둔 것이 전부 초기값으로 돌아간다. `sync` 는 브라우저 계정에 남으므로
 * 재설치를 건너 살아남고 다른 기기에서도 같은 설정으로 뜬다.
 */
import type { TimelineKind } from './types'
import type { TranslateEngineId } from './messages'

const STORAGE_KEY = 'x-deck:settings'

/**
 * 브리지 열쇠를 두는 자리. **설정과 같은 자리에 두지 않는다.**
 *
 * 설정은 아래 `writeMirror` 가 x.com 페이지의 localStorage 에 그대로 한 벌 더 남긴다 —
 * 확장을 지워도 살아남게 하려는 장치다. 그 자리는 x.com 에서 도는 어떤 스크립트든
 * 읽을 수 있어서, 열쇠를 섞으면 그대로 새어 나간다. 이 값만은 확장 저장소에만 둔다.
 */
const TOKEN_KEY = 'x-deck:bridge-token'

export async function loadBridgeToken(): Promise<string> {
  const stored = (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY]
  return typeof stored === 'string' ? stored : ''
}

export async function saveBridgeToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() })
}

/** 설정을 둘 자리. sync 를 못 쓰는 환경에서는 local 로 물러선다. */
function area(): chrome.storage.StorageArea {
  return chrome.storage.sync ?? chrome.storage.local
}

/**
 * 확장 바깥에 두는 사본.
 *
 * chrome.storage 는 sync 든 local 이든 확장에 딸린 저장소다. 확장을 지우면 함께
 * 지워지므로 다시 깔면 설정이 초기값으로 돌아간다. 덱은 x.com 문서 위에서 도니
 * 그 페이지의 저장소에 같은 값을 남겨둘 수 있다 — 이쪽은 확장의 생사와 무관하다.
 * 되살릴 때만 읽는 자리라, 평소 판단의 기준은 여전히 확장 저장소다.
 */
const MIRROR_KEY = 'xdeck:settings'

export function readMirror(): Partial<Settings> | undefined {
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY)
    return raw ? (JSON.parse(raw) as Partial<Settings>) : undefined
  } catch {
    return undefined
  }
}

function writeMirror(settings: Settings): void {
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(settings))
  } catch {
    // 저장소가 막힌 환경. 확장 저장소만으로 간다.
  }
}

/** 미디어 표시 크기. `full` 은 원본 비율 그대로라 높이 제한이 없다. */
export type MediaSize = 'small' | 'medium' | 'large' | 'full'

/** 작은 것부터의 순서. 한 단계 줄일 때 기준으로 쓴다. */
export const MEDIA_SIZE_ORDER: readonly MediaSize[] = ['small', 'medium', 'large', 'full']

/** 크기별 최대 높이(px). `null` 이면 제한 없음. */
export const MEDIA_MAX_HEIGHT: Record<MediaSize, number | null> = {
  small: 180,
  medium: 340,
  large: 520,
  full: null,
}

/** 미디어를 한 단계 작게. 인용글과 조밀 밀도에서 쓴다. */
export function smallerMediaSize(size: MediaSize): MediaSize {
  const index = MEDIA_SIZE_ORDER.indexOf(size)
  return MEDIA_SIZE_ORDER[Math.max(0, index - 1)] ?? 'small'
}

/**
 * 컬럼을 늘어놓는 방식.
 * `tabs` 는 창 크기와 무관하게 한 번에 하나만 보여주고 상단에서 갈아 끼운다.
 */
export type DeckLayout = 'columns' | 'rows' | 'tabs'

/**
 * 미디어를 다루는 방식.
 * `label` 은 무엇이 붙어 있는지만 알려주고 눌러야 그 자리에서 펼친다 —
 * 목록을 훑을 때는 조용하고, 보고 싶은 것만 골라 열 수 있다.
 */
export type MediaMode = 'show' | 'label' | 'hide'

export interface Settings {
  /** 덱에 표시할 컬럼과 순서. */
  columns: TimelineKind[]
  /** 컬럼을 좌우로 늘어놓을지, 위아래로 쌓을지. */
  layout: DeckLayout
  /** '새 게시물 보기' 알림을 감지하면 자동으로 눌러 새 타임라인을 받아온다. */
  autoAdvance: boolean
  /** 알림이 이 시간(ms) 동안 안 뜨면 탭을 다시 눌러 강제로 갱신한다. 0 이면 사용 안 함. */
  idleRefreshMs: number
  /** 보관 기간(일). */
  retentionDays: number
  /** 컬럼당 최대 보관 건수. */
  maxPerColumn: number
  /** 카드 밀도. */
  density: 'comfortable' | 'compact'
  /** 컬럼 상자에 테두리를 두를지. 끄면 컬럼끼리 경계 없이 이어져 보인다. */
  columnBorder: boolean
  /** 카드 사이에 구분선을 그을지. 끄면 목록이 하나로 이어져 보인다. */
  cardDivider: boolean
  /** 이미지·동영상을 어떻게 다룰지. */
  mediaMode: MediaMode
  /** 동영상·GIF 에 마우스를 올리면 소리 없이 미리 재생한다. */
  hoverPlay: boolean
  /** 미디어가 차지하는 최대 높이. 작을수록 한 화면에 글이 많이 들어온다. */
  mediaSize: MediaSize
  /** 목록을 위로 올려둔 동안에는 새 글을 끼워넣지 않고 상단 알림으로만 모아둔다. */
  holdWhileScrolled: boolean
  /** 화면 테마. */
  theme: 'system' | 'dark' | 'light'
  /** 덱 전체에 쓸 글꼴 이름. 빈 값이면 기본 글꼴. */
  fontFamily: string
  /** x.com 홈에 들어가면 곧바로 덱을 얹는다. 끄면 확장 아이콘을 눌러야 뜬다. */
  autoMount: boolean
  /**
   * 사진 속 글자 번역을 쓸지. 켜도 브리지에 로그인이 확인되기 전에는 단추가 뜨지 않는다 —
   * 켜는 것과 쓸 수 있는 것은 다르다.
   */
  imageTranslate: boolean
  /** 어느 명령을 주로 쓸지. 하나만 로그인돼 있으면 그쪽으로 자동으로 간다. */
  imageTranslateEngine: TranslateEngineId
  /** 브리지가 듣고 있는 포트. */
  bridgePort: number
}

export const DEFAULT_SETTINGS: Settings = {
  columns: ['foryou', 'following'],
  layout: 'columns',
  autoAdvance: true,
  idleRefreshMs: 120_000,
  retentionDays: 7,
  maxPerColumn: 2_000,
  density: 'comfortable',
  columnBorder: true,
  cardDivider: true,
  mediaMode: 'show',
  hoverPlay: true,
  mediaSize: 'medium',
  holdWhileScrolled: true,
  theme: 'system',
  fontFamily: '',
  autoMount: true,
  imageTranslate: false,
  imageTranslateEngine: 'codex',
  bridgePort: 8765,
}

/** 컬럼과 지켜보기를 가르는 데 필요한 만큼만 받는다 — 테스트에서 설정 전체를 짓지 않아도 된다. */
type Watchable = Pick<Settings, 'columns' | 'watch'>

/**
 * 컬럼 없이 종으로만 지켜보는 타임라인.
 *
 * 컬럼으로도 띄우고 있으면 뺀다 — 화면에 이미 보이는 것을 종에 또 세면 안 본 수가
 * 영영 줄지 않는다.
 */
export function watchedKinds(settings: Watchable): TimelineKind[] {
  return settings.watch.filter((kind) => !settings.columns.includes(kind))
}

/**
 * 실제로 수집해야 하는 타임라인.
 *
 * 컬럼을 끄면 화면에서만 사라지는 게 아니라 그 타임라인을 아예 받지 않게 되므로,
 * 수집 프레임을 세우는 자리와 멈춘 컬럼을 되살리는 자리는 모두 이 목록을 봐야 한다.
 */
export function collectedKinds(settings: Watchable): TimelineKind[] {
  return [...settings.columns, ...watchedKinds(settings)]
}

/** 예전 저장값을 지금 모양으로 옮긴다. 뜻이 담긴 값은 기본값으로 덮어버리면 안 된다. */
function migrate(value: Partial<Settings> | undefined): Partial<Settings> {
  if (!value) return {}
  // 미디어 표시가 켬/끔 두 갈래이던 시절의 값. 껐던 사람이 켜진 채로 뜨면 안 된다.
  const legacy = value as Partial<Settings> & { showMedia?: boolean }
  if (legacy.mediaMode === undefined && legacy.showMedia !== undefined) {
    return { ...value, mediaMode: legacy.showMedia ? 'show' : 'hide' }
  }
  return value
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await area().get(STORAGE_KEY))[STORAGE_KEY] as Partial<Settings> | undefined
  // 필드가 늘어나도 기존 저장값이 깨지지 않도록 항상 기본값 위에 덮는다.
  if (stored) {
    const settings = { ...DEFAULT_SETTINGS, ...migrate(stored) }
    // 사본을 늘 최신으로 둔다. 확장을 지우는 순간에는 아무 것도 할 수 없으므로
    // 그전에 남겨둔 것이 전부다.
    writeMirror(settings)
    return settings
  }

  // 확장 저장소가 비었다는 건 새로 깔았다는 뜻이다. 페이지에 남겨둔 사본과
  // 예전 판이 쓰던 local 저장분을 차례로 본다.
  const rescued =
    readMirror() ??
    ((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<Settings> | undefined)
  const settings = { ...DEFAULT_SETTINGS, ...migrate(rescued) }
  if (rescued) await area().set({ [STORAGE_KEY]: settings })
  return settings
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  await area().set({ [STORAGE_KEY]: next })
  writeMirror(next)
  return next
}

/** 설정 변경을 구독한다. 반환값을 호출하면 구독을 해제한다. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>): void => {
    // 어느 영역에서 왔는지는 따지지 않는다. 우리 키가 바뀌었다는 사실만이 중요하고,
    // 옮겨 담는 도중에는 local 에서 오는 변경도 그대로 반영해야 한다.
    if (!(STORAGE_KEY in changes)) return
    listener({
      ...DEFAULT_SETTINGS,
      ...migrate((changes[STORAGE_KEY]?.newValue ?? {}) as Partial<Settings>),
    })
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
