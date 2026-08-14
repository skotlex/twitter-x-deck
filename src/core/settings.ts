/** 사용자 설정. chrome.storage.local 에 단일 키로 저장한다. */
import type { TimelineKind } from './types'

const STORAGE_KEY = 'x-deck:settings'

export interface Settings {
  /** 덱에 표시할 컬럼과 좌우 순서. */
  columns: TimelineKind[]
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
  /** 목록을 위로 올려둔 동안에는 새 글을 끼워넣지 않고 상단 알림으로만 모아둔다. */
  holdWhileScrolled: boolean
  /** 화면 테마. */
  theme: 'system' | 'dark' | 'light'
}

export const DEFAULT_SETTINGS: Settings = {
  columns: ['foryou', 'following'],
  autoAdvance: true,
  idleRefreshMs: 120_000,
  retentionDays: 7,
  maxPerColumn: 2_000,
  density: 'comfortable',
  showMedia: true,
  holdWhileScrolled: true,
  theme: 'dark',
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
