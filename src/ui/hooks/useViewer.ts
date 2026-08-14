import { useEffect, useState } from 'react'
import { findViewer, type ViewerInfo } from '../../content/selectors'

/** 사이드바가 그려질 때까지 다시 물어보는 간격. */
const POLL_MS = 1_000
/** 이 시간까지 못 찾으면 포기한다. 로그인 화면이거나 구조가 바뀐 것이다. */
const GIVE_UP_MS = 30_000

/**
 * 지금 로그인한 계정.
 *
 * 덱은 x.com 문서 위에 얹혀 있으므로 그 문서의 사이드바를 그대로 읽으면 된다.
 * 다만 우리가 먼저 뜨는 경우가 있어 한 번에 못 찾는다 — 찾을 때까지 잠깐씩 다시 본다.
 */
export function useViewer(): ViewerInfo | null {
  const [viewer, setViewer] = useState<ViewerInfo | null>(() => findViewer())

  useEffect(() => {
    if (viewer) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const found = findViewer()
      if (found) setViewer(found)
      if (found || Date.now() - startedAt > GIVE_UP_MS) window.clearInterval(timer)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [viewer])

  return viewer
}
