/**
 * 백그라운드 서비스 워커.
 *
 * 하는 일은 둘뿐이다 — 덱 탭 열기, 그리고 폴백 탭 모드의 탭 수명 관리.
 * content script 가 `chrome.runtime.sendMessage` 로 보낸 메시지는 확장 페이지인
 * 덱이 직접 받으므로 별도 중계는 하지 않는다.
 */
import { ROLE_PARAM } from '@core/messages'
import type { TimelineKind } from '@core/types'

const DECK_PATH = 'deck.html'

/** 폴백 탭 모드에서 만든 탭. 컬럼별로 하나씩만 유지한다. */
const fallbackTabs = new Map<TimelineKind, number>()

interface BackgroundRequest {
  channel: 'xdeck/v1'
  type: 'background'
  action: 'open-fallback-tab' | 'close-fallback-tab' | 'relay-command'
  role: TimelineKind
  /** relay-command 일 때만 쓴다. */
  command?: string
}

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BackgroundRequest).channel === 'xdeck/v1' &&
    (value as BackgroundRequest).type === 'background'
  )
}

async function openDeck(): Promise<void> {
  const url = chrome.runtime.getURL(DECK_PATH)
  const [existing] = await chrome.tabs.query({ url })
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url })
}

async function openFallbackTab(role: TimelineKind): Promise<number | null> {
  const existing = fallbackTabs.get(role)
  if (existing !== undefined) {
    const tab = await chrome.tabs.get(existing).catch(() => null)
    if (tab) return tab.id ?? null
    fallbackTabs.delete(role)
  }
  const tab = await chrome.tabs.create({
    url: `https://x.com/home?${ROLE_PARAM}=${role}`,
    active: false,
    pinned: true,
  })
  if (tab.id !== undefined) fallbackTabs.set(role, tab.id)
  return tab.id ?? null
}

async function closeFallbackTab(role: TimelineKind): Promise<void> {
  const id = fallbackTabs.get(role)
  if (id === undefined) return
  fallbackTabs.delete(role)
  await chrome.tabs.remove(id).catch(() => {})
}

chrome.action.onClicked.addListener(() => {
  void openDeck()
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openDeck()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [role, id] of fallbackTabs) {
    if (id === tabId) fallbackTabs.delete(role)
  }
})

/** 폴백 탭 모드에서 덱의 명령을 해당 탭의 content script 로 넘긴다. */
async function relayCommand(role: TimelineKind, command: string): Promise<void> {
  const tabId = fallbackTabs.get(role)
  if (tabId === undefined) return
  await chrome.tabs
    .sendMessage(tabId, { channel: 'xdeck/v1', type: 'command', command })
    .catch(() => {})
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBackgroundRequest(message)) return undefined

  let task: Promise<{ tabId: number | null }>
  switch (message.action) {
    case 'open-fallback-tab':
      task = openFallbackTab(message.role).then((tabId) => ({ tabId }))
      break
    case 'relay-command':
      task = relayCommand(message.role, message.command ?? 'refresh').then(() => ({ tabId: null }))
      break
    default:
      task = closeFallbackTab(message.role).then(() => ({ tabId: null }))
  }

  void task.then(sendResponse)
  return true // 비동기 응답을 쓰겠다는 신호
})
