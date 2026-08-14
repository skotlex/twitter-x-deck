import { useCallback } from 'react'
import { ROLE_PARAM } from '@core/messages'
import { FRAME_NAME_PREFIX } from '@core/role'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'

/**
 * 최상위 문서가 맡지 않는 컬럼을 채우는 x.com 프레임.
 *
 * 부모가 x.com 이라 `frame-ancestors 'self'` 를 그대로 만족한다 — 헤더를 손댈 일이 없고
 * 쿠키도 same-site 로 실린다.
 *
 * 평소에는 `opacity: 0` 으로 감춘다. `display:none` 이나 화면 밖 배치는 렌더링이
 * 멈추거나 스로틀링돼서 타임라인이 갱신되지 않는다. 투명하게만 두면 문서는 정상적으로
 * 그려지고 우리 눈에만 안 보인다.
 *
 * `name` 은 프레임 안 SPA 이동과 로그인 리다이렉트를 거쳐도 남아 역할 판별의 기준이 된다.
 */
export interface CollectorFrameProps {
  kind: TimelineKind
  register: (kind: TimelineKind, frame: HTMLIFrameElement | null) => void
}

export function CollectorFrame({ kind, register }: CollectorFrameProps) {
  const ref = useCallback(
    (element: HTMLIFrameElement | null) => {
      register(kind, element)
    },
    [kind, register],
  )

  return (
    <iframe
      ref={ref}
      title={`${TIMELINE_LABEL[kind]} 수집기`}
      name={`${FRAME_NAME_PREFIX}${kind}`}
      src={`https://x.com/home?${ROLE_PARAM}=${kind}`}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 -z-10 h-screen w-[560px] border-0 opacity-0"
    />
  )
}
