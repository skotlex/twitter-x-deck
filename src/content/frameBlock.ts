/**
 * 프레임이 막힌 이유를 가려내는 관측점.
 *
 * 자식 프레임이 안 뜰 때 범인은 둘이다 — 자식 응답의 `X-Frame-Options` 이거나,
 * 이 문서 자신의 CSP `frame-src` 다. 둘 다 결과는 똑같이 '문서를 읽을 수 없다' 라
 * 겉으로는 구별되지 않는다.
 *
 * CSP 가 막은 경우에만 문서에 위반 이벤트가 뜬다. 그래서 이 이벤트의 유무가
 * 둘을 가르는 유일한 단서다.
 *
 * 여기에 헤더 제거 규칙이 살아 있는지까지 얹는다. 규칙이 아예 안 실린 것과,
 * 실렸는데 요청 종류가 안 맞아 비껴간 것은 대응이 전혀 다르다.
 */
import { RULE_REPORT } from '@core/messages'

let reason: string | null = null
/** 배경 워커가 알려준 헤더 제거 규칙 상태. 규칙이 안 실렸는지 비껴갔는지를 가른다. */
let rules = '규칙 상태 확인 전'

export function watchFrameBlocks(): void {
  document.addEventListener('securitypolicyviolation', (event) => {
    if (!event.violatedDirective.startsWith('frame')) return
    reason = `CSP ${event.violatedDirective} 위반`
  })
  void refreshRuleReport()
}

/** 헤더 제거 규칙 상태를 배경 워커에 물어 캐시해둔다. 조회는 거기서만 된다. */
export async function refreshRuleReport(): Promise<void> {
  try {
    const answer: unknown = await chrome.runtime.sendMessage({ type: RULE_REPORT })
    if (typeof answer === 'string') rules = answer
  } catch {
    rules = '배경 워커가 답하지 않습니다'
  }
}

/** 지금까지 관측한 CSP 프레임 차단. 없으면 null — XFO 쪽이라는 뜻이다. */
export function frameBlockReason(): string | null {
  return reason
}

/** 임베드가 막혔을 때 붙일 설명. 범인과 규칙 상태를 함께 지목한다. */
export function describeFrameBlock(): string {
  return `${reason ?? 'CSP 위반 이벤트 없음 — XFO 로 보입니다'} · ${rules}`
}
