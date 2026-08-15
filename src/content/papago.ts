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
/** 사진을 넣은 뒤 로그인 안내가 뜨는지 지켜보는 시간. */
const LOGIN_WALL_MS = 4_000
/** 번역된 사진이 나올 때까지 기다리는 한계. OCR 이 도는 시간이다. */
const RESULT_IMAGE_TIMEOUT_MS = 20_000
/** 결과로 셀 만한 최소 크기. 아이콘·장식 그림을 걸러낸다. */
const MIN_RESULT_PX = 80

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
async function handleImage(blob: Blob, name: string): Promise<string | null> {
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

  // 로그인 벽이 먼저 뜨는지부터 본다. 사진을 넣는 데까지는 성공했으므로 사용자에게는
  // '안 된다' 가 아니라 '로그인이 필요하다' 로 보여야 다음에 무엇을 할지 알 수 있다.
  const wall = await waitFor(() => (isLoginWall() ? true : null), LOGIN_WALL_MS)
  if (wall) throw new Error(LOGIN_REQUIRED)

  const found = await waitFor(() => readTranslatedImage(before), RESULT_IMAGE_TIMEOUT_MS)
  // 못 찾았으면 **무엇이 있었는지** 함께 알린다. 이 탭 화면은 밖에서 볼 수 없어,
  // 다음에 어디를 고쳐야 할지는 이 한 줄로만 알 수 있다.
  if (!found) throw new Error(`번역된 사진을 찾지 못했습니다 — ${describeCandidates(before)}`)
  return found
}

/** 결과를 찾을 때 무엇이 후보로 있었는지 한 줄로 적는다. 진단용이다. */
function describeCandidates(before: Set<string>): string {
  const canvases = [...document.querySelectorAll('canvas')].map(
    (canvas) => `${canvas.width}x${canvas.height}`,
  )
  const fresh = [...document.images]
    .filter((image) => !before.has(image.src))
    .map((image) => `${image.naturalWidth}x${image.naturalHeight}${image.complete ? '' : '(로딩중)'}`)

  const canvasPart = canvases.length ? `캔버스 ${canvases.slice(0, 4).join(' ')}` : '캔버스 없음'
  const imagePart = fresh.length ? `새 이미지 ${fresh.slice(0, 6).join(' ')}` : '새 이미지 없음'
  return `${canvasPart} · ${imagePart}`
}

/**
 * '로그인이 필요한 기능입니다' 안내가 떠 있는지.
 * 화면 구석의 '로그인' 버튼은 늘 있으므로, 필요하다고 **말하는** 문구만 센다.
 */
function isLoginWall(): boolean {
  return /로그인이?\s*필요|login\s*(is\s*)?required/i.test(document.body?.innerText ?? '')
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
function readTranslatedImage(before: Set<string>): string | null {
  for (const canvas of document.querySelectorAll('canvas')) {
    if (canvas.width < MIN_RESULT_PX || canvas.height < MIN_RESULT_PX) continue
    const drawn = readCanvas(canvas)
    if (drawn) return drawn
  }

  const fresh = [...document.images].filter(
    (image) =>
      !before.has(image.src) &&
      image.complete &&
      image.naturalWidth >= MIN_RESULT_PX &&
      image.naturalHeight >= MIN_RESULT_PX,
  )
  const found = fresh.at(-1)
  if (!found) return null

  const canvas = document.createElement('canvas')
  canvas.width = found.naturalWidth
  canvas.height = found.naturalHeight
  canvas.getContext('2d')?.drawImage(found, 0, 0)
  return readCanvas(canvas)
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
    })) as { dataUrl: string } | null
    if (!asked) return

    const dataUrl = await handleImage(decodeDataUrl(asked.dataUrl), 'image.jpg')
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
