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
import {
  CHANNEL,
  isCapturedPayload,
  NOCACHE_PARAM,
  ROLE_PARAM,
  type DeckCommand,
  type DeletedMessage,
  type FrameMessage,
} from '@core/messages'
import { rememberLoggedOut } from '@core/session'
import {
  DEFAULT_SETTINGS,
  isPowerSaving,
  loadSettings,
  watchSettings,
  type Settings,
} from '@core/settings'
import {
  DELETE_TWEET_OPERATION,
  isNotificationKind,
  TIMELINE_KINDS,
  TIMELINE_OPERATION,
  TIMELINE_PATH,
  type CollectorState,
  type TimelineKind,
} from '@core/types'
import {
  findHomeNavLink,
  findNotificationsNavLink,
  findRefreshPill,
  findTab,
  isLoggedOut,
  isOnPageFor,
  isTabSelected,
  pressLoadNewPostsShortcut,
  simulateClick,
} from './selectors'

/** 상태 점검 주기. */
const TICK_MS = 1_000
/** 상태가 그대로여도 이 간격마다 한 번은 다시 알린다. */
const STATE_RESEND_MS = 5_000
/** 같은 알림을 연타하지 않도록 두는 최소 간격. */
const PILL_COOLDOWN_MS = 3_000
/** 탭 선택이 어긋났을 때 다시 누르기까지의 최소 간격. */
const TAB_ASSERT_COOLDOWN_MS = 4_000
/** 담당 화면으로 돌아가는 클릭 사이의 최소 간격. SPA 이동에 시간이 걸린다. */
const NAV_COOLDOWN_MS = 5_000
/** 교대 수집에서 한 탭에 머무는 시간. */
const ROTATE_MS = 30_000
/** 대타 방문에서 다른 탭에 머무는 최대 시간. 응답이 잡히면 그 즉시 돌아온다. */
const PRIME_MAX_MS = 10_000
/** 대타 방문에서 탭 클릭만으로 응답이 안 나올 때 한 번 더 찔러보기까지의 시간. */
const PRIME_NUDGE_MS = 3_000
/** 수동 새로고침에서 옆 탭에 들렀다 돌아오기까지의 시간. */
const TAB_BOUNCE_MS = 500
/**
 * 강제 갱신이 담당 컬럼을 못 채웠을 때 다음 칸으로 올라가기까지의 시간.
 *
 * 유휴 간격(기본 2분)을 그대로 다시 기다리면 사다리 끝까지 오르는 데 몇 분이 걸린다.
 * 한 칸이 헛돌았다는 것은 이미 확인된 사실이므로 곧바로 다음 수단을 시도한다.
 */
const ESCALATE_RETRY_MS = 20_000
/**
 * 사람이 새로고침을 누른 뒤 다음 칸으로 넘어가기까지의 시간.
 *
 * 기다리는 사람이 있으므로 자동 갱신(20 초)보다 훨씬 짧다. 그래도 한 칸씩 밟는
 * 것은 같다 — 통했는지 보고 넘어가야 헛일을 반복하지 않는다.
 */
const MANUAL_RETRY_MS = 2_500
/**
 * 그 빠른 구간을 유지하는 시간.
 *
 * 사다리를 끝까지 밟고도 남을 만큼만 둔다. 이 시간이 지나면 자동 갱신의 느긋한
 * 간격으로 돌아간다.
 */
const MANUAL_WINDOW_MS = 12_000
/**
 * 강제 갱신 사다리의 칸 수. 이 칸을 다 밟고도 조용하면 문서를 다시 띄운다.
 * `ladder()` 가 돌려주는 칸 수와 반드시 같아야 한다.
 */
const LADDER_RUNGS = 4

/**
 * 목록 응답에만 들어 있는 표시.
 *
 * 정확한 판정은 파서가 한다. 여기서는 '이 컬럼이 갱신됐다' 로 셀지 말지만 가린다 —
 * 세 글자 훑는 값으로 사다리와 상태 표시가 엉뚱한 응답에 속지 않는다.
 * GraphQL 타임라인은 `instructions` · `entryId` 를, 옛 알림 경로는 `globalObjects` 를 싣는다.
 */
const TIMELINE_MARKER_RE = /"(instructions|entryId|globalObjects)"/

/** 목록 지문에 넣을 항목 수. 앞쪽 몇 개만 봐도 같은 목록인지는 갈린다. */
const SIGNATURE_ENTRIES = 20
const ENTRY_ID_RE = /"entryId"\s*:\s*"([^"]+)"/g

