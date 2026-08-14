/** 사용자 설정. chrome.storage.local 에 단일 키로 저장한다. */
import type { TimelineKind } from './types'

const STORAGE_KEY = 'x-deck:settings'

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
  /** 이미지·동영상 표시 여부. */
  showMedia: boolean
  /** 미디어가 차지하는 최대 높이. 작을수록 한 화면에 글이 많이 들어온다. */
  mediaSize: MediaSize
  /** 목록을 위로 올려둔 동안에는 새 글을 끼워넣지 않고 상단 알림으로만 모아둔다. */
  holdWhileScrolled: boolean
  /** 화면 테마. */
  theme: 'system' | 'dark' | 'light'
  /** 덱 전체에 쓸 글꼴 이름. 빈 값이면 기본 글꼴. */
  fontFamily: string
}

export const DEFAULT_SETTINGS: Settings = {
  columns: ['foryou', 'following'],
  layout: 'columns',
  autoAdvance: true,
  idleRefreshMs: 120_000,
  retentionDays: 7,
  maxPerColumn: 2_000,
  density: 'comfortable',
  showMedia: true,
  mediaSize: 'medium',
  holdWhileScrolled: true,
  theme: 'system',
  fontFamily: '',
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY] as Partial<Settings> | undefined
  // 필드가 늘어나도 기존 저장값이 깨지지 않도록 항상 기본값 위에 덮는다.
  return { ...DEFAULT_SETTINGS, ...(value ?? {}) }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

/** 설정 변경을 구독한다. 반환값을 호출하면 구독을 해제한다. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) return
    listener({ ...DEFAULT_SETTINGS, ...((changes[STORAGE_KEY]?.newValue ?? {}) as Partial<Settings>) })
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
