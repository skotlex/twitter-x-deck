/**
 * MAIN world 인터셉터.
 *
 * x.com 자신이 보내는 타임라인 GraphQL 요청의 **응답만 엿본다**. 요청을 새로 만들지도,
 * 기존 요청을 바꾸지도 않는다 — 화면에 뜨는 것과 우리가 받는 게 항상 같도록 하기 위해서다.
 * 페이지 컨텍스트라 chrome API 를 못 쓰므로 결과는 postMessage 로 브리지에 넘긴다.
 */
import { CHANNEL, type CapturedPayload } from '@core/messages'
import { blocksPlayback, createStopLedger, isDeckMedia } from '@core/playback'
import {
  isDeckHostDocument,
  isDeckPanelFrame,
  isMasked,
  MASK_ATTR,
  OVERLAY_ID,
  readFrameRole,
  whenTrue,
} from '@core/role'
import {
  CREATE_TWEET_OPERATION,
  DELETE_TWEET_OPERATION,
  isNotificationKind,
  TIMELINE_OPERATION,
  type TimelineKind,
} from '@core/types'

const GUARD = '__xDeckInterceptorInstalled'
const OPERATION_RE = /\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]+)/
/** 알림 목록을 실어오는 옛 경로. GraphQL 로 안 올 때가 있어 함께 본다. */
const NOTIFICATION_REST_RE = /\/i\/api\/2\/notifications\//
// 삭제는 어느 문서에서 일어나든 알아야 한다. 우리 목록에 남은 글을 걷어낼 유일한 근거다.
const WATCHED = new Set<string>([...Object.values(TIMELINE_OPERATION), DELETE_TWEET_OPERATION])
/**
 * 이 문서에서는 감시 목록을 따지지 않고 타임라인처럼 생긴 응답을 전부 받는다.
 * 알림 쪽은 operation 이름을 확신할 수 없는데, 그 프레임은 담당 컬럼이 하나뿐이라
 * 무엇이 오든 자기 컬럼으로 귀속시키면 된다. 못 쓸 응답은 파서가 걸러낸다.
 */
let catchAll = false

function operationOf(url: string): string | null {
  return OPERATION_RE.exec(url)?.[1] ?? null
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url ?? ''
}

/**
 * 삭제 요청에서 무엇을 지웠는지 알아낸다.
 *
 * 응답에는 그 정보가 없어 보낸 본문을 쓰는데, 그마저 문자열이 아닐 때가 있다
 * (Request 객체로 감싸 보내거나 XHR 로 나가는 경우). 그럴 때는 지금 이 문서의
 * 주소를 본다 — 글을 지우는 자리는 그 글의 상세 페이지이므로 주소에 id 가 있다.
 */
function deletedBody(sent: string | null): string | null {
  if (sent) return sent
  const id = /\/status\/(\d+)/.exec(window.location.pathname)?.[1]
  return id ? JSON.stringify({ variables: { tweet_id: id } }) : null
}

function emit(operation: string, url: string, body: string): void {
  const payload: CapturedPayload = { channel: CHANNEL, type: 'captured', operation, url, body }
  window.postMessage(payload, window.location.origin)
}

/** 감시 대상이면 operation 이름을, 아니면 null 을 준다. */
function watchedOperation(url: string): string | null {
  const operation = operationOf(url)
  if (operation && WATCHED.has(operation)) return operation
  if (!catchAll) return null
  if (operation) return operation
  return NOTIFICATION_REST_RE.test(url) ? 'NotificationsRest' : null
}

