/**
 * 이 탭에 헤더 제거 규칙을 걸어두는 절차.
 *
 * 규칙을 정적 파일로 두면 브라우저 전체에 걸린다. 그러면 아무 사이트나 x.com 을
 * 프레임에 실을 수 있게 되어 로그인한 사용자가 클릭재킹에 노출된다. 그래서
 * 덱이 뜬 탭에만 거는데, 탭 번호는 메시지를 받은 배경 워커만 알 수 있다.
 *
 * 프레임을 만들기 전에 반드시 이것을 기다려야 한다 — 규칙보다 먼저 나간 요청은
 * `X-Frame-Options` 를 그대로 달고 와서 막힌다.
 *
 * 한 문서에서 여러 번 불러도 청은 한 번만 간다. 실패해도 던지지 않는다 —
 * 규칙이 안 걸린 채로 프레임이 막히면 그때는 진단 문구가 사정을 알려준다.
 */
import { RULE_SCOPE } from '@core/messages'

let pending: Promise<boolean> | null = null

export function ensureRuleScope(): Promise<boolean> {
  pending ??= chrome.runtime.sendMessage({ type: RULE_SCOPE }).then(
    (answer: unknown) => answer === true,
    () => false,
  )
  return pending
}
