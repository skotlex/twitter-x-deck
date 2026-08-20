/**
 * Papago 문서 안에서 도는 스크립트.
 *
 * 덱은 x.com 에, Papago 는 naver.com 에 있어 서로의 DOM 을 읽을 수 없다. 그래서
 * 결과를 여기서 읽어 메시지로 돌려준다. 무엇을 번역할지, 실패하면 어디로 물러설지는
 * 전부 부모(`translate.ts`)가 정한다.
 *
 * 번역할 글월은 주소(`st`)에 실려 온다 — Papago 가 공유 링크로 쓰는 방식이라 우리가
 * 입력란을 건드릴 일이 없다. 주소에 담기엔 너무 긴 글만 여기서 직접 넣는다.
 *
 * **덱이 띄운 프레임에서만 돈다.** 사람이 직접 연 Papago 탭에는 표시가 없다.
 */
import {
  CHANNEL,
  isPapagoMessage,
  PAPAGO_PARAM,
  X_ORIGIN,
  type PapagoMessage,
} from '@core/messages'

/** 입력·출력 칸이 그려질 때까지 기다리는 한계. */
const EDITOR_TIMEOUT_MS = 8_000
/** 주소로 보낸 글월이 저절로 들어오기를 기다리는 한계. 이 안에 안 오면 직접 넣는다. */
const PREFILL_TIMEOUT_MS = 3_000
/** 번역문이 다 뜰 때까지 기다리는 한계. */
const RESULT_TIMEOUT_MS = 12_000
/** 번역문이 더 자라지 않는지 확인하는 시간. Papago 는 글자를 조금씩 채운다. */
const SETTLE_MS = 600
const POLL_MS = 150

/**
 * 표시는 스크립트가 뜨자마자 읽는다.
 * Papago 는 자기 SPA 를 띄우면서 주소를 다시 쓰는데, 그때 우리 표시가 지워진다.
 */
const id = new URLSearchParams(window.location.search).get(PAPAGO_PARAM)

/** 입력·출력 칸. 둘 다 textarea 가 아니라 편집 가능한 div 다. */
const SOURCE = '[data-testid="source-editor"], #source-editor'
const TARGET = '[data-testid="target-editor"], #target-editor'

/** 글 번역은 덱이 띄운 프레임에서 하므로 답할 곳은 늘 부모다. */
function post(message: PapagoMessage): void {
  window.parent.postMessage(message, X_ORIGIN)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function read(selector: string): string {
  const box = document.querySelector<HTMLElement>(selector)
  return (box?.innerText ?? box?.textContent ?? '').trim()
}

/**
 * 번역문을 줄바꿈까지 살려 읽는다.
 *
 * `innerText` 로 그냥 읽으면 줄마다 빈 줄이 하나씩 더 낀다. 편집기가 줄을 문단
 * 요소로 그리는데, `innerText` 는 문단 사이의 **여백까지 줄바꿈으로 옮기기** 때문이다.
 * 그래서 줄 요소를 직접 모아 한 줄씩 잇는다.
 *
 * 줄이 한 겹 더 안쪽에 들어 있어 줄 요소가 안 잡히는 판을 위해 `innerText` 로도
 * 물러선다. 그때는 겹친 빈 줄을 하나로 줄인다 — 원문에 있던 빈 줄까지 함께 줄지만,
 * 줄마다 빈 줄이 끼는 것보다는 낫다.
 */
function readResult(): string {
  const box = document.querySelector<HTMLElement>(TARGET)
  if (!box) return ''

  const lines = [...box.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  if (lines.length > 1) {
    return lines
      .map((line) => (line.innerText ?? line.textContent ?? '').trim())
      .join('\n')
      .trim()
  }

  return (box.innerText ?? box.textContent ?? '').replace(/\n[ \t]*\n/g, '\n').trim()
}

/** 조건이 참이 될 때까지 기다린다. 시간을 넘기면 null. */
async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(POLL_MS)
  }
}

/**
 * 편집 가능한 div 에 글월을 넣는다.
 *
 * 값을 직접 써넣지 않고 브라우저의 편집 파이프라인을 태운다. 요즘 편집기는 제 모델을
 * 따로 들고 있어서, DOM 만 고치면 다시 그릴 때 통째로 지워버린다. `insertText` 는
 * 사람이 붙여넣은 것과 같은 이벤트를 내보내므로 그 모델까지 함께 갱신된다.
 */
