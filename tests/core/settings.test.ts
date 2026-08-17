/**
 * [settings.ts](../../src/core/settings.ts) 는 chrome.storage 위에서 돈다.
 * 확장을 다시 깔았을 때 지정해둔 것이 살아남는지가 이 파일의 핵심이다 — 되살리기
 * 경로가 조용히 끊기면 사용자는 재설치 뒤에야, 그것도 설정이 다 날아간 뒤에야 안다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptsNewItems,
  collectedKinds,
  DEFAULT_SETTINGS,
  isPowerSaving,
  loadSettings,
  saveSettings,
  watchedKinds,
  watchSettings,
} from '@core/settings'
import type { Settings } from '@core/settings'

const STORAGE_KEY = 'x-deck:settings'
const MIRROR_KEY = 'xdeck:settings'

type Changed = Record<string, chrome.storage.StorageChange>
type ChangeHandler = (changes: Changed) => void

/** Map 하나로 받치는 가짜 StorageArea. 실제로 쓰는 get/set 만 채운다. */
function fakeArea(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: vi.fn(async (key: string) => {
      const value = data.get(key)
      return value === undefined ? {} : { [key]: value }
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value)
    }),
  }
}

let sync: ReturnType<typeof fakeArea>
let local: ReturnType<typeof fakeArea>
let handlers: ChangeHandler[]

