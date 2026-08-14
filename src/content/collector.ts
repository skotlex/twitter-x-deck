/**
 * 한 x.com 문서에서 타임라인을 계속 길어 올리는 수집기.
 *
 * 하는 일 네 가지.
 *   1) MAIN world 인터셉터가 잡은 응답을 밖으로 넘긴다.
 *   2) 담당 탭(추천/팔로잉)을 선택된 상태로 유지한다.
 *   3) '새 게시물 보기' 알림을 감지해 눌러서 다음 타임라인을 끌어온다.
 *   4) 담당 컬럼이 둘 이상이면 탭을 교대로 방문한다 (프레임을 못 띄울 때의 경로).
 *   5) 요청이 오면 담당이 아닌 탭도 한 번 들렀다 온다 (프레임이 늦을 때의 대타).
 *
 * 전송 수단은 모른다 — 최상위 문서에서는 덱이 직접 받고, 자식 프레임에서는
 * 부모로 postMessage 한다. 호출하는 쪽이 `emit` 으로 정한다.
 */
import { CHANNEL, isCapturedPayload, type DeckCommand, type FrameMessage } from '@core/messages'
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from '@core/settings'
import {
  isNotificationKind,
  TIMELINE_KINDS,
  TIMELINE_OPERATION,
  type CollectorState,
  type TimelineKind,
} from '@core/types'
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
/** 교대 수집에서 한 탭에 머무는 시간. */
const ROTATE_MS = 30_000
/** 대타 방문에서 다른 탭에 머무는 최대 시간. 응답이 잡히면 그 즉시 돌아온다. */
const PRIME_MAX_MS = 10_000
/** 대타 방문에서 탭 클릭만으로 응답이 안 나올 때 한 번 더 찔러보기까지의 시간. */
const PRIME_NUDGE_MS = 3_000
/** 수동 새로고침에서 옆 탭에 들렀다 돌아오기까지의 시간. */
const TAB_BOUNCE_MS = 500

/**
 * 응답이 어느 타임라인 것인지는 GraphQL operation 이름이 알려준다.
 * 지금 어느 탭이 열려 있는지 추측하는 것보다 정확하다.
 */
function roleFromOperation(operation: string): TimelineKind | null {
  for (const kind of Object.keys(TIMELINE_OPERATION) as TimelineKind[]) {
    if (TIMELINE_OPERATION[kind] === operation) return kind
  }
  return null
}

/**
 * 응답 주소로 알림 컬럼을 가른다.
 *
 * 알림과 멘션은 한 화면에서 둘 다 불려 나올 수 있다. 프레임 담당만 믿으면 두
 * 컬럼에 같은 내용이 들어간다 — 실제로 그렇게 됐다. 주소에는 어느 목록인지가
 * 경로나 variables 로 적혀 있으므로, 적혀 있을 때는 그쪽이 더 정확하다.
 */
function roleFromUrl(url: string): TimelineKind | null {
  let text = url
  try {
    text = decodeURIComponent(url)
  } catch {
    // 못 풀면 원본 그대로 본다. 경로 쪽 표시는 인코딩과 무관하다.
  }
  if (/notifications\/mentions|timeline_type"?\s*:\s*"?Mentions/i.test(text)) return 'mentions'
  if (/notifications\/(all|verified)|timeline_type"?\s*:\s*"?All/i.test(text)) return 'notifications'
  return null
}

export interface CollectorHandle {
  command: (kind: TimelineKind, command: DeckCommand['command']) => void
  /** 잠시 손을 뗀다. 사용자가 이 문서의 x.com 을 직접 쓰는 동안에는 탭을 건드리면 안 된다. */
  setPaused: (paused: boolean) => void
  /** 담당 컬럼 목록을 바꾼다. 둘 이상이면 교대 수집으로 넘어간다. */
  setKinds: (kinds: TimelineKind[]) => void
  /** 담당이 아닌 탭을 한 번만 들렀다 온다. 응답 한 건을 받으면 곧바로 원래 탭으로 복귀. */
  prime: (kind: TimelineKind) => void
  dispose: () => void
}

