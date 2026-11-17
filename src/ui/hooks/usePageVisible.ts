/**
 * 덱이 든 탭이 지금 실제로 보이는지.
 *
 * `visibilitychange` 는 쓸 수 없다. 덱이 얹힌 문서에서는 인터셉터가 x.com 의 새 글
 * 폴링을 살려 두려고 그 이벤트와 `blur` 를 맨 앞에서 삼킨다 — 덱의 리스너에도 닿지 않는다.
 * 값 자체는 덱(ISOLATED world)에서 읽으면 위장되지 않은 진짜다. 그래서 주기적으로 읽고,
 * 탭으로 돌아오는 순간은 `focus`(삼키지 않는다)로 곧바로 알아챈다.
 *
 * 구독자가 있을 때만 돈다. 여러 영상이 물어도 타이머는 하나다.
 */
import { useSyncExternalStore } from 'react'

/** 가려졌는지 다시 읽는 주기. 뒤에 있는 탭의 타이머는 어차피 1초보다 촘촘히 돌지 않는다. */
const POLL_MS = 1000

const listeners = new Set<() => void>()
let visible = readVisible()
let timer = 0

function readVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function refresh(): void {
  const next = readVisible()
  if (next === visible) return
  visible = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    visible = readVisible()
    timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    window.clearInterval(timer)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('pageshow', refresh)
  }
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visible, () => true)
}