/** chrome 전역을 세운다. `syncAvailable` 을 끄면 sync 를 못 쓰는 환경이 된다. */
function installChrome(syncAvailable = true): void {
  sync = fakeArea()
  local = fakeArea()
  handlers = []

  vi.stubGlobal('chrome', {
    storage: {
      sync: syncAvailable ? sync : undefined,
      local,
      onChanged: {
        addListener: (handler: ChangeHandler) => handlers.push(handler),
        removeListener: (handler: ChangeHandler) => {
          handlers = handlers.filter((h) => h !== handler)
        },
      },
    },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  installChrome()
})

describe('loadSettings', () => {
  it('저장된 것이 없으면 기본값이다', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('빈 저장소에는 아무 것도 써넣지 않는다', async () => {
    await loadSettings()
    expect(sync.set).not.toHaveBeenCalled()
  })

  it('저장값을 기본값 위에 덮는다 — 필드가 늘어도 기존 저장값이 안 깨진다', async () => {
    sync.data.set(STORAGE_KEY, { density: 'compact', columns: ['mentions'] })

    const settings = await loadSettings()
    expect(settings.density).toBe('compact')
    expect(settings.columns).toEqual(['mentions'])
    // 저장값에 없던 필드는 기본값으로 채워진다.
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.maxPerColumn).toBe(DEFAULT_SETTINGS.maxPerColumn)
  })

  it('sync 를 못 쓰는 환경에서는 local 로 물러선다', async () => {
    installChrome(false)
    local.data.set(STORAGE_KEY, { density: 'compact' })
    expect((await loadSettings()).density).toBe('compact')
  })
})

describe('절전', () => {
  /**
   * 켜면 새 글을 받아오지 않고 세어만 둔다. 꺼져 있는 것이 기본이어야 한다 —
   * 처음 깐 사람이 영문도 모르고 '글이 안 들어온다' 를 겪으면 안 된다.
   */
  it('기본은 꺼짐이다', () => {
    expect(DEFAULT_SETTINGS.powerSave).toBe(false)
  })

  it('이 항목이 없던 예전 저장값도 꺼짐으로 채운다', async () => {
    sync.data.set(STORAGE_KEY, { density: 'compact' })
    expect((await loadSettings()).powerSave).toBe(false)
  })

  /** 게임하는 동안 켜두는 스위치라, 껐다 켰다 하는 값이 그대로 남아야 한다. */
  it('켠 값이 저장되고 다시 읽힌다', async () => {
    await saveSettings({ powerSave: true })
    expect((await loadSettings()).powerSave).toBe(true)

    await saveSettings({ powerSave: false })
    expect((await loadSettings()).powerSave).toBe(false)
  })

  it('절전을 바꿔도 다른 설정은 건드리지 않는다', async () => {
    await saveSettings({ density: 'compact', columns: ['mentions'] })
    await saveSettings({ powerSave: true })

    const settings = await loadSettings()
    expect(settings.density).toBe('compact')
    expect(settings.columns).toEqual(['mentions'])
  })
})

describe('컬럼별 절전', () => {
  it('기본은 아무 컬럼도 지정돼 있지 않다', () => {
    expect(DEFAULT_SETTINGS.powerSaveColumns).toEqual([])
  })

  it('이 항목이 없던 예전 저장값도 빈 목록으로 채운다', async () => {
    sync.data.set(STORAGE_KEY, { powerSave: true })
    expect((await loadSettings()).powerSaveColumns).toEqual([])
  })

  it('지정한 컬럼이 저장되고 다시 읽힌다', async () => {
    await saveSettings({ powerSaveColumns: ['foryou'] })
    expect((await loadSettings()).powerSaveColumns).toEqual(['foryou'])
  })

  /**
   * 두 스위치는 따로 논다. 전체 절전을 껐다 켜는 동안 컬럼별 지정이 함께 지워지면
   * '추천만 재워두기' 같은 상시 지정이 게임 한 번 할 때마다 풀린다.
   */
  it('전체 절전을 껐다 켜도 컬럼별 지정은 남는다', async () => {
    await saveSettings({ powerSaveColumns: ['foryou'] })
    await saveSettings({ powerSave: true })
    await saveSettings({ powerSave: false })
    expect((await loadSettings()).powerSaveColumns).toEqual(['foryou'])
  })

  describe('isPowerSaving — 그 컬럼이 멈춰 있는지', () => {
    it('둘 다 꺼져 있으면 멈추지 않는다', () => {
      expect(isPowerSaving({ powerSave: false, powerSaveColumns: [] }, 'foryou')).toBe(false)
    })

    it('컬럼별로 지정한 것만 멈춘다', () => {
      const settings = { powerSave: false, powerSaveColumns: ['foryou' as const] }
      expect(isPowerSaving(settings, 'foryou')).toBe(true)
      expect(isPowerSaving(settings, 'mentions')).toBe(false)
    })

    it('전체 절전은 지정하지 않은 컬럼까지 멈춘다', () => {
      expect(isPowerSaving({ powerSave: true, powerSaveColumns: [] }, 'mentions')).toBe(true)
    })
  })

  /**
   * 멈추는 것만으로는 멈춰 있지 않다.
   *
   * 팔로잉 수집기가 자기 목록을 되찾으려고 홈 링크를 다시 누르거나 탭을 튕기면
   * **추천 타임라인이 딸려 온다** — 홈의 기본 탭이 추천이기 때문이다. 청하지 않은
   * 응답인데 귀속은 정확해서 그대로 추천 컬럼에 쌓였다. 컬럼별 절전을 켜도 추천이
   * 계속 갱신되던 것이 이 자리다 (전체 절전에서는 옆 컬럼도 함께 잠들어 드러나지 않았다).
   */
  describe('acceptsNewItems — 그 컬럼에 새 글을 들일지', () => {
    const asleep = { powerSave: false, powerSaveColumns: ['foryou' as const] }

    it('멈춰둔 컬럼에는 옆 컬럼이 끌고 온 목록도 들이지 않는다', () => {
      expect(acceptsNewItems(asleep, 'foryou', false)).toBe(false)
    })

    it('깨어 있는 컬럼은 그대로 들인다', () => {
      expect(acceptsNewItems(asleep, 'following', false)).toBe(true)
    })

    it('사람이 새로고침을 누른 동안은 멈춰뒀어도 들인다', () => {
      expect(acceptsNewItems(asleep, 'foryou', true)).toBe(true)
    })
  })
})

describe('예전 저장값 옮기기', () => {
  /**
   * 미디어 표시가 켬/끔 두 갈래이던 시절의 값. 껐던 사람이 켜진 채로 뜨면 안 된다.
   */
  it('showMedia=false 를 mediaMode=hide 로 옮긴다', async () => {
    sync.data.set(STORAGE_KEY, { showMedia: false })
    expect((await loadSettings()).mediaMode).toBe('hide')
  })

  it('showMedia=true 는 show 가 된다', async () => {
    sync.data.set(STORAGE_KEY, { showMedia: true })
    expect((await loadSettings()).mediaMode).toBe('show')
  })

  it('이미 mediaMode 가 있으면 옛 값을 보지 않는다', async () => {
    sync.data.set(STORAGE_KEY, { showMedia: true, mediaMode: 'label' })
    expect((await loadSettings()).mediaMode).toBe('label')
  })
})

describe('되살리기 — 확장을 다시 깔았을 때', () => {
  it('확장 저장소가 비면 페이지에 남긴 사본에서 되살린다', async () => {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify({ density: 'compact', theme: 'dark' }))

    const settings = await loadSettings()
    expect(settings.density).toBe('compact')
    expect(settings.theme).toBe('dark')
    // 되살린 값은 확장 저장소에 다시 심어둔다.
    expect(sync.data.get(STORAGE_KEY)).toMatchObject({ density: 'compact', theme: 'dark' })
  })

  it('사본이 없으면 예전 판이 쓰던 local 저장분을 본다', async () => {
    local.data.set(STORAGE_KEY, { theme: 'light' })
    expect((await loadSettings()).theme).toBe('light')
  })

  it('사본이 망가져 있어도 예외 없이 기본값으로 간다', async () => {
    window.localStorage.setItem(MIRROR_KEY, '{ 깨진 JSON')
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('평소 읽을 때마다 사본을 최신으로 갱신한다', async () => {
    sync.data.set(STORAGE_KEY, { theme: 'dark' })
    await loadSettings()

    const mirror = JSON.parse(window.localStorage.getItem(MIRROR_KEY) ?? '{}') as Settings
    expect(mirror.theme).toBe('dark')
    // 사본도 기본값이 채워진 완전한 형태여야 되살릴 때 쓸모가 있다.
    expect(mirror.columns).toEqual(DEFAULT_SETTINGS.columns)
  })
})

describe('saveSettings', () => {
  it('바꾼 값만 덮고 나머지는 지킨다', async () => {
    sync.data.set(STORAGE_KEY, { density: 'compact' })

    const next = await saveSettings({ theme: 'dark' })
    expect(next.theme).toBe('dark')
    expect(next.density).toBe('compact')
    expect(sync.data.get(STORAGE_KEY)).toMatchObject({ theme: 'dark', density: 'compact' })
  })

  it('사본에도 같이 남긴다', async () => {
    await saveSettings({ autoMount: false })
    const mirror = JSON.parse(window.localStorage.getItem(MIRROR_KEY) ?? '{}') as Settings
    expect(mirror.autoMount).toBe(false)
  })
})

/**
 * 컬럼을 끄면 화면에서만 사라지는 게 아니라 그 타임라인을 아예 받지 않는다.
 * 수집 프레임을 세우는 자리와 멈춘 컬럼을 되살리는 자리가 모두 이 두 함수를 보므로,
 * 여기서 하나가 새면 그 타임라인은 한 건도 들어오지 않는다.
 */
describe('지켜보는 타임라인', () => {
  it('지켜보기는 기본으로 비어 있다 — 켜야 프레임이 는다', () => {
    expect(DEFAULT_SETTINGS.watch).toEqual([])
  })

  it('지켜보기에 없는 것을 컬럼과 합쳐 수집 대상으로 삼는다', () => {
    expect(collectedKinds({ columns: ['foryou', 'following'], watch: ['mentions'] })).toEqual([
      'foryou',
      'following',
      'mentions',
    ])
  })

  it('컬럼으로도 띄우는 것은 종에서 뺀다 — 보이는 것을 또 세지 않는다', () => {
    expect(watchedKinds({ columns: ['foryou', 'mentions'], watch: ['mentions'] })).toEqual([])
    expect(
      watchedKinds({ columns: ['foryou', 'notifications'], watch: ['mentions', 'notifications'] }),
    ).toEqual(['mentions'])
  })

  /**
   * 판의 탭 차례가 여기서 정해진다. 저장된 순서를 그대로 쓰면 멘션을 먼저 켰다는
   * 이유만으로 사람마다 다른 차례로 뜬다.
   */
  it('켠 차례가 아니라 정해진 차례로 늘어놓는다', () => {
    expect(watchedKinds({ columns: ['foryou'], watch: ['mentions', 'notifications'] })).toEqual([
      'notifications',
      'mentions',
    ])
    expect(watchedKinds({ columns: ['foryou'], watch: ['notifications', 'mentions'] })).toEqual([
      'notifications',
      'mentions',
    ])
  })

  it('컬럼과 겹쳐도 수집 대상이 두 번 세어지지 않는다 — 프레임이 둘 뜬다', () => {
    expect(collectedKinds({ columns: ['foryou', 'mentions'], watch: ['mentions'] })).toEqual([
      'foryou',
      'mentions',
    ])
  })

  it('예전 저장값에 지켜보기가 없어도 빈 목록으로 채운다', async () => {
    sync.data.set(STORAGE_KEY, { columns: ['foryou'] })
    expect((await loadSettings()).watch).toEqual([])
  })
})

describe('watchSettings', () => {
  it('우리 키가 바뀌면 기본값을 덮은 전체 설정을 넘긴다', () => {
    const seen: Settings[] = []
    watchSettings((settings) => seen.push(settings))

    handlers[0]?.({ [STORAGE_KEY]: { newValue: { theme: 'dark' } } as chrome.storage.StorageChange })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.theme).toBe('dark')
    expect(seen[0]?.columns).toEqual(DEFAULT_SETTINGS.columns)
  })

  it('예전 저장값이 실려 와도 옮겨서 넘긴다', () => {
    const seen: Settings[] = []
    watchSettings((settings) => seen.push(settings))

    handlers[0]?.({
      [STORAGE_KEY]: { newValue: { showMedia: false } } as chrome.storage.StorageChange,
    })
    expect(seen[0]?.mediaMode).toBe('hide')
  })

  it('남의 키가 바뀐 것에는 반응하지 않는다', () => {
    const listener = vi.fn()
    watchSettings(listener)

    handlers[0]?.({ 'someone-else': { newValue: 1 } as chrome.storage.StorageChange })
    expect(listener).not.toHaveBeenCalled()
  })

  it('반환한 함수를 부르면 구독이 끊긴다', () => {
    const listener = vi.fn()
    const stop = watchSettings(listener)
    expect(handlers).toHaveLength(1)

    stop()
    expect(handlers).toHaveLength(0)
  })
})