function installFetchHook(): void {
  const original = window.fetch
  window.fetch = function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const promise = original.call(this as never, input, init)
    try {
      const operation = watchedOperation(urlOf(input))
      if (operation) {
        const deleting = operation === DELETE_TWEET_OPERATION
        const sent = deleting ? deletedBody(typeof init?.body === 'string' ? init.body : null) : null

        void promise.then((response) => {
          const url = response.url || urlOf(input)
          if (deleting) {
            // 실제로 지워졌을 때만 알린다. 실패한 요청까지 믿으면 멀쩡한 글이 사라진다.
            if (response.ok && sent) emit(operation, url, sent)
            return
          }
          // 원본 스트림은 손대지 않는다. 복제본만 읽는다.
          response
            .clone()
            .text()
            .then((body) => emit(operation, url, body))
            .catch(() => {})
        })
      }
    } catch {
      // 후킹 실패가 원래 요청을 깨뜨려서는 안 된다.
    }
    return promise
  } as typeof window.fetch
}

function installXhrHook(): void {
  const urls = new WeakMap<XMLHttpRequest, string>()
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    urls.set(this, typeof url === 'string' ? url : url.href)
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
    try {
      const url = urls.get(this) ?? ''
      const operation = watchedOperation(url)
      if (operation) {
        const deleting = operation === DELETE_TWEET_OPERATION
        const sent = deleting ? deletedBody(typeof args[0] === 'string' ? args[0] : null) : null

        this.addEventListener('load', () => {
          if (deleting) {
            if (this.status >= 200 && this.status < 300 && sent) emit(operation, url, sent)
            return
          }
          if (this.responseType !== '' && this.responseType !== 'text') return
          emit(operation, url, this.responseText)
        })
      }
    } catch {
      // 무시하고 원래 동작을 이어간다.
    }
    return (originalSend as (...args: unknown[]) => void).call(this, ...args)
  } as typeof XMLHttpRequest.prototype.send
}

/**
 * 이 문서를 항상 '보이는 상태' 로 위장한다.
 *
 * x.com 은 `document.hidden` 이면 새 게시물 폴링을 멈춘다. 우리 프레임은 투명하게 감춰져
 * 있거나 백그라운드 탭에 있어서 그대로 두면 알림이 영영 뜨지 않는다.
 * 사용자가 보는 x.com 탭에는 적용되지 않는다 (역할이 있는 프레임에서만 돈다).
 */
function spoofVisibility(): void {
  const alwaysVisible = { get: () => 'visible' as DocumentVisibilityState, configurable: true }
  const neverHidden = { get: () => false, configurable: true }

  try {
    Object.defineProperty(Document.prototype, 'visibilityState', alwaysVisible)
    Object.defineProperty(Document.prototype, 'hidden', neverHidden)
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', alwaysVisible)
    Object.defineProperty(Document.prototype, 'webkitHidden', neverHidden)
  } catch {
    // 재정의가 막힌 환경이면 폴링이 느려질 뿐, 강제 갱신 사다리가 대신 받쳐준다.
  }

  document.hasFocus = () => true

  // 이미 걸려 있는 리스너보다 먼저 잡아 이벤트 자체를 없앤다.
  const swallow = (event: Event) => {
    event.stopImmediatePropagation()
  }
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'blur', 'pagehide']) {
    window.addEventListener(type, swallow, true)
    document.addEventListener(type, swallow, true)
  }
}

