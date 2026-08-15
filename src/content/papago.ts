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
 * 두 가지 일을 한다. 어느 쪽인지는 이 문서가 프레임인지 탭인지로 갈린다.
 *   - **프레임** — 글 번역. 덱이 띄운 보이지 않는 프레임이고, 결과는 부모로 돌려준다.
 *   - **탭** — 사진 번역. 배경 워커가 열어준 탭이고, 결과는 확장 메시지로 돌려준다.
 *     탭이어야 하는 이유는 네이버 로그인 쿠키가 Papago 가 최상위인 문서에만 실려서다.
 *
 * **덱이 부른 문서에서만 돈다.** 사람이 직접 연 Papago 에는 표시가 없다.
 */
import {
  CHANNEL,
  IMAGE_TRANSLATE_ASK,
  IMAGE_TRANSLATE_DONE,
  isPapagoMessage,
  LOGIN_REQUIRED,
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
/** 이미지 번역 화면의 파일 입력. */
const FILE_INPUT = '[data-testid="file-input"], input#file[type="file"]'
/** 번역된 사진이 나올 때까지 기다리는 한계. OCR 이 도는 시간이다. */
const RESULT_IMAGE_TIMEOUT_MS = 20_000
/** 결과로 셀 만한 최소 크기. 아이콘·장식 그림을 걸러낸다. */
const MIN_RESULT_PX = 80
/** 원본 크기를 모를 때 쓰는 최소 크기. 비율로 거를 수 없으니 더 엄하게 잡는다. */
const LOOSE_MIN_PX = 320
/** 원본과 같은 비율로 볼 여유. 테두리 몇 픽셀 차이는 넘어간다. */
const ASPECT_TOLERANCE = 0.06
/** 원본 대비 이만큼은 돼야 번역본으로 본다. 줄여 보여줄 수는 있어도 손톱만 하지는 않다. */
const MIN_SCALE = 0.4
/** 그림자 DOM·프레임을 몇 겹까지 파고들지. 더 깊으면 결과가 아니라 남의 위젯이다. */
const MAX_SCAN_DEPTH = 4

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
 * 이미지 번역 화면의 파일 입력에 사진을 넣는다.
 *
 * 파일 입력에는 주소를 넣을 수 없다 — 파일 객체여야 한다. 그래서 바이트를 통째로
 * 받아 `DataTransfer` 로 목록을 꾸며 넣은 뒤, 사람이 고른 것과 같은 `change` 를 낸다.
 * 번역된 사진을 돌려준다. 시간을 넘기면 null.
 */
async function handleImage(blob: Blob, name: string, source: Size): Promise<string | null> {
  const input = await waitFor(
    () => document.querySelector<HTMLInputElement>(FILE_INPUT),
    EDITOR_TIMEOUT_MS,
  )
  if (!input) throw new Error('사진을 넣을 자리를 찾지 못했습니다')

  // 넣기 전 화면에 있던 그림을 기억해둔다. 뒤에 새로 생긴 것이 번역 결과다.
  const before = new Set([...document.images].map((image) => image.src))

  const transfer = new DataTransfer()
  transfer.items.add(new File([blob], name, { type: blob.type || 'image/jpeg' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))

  /*
   * 번역문과 로그인 안내 중 **먼저 오는 쪽** 을 답으로 삼는다.
   *
   * 로그인 안내를 몇 초만 지켜보고 넘어가면 안 된다. 그 안내는 사진이 서버에 다녀온
   * 뒤에야 뜨기도 하는데, 그 창을 놓치면 있지도 않을 결과를 끝까지 기다린 다음
   * '번역된 사진을 찾지 못했습니다' 라는 엉뚱한 말로 끝난다. 실제로 그랬다.
   */
  const outcome = await waitFor<{ login: true } | { image: string }>(() => {
    if (isLoginWall()) return { login: true }
    const image = readTranslatedImage(before, source)
    return image ? { image } : null
  }, RESULT_IMAGE_TIMEOUT_MS)

  if (!outcome) {
    // 못 찾았으면 **무엇이 있었는지** 함께 알린다. 이 탭 화면은 밖에서 볼 수 없어,
    // 다음에 어디를 고쳐야 할지는 이 한 줄로만 알 수 있다.
    throw new Error(`번역된 사진을 찾지 못했습니다 — ${describeCandidates(before)}`)
  }
  if ('login' in outcome) throw new Error(LOGIN_REQUIRED)
  return outcome.image
}

/**
 * 결과를 찾을 때 무엇이 후보로 있었는지 한 줄로 적는다. 진단용이다.
 * 큰 것만 적는다 — 아이콘·추적 픽셀까지 늘어놓으면 정작 볼 것이 묻힌다.
 */
function describeCandidates(before: Set<string>): string {
  const { canvases, images, backgrounds } = collectCandidates()

  const big = (width: number, height: number): boolean =>
    width >= MIN_RESULT_PX && height >= MIN_RESULT_PX

  const parts = [
    describeSizes(
      '캔버스',
      canvases.filter((canvas) => big(canvas.width, canvas.height)).map((canvas) => `${canvas.width}x${canvas.height}`),
    ),
    describeSizes(
      '새 그림',
      images
        .filter((image) => !before.has(image.src) && big(image.naturalWidth, image.naturalHeight))
        .map((image) => `${image.naturalWidth}x${image.naturalHeight}`),
    ),
    describeSizes(
      '배경',
      backgrounds.map((item) => `${Math.round(item.width)}x${Math.round(item.height)}`),
    ),
    `프레임 ${document.querySelectorAll('iframe').length}`,
    describeLoginHint(),
  ]
  return parts.join(' · ')
}

/**
 * 화면에 '로그인' 이라는 말이 어떤 모양으로 있는지 한 조각 떠온다.
 *
 * 로그인 안내를 못 알아보고 있는지, 안내 자체가 없는지를 가르는 데 쓴다.
 * 둘은 고칠 곳이 전혀 다르다 — 앞은 문구 판별, 뒤는 사진이 아예 안 올라간 것이다.
 */
function describeLoginHint(): string {
  const text = (document.body?.textContent ?? '').replace(/\s+/g, ' ')
  const at = text.search(/로그인|login/i)
  if (at < 0) return `로그인 문구 없음 (${window.location.pathname})`
  return `문구 "${text.slice(Math.max(0, at - 15), at + 35)}"`
}

function describeSizes(label: string, sizes: string[]): string {
  return sizes.length ? `${label} ${sizes.slice(0, 5).join(' ')}` : `${label} 없음`
}

/** '로그인이 필요한 기능입니다' 안내의 문구. */
const LOGIN_WALL_RE = /로그인이?\s*필요|login\s*(is\s*)?required/i

/**
 * 로그인 안내가 **눈에 보이게** 떠 있는지.
 *
 * 문구가 문서에 있다는 것만으로는 어림도 없다. 화면에 안 뜬 안내문이 미리 심어져 있기도
 * 하고, 어느 조상 요소의 글자를 훑으면 그 안의 숨은 문구까지 딸려 온다. 실제로 로그인을
 * 마친 뒤에도 로그인하라는 말이 계속 나왔다.
 *
 * 그래서 두 가지를 함께 본다 — 그 요소가 **직접 들고 있는 글자** 가 문구와 맞을 것,
 * 그리고 그 요소가 자리를 차지하고 있을 것. 안내 문구는 늘 문단이나 제목 하나에
 * 통째로 들어 있으므로 이 조건으로 충분하다.
 */
function isLoginWall(): boolean {
  // 0.15초마다 도는 자리다. 문서 전체 글자를 한 번 훑어 값싸게 거른 뒤,
  // 걸렸을 때만 요소를 하나씩 들여다본다.
  if (!LOGIN_WALL_RE.test(document.body?.textContent ?? '')) return false

  for (const element of document.querySelectorAll<HTMLElement>('p, span, strong, h1, h2, h3, div')) {
    if (!LOGIN_WALL_RE.test(ownText(element))) continue
    const box = element.getBoundingClientRect()
    if (box.width > 0 && box.height > 0) return true
  }
  return false
}

/** 그 요소가 직접 들고 있는 글자. 자식 요소 안의 글자는 세지 않는다. */
function ownText(element: HTMLElement): string {
  let text = ''
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  }
  return text
}

/**
 * 번역된 사진을 data URL 로 꺼낸다. 아직 안 나왔으면 null.
 *
 * Papago 가 결과를 캔버스로 그리는지 이미지로 그리는지는 확인하지 못했다. 그래서 둘 다
 * 본다 — 여기는 Papago 자신의 문서라 어느 쪽이든 같은 출처로 읽힌다.
 *
 * 이미지도 **캔버스에 옮겨 그려서** 바이트를 얻는다. 주소를 그대로 넘기면 그 주소는
 * 이 탭에서만 살아 있어 덱에서는 못 연다. `fetch` 로 받아오는 길은 이 탭에 살아 있는
 * Papago CSP 에 막힐 수 있어 쓰지 않는다.
 *
 * 이미지 쪽은 넣기 전에 없던 것 중 마지막에 나타난 것을 고른다. 올린 원본도 새로
 * 생기지만 번역본이 그보다 뒤에 붙는다.
 */
function readTranslatedImage(before: Set<string>, source: Size): string | null {
  // 여기는 0.15초마다 도는 자리다. 문서 전체를 훑는 무거운 검사는 두지 않는다 —
  // 그런 검사는 실패했을 때 진단 한 번에만 쓴다(`describeCandidates`).
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!looksLikeTranslation(canvas.width, canvas.height, source)) continue
    const drawn = readCanvas(canvas)
    if (drawn) return drawn
  }

  const fresh = [...document.images].filter(
    (image) =>
      !before.has(image.src) &&
      image.complete &&
      looksLikeTranslation(image.naturalWidth, image.naturalHeight, source),
  )
  const found = fresh.at(-1)
  return found ? drawToDataUrl(found, found.naturalWidth, found.naturalHeight) : null
}

