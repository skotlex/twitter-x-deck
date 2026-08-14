import { useCallback, useRef } from 'react'
import { ROLE_PARAM } from '@core/messages'
import { FRAME_NAME_PREFIX } from '@core/role'
import { TIMELINE_LABEL, type TimelineKind } from '@core/types'
import { describeFrameBlock, refreshRuleReport } from '../../content/frameBlock'

/**
 * 최상위 문서가 맡지 않는 컬럼을 채우는 x.com 프레임.
 *
 * 부모가 x.com 이라 `frame-ancestors 'self'` 를 그대로 만족하고 쿠키도 same-site 로 실린다.
 * 다만 `X-Frame-Options: DENY` 는 동일 출처까지 막으므로 그 헤더는 확장이 걷어낸다
 * (`rules.json`, sub_frame 요청에 한해서만).
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
  /** 로드 결과 진단. 실패 원인을 컬럼 배너로 올린다. */
  onReport: (kind: TimelineKind, message: string) => void
}

export function CollectorFrame({ kind, register, onReport }: CollectorFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const ref = useCallback(
    (element: HTMLIFrameElement | null) => {
      frameRef.current = element
      register(kind, element)
    },
    [kind, register],
  )

  // 같은 오리진이라 프레임 문서를 직접 들여다볼 수 있다 — 실패 원인을 정확히 알아낸다.
  const handleLoad = useCallback(() => {
    const frame = frameRef.current
    if (!frame) return
    try {
      const doc = frame.contentDocument
      if (!doc) {
        // 규칙이 요청에 걸렸는지는 요청이 나간 뒤에 물어야 의미가 있다.
        void refreshRuleReport().then(() => {
          onReport(kind, `프레임 문서를 읽을 수 없습니다 — 임베드 차단 (${describeFrameBlock()})`)
        })
        return
      }
      onReport(kind, `프레임 로드: ${doc.location.pathname}${doc.location.search} (${doc.readyState})`)
    } catch {
      onReport(kind, `프레임이 교차 출처로 떨어졌습니다 — 임베드 차단 (${describeFrameBlock()})`)
    }
  }, [kind, onReport])

  return (
    <iframe
      ref={ref}
      title={`${TIMELINE_LABEL[kind]} 수집기`}
      name={`${FRAME_NAME_PREFIX}${kind}`}
      src={`https://x.com/home?${ROLE_PARAM}=${kind}`}
      onLoad={handleLoad}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 -z-10 h-screen w-[560px] border-0 opacity-0"
    />
  )
}