/**
 * 응답이 실어온 목록의 지문. 뽑을 것이 없으면 null.
 *
 * **응답이 온 것과 새 목록이 온 것은 다르다.** 이미 열려 있는 화면을 다시 두드리면
 * x.com 은 대개 방금 준 것과 똑같은 목록을 한 번 더 준다. 그것을 성공으로 세면
 * 사다리가 첫 칸에서 되감기기만 하고, 실제로 새 목록을 받아오는 뒷칸(탭 튕기기)까지
 * 영영 올라가지 못한다 — 추천 컬럼이 첫 적재 뒤로 같은 글만 들고 있던 자리다.
 *
 * 커서는 같은 목록이어도 값이 매번 달라 뺀다. 광고 항목도 마찬가지로 매번 갈리므로
 * 함께 뺀다 — 하나라도 섞이면 지문이 늘 달라져 아무 것도 가려내지 못한다.
 *
 * 뽑을 것이 하나도 없으면(항목 표시가 없는 옛 알림 경로 등) null 을 준다. 부르는 쪽은
 * 그때 새 목록으로 친다 — 모르는 것을 같다고 우기면 갱신이 멎는 쪽으로 틀리게 된다.
 */
export function timelineSignature(body: string): string | null {
  ENTRY_ID_RE.lastIndex = 0
  const ids: string[] = []
  for (let hit = ENTRY_ID_RE.exec(body); hit !== null; hit = ENTRY_ID_RE.exec(body)) {
    const id = hit[1] ?? ''
    if (id.startsWith('cursor-') || id.includes('promoted')) continue
    ids.push(id)
    if (ids.length >= SIGNATURE_ENTRIES) break
  }
  return ids.length > 0 ? ids.join(',') : null
}

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
  emit: (message: FrameMessage | DeletedMessage) => void,
): CollectorHandle {
  let kinds = [...initialKinds]
  let activeIndex = 0
  let settings: Settings = DEFAULT_SETTINGS
  const states = new Map<TimelineKind, CollectorState>()
  const pendings = new Map<TimelineKind, number | null>()
  /**
   * 컬럼별 마지막 수신 시각.
   *
   * 하나로 묶어두면 안 된다 — 이 문서는 담당이 아닌 컬럼의 응답도 받는다.
   * 팔로잉 프레임에서 홈 링크를 누르면 추천 응답이 돌아오는데, 그걸 팔로잉이
   * 갱신된 근거로 쓰면 팔로잉은 영영 안 채워진 채 사다리만 제자리를 돈다.
   */
  const captures = new Map<TimelineKind, number>()
  /**
   * 컬럼별로 마지막에 **새 목록**을 받은 시각. 그 컬럼이 조용한지를 재는 유일한 근거다.
   *
   * 수신 시각(`captures`)으로 재면 안 된다. 우리는 x.com 의 폴링이 계속 돌도록
   * 문서를 늘 '보임' 으로 위장해 두므로, 두드리지 않아도 응답은 꾸준히 들어온다.
   * 추천은 알고리즘 타임라인이라 그 응답이 늘 같은 목록인데, 그것으로 유휴 시계를
   * 되감으면 컬럼은 영영 '조용하지 않은' 것이 되어 사다리가 **시작조차 못 한다** —
   * 추천이 20 분이 지나도 그대로였던 자리다. 팔로잉은 시간순이라 폴링 응답에 새
   * 글이 실려 오고, 그래서 같은 결함이 그쪽에서는 드러나지 않았다.
   */
  const renewals = new Map<TimelineKind, number>()
  /** 컬럼별 마지막 목록 지문. 같은 목록을 다시 받은 것인지 가리는 데 쓴다. */
  const signatures = new Map<TimelineKind, string>()
  /** 맡은 컬럼의 응답을 한 번이라도 받았는지. 상태를 '수신 중' 으로 올릴 유일한 근거다. */
  const receiving = (): boolean => kinds.some((kind) => captures.has(kind))
  let lastPillClickAt = 0
  let lastTabAssertAt = 0
  let lastRotateAt = Date.now()
  let lastForcedRefreshAt = Date.now()
  /** 강제 갱신 사다리의 현재 칸. 담당 컬럼에 **새 목록** 이 들어오면 0 으로 되돌린다. */
  let escalation = 0
  /**
   * 이번에 사다리를 오르는 동안 담당 컬럼의 응답이 한 번이라도 왔는지.
   *
   * 사다리 끝에서 문서를 다시 띄울지 가르는 기준이다. 응답이 오는데 내용만 그대로인
   * 것은 문서가 죽은 게 아니라 x.com 에 내놓을 새 글이 없는 것이라, 다시 띄워봐야
   * 같은 목록을 처음부터 받을 뿐이다.
   */
  let answered = false
  /** 사다리 끝의 재적재를 이미 걸었는지. 문서가 곧 사라지므로 두 번 걸 일이 없다. */
  let reloading = false
  /**
   * 손을 뗀 상태. 사용자가 이 문서의 x.com 을 직접 보고 있다는 뜻이다.
   * 그동안 탭을 되돌리거나 대타로 옮겨 다니면 사용자의 조작과 정면으로 싸운다.
   */
  let paused = false
  /** 상태를 마지막으로 알린 시각. 바뀐 게 없어도 이따금 다시 알리기 위해 둔다. */
  let lastStateEmitAt = 0
  /** 지금까지 알고 있는 로그인 상태. 바뀔 때만 문서 밖에 남긴다. */
  let knownLoggedOut: boolean | null = null
  /** 담당 화면으로 돌아가려고 마지막으로 누른 시각. */
  let lastNavAt = 0
  /** 대타로 들러 있는 타임라인. 없으면 null. */
  let priming: TimelineKind | null = null
  let primingUntil = 0
  /** 이번 대타 방문에서 추가로 찔러볼 시각. 한 번 쓰고 나면 0. */
  let primeNudgeAt = 0
  /** 사람이 새로고침을 누른 뒤 사다리를 빠르게 올라가는 구간의 끝. */
  let manualUntil = 0

  /** 담당 몫으로 선택돼 있어야 하는 타임라인. */
  const home = (): TimelineKind => kinds[activeIndex % kinds.length] ?? 'foryou'

  /** 지금 선택돼 있어야 하는 타임라인. 대타 방문 중이면 그쪽이 우선한다. */
  const target = (): TimelineKind => priming ?? home()

  /** 그 컬럼이 멈춰 있는지. 전체 스위치와 컬럼별 지정을 함께 본다. */
  const saving = (kind: TimelineKind): boolean => isPowerSaving(settings, kind)

  /**
   * 교대 수집에서 다음으로 옮겨갈 자리. 갈 곳이 없으면 null.
   *
   * 멈춰둔 컬럼은 건너뛴다 — 탭을 옮기는 것이 곧 x.com 의 재렌더라, 보러 가는 것
   * 자체가 절전이 막으려던 그 값이다. 지금 자리는 후보에서 뺀다. 자기 탭을 다시
   * 눌러봐야 요청도 안 나가면서 확인 시계만 되감긴다.
   */
  function nextAwakeIndex(): number | null {
    for (let step = 1; step < kinds.length; step += 1) {
      const index = (activeIndex + step) % kinds.length
      const kind = kinds[index]
      if (kind && !saving(kind)) return index
    }
    return null
  }

  function setState(next: CollectorState, message?: string): void {
    /*
     * 바뀐 것이 없어도 이따금 다시 알린다.
     *
     * 최상위 문서의 수집기는 덱보다 **먼저** 뜬다. 그래서 첫 상태를 알릴 때는 아직
     * 듣는 쪽이 없고, 그 뒤로 상태가 그대로면 다시 알릴 일도 없어 덱은 영영 '대기'
     * 에 머문다. 로그아웃처럼 처음부터 끝까지 한 상태로 있는 경우가 정확히 그렇다.
     */
    const now = Date.now()
    const resend = now - lastStateEmitAt > STATE_RESEND_MS
    if (resend) lastStateEmitAt = now

    // 담당하는 모든 컬럼의 상태를 함께 올린다 — 교대 수집이면 둘 다 같은 처지다.
    for (const kind of kinds) {
      if (states.get(kind) === next && !resend) continue
      states.set(kind, next)
      emit(
        message
          ? { channel: CHANNEL, type: 'status', role: kind, state: next, message }
          : { channel: CHANNEL, type: 'status', role: kind, state: next },
      )
    }
  }

  /**
   * 지금 무엇을 해보고 있는지 한 줄로 알린다. 컬럼 상태 배지의 말풍선에 그대로 뜬다.
   *
   * 상태 값 자체는 그대로라 `setState` 로는 나가지 않는 소식을 전하는 통로다.
   * 갱신이 멎었을 때 수집기가 어디까지 시도했는지 밖에서 볼 길이 있어야 한다.
   */
  function report(message: string): void {
    for (const kind of kinds) {
      emit({
        channel: CHANNEL,
        type: 'status',
        role: kind,
        state: states.get(kind) ?? 'loading',
        message,
      })
    }
  }

  function setPending(kind: TimelineKind, next: number | null): void {
    if (pendings.get(kind) === next) return
    pendings.set(kind, next)
    emit({ channel: CHANNEL, type: 'pending', role: kind, count: next })
  }

  /**
   * 담당 화면의 내비 링크를 다시 눌러 목록을 새로 받아온다. 눌렀으면 true.
   *
   * 이미 그 화면에 있을 때 같은 링크를 누르면 x.com 이 목록을 맨 위로 올리며 새로
   * 받아온다. 탭을 다시 누르는 것과 달리 실제 요청이 나가는 것이 확인된 경로다.
   *
   * 알림 문서에서 홈 링크를 누르면 안 된다 — 그 문서를 홈으로 데려가 담당하던 컬럼을
   * 통째로 잃는다. 대신 같은 자리의 알림 링크를 쓴다. 멘션 담당이 알림 목록으로
   * 옮겨가더라도 같은 화면 안이라 tick 이 곧 담당 탭을 되찾는다.
   */
  function clickOwnNav(): boolean {
    const link = isNotificationKind(target()) ? findNotificationsNavLink() : findHomeNavLink()
    if (!link) return false
    simulateClick(link)
    return true
  }

  /**
   * 수집 프레임을 통째로 다시 띄운다. 사다리의 마지막 칸.
   *
   * 최상위 문서에서는 하지 않는다 — 그 위에 덱이 얹혀 있어서, 컬럼 하나가 조용하다는
   * 이유로 사용자가 읽던 화면을 통째로 날리게 된다. 대신 사다리를 맨 아래로 되돌려
   * 처음부터 다시 두드리고, 사정은 배지에 적어 사용자가 직접 판단하게 한다.
   *
   * 프레임에서도 그냥 reload 하면 안 된다 — 캐시에 남은 응답에는 걷어내야 할
   * `X-Frame-Options` 가 그대로 붙어 있어 프레임이 막힌다. 처음 띄울 때와 같은
   * 일회용 값을 붙여 새 응답을 받게 한다.
   */
  function hardReload(): void {
    if (window.top === window.self) {
      /*
       * 최상위 문서는 다시 띄울 수 없다. 대신 **이 컬럼을 놓겠다고 알린다.**
       *
       * 여기까지 왔다는 것은 사다리를 다 밟는 동안 응답이 한 건도 없었다는 뜻이다 —
       * 이 문서의 x.com 이 세션째로 막힌 상태이고, 그 자리에서 아무리 두드려도
       * 돌아오지 않는다. 실제로 `viewer_context` 가 500 을 되풀이하는 동안 추천이
       * 그렇게 멎었고, 예전에는 여기서 '탭 새로고침이 필요합니다' 라고 적고 손을
       * 놓아 사람이 직접 새로고침할 때까지 컬럼이 죽어 있었다.
       *
       * 덱은 이 신고를 받아 숨은 프레임을 세운다. 새 문서라 막힌 세션 바깥에서
       * 처음부터 시작하고, 그 프레임은 막히면 스스로 다시 뜰 수도 있다.
       */
      report('되살리지 못함 — 숨은 프레임에 넘김')
      escalation = 0
      for (const kind of kinds) emit({ channel: CHANNEL, type: 'stalled', role: kind })
      return
    }
    // 한 번이면 족하다. 재적재가 어떤 이유로 듣지 않아도 20초마다 다시 부르지 않는다.
    if (reloading) return
    reloading = true
    report('강제 갱신: 프레임 재적재')
    const kind = home()
    const nonce = Date.now().toString(36)
    window.location.replace(
      `${TIMELINE_PATH[kind]}?${ROLE_PARAM}=${kind}&${NOCACHE_PARAM}=${nonce}`,
    )
  }

  /**
   * 새 타임라인을 강제로 받아온다.
   *
   * 한 가지 방법에 기대지 않고 사다리를 오른다 — 앞 칸이 통했으면 **담당 컬럼의**
   * 응답이 들어오면서 `escalation` 이 0 으로 되돌아가고, 통하지 않았으면 다음 칸으로
   * 넘어간다. 마지막 칸은 문서 재적재라 어떤 경우에도 결국 복구된다.
   */
  function forceRefresh(): void {
    lastForcedRefreshAt = Date.now()

    // 알약은 여기서 손대지 않는다. 떠 있으면 tick 이 이미 눌러보고 있고,
    // 그것으로 안 되니 여기까지 온 것이다.
    const rungs = ladder()
    if (escalation >= rungs.length) {
      /*
       * 사다리를 다 밟았다.
       *
       * 오르는 내내 응답이 오고 있었다면 문서가 죽은 것이 아니라 x.com 이 내놓을 새
       * 글이 없는 것이다. 다시 띄워봐야 같은 목록을 처음부터 받을 뿐이므로 맨 아래로
       * 되돌려 같은 사다리를 한 번 더 오른다 — 마지막 칸까지 밟고 나면 사다리를 오르는
       * 중이 아니게 되어, 다음 오름은 유휴 간격만큼 쉰 뒤에 시작된다.
       */
      if (!answered) {
        hardReload()
        return
      }
      escalation = 0
    }
    const step = rungs[escalation]
    if (!step) return
    // 맨 아래 칸에서 다시 센다 — 이번 오름에서 응답을 봤는지가 다음 판단의 근거다.
    if (escalation === 0) answered = false
    report(`강제 갱신 ${escalation + 1}/${rungs.length}: ${step.label}`)
    step.run()
    escalation = Math.min(escalation + 1, rungs.length)
  }

  /**
   * 강제 갱신 수단을 시도할 차례대로 늘어놓는다. 담당 컬럼에 따라 순서가 다르다.
   *
   * 내비 링크 재클릭은 이미 그 화면에 있을 때 목록을 맨 위로 올리며 새로 받아오는,
   * 실제 요청이 나가는 것이 확인된 경로다. 그래서 대개 맨 앞에 둔다.
   *
   * 팔로잉만 예외다. 홈 링크로 받아오는 것은 홈의 기본 탭인 추천이라, 앞에 두면
   * 팔로잉은 한 건도 못 받은 채 추천 응답만 돌아와 사다리가 제자리를 돈다.
   * 알림·멘션은 자기 화면의 링크를 쓰므로 이 문제가 없다.
   */
  function ladder(): Array<{ label: string; run: () => void }> {
    const wanted = target()
    const nav = {
      label: isNotificationKind(wanted) ? '알림 링크 재클릭' : '홈 링크 재클릭',
      run: (): void => {
        // 링크를 못 찾는 화면(좁은 프레임 등)에서는 선택자에 기대지 않는 단축키로 물러선다.
        if (!clickOwnNav()) pressLoadNewPostsShortcut()
      },
    }
    const tab = {
      label: '탭 재클릭',
      run: (): void => {
        const found = findTab(wanted)
        if (found) simulateClick(found)
      },
    }
    const shortcut = { label: '단축키', run: pressLoadNewPostsShortcut }
    const bounce = { label: '탭 튕기기', run: bounceTab }
    // 탭 튕기기는 맨 끝이다. 확실히 듣는 수단이지만 옆 타임라인을 통째로 받아
    // 그리게 만들어 가장 비싸다 — 싼 것들이 다 실패했을 때만 쓴다.
    return wanted === 'following' ? [shortcut, tab, nav, bounce] : [nav, tab, shortcut, bounce]
  }

  /**
   * 담당 탭을 잠깐 떠났다 돌아온다.
   *
   * 이미 열려 있는 탭을 다시 눌러봐야 x.com 은 아무 요청도 내지 않는다. 옆 탭에
   * 들렀다 돌아와야 담당 타임라인을 새로 받아온다.
   *
   * 대가가 크다 — 들른 탭의 타임라인을 통째로 받아 그리고, 돌아오며 담당 타임라인도
   * 다시 그린다. 한 번에 전체 렌더가 두세 번이다. 그래서 사다리의 마지막 칸에 둔다.
   */
  function bounceTab(): void {
    const wanted = target()
    // 같은 화면에 실제로 떠 있는 다른 탭을 고른다 — 홈과 알림은 탭 목록이 따로라
    // 이름만 보고 고르면 이 문서에 없는 탭을 집는다.
    const away = TIMELINE_KINDS.filter((kind) => kind !== wanted)
      .map((kind) => findTab(kind))
      .find((tab) => tab !== null)
    // 들를 곳이 없으면(탭이 하나뿐인 화면) 선택자에 기대지 않는 단축키로 물러선다.
    if (!away) {
      pressLoadNewPostsShortcut()
      return
    }

    // tick 이 그 사이에 끼어들어 탭을 되돌리지 않도록 확인 시계를 미뤄둔다.
    lastTabAssertAt = Date.now()
    simulateClick(away)
    window.setTimeout(() => {
      const back = findTab(wanted)
      if (back) simulateClick(back)
    }, TAB_BOUNCE_MS)
  }

  /**
   * 담당이 아닌 탭으로 잠깐 건너간다.
   *
   * 숨은 프레임은 x.com 을 처음부터 띄우느라 첫 타임라인이 한참 뒤에 온다. 그동안
   * 이미 떠 있는 이 문서가 그 탭을 한 번 눌러주면 같은 응답을 훨씬 먼저 받아낼 수 있다.
   * 담당 컬럼의 상태는 건드리지 않는다 — 어디까지나 대타다.
   */
  function prime(kind: TimelineKind): void {
    // 멈춰둔 컬럼은 대신 훑어주지도 않는다. 대타 방문도 결국 탭을 옮기는 일이다.
    // 맡은 것이 없으면 대신 훑어주지도 않는다 — 이 문서는 이미 손을 뗀 상태다.
    if (paused || priming || kinds.length === 0 || kinds.includes(kind) || saving(kind)) return
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
    // 기다리는 사람이 있다. 다음 칸으로 넘어가는 간격을 잠시 짧게 둔다.
    manualUntil = now + MANUAL_WINDOW_MS

    /*
     * 수단은 **하나만** 쓴다.
     *
     * 예전에는 알약·내비 재클릭·탭 튕기기를 0.5 초 안에 전부 발사했다. 통했는지
     * 보지 않으므로 첫 수단이 먹힌 흔한 경우에도 x.com 이 타임라인을 서너 번 다시
     * 그렸고, 그때마다 사진을 다시 받아 CPU 가 100% 를 넘었다. 컬럼 하나만 켠
     * 구성에서도 그랬다 — 숨은 프레임과 무관하게 이 자리가 원인이었다.
     *
     * 통했는지는 응답이 알려준다. 안 왔으면 tick 이 `MANUAL_RETRY_MS` 뒤에 다음
     * 칸을 밟고, 왔으면 `escalation` 이 0 으로 되감기며 거기서 멈춘다.
     */
    const pill = findRefreshPill()
    if (pill) {
      // 알약은 정확히 이 일을 하라고 x.com 이 띄워둔 것이다. 이것보다 나은 수단이 없다.
      simulateClick(pill.element)
      lastPillClickAt = now
      report(
        pill.count === null
          ? '새로고침: 새 게시물 알림 클릭'
          : `새로고침: 새 게시물 알림 ${pill.count}건 클릭`,
      )
      return
    }

    // 알약이 없으면 사다리를 처음부터 밟는다. 누른 사람은 첫 수단부터 다시 시도되길
    // 기대하므로, 오르던 중이었더라도 되감는다.
    escalation = 0
    forceRefresh()
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
    /*
     * 강제 갱신 시계는 **되돌리지 않는다.**
     *
     * 돌아오며 담당 타임라인을 새로 받을 수도 있지만, 그것은 응답이 알려준다.
     * 미리 되감아 두면 대타 방문이 잦은 동안 담당 컬럼의 유휴 시계가 방문 때마다
     * 0 으로 밀려 유휴 간격에 영영 닿지 못한다 — 최상위 문서가 맡은 추천이 20 분이
     * 지나도록 한 칸도 못 오르던 자리다.
     */
  }

  function command(kind: TimelineKind, next: DeckCommand['command']): void {
    if (next === 'ping') {
      // 덱이 뒤늦게 떠서 처음 알린 상태를 놓쳤을 때 물어보는 자리다. 로그인 여부는
      // 그 사이 바뀌었을 수 있으므로 저장해둔 값 대신 지금 다시 본다.
      const state = isLoggedOut() ? 'login-required' : (states.get(kind) ?? 'loading')
      states.set(kind, state)
      emit({ channel: CHANNEL, type: 'status', role: kind, state })
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

    // 삭제는 타임라인이 아니다. 파서에 넘기면 아무 것도 못 건지고 끝나므로 따로 넘긴다.
    if (event.data.operation === DELETE_TWEET_OPERATION) {
      emit({ channel: CHANNEL, type: 'deleted', body: event.data.body })
      return
    }

    const capturedAt = Date.now()

    // operation 이름 → 주소 → 지금 보고 있는 탭 순으로 귀속을 정한다.
    const role =
      roleFromOperation(event.data.operation) ?? roleFromUrl(event.data.url) ?? target()

    // 건질 게 있는지는 파서가 판단한다. 여기서는 무엇이든 넘긴다.
    emit({
      channel: CHANNEL,
      type: 'timeline',
      role,
      operation: event.data.operation,
      body: event.data.body,
    })

    // 여기서부터는 '갱신됐다' 는 판정이다. 목록처럼 생긴 응답만 그 근거로 삼는다.
    //
    // 알림 프레임은 operation 이름을 가릴 수 없어 이 문서의 응답을 전부 받는데,
    // 귀속이 마지막에는 지금 보고 있는 탭으로 떨어진다. 그래서 목록과 무관한 응답
    // (프로필 조회 따위) 까지 자기 컬럼의 수신으로 세게 된다 — 사다리는 매번 맨
    // 아래로 되감기고, 한 건도 못 나른 컬럼이 '수신 중' 으로 보인다. 팔로잉·추천이
    // 멈췄던 것과 같은 종류의 착각이다.
    if (!TIMELINE_MARKER_RE.test(event.data.body)) return

    captures.set(role, capturedAt)

    // 방금 준 것과 같은 목록인지 가린다. 같은 목록이면 두드림이 헛돈 것이다.
    const signature = timelineSignature(event.data.body)
    const renewed = signature === null || signatures.get(role) !== signature
    if (signature !== null) signatures.set(role, signature)

    // 유휴 시계는 **어느 컬럼이든** 자기 것이 새로 왔으면 되감는다. 담당이 아닌
    // 컬럼도 대타 방문이나 교대 수집으로 이 문서를 거쳐 채워지기 때문이다.
    if (renewed) renewals.set(role, capturedAt)

    /*
     * 사다리와 유휴 시계는 **담당 컬럼**의 응답으로만 되돌린다.
     * 다른 컬럼 것으로 되돌리면 헛돈 시도를 성공으로 읽어 같은 칸만 되풀이한다.
     *
     * 대타 방문 중이어도 기준은 담당 컬럼이다. 사다리는 담당 컬럼의 것이고 방문
     * 중에는 오르지도 않는데, 들른 컬럼의 응답으로 되감으면 방문이 있을 때마다
     * 사다리가 첫 칸으로 돌아가 뒷칸에 영영 닿지 못한다.
     */
    if (role === home()) {
      // 응답이 왔다는 것만은 목록이 그대로여도 사실이다. 문서는 살아 있다.
      answered = true
      // 되돌리는 근거는 **새 목록** 하나뿐이다. 같은 목록을 다시 받은 것으로
      // 되감으면 사다리가 첫 칸을 되풀이하며 뒷칸에 영영 닿지 못한다.
      if (renewed) {
        lastForcedRefreshAt = capturedAt
        escalation = 0
        // 새로고침이 통했다. 빠른 재시도 구간을 여기서 닫는다.
        manualUntil = 0
      }
    }

    setState('streaming')
    setPending(role, null)

    // 대타로 노리던 응답을 받았으면 더 머무를 이유가 없다.
    if (priming === role) endPrime()
  }

  function tick(): void {
    /*
     * 맡은 컬럼이 하나도 없으면 아무 것도 하지 않는다.
     *
     * 덱이 이 문서에서 손을 뗀 상태다 (되살리지 못해 프레임에 넘긴 뒤). 그런데도
     * 탭을 누르고 다니면, 새로 맡은 프레임이 받아오는 것과 이 문서가 만들어내는
     * 것이 한 컬럼에서 엉킨다.
     */
    if (kinds.length === 0) return

    const now = Date.now()

    /*
     * 로그인 여부는 **손을 뗀 동안에도** 살핀다.
     *
     * 보는 것은 x.com 을 건드리는 일이 아니고, 사용자가 원본에서 로그아웃하는 것도
     * 대개 손을 뗀 동안이다. 여기서 눈을 감으면 덱으로 돌아온 뒤에야 알아채고,
     * 그 사이 보관된 글이 잠깐 떴다가 로그인 화면으로 밀려나 화면이 튄다.
     */
    const loggedOut = isLoggedOut()
    if (loggedOut !== knownLoggedOut) {
      knownLoggedOut = loggedOut
      rememberLoggedOut(loggedOut)
    }

    if (loggedOut) {
      for (const kind of kinds) setPending(kind, null)
      setState('login-required')
      return
    }

    // 손을 뗀 동안에는 아무 것도 누르지 않는다. 응답이 들어오면 받기는 한다 —
    // 사용자가 직접 넘긴 타임라인도 우리 것으로 쌓인다.
    // 다만 로그인이 돌아온 것은 알린다 — 그러지 않으면 '로그인 필요' 에 갇혀
    // 덱으로 돌아갈 길까지 막힌다.
    if (paused) {
      setState(receiving() ? 'streaming' : 'loading')
      return
    }

    /*
     * 담당 화면이 아니면 그리로 돌아간다.
     *
     * 홈 컬럼은 홈에서, 알림 컬럼은 알림 화면에서만 나온다. 로그인을 마치고 알림
     * 화면에 떨어지는 것처럼 엉뚱한 자리에 서 있으면 탭도 알약도 찾을 수 없어
     * 아무 것도 못 한다. 덱이 얹힌 문서는 우리가 지키는 자리이므로 되돌린다.
     * 사용자가 직접 쓰는 동안(통과 모드)은 위에서 이미 물러난 뒤다.
     */
    if (!isOnPageFor(target())) {
      if (now - lastNavAt > NAV_COOLDOWN_MS) {
        lastNavAt = now
        clickOwnNav()
      }
      setState(receiving() ? 'streaming' : 'loading')
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
    // 멈춰둔 컬럼은 건너뛴다 — 탭을 옮기는 것이 곧 x.com 의 재렌더다.
    if (!priming && kinds.length > 1 && now - lastRotateAt > ROTATE_MS) {
      const next = nextAwakeIndex()
      if (next !== null) {
        activeIndex = next
        lastRotateAt = now
        lastForcedRefreshAt = now
        const nextTab = findTab(target())
        if (nextTab) simulateClick(nextTab)
        return
      }
    }

    /*
     * 여기부터는 어떤 이유로도 되돌아 나가지 않는다.
     *
     * 탭을 못 찾았든, 탭이 안 잡혔든, 아직 한 건도 못 받았든 — 그건 전부 되살릴
     * 손이 필요하다는 뜻이지 손을 뗄 이유가 아니다. 예전에는 이런 자리마다 빠져
     * 나가는 바람에 아래 사다리에 영영 닿지 못했다.
     */
    const wanted = target()
    const tab = findTab(wanted)

    // 같은 오리진의 다른 문서가 탭 선택을 밀어버릴 수 있다. 매 tick 확인해 되돌린다.
    // 유휴 시계는 건드리지 않는다 — 갱신됐다는 근거는 응답이지 클릭이 아니다.
    const selected = tab !== null && isTabSelected(tab)
    if (tab && !selected && now - lastTabAssertAt > TAB_ASSERT_COOLDOWN_MS) {
      simulateClick(tab)
      lastTabAssertAt = now
    }

    // 맡은 컬럼의 응답을 한 번이라도 받았으면 DOM 선택자가 어긋나도 수신 중으로 본다.
    // 거꾸로, 타임라인이 그려져 있다는 것만으로는 근거가 못 된다 — 팔로잉 프레임에도
    // 추천 타임라인이 먼저 그려지므로 그걸 근거로 삼으면 한 건도 못 나른 컬럼이
    // 수신 중으로 보인다. 실제로 그렇게 보였다.
    setState(receiving() ? 'streaming' : 'loading')

    // 알약은 지금 그려져 있는 목록의 것이다. 담당 탭이 아직 안 잡혔으면 남의 것이다.
    /*
     * 알약은 **읽기만 하면 공짜다.**
     *
     * 값이 드는 것은 누르는 쪽이다 — 누르면 x.com 이 응답을 주면서 자기 타임라인도
     * 함께 다시 그린다. 읽는 것은 문구를 보는 일이라 아무 것도 다시 그려지지 않는다.
     * 그래서 절전 중에도 계속 읽어 몇 건이 밀렸는지 머리글에 띄운다.
     */
    const pill = selected ? findRefreshPill() : null
    setPending(wanted, pill?.count ?? null)
    if (pill && settings.autoAdvance && !saving(wanted) && now - lastPillClickAt > PILL_COOLDOWN_MS) {
      simulateClick(pill.element)
      lastPillClickAt = now
      report(pill.count === null ? '새 게시물 알림 클릭' : `새 게시물 알림 ${pill.count}건 클릭`)
    }

    // 알약을 눌렀다고 해서 여기서 멈추지 않는다. 눌러도 응답이 없으면 조용한 것은
    // 마찬가지이고, 그때 멈춰 서면 되살아날 길이 사라진다. 실제로 갱신이 통째로
    // 멎었던 자리다 — 판정은 응답이 들어왔는지 하나로만 한다.
    //
    // 조용한지는 **이 컬럼에 새 목록이 들어온** 시각으로 잰다. 옆 컬럼의 응답은
    // 이 컬럼이 살아 있다는 근거가 못 되고, 같은 목록을 다시 받은 것도 마찬가지다.
    // 방금 두드린 시각을 함께 보는 것이 칸과 칸 사이의 간격을 지키는 장치다 —
    // 그것 없이 새 목록만 보면 조용한 동안 사다리를 매 tick 한 칸씩 태워버린다.
    // 대타 방문 중에는 건너뛴다 — 사다리 끝의 문서 재적재가 방문을 통째로 날린다.
    const idleFor = now - Math.max(renewals.get(wanted) ?? 0, lastForcedRefreshAt)
    // 사다리를 오르는 중이면 유휴 간격을 다시 채울 것 없이 곧바로 다음 칸으로 간다.
    // 문서를 다시 띄우는 마지막 칸만은 예외다 — 최상위 문서에서는 덱까지 함께 다시 뜬다.
    const climbing = escalation > 0 && escalation < LADDER_RUNGS
    /*
     * 사람이 방금 누른 뒤라면 훨씬 짧은 간격으로 다음 칸을 밟는다.
     *
     * 다만 **사다리 안에서만** 서두른다. 마지막 칸을 넘어서면 다음은 문서 재적재라,
     * 그것까지 빠르게 밟으면 새로고침 한 번에 프레임이 통째로 다시 뜬다.
     */
    const hurrying = now < manualUntil && escalation < LADDER_RUNGS
    const wait = hurrying
      ? MANUAL_RETRY_MS
      : climbing
        ? Math.min(settings.idleRefreshMs, ESCALATE_RETRY_MS)
        : settings.idleRefreshMs
    /*
     * 절전 중에는 스스로 두드리지 않는다 — 강제 갱신은 결국 x.com 에게 타임라인을
     * 다시 만들라고 시키는 일이다. 다만 **사람이 방금 누른 것은 끝까지 처리한다.**
     * 절전이 막으려는 것은 저절로 도는 일이지 사용자의 조작이 아니다.
     */
    const mayForce = hurrying || !saving(wanted)
    // 유휴 갱신을 꺼두었어도 사람이 누른 것은 끝까지 처리한다.
    if (!priming && mayForce && (hurrying || settings.idleRefreshMs > 0) && idleFor > wait) {
      forceRefresh()
    }
  }

  window.addEventListener('message', onWindowMessage)
  void loadSettings().then((loaded) => {
    settings = loaded
  })
  const unwatch = watchSettings((next) => {
    const before = settings
    settings = next
    if (paused) return
    /*
     * 절전을 끄는 순간 밀어둔 것을 받아온다. 다음 유휴 갱신까지 기다리면 껐는데도
     * 한참 동안 아무 일이 없어, 멈춘 것과 구별되지 않는다.
     *
     * 어느 컬럼이 깨어났는지까지 봐야 한다 — 전체 스위치와 컬럼별 지정이 따로
     * 놀므로, 깬 것이 지금 보고 있는 탭이 아닐 수 있다. `command` 에 맡기면 그
     * 탭으로 옮기는 것까지 함께 처리된다.
     */
    const woke = kinds.find((kind) => isPowerSaving(before, kind) && !saving(kind))
    if (woke !== undefined) command(woke, 'refresh')
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
      // 빈 목록은 '이 문서는 이제 아무 컬럼도 맡지 않는다' 는 뜻이다. tick 이 그
      // 자리에서 물러난다 — 예전에는 여기서 되돌아 나가 손을 뗀 척만 했다.
      kinds = [...next]
      activeIndex = 0
      // 담당이 바뀌었으니 대타 방문은 의미가 없다. 새 담당 탭으로 돌아온다.
      endPrime()
      lastRotateAt = Date.now()
      // 새 담당의 목록은 아직 한 번도 안 봤다. 남의 지문으로 '같은 목록' 판정을
      // 내리지 않도록 비운다. 유휴 시계도 함께 비워 방금 맡은 컬럼을 남이 받아둔
      // 시각으로 '조용하지 않다' 고 읽지 않게 한다.
      signatures.clear()
      renewals.clear()
      escalation = 0
      answered = false
      // 새로 맡은 컬럼에도 현재 상태를 알려야 하므로 캐시를 비운다.
      states.clear()
      setState(receiving() ? 'streaming' : 'loading')
    },
    dispose() {
      window.clearInterval(timer)
      window.removeEventListener('message', onWindowMessage)
      unwatch()
    },
  }
}