/**
 * 아무도 보지 않는 영상을 틀지 않는다.
 *
 * `visibility:hidden` 은 그리기를 건너뛰게 하지만 **영상 디코딩은 못 막는다.** 화면에
 * 안 보여도 재생은 계속된다 (백그라운드 탭에서 소리가 계속 나는 것과 같다). 게다가
 * `spoofVisibility` 때문에 x.com 은 자기가 보이는 줄 알고 자동재생에 더 적극적이다.
 * 추천 타임라인은 영상이 많아, 실제로 재던 값의 절반쯤이 여기였다 — x.com 설정에서
 * 자동재생을 끄자 새로고침 CPU 가 80~90% 에서 40~50% 로 떨어졌다.
 *
 * **세우는 것으로는 안 된다.** 처음에는 `play` 이벤트를 잡아 그 자리에서 `pause()`
 * 했다. x.com 플레이어는 정지를 알아채면 곧바로 다시 튼다 — 성능 트레이스에서
 * 우리 리스너 9,037 회 · x.com 의 `onPause` 9,036 회 · `onMediaPlaying` 9,027 회가
 * 1:1 로 맞물려 찍혔다. 초당 170 회, 최고 643 회로 47 초 내내 돌았다. 합성 갱신
 * 한 번이 0.52ms 에서 5.63ms 로 뛰어 그것만으로 코어의 60% 를 태웠다.
 *
 * **삼키는 것만으로도 안 된다.** 다음으로 `play()` 를 삼켜 이행된 프라미스만 돌려줬다.
 * 왕복은 죽었지만 플레이어가 '재생 중' 이라고 믿은 채 눌러앉아, HLS 로더의 틱이
 * 호스트 문서에서만 초당 246 회 돌며 매 프레임 스타일을 더럽혔다. 바뀐 것이 없는
 * 화면에 대해 초당 136 번 합성을 다시 하고 63.8 초 동안 실제로 그린 것은 47 장이었다.
 *
 * 그래서 세우지도 삼키지도 말고 **떼어낸다.** 원본을 떼고 `load()` 로 되돌리면
 * 플레이어는 `emptied` 를 받고 스스로 물러난다 — 트레이스에 x.com 의 `_onMediaEmptied`
 * 가 찍혀 있어, 그 경로를 자기가 갖고 있다는 것은 확인된 사실이다.
 */
