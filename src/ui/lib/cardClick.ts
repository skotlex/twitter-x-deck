/**
 * 카드를 누른 것이 '상세를 열어라' 인지 가리는 판정.
 *
 * 컴포넌트에서 떼어 둔 이유는 하나다 — 이 판정은 조상 요소까지 훑기 때문에 카드가
 * 어디에 놓였느냐에 따라 결과가 달라지고, 그 자리는 눈으로 봐서는 알기 어렵다.
 */

/** 그 자리에서 할 일이 따로 있는 것들. 여기를 누른 건 카드를 누른 것이 아니다. */
const OWN_ACTION = 'a, button, video, [role="button"], [role="dialog"]'

/**
 * 카드 안에서 상세를 열어도 되는 클릭인지.
 *
 * 카드에는 이미 제 할 일이 있는 것들이 잔뜩 있다. 링크·버튼·사진은 그 자리의
 * 동작이 우선하고, 카드가 띄운 대화상자 안의 클릭이 뒤로 새어 나와서도 안 된다.
 * 글을 긁는 중이었다면 그건 복사하려던 것이지 클릭이 아니다.
 *
 * 막을 것을 **카드 안쪽으로 한정**한다. 카드 바깥의 대화상자까지 세면, 판 전체가
 * 대화상자인 자리(종으로 펼친 타임라인)에서는 어느 게시물도 열리지 않는다.
 */
export function opensCardDetail(target: EventTarget | null, card: Element): boolean {
  const blocker = target instanceof Element ? target.closest(OWN_ACTION) : null
  if (blocker && card.contains(blocker)) return false
  return !card.ownerDocument.defaultView?.getSelection()?.toString()
}
