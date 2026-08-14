import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, watchSettings, type Settings } from '@core/settings'

export interface SettingsHandle {
  settings: Settings
  /** 저장이 끝나기 전에는 기본값이 들어 있다. */
  ready: boolean
  update: (patch: Partial<Settings>) => void
}

export function useSettings(): SettingsHandle {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadSettings().then((loaded) => {
      if (cancelled) return
      setSettings(loaded)
      setReady(true)
    })
    const unwatch = watchSettings(setSettings)
    return () => {
      cancelled = true
      unwatch()
    }
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    // 저장 왕복을 기다리지 않고 화면부터 바꾼다. 저장 결과는 watch 로 되돌아온다.
    setSettings((prev) => ({ ...prev, ...patch }))
    void saveSettings(patch)
  }, [])

  return { settings, ready, update }
}