function stopUnseenPlayback(role: TimelineKind | null): void {
  const ledger = createStopLedger()

  /** 이 영상은 아무도 안 보는가. 통과 모드는 오갈 수 있어 부를 때마다 다시 본다. */
  const unseen = (media: HTMLMediaElement): boolean =>
    blocksPlayback(role, isMasked()) && !isDeckMedia(media.getRootNode(), OVERLAY_ID)

  /**
   * 원본을 떼어 플레이어가 붙잡을 것을 없앤다.
   *
   * `srcObject` 를 먼저 비우는 것이 핵심이다 — HLS 는 `MediaSource` 를 blob 주소로
   * 물리므로 속성만 지우면 스트림이 그대로 남는다. `load()` 는 진행 중인 것을
   * 중단하고 자원 선택을 다시 돌리는데, 물릴 것이 없으니 빈 상태로 떨어진다.
   *
   * `<source>` 자식은 건드리지 않는다. 그걸 쓰는 영상이라면 `load()` 가 거기서
   * 다시 물어오지만, 지우면 x.com 의 React 가 자기가 만든 자식을 잃고 언마운트에서
   * 터진다. 되살아나는 쪽은 아래 한도가 받아낸다.
   */
  const detach = (media: HTMLMediaElement): void => {
    if (!unseen(media)) return
    if (!ledger.allow(media)) return
    media.autoplay = false
    media.pause()
    media.srcObject = null
    media.removeAttribute('src')
    media.load()
  }

  /*
   * 1) 재생 요청을 받아 그 자리에서 떼어낸다.
   *
   * 이행된 프라미스를 돌려주는 것은 그대로 둔다. 여기서 거절하면 x.com 이 다시
   * 시도하는 경로로 새는데, 그게 처음의 초당 643 회 왕복이었다.
   *
   * 덱 자신의 영상은 여기 닿지 않는다. 확장의 ISOLATED world 는 prototype 을 따로
   * 가지므로 덱이 부르는 `play()` 는 원래 것 그대로다. `isDeckMedia` 는 그래도
   * 남겨 둔다 — 아래 2)·3) 이 같은 판단을 쓰고, 덱이 light DOM 에 영상을 두게 되는
   * 날 조용히 재생이 죽는 것을 막는다.
   */
  try {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function patchedPlay(this: HTMLMediaElement) {
      if (!unseen(this) || ledger.gaveUp(this)) return original.call(this)
      detach(this)
      return Promise.resolve()
    }
  } catch {
    // 재정의가 막힌 환경이면 아래 2) 만으로 버틴다.
  }

  /*
   * 2) 그래도 돌기 시작한 것은 떼어낸다.
   *
   * `autoplay` 속성으로 시작하는 재생은 `play()` 를 거치지 않아 1) 이 못 잡는다.
   *
   * 다만 무한정 떼지는 않는다. 어떤 경로로든 상대가 계속 되살리면 한도에서 손을
   * 뗀다 — 그 영상 하나가 디코딩을 이어가는 값은, 초당 수백 번의 왕복이 만들던
   * 값에 비하면 없는 것이나 같다.
   */
  document.addEventListener('play', (event) => {
    const media = event.target
    if (media instanceof HTMLMediaElement) detach(media)
  }, true)

  /*
   * 3) 덱이 화면을 덮는 순간, 이미 돌고 있던 것을 훑어 떼어낸다.
   *
   * 1)·2) 는 재생이 시작되는 순간을 잡는다. 덱이 뜨기 전에 이미 돌던 영상과,
   * 통과 모드로 비켜서 있는 동안 사용자가 틀어둔 영상은 그 순간을 이미 지났다.
   * 가림막이 걸리는 때가 곧 '아무도 안 보게 되는' 때이므로 거기서 한 번 훑는다.
   *
   * 수집 프레임은 처음부터 끝까지 아무도 안 보므로 가림막이 오갈 일이 없다.
   */
  if (role === null) {
    let covered = isMasked()
    new MutationObserver(() => {
      const now = isMasked()
      if (now === covered) return
      covered = now
      if (!now) return
      for (const media of document.querySelectorAll('video,audio')) {
        if (media instanceof HTMLMediaElement) detach(media)
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: [MASK_ATTR] })
  }
}

function main(): void {
  const role = readFrameRole()
  const panel = isDeckPanelFrame()
  if (role !== null || panel) {
    install(role, panel)
    return
  }

  /*
   * 역할 표시가 없어도 덱이 얹히는 문서라면 거기서 수집이 일어난다. 덱은 그 문서를
   * '추천' 담당으로 세우므로 인터셉터도 같은 기준으로 깨어나야 한다.
   *
   * 지금 당장 아니어도 나중에 그 자리가 될 수 있다 — 로그인 화면에서 시작한 탭은
   * 로그인을 마치면 문서 그대로 홈으로 옮겨간다. 덱도 그때 뜨므로 여기도 함께 깨어난다.
   * 그 전까지는 사용자의 평범한 x.com 을 건드리지 않는다.
   */
  whenTrue(isDeckHostDocument, () => install(null, false))
}

function install(role: TimelineKind | null, panel: boolean): void {
  const globals = window as unknown as Record<string, unknown>
  if (globals[GUARD]) return
  globals[GUARD] = true

  // 작성창 프레임만 수집하지 않는다. 역할이 있는 수집 프레임과 덱이 얹힌 최상위
  // 문서는 둘 다 수집 문서다.
  const collecting = role !== null || !panel
  if (role !== null && isNotificationKind(role)) catchAll = true

  // 작성창은 글이 올라간 순간만 알면 된다. 타임라인을 계속 받을 이유가 없다.
  // 작성창은 물론 상세 창에서도 글이 올라간다 (거기서 답글을 단다).
  if (panel) WATCHED.add(CREATE_TWEET_OPERATION)
  // 사람이 보고 있는 작성창은 숨길 이유가 없으므로 가시성도 손대지 않는다.
  // 영상을 세우는 것도 같은 기준이다 — 창으로 띄운 원본은 보라고 띄운 것이다.
  if (collecting) {
    spoofVisibility()
    stopUnseenPlayback(role)
  }

  installFetchHook()
  installXhrHook()
}

main()