export interface Size {
  width: number
  height: number
}

/**
 * 이 그림이 **우리가 올린 사진의 번역본** 으로 볼 만한지.
 *
 * '새로 생긴 큰 그림' 만으로는 어림도 없다. 그 화면에는 행사 배지·배너 같은 남의 그림도
 * 함께 뜨고, 로그인이 없어 번역이 아예 안 돌았을 때는 그것들만 남는다. 실제로 10주년
 * 배지가 번역 결과랍시고 덱에 실렸다.
 *
 * 번역본은 원본 위에 글자만 얹은 것이라 **가로세로 비율이 원본과 같다.** 크기도 원본과
 * 비슷해야 한다 — 줄여 보여줄 수는 있어도 손톱만 해지지는 않는다. 원본 크기를 모르면
 * 비율로 거를 수 없으니 넉넉한 크기 기준만 쓴다.
 */
function looksLikeTranslation(width: number, height: number, source: Size): boolean {
  if (width < MIN_RESULT_PX || height < MIN_RESULT_PX) return false
  if (source.width <= 0 || source.height <= 0) {
    return width >= LOOSE_MIN_PX && height >= LOOSE_MIN_PX
  }

  const wanted = source.width / source.height
  if (Math.abs(width / height - wanted) / wanted > ASPECT_TOLERANCE) return false
  return width >= source.width * MIN_SCALE
}

