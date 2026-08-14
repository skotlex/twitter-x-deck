/**
 * 한 x.com 문서에서 타임라인 한 종류를 계속 길어 올리는 수집기.
 *
 * 하는 일 세 가지.
 *   1) MAIN world 인터셉터가 잡은 응답을 밖으로 넘긴다.
 *   2) 담당 탭(추천/팔로잉)을 선택된 상태로 유지한다.
 *   3) '새 게시물 보기' 알림을 감지해 눌러서 다음 타임라인을 끌어온다.
 *
 * 전송 수단은 모른다 — 최상위 문서에서는 덱이 직접 받고, 자식 프레임에서는
 * 부모로 postMessage 한다. 호출하는 쪽이 `emit` 으로 정한다.
 */
import { CHANNEL, isCapturedPayload, type DeckCommand, type FrameMessage } from '@core/messages'
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from '@core/settings'
import type { CollectorState, TimelineKind } from '@core/types'
import {
  findHomeNavLink,
  findRefreshPill,
  findTab,
  hasTimeline,
  isLoggedOut,
  isTabSelected,
  pressLoadNewPostsShortcut,
  simulateClick,
} from './selectors'

/** 상태 점검 주기. */
const TICK_MS = 1_000
/** 같은 알림을 연타하지 않도록 두는 최소 간격. */
const PILL_COOLDOWN_MS = 3_000
/** 탭 선택이 어긋났을 때 다시 누르기까지의 최소 간격. */
const TAB_ASSERT_COOLDOWN_MS = 4_000

export interface CollectorHandle {
  command: (command: DeckCommand['command']) => void
  dispose: () => void
}

export function startCollector(
  kind: TimelineKind,
  emit: (message: FrameMessage) => void,
): CollectorHandle {
  let settings: Settings = DEFAULT_SETTINGS
  let state: CollectorState = 'loading'
  let pending: number | null = null
  let lastCaptureAt = 0
  let lastPillClickAt = 0
  let lastTabAssertAt = 0
  let lastForcedRefreshAt = Date.now()
  /** 강제 갱신 사다리의 현재 칸. 새 응답이 들어오면 0 으로 되돌린다. */
  let escalation = 0

  function setState(next: CollectorState, message?: string): void {
    if (next === state) return
    state = next
    emit(
      message
        ? { channel: CHANNEL, type: 'status', role: kind, state: next, message }
        : { channel: CHANNEL, type: 'status', role: kind, state: next },
    )
  }

  function setPending(next: number | null): void {
    if (next === pending) return
    pending = next
    emit({ channel: CHANNEL, type: 'pending', role: kind, count: next })
  }

  /**
   * 새 타임라인을 강제로 받아온다.
   *
   * 한 가지 방법에 기대지 않고 사다리를 오른다 — 앞 칸이 통했으면 응답이 들어오면서
   * `escalation` 이 0 으로 되돌아가고, 통하지 않았으면 다음 칸으로 넘어간다.
   * 마지막 칸은 문서 새로고침이라 어떤 경우에도 결국 복구된다.
   */
  function forceRefresh(): void {
    lastForcedRefreshAt = Date.now()

    const pill = findRefreshPill()
    if (pill) {
      simulateClick(pill.element)
      lastPillClickAt = lastForcedRefreshAt
      return
    }

    switch (escalation) {
      case 0: {
        // 홈 링크 재클릭 — 이미 홈에 있으면 맨 위로 올리며 타임라인을 새로 받는다.
        const home = findHomeNavLink()
        if (home) simulateClick(home)
        break
      }
      case 1: {
        const tab = findTab(kind)
        if (tab) simulateClick(tab)
        break
      }
      case 2:
        pressLoadNewPostsShortcut()
        break
      default:
        window.location.reload()
        return
    }

    escalation = Math.min(escalation + 1, 3)
  }

  function command(next: DeckCommand['command']): void {
    if (next === 'ping') {
      emit({ channel: CHANNEL, type: 'status', role: kind, state })
      return
    }
    if (next === 'select-tab') {
      const tab = findTab(kind)
      if (tab) simulateClick(tab)
      return
    }
    forceRefresh()
  }

  const onWindowMessage = (event: MessageEvent): void => {
    // 인터셉터가 같은 문서 안에서 보낸 캡처만 받는다.
    if (event.source !== window || !isCapturedPayload(event.data)) return

    lastCaptureAt = Date.now()
    lastForcedRefreshAt = lastCaptureAt
    // 직전 시도가 통했다는 뜻이므로 사다리를 맨 아래로 되돌린다.
    escalation = 0

    emit({
      channel: CHANNEL,
      type: 'timeline',
      role: kind,
      operation: event.data.operation,
      body: event.data.body,
    })
    setState('streaming')
    setPending(null)
  }

  function tick(): void {
    const now = Date.now()

    if (isLoggedOut()) {
      setPending(null)
      setState('login-required')
      return
    }

    const tab = findTab(kind)
    if (!tab) {
      setState('loading')
      return
    }

    // 두 문서가 같은 오리진을 공유해 탭 선택이 서로 밀릴 수 있다. 매 tick 확인해 되돌린다.
    if (!isTabSelected(tab)) {
      if (now - lastTabAssertAt > TAB_ASSERT_COOLDOWN_MS) {
        simulateClick(tab)
        lastTabAssertAt = now
        lastForcedRefreshAt = now
      }
      return
    }

    // 응답을 한 번이라도 받았으면 DOM 선택자가 어긋나도 수신 중으로 본다.
    if (!hasTimeline() && lastCaptureAt === 0) {
      setState('loading')
      return
    }
    setState('streaming')

    const pill = findRefreshPill()
    if (pill) {
      setPending(pill.count)
      if (settings.autoAdvance && now - lastPillClickAt > PILL_COOLDOWN_MS) {
        simulateClick(pill.element)
        lastPillClickAt = now
        lastForcedRefreshAt = now
      }
      return
    }

    setPending(null)

    // 알림이 한동안 안 뜨면 사다리를 한 칸 올라 직접 새 타임라인을 받아온다.
    const idleFor = now - Math.max(lastCaptureAt, lastForcedRefreshAt)
    if (settings.idleRefreshMs > 0 && idleFor > settings.idleRefreshMs) {
      forceRefresh()
    }
  }

  window.addEventListener('message', onWindowMessage)
  void loadSettings().then((loaded) => {
    settings = loaded
  })
  const unwatch = watchSettings((next) => {
    settings = next
  })

  emit({ channel: CHANNEL, type: 'status', role: kind, state: 'loading' })
  const timer = window.setInterval(tick, TICK_MS)

  return {
    command,
    dispose() {
      window.clearInterval(timer)
      window.removeEventListener('message', onWindowMessage)
      unwatch()
    },
  }
}
