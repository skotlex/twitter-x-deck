import { useEffect, useState } from 'react'
import { findViewer, type ViewerInfo } from '../../content/selectors'
import { rememberViewer, rememberedViewer } from '@core/session'

/** 사이드바가 그려질 때까지 다시 물어보는 간격. */
const POLL_MS = 1_000
/** 이 시간까지 못 찾으면 포기한다. 로그인 화면이거나 구조가 바뀐 것이다. */
const GIVE_UP_MS = 30_000

/**
 * 더 물어볼 것이 남았는지.
 *
 * 핸들만 읽힌 상태에서 멈추면 상단 바에 사진 대신 머리글자만 남는다 —
 * 사진까지 들어와야 다 읽은 것이다.
 */
export function isViewerComplete(viewer: ViewerInfo | null): boolean {
  return Boolean(viewer?.handle && viewer.avatarUrl)
}

/**
 * 이번에 읽은 값의 빈 사진을 지난번 사진으로 메운다.
 * **같은 계정일 때만** — 계정을 바꿨으면 남의 사진을 띄우게 된다.
 */
export function fillAvatar(found: ViewerInfo, remembered: ViewerInfo | null): ViewerInfo {
  if (found.avatarUrl) return found
  if (!remembered?.avatarUrl || remembered.handle !== found.handle) return found
  return { ...found, avatarUrl: remembered.avatarUrl }
}

function sameViewer(a: ViewerInfo | null, b: ViewerInfo | null): boolean {
  return a?.handle === b?.handle && a?.name === b?.name && a?.avatarUrl === b?.avatarUrl
}

/** 화면에서 읽고, 사진이 아직이면 지난번 것으로 메운 값. */
function readViewer(): ViewerInfo | null {
  const found = findViewer()
  return found ? fillAvatar(found, rememberedViewer()) : null
}

/**
 * 지금 로그인한 계정.
 *
 * 덱은 x.com 문서 위에 얹혀 있으므로 그 문서의 사이드바를 그대로 읽으면 된다.
 * 다만 우리가 먼저 뜨는 경우가 있어 한 번에 못 찾는다 — 찾을 때까지 잠깐씩 다시 본다.
 *
 * **핸들을 찾았다고 멈추지 않는다.** 프로필 사진은 핸들보다 늦게 붙어서, 처음 읽힌
 * 값으로 만족하면 사진이 나중에 붙어도 영영 안 가져온다 — 간헐적으로 머리글자만
 * 남던 이유다. 사진까지 들어오거나 포기 시간이 될 때까지 계속 물어본다.
 */
export function useViewer(): ViewerInfo | null {
  const [viewer, setViewer] = useState<ViewerInfo | null>(readViewer)

  useEffect(() => {
    if (isViewerComplete(viewer)) {
      // 다음 판에서 사진이 늦게 붙어도 이 값으로 메울 수 있다.
      if (viewer) rememberViewer(viewer)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const found = readViewer()
      // 못 읽은 판은 그냥 넘긴다. 화면 전환 중 사이드바가 잠깐 사라져도
      // 이미 띄운 계정 메뉴가 깜빡이지 않게.
      if (found && !sameViewer(found, viewer)) setViewer(found)
      if (isViewerComplete(found) || Date.now() - startedAt > GIVE_UP_MS) {
        window.clearInterval(timer)
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [viewer])

  return viewer
}