/** 그림 하나를 캔버스에 옮겨 그려 data URL 로 만든다. */
function drawToDataUrl(source: CanvasImageSource, width: number, height: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(source, 0, 0)
  return readCanvas(canvas)
}

interface Candidates {
  canvases: HTMLCanvasElement[]
  images: HTMLImageElement[]
  backgrounds: Array<{ url: string; width: number; height: number }>
}

/**
 * 결과가 있을 만한 자리를 모두 훑는다. **실패했을 때 진단용으로만** 부른다.
 *
 * 문서 전체를 돌며 모든 요소의 계산된 스타일까지 읽으므로 되풀이해 부를 것이 못 된다.
 * 평소 결과 찾기가 보는 곳(`document.images`·캔버스) 밖에 무엇이 있었는지를 한 번
 * 훑어, 다음에 어디를 봐야 할지 알려주는 것이 이 함수의 쓸모다.
 */
function collectCandidates(): Candidates {
  const found: Candidates = { canvases: [], images: [], backgrounds: [] }

  const walk = (root: Document | ShadowRoot, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return
    found.canvases.push(...root.querySelectorAll('canvas'))
    found.images.push(...root.querySelectorAll('img'))

    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot) walk(element.shadowRoot, depth + 1)

      const box = element.getBoundingClientRect()
      if (box.width < MIN_RESULT_PX || box.height < MIN_RESULT_PX) continue
      const url = /url\(["']?(.+?)["']?\)/.exec(getComputedStyle(element).backgroundImage)?.[1]
      if (url && !url.startsWith('data:image/svg')) {
        found.backgrounds.push({ url, width: box.width, height: box.height })
      }
    }

    for (const frame of root.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument
        if (doc) walk(doc, depth + 1)
      } catch {
        // 다른 출처의 프레임. 읽을 수 없고, 읽을 이유도 없다.
      }
    }
  }

  walk(document, 0)
  return found
}