function typeInto(box: HTMLElement, text: string): void {
  box.focus()

  const range = document.createRange()
  range.selectNodeContents(box)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  if (document.execCommand('insertText', false, text)) return

  box.textContent = text
  box.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
  )
}

/**
 * 번역문이 다 채워질 때까지 기다린다.
 *
 * 글자가 조금씩 차오르므로 '비어 있지 않다' 만으로는 이르다. 값이 한동안 그대로일 때
 * 비로소 끝난 것으로 본다. 원문이 그대로 돌아오는 것도 답이다 — 같은 언어였을 뿐이다.
 */
async function waitForResult(): Promise<string> {
  const deadline = Date.now() + RESULT_TIMEOUT_MS
  let last = ''
  let stableSince = 0

  for (;;) {
    const now = readResult()
    if (now.length > 0 && now === last) {
      if (stableSince === 0) stableSince = Date.now()
      if (Date.now() - stableSince >= SETTLE_MS) return now
    } else {
      stableSince = 0
    }
    last = now
    if (Date.now() > deadline) return now
    await sleep(POLL_MS)
  }
}

/**
 * 이 프레임에서 도착 언어 때문에 이미 한 번 다시 띄웠는지.
 *
 * 표시를 주소에 두면 안 된다 — Papago 가 주소를 다시 쓸 때 함께 지워져 되풀이한다.
 * 저장소가 막힌 프레임에서는 '이미 했다' 고 답한다. 되풀이하는 쪽이 더 위험하다.
 */
function alreadyRetargeted(): boolean {
  try {
    const key = `xdeck-retarget:${id ?? ''}`
    if (window.sessionStorage.getItem(key)) return true
    window.sessionStorage.setItem(key, '1')
    return false
  } catch {
    return true
  }
}

/**
 * Papago 가 도착 언어를 제 것으로 바꿔놓았으면 주소를 다시 잡아 띄운다.
 *
 * Papago 는 자기 SPA 를 띄우면서 주소를 제 상태로 다시 쓴다. 그 상태가 우리가 실어
 * 보낸 `tk` 를 덮으면, 한국어를 부탁했는데 영어 번역문이 돌아온다. 주소가 부탁과
 * 어긋날 때만, 그것도 한 번만 다시 띄운다. 우리 표시는 그 재작성에 지워지므로
 * 직접 다시 넣는다.
 *
 * @returns 다시 띄웠으면 true — 이 문서는 곧 사라지므로 부르는 쪽은 손을 뗀다.
 */
function retarget(target: string): boolean {
  const params = new URLSearchParams(window.location.search)
  const now = params.get('tk')
  if (!now || now === target || target.length === 0) return false
  if (alreadyRetargeted()) return false

  params.set('sk', 'auto')
  params.set('tk', target)
  params.set(PAPAGO_PARAM, id ?? '')
  window.location.replace(`${window.location.pathname}?${params.toString()}`)
  return true
}

async function handle(text: string, target: string): Promise<void> {
  const fail = (reason: string): void => {
    post({ channel: CHANNEL, type: 'papago-failed', id: id ?? '', reason })
  }

  const box = await waitFor(() => document.querySelector<HTMLElement>(SOURCE), EDITOR_TIMEOUT_MS)
  if (!box) {
    fail('입력란을 찾지 못했습니다')
    return
  }

  // 주소로 보낸 글월이 들어오기를 먼저 기다린다. 그 사이에 우리가 끼어들면 앱이
  // 채우는 글월과 겹쳐 같은 문장이 두 번 들어간다.
  const arrived = await waitFor(
    () => (read(SOURCE).length > 0 || read(TARGET).length > 0 ? true : null),
    PREFILL_TIMEOUT_MS,
  )

  // 여기까지 오면 SPA 가 주소를 다 고쳐 쓴 뒤다. 도착 언어를 이때 확인한다.
  if (retarget(target)) return

  if (!arrived) typeInto(box, text)

  const result = await waitForResult()
  if (result.length === 0) {
    fail('번역문이 뜨지 않았습니다')
    return
  }
  post({ channel: CHANNEL, type: 'papago-result', id: id ?? '', text: result })
}

if (id && window.parent !== window.self) {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== X_ORIGIN || !isPapagoMessage(event.data)) return
    if (event.data.type !== 'papago-ask' || event.data.id !== id) return
    void handle(event.data.text, event.data.target)
  })

  post({ channel: CHANNEL, type: 'papago-ready', id })
}
