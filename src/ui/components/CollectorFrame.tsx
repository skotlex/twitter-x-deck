import { useCallback } from 'react'
import { ROLE_PARAM } from '@core/messages'
import { FRAME_NAME_PREFIX } from '@core/role'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import type { CollectorMode } from '../hooks/useCollector'

/**
 * 데이터를 실제로 길어 올리는 x.com 프레임.
 *
 * 평소에는 `opacity-0` 으로 감춘다 — `display:none` 이나 화면 밖 배치는 렌더링이
 * 멈추거나 스로틀링돼서 타임라인이 갱신되지 않는다. 투명하게만 두면 문서는 정상적으로
 * 그려지고 우리 눈에만 안 보인다.
 *
 * `sandbox` 는 걸지 않는다. 로그인 플로우가 팝업·스토리지 접근을 쓰기 때문에 sandbox 아래에서는
 * 로그인 자체가 막힌다. 프레임 탈출은 x.com 이 시도하지 않으므로 감수할 만한 교환이다.
 *
 * `name` 은 프레임 안 SPA 이동과 로그인 리다이렉트를 거쳐도 남아 역할 판별의 기준이 된다.
 */
const HIDDEN_CLASS =
  'pointer-events-none fixed left-0 top-0 -z-10 h-screen w-[560px] border-0 opacity-0'

const EXPANDED_CLASS =
  'fixed left-1/2 top-[4.5rem] z-50 h-[calc(100dvh-6rem)] w-[min(520px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-line bg-white opacity-100 shadow-2xl'

export interface CollectorFrameProps {
  kind: TimelineKind
  mode: CollectorMode
  /** 로그인 화면을 사용자에게 보여줘야 하는 상태인지. */
  expanded: boolean
  register: (kind: TimelineKind, frame: HTMLIFrameElement | null) => void
}

export function CollectorFrame({ kind, mode, expanded, register }: CollectorFrameProps) {
  const ref = useCallback(
    (element: HTMLIFrameElement | null) => {
      register(kind, element)
    },
    [kind, register],
  )

  // 폴백 탭 모드에서는 별도 탭이 수집을 맡으므로 프레임을 띄우지 않는다.
  if (mode === 'tab') return null

  return (
    <iframe
      ref={ref}
      title={`${TIMELINE_LABEL[kind]} 수집기`}
      name={`${FRAME_NAME_PREFIX}${kind}`}
      src={`https://x.com/home?${ROLE_PARAM}=${kind}`}
      referrerPolicy="no-referrer-when-downgrade"
      className={expanded ? EXPANDED_CLASS : HIDDEN_CLASS}
      aria-hidden={expanded ? undefined : true}
    />
  )
}