/** 캔버스를 data URL 로. 다른 출처가 섞여 오염됐으면 null. */
function readCanvas(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

async function handle(text: string): Promise<void> {
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
  if (!arrived) typeInto(box, text)

  const result = await waitForResult()
  if (result.length === 0) {
    fail('번역문이 뜨지 않았습니다')
    return
  }
  post({ channel: CHANNEL, type: 'papago-result', id: id ?? '', text: result })
}

/**
 * 사진 번역은 이 문서가 **최상위 탭** 일 때만 한다. 배경 워커가 그렇게 열어준다 —
 * 네이버 로그인 쿠키는 Papago 가 최상위인 문서에만 실리기 때문이다.
 *
 * 덱과는 사이트가 달라 직접 말할 수 없으므로 확장 메시지로 배경 워커를 거친다.
 */
async function runImageJob(jobId: string): Promise<void> {
  try {
    const asked = (await chrome.runtime.sendMessage({
      type: IMAGE_TRANSLATE_ASK,
      id: jobId,
    })) as { dataUrl: string; width: number; height: number } | null
    if (!asked) return

    const dataUrl = await handleImage(decodeDataUrl(asked.dataUrl), 'image.jpg', {
      width: asked.width,
      height: asked.height,
    })
    if (!dataUrl) throw new Error('번역된 사진을 찾지 못했습니다')
    await chrome.runtime.sendMessage({ type: IMAGE_TRANSLATE_DONE, id: jobId, dataUrl })
  } catch (cause) {
    await chrome.runtime.sendMessage({
      type: IMAGE_TRANSLATE_DONE,
      id: jobId,
      reason: cause instanceof Error ? cause.message : '사진 번역에 실패했습니다',
    })
  }
}

/**
 * data URL 을 그림 조각으로 되돌린다.
 *
 * `fetch` 로 읽지 않는다. 이 탭은 Papago 가 최상위라 그쪽 CSP 가 그대로 살아 있는데,
 * `data:` 는 보통 `connect-src` 에 없어 요청이 막히고 'Failed to fetch' 로 끝난다.
 * 직접 풀면 네트워크를 아예 쓰지 않으므로 걸릴 곳이 없다.
 */
function decodeDataUrl(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg' })
}

if (id) {
  if (window.parent !== window.self) {
    // 글 번역. 덱이 띄운 보이지 않는 프레임이다.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== X_ORIGIN || !isPapagoMessage(event.data)) return
      if (event.data.type !== 'papago-ask' || event.data.id !== id) return
      void handle(event.data.text)
    })
    post({ channel: CHANNEL, type: 'papago-ready', id })
  } else {
    void runImageJob(id)
  }
}
