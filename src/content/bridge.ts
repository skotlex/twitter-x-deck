/**
 * ISOLATED world 브리지.
 *
 * 역할 세 가지.
 *   1) MAIN world 인터셉터가 잡은 응답을 덱 페이지로 넘긴다.
 *   2) 이 프레임이 담당할 탭(추천/팔로잉)을 선택된 상태로 유지한다.
 *   3) '새 게시물 보기' 알림을 감지해 눌러서 다음 타임라인을 끌어온다.
 *
 * 덱이 띄운 프레임/탭이 아니면 아무 것도 하지 않는다.
 */
import {
  CHANNEL,
  isCapturedPayload,
  isDeckCommand,
  type DeckCommand,
  type FrameMessage,
} from '@core/messages'
import { readFrameRole } from '@core/role'
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

const role = readFrameRole()
if (role) start(role)

function start(kind: TimelineKind): void {
  const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin
  const isFramed = window.parent !== window.self

  let settings: Settings = DEFAULT_SETTINGS
  let state: CollectorState = 'loading'
  let pending: number | null = null
  let lastCaptureAt = 0
  let lastPillClickAt = 0
  let lastTabAssertAt = 0
  let lastForcedRefreshAt = Date.now()
  /** 강제 갱신 사다리의 현재 칸. 새 응답이 들어오면 0 으로 되돌린다. */
  let escalation = 0

  function post(message: FrameMessage): void {
    if (isFramed) {
      window.parent.postMessage(message, extensionOrigin)
      return
    }
    // 폴백 탭 모드: 백그라운드 서비스 워커가 덱으로 중계한다.
    void chrome.runtime.sendMessage(message).catch(() => {})
  }

  function setState(next: CollectorState, message?: string): void {
    if (next === state) return
    state = next
    post(message ? { channel: CHANNEL, type: 'status', role: kind, state: next, message } : { channel: CHANNEL, type: 'status', role: kind, state: next })
  }

  function setPending(next: number | null): void {
    if (next === pending) return
    pending = next
    post({ channel: CHANNEL, type: 'pending', role: kind, count: next })
  }

  /**
   * 새 타임라인을 강제로 받아온다.
   *
   * 한 가지 방법에 기대지 않고 사다리를 오른다 — 앞 칸이 통했으면 응답이 들어오면서
   * `escalation` 이 0 으로 되돌아가고, 통하지 않았으면 다음 칸으로 넘어간다.
   * 마지막 칸은 프레임 새로고침이라 어떤 경우에도 결국 복구된다.
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

  function handleCommand(command: DeckCommand['command']): void {
    if (command === 'ping') {
      post({ channel: CHANNEL, type: 'status', role: kind, state })
      return
    }
    if (command === 'select-tab') {
      const tab = findTab(kind)
      if (tab) simulateClick(tab)
      return
    }
    forceRefresh()
  }

  window.addEventListener('message', (event: MessageEvent) => {
    // 인터셉터가 같은 프레임 안에서 보낸 캡처.
    if (event.source === window && isCapturedPayload(event.data)) {
      lastCaptureAt = Date.now()
      lastForcedRefreshAt = lastCaptureAt
      // 직전 시도가 통했다는 뜻이므로 사다리를 맨 아래로 되돌린다.
      escalation = 0
      post({
        channel: CHANNEL,
        type: 'timeline',
        role: kind,
        operation: event.data.operation,
        body: event.data.body,
      })
      setState('streaming')
      setPending(null)
      return
    }

    // 덱 페이지가 내려보낸 명령.
    if (event.origin === extensionOrigin && isDeckCommand(event.data)) {
      handleCommand(event.data.command)
    }
  })

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (isDeckCommand(message)) handleCommand(message.command)
  })

  void loadSettings().then((loaded) => {
    settings = loaded
  })
  watchSettings((next) => {
    settings = next
  })

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

    // 두 프레임이 같은 오리진을 공유해 탭 선택이 서로 밀릴 수 있다. 매 tick 확인해 되돌린다.
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

  post({ channel: CHANNEL, type: 'status', role: kind, state: 'loading' })
  setInterval(tick, TICK_MS)
}