export function startCollector(
  initialKinds: TimelineKind[],
  emit: (message: FrameMessage) => void,
): CollectorHandle {
  let kinds = [...initialKinds]
  let activeIndex = 0
  let settings: Settings = DEFAULT_SETTINGS
  const states = new Map<TimelineKind, CollectorState>()
  const pendings = new Map<TimelineKind, number | null>()
  let lastCaptureAt = 0
  let lastPillClickAt = 0
  let lastTabAssertAt = 0
  let lastRotateAt = Date.now()
  let lastForcedRefreshAt = Date.now()
  /** 강제 갱신 사다리의 현재 칸. 새 응답이 들어오면 0 으로 되돌린다. */
  let escalation = 0
  /**
   * 손을 뗀 상태. 사용자가 이 문서의 x.com 을 직접 보고 있다는 뜻이다.
   * 그동안 탭을 되돌리거나 대타로 옮겨 다니면 사용자의 조작과 정면으로 싸운다.
   */
  let paused = false
  /** 대타로 들러 있는 타임라인. 없으면 null. */
  let priming: TimelineKind | null = null
  let primingUntil = 0
  /** 이번 대타 방문에서 추가로 찔러볼 시각. 한 번 쓰고 나면 0. */
  let primeNudgeAt = 0

  /** 담당 몫으로 선택돼 있어야 하는 타임라인. */
  const home = (): TimelineKind => kinds[activeIndex % kinds.length] ?? 'foryou'

  /** 지금 선택돼 있어야 하는 타임라인. 대타 방문 중이면 그쪽이 우선한다. */
  const target = (): TimelineKind => priming ?? home()

  function setState(next: CollectorState, message?: string): void {
    // 담당하는 모든 컬럼의 상태를 함께 올린다 — 교대 수집이면 둘 다 같은 처지다.
    for (const kind of kinds) {
      if (states.get(kind) === next) continue
      states.set(kind, next)
      emit(
        message
          ? { channel: CHANNEL, type: 'status', role: kind, state: next, message }
          : { channel: CHANNEL, type: 'status', role: kind, state: next },
      )
    }
  }

  function setPending(kind: TimelineKind, next: number | null): void {
    if (pendings.get(kind) === next) return
    pendings.set(kind, next)
    emit({ channel: CHANNEL, type: 'pending', role: kind, count: next })
  }

  /**
   * 홈 링크를 다시 눌러 타임라인을 새로 받아온다. 눌렀으면 true.
   *
   * 이미 홈에 있을 때 홈을 누르면 x.com 이 목록을 맨 위로 올리며 새로 받아온다.
   * 탭을 다시 누르는 것과 달리 실제 요청이 나가는 것이 확인된 경로다.
   *
   * 알림·멘션 화면에서는 절대 쓰지 않는다. 그 문서를 홈으로 데려가 담당하던
   * 컬럼을 통째로 잃는다.
   */
  function clickHome(): boolean {
    if (isNotificationKind(target())) return false
    const home = findHomeNavLink()
    if (!home) return false
    simulateClick(home)
    return true
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
        // 알림 화면에서는 쓰면 안 된다. 그 문서를 홈으로 데려가 담당을 잃는다.
        const home = clickHome()
        if (!home) pressLoadNewPostsShortcut()
        break
      }
      case 1: {
        const tab = findTab(target())
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

  /**
   * 담당이 아닌 탭으로 잠깐 건너간다.
   *
   * 숨은 프레임은 x.com 을 처음부터 띄우느라 첫 타임라인이 한참 뒤에 온다. 그동안
   * 이미 떠 있는 이 문서가 그 탭을 한 번 눌러주면 같은 응답을 훨씬 먼저 받아낼 수 있다.
   * 담당 컬럼의 상태는 건드리지 않는다 — 어디까지나 대타다.
   */
  function prime(kind: TimelineKind): void {
    if (paused || priming || kinds.includes(kind)) return
    const tab = findTab(kind)
    if (!tab) return
    const now = Date.now()
    priming = kind
    primingUntil = now + PRIME_MAX_MS
    primeNudgeAt = now + PRIME_NUDGE_MS
    simulateClick(tab)
  }

  /**
   * 사용자가 새로고침을 눌렀을 때.
   *
   * 사다리를 타지 않는다 — 그 끝은 문서 새로고침이고, 최상위 문서에서는 덱까지
   * 통째로 다시 뜬다.
   *
   * 이미 열려 있는 탭을 다시 눌러봐야 x.com 은 아무 요청도 내지 않는다. 옆 탭에
   * 잠깐 들렀다 돌아와야 담당 타임라인을 새로 받아온다 — 들르는 김에 옆 컬럼도
   * 한 번 채워진다. 돌아올 탭은 그때 다시 찾는다. 탭 목록이 그 사이 다시 그려지면
   * 미리 잡아둔 요소는 문서에서 떨어져 나가 눌러도 아무 일이 없다.
   */
  function manualRefresh(): void {
    const now = Date.now()
    lastForcedRefreshAt = now

    const pill = findRefreshPill()
    if (pill) {
      simulateClick(pill.element)
      lastPillClickAt = now
      return
    }

    // 같은 화면에 실제로 떠 있는 다른 탭을 고른다. 홈과 알림은 탭 목록이 따로라
    // 이름만 보고 고르면 이 문서에 없는 탭을 집는다.
    // 홈 링크 재클릭이 실제 요청을 내는 것이 확인된 경로다. 탭을 다시 누르는 것만으로는
    // x.com 이 이미 받아둔 목록을 다시 그리기만 하고 요청을 안 낼 때가 있다.
    clickHome()

    // 홈 링크가 없거나(알림 화면·좁은 프레임) 그것만으로 부족할 때를 위해 탭도 튕긴다.
    // 홈 클릭으로 담당 탭이 풀렸다면 돌아오는 클릭이 그것까지 함께 되돌린다.
    const wanted = target()
    const away = TIMELINE_KINDS.filter((kind) => kind !== wanted)
      .map((kind) => findTab(kind))
      .find((tab) => tab !== null)

    // tick 이 그 사이에 끼어들어 탭을 되돌리지 않도록 확인 시계를 미뤄둔다.
    lastTabAssertAt = now
    if (away) simulateClick(away)
    window.setTimeout(() => {
      const back = findTab(wanted)
      if (back) simulateClick(back)
      pressLoadNewPostsShortcut()
    }, TAB_BOUNCE_MS)
  }

  /** 대타 방문을 끝내고 담당 탭으로 돌아온다. */
  function endPrime(): void {
    if (!priming) return
    // 떠나는 컬럼의 알림 개수는 더 이상 우리가 볼 수 없다. 남은 숫자를 지워둔다.
    setPending(priming, null)
    priming = null
    primeNudgeAt = 0
    const tab = findTab(home())
    if (tab) simulateClick(tab)
    // 돌아오며 담당 타임라인을 새로 받게 되므로 강제 갱신 시계도 함께 되돌린다.
    lastForcedRefreshAt = Date.now()
  }

  function command(kind: TimelineKind, next: DeckCommand['command']): void {
    if (next === 'ping') {
      emit({ channel: CHANNEL, type: 'status', role: kind, state: states.get(kind) ?? 'idle' })
      return
    }

    // 사용자 조작이 대타 방문보다 우선한다 — 담당 탭으로 먼저 돌아온다.
    endPrime()

    // 교대 수집 중 다른 컬럼을 새로 받으라는 요청이면 그 탭으로 먼저 옮긴다.
    const index = kinds.indexOf(kind)
    if (index >= 0 && index !== activeIndex) {
      activeIndex = index
      lastRotateAt = Date.now()
      const tab = findTab(kind)
      if (tab) simulateClick(tab)
      if (next === 'select-tab') return
    }

    if (next === 'select-tab') {
      const tab = findTab(kind)
      if (tab) simulateClick(tab)
      return
    }

    manualRefresh()
  }

  const onWindowMessage = (event: MessageEvent): void => {
    // 인터셉터가 같은 문서 안에서 보낸 캡처만 받는다.
    if (event.source !== window || !isCapturedPayload(event.data)) return

    lastCaptureAt = Date.now()
    lastForcedRefreshAt = lastCaptureAt
    // 직전 시도가 통했다는 뜻이므로 사다리를 맨 아래로 되돌린다.
    escalation = 0

    // operation 이름 → 주소 → 지금 보고 있는 탭 순으로 귀속을 정한다.
    const role =
      roleFromOperation(event.data.operation) ?? roleFromUrl(event.data.url) ?? target()
    emit({
      channel: CHANNEL,
      type: 'timeline',
      role,
      operation: event.data.operation,
      body: event.data.body,
    })
    setState('streaming')
    setPending(role, null)

    // 대타로 노리던 응답을 받았으면 더 머무를 이유가 없다.
    if (priming === role) endPrime()
  }

  function tick(): void {
    const now = Date.now()

    // 손을 뗀 동안에는 아무 것도 누르지 않는다. 응답이 들어오면 받기는 한다 —
    // 사용자가 직접 넘긴 타임라인도 우리 것으로 쌓인다.
    if (paused) return

    if (isLoggedOut()) {
      for (const kind of kinds) setPending(kind, null)
      setState('login-required')
      return
    }

    // 대타 방문은 응답이 오면 그때 끝난다. 안 오면 여기서 시간으로 끊는다.
    if (priming) {
      if (now > primingUntil) {
        endPrime()
        return
      }
      // 최근에 들렀던 탭이면 클릭해도 이미 받아둔 타임라인만 다시 그리고 요청이 안 나간다.
      // 그럴 때를 위해 방문당 한 번, 선택자에 기대지 않는 단축키로 새 글을 끌어온다.
      if (primeNudgeAt > 0 && now > primeNudgeAt) {
        primeNudgeAt = 0
        pressLoadNewPostsShortcut()
      }
    }

    // 담당이 둘 이상이면 주기적으로 다음 탭으로 넘어간다.
    if (!priming && kinds.length > 1 && now - lastRotateAt > ROTATE_MS) {
      activeIndex = (activeIndex + 1) % kinds.length
      lastRotateAt = now
      lastForcedRefreshAt = now
      const nextTab = findTab(target())
      if (nextTab) simulateClick(nextTab)
      return
    }

    const wanted = target()
    const tab = findTab(wanted)
    if (!tab) {
      setState('loading')
      return
    }

    // 같은 오리진의 다른 문서가 탭 선택을 밀어버릴 수 있다. 매 tick 확인해 되돌린다.
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
      setPending(wanted, pill.count)
      if (settings.autoAdvance && now - lastPillClickAt > PILL_COOLDOWN_MS) {
        simulateClick(pill.element)
        lastPillClickAt = now
        lastForcedRefreshAt = now
      }
      return
    }

    setPending(wanted, null)

    // 알림이 한동안 안 뜨면 사다리를 한 칸 올라 직접 새 타임라인을 받아온다.
    // 대타 방문 중에는 건너뛴다 — 사다리 끝의 문서 새로고침이 방문을 통째로 날린다.
    const idleFor = now - Math.max(lastCaptureAt, lastForcedRefreshAt)
    if (!priming && settings.idleRefreshMs > 0 && idleFor > settings.idleRefreshMs) {
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

  setState('loading')
  const timer = window.setInterval(tick, TICK_MS)

  return {
    command,
    prime,
    setPaused(next) {
      if (paused === next) return
      paused = next
      if (!next) return
      // 대타 방문 중이었어도 탭을 되돌리는 클릭은 하지 않는다. 손을 떼는 마당에
      // 마지막으로 한 번 누르면 그게 바로 사용자와 싸우는 그 클릭이다.
      if (priming) setPending(priming, null)
      priming = null
      primeNudgeAt = 0
    },
    setKinds(next) {
      if (next.length === 0) return
      kinds = [...next]
      activeIndex = 0
      // 담당이 바뀌었으니 대타 방문은 의미가 없다. 새 담당 탭으로 돌아온다.
      endPrime()
      lastRotateAt = Date.now()
      // 새로 맡은 컬럼에도 현재 상태를 알려야 하므로 캐시를 비운다.
      states.clear()
      setState(lastCaptureAt === 0 ? 'loading' : 'streaming')
    },
    dispose() {
      window.clearInterval(timer)
      window.removeEventListener('message', onWindowMessage)
      unwatch()
    },
  }
}
