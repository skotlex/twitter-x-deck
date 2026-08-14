/**
 * MAIN world 인터셉터.
 *
 * x.com 자신이 보내는 타임라인 GraphQL 요청의 **응답만 엿본다**. 요청을 새로 만들지도,
 * 기존 요청을 바꾸지도 않는다 — 화면에 뜨는 것과 우리가 받는 게 항상 같도록 하기 위해서다.
 * 페이지 컨텍스트라 chrome API 를 못 쓰므로 결과는 postMessage 로 브리지에 넘긴다.
 */
import { CHANNEL, type CapturedPayload } from '@core/messages'
import { readFrameRole } from '@core/role'
import { TIMELINE_OPERATION } from '@core/types'

const GUARD = '__xDeckInterceptorInstalled'
const OPERATION_RE = /\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]+)/
const WATCHED = new Set<string>(Object.values(TIMELINE_OPERATION))

function operationOf(url: string): string | null {
  return OPERATION_RE.exec(url)?.[1] ?? null
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url ?? ''
}

function emit(operation: string, url: string, body: string): void {
  const payload: CapturedPayload = { channel: CHANNEL, type: 'captured', operation, url, body }
  window.postMessage(payload, window.location.origin)
}

/** 감시 대상 operation 이면 operation 이름을, 아니면 null 을 준다. */
function watchedOperation(url: string): string | null {
  const operation = operationOf(url)
  return operation && WATCHED.has(operation) ? operation : null
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
        void promise.then((response) => {
          const url = response.url || urlOf(input)
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
        this.addEventListener('load', () => {
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

function main(): void {
  const globals = window as unknown as Record<string, unknown>
  if (globals[GUARD]) return
  // 덱이 띄운 프레임/탭이 아니면 사용자의 x.com 을 건드리지 않는다.
  if (!readFrameRole()) return
  globals[GUARD] = true

  spoofVisibility()
  installFetchHook()
  installXhrHook()
}

main()
