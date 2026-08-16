/**
 * [cardClick.ts](../../src/ui/lib/cardClick.ts) 의 카드 클릭 판정.
 *
 * 카드를 눌러 상세를 여는 길은 손으로 확인하기 번거로운 자리다 — 카드가 어디에
 * 놓였느냐(컬럼 안이냐, 종으로 펼친 판 안이냐)로 결과가 갈리는데 화면상으로는
 * 똑같아 보인다. 그래서 놓인 자리별로 여기서 못을 박아 둔다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { opensCardDetail } from '@ui/lib/cardClick'

/** 카드 하나를 만들어 원하는 자리에 심는다. 안에는 본문·링크·인용 상자를 둔다. */
function mountCard(host: Element) {
  const card = document.createElement('article')
  card.innerHTML = `
    <p class="body">본문</p>
    <a class="profile" href="https://x.com/someone">프로필</a>
    <button class="like">마음에 들어요</button>
    <div class="quote"><p class="quote-body">인용된 글</p></div>
  `
  host.append(card)
  const find = (selector: string) => card.querySelector(selector) as Element
  return { card, find }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('opensCardDetail', () => {
  it('본문을 누르면 연다', () => {
    const { card, find } = mountCard(document.body)
    expect(opensCardDetail(find('.body'), card)).toBe(true)
  })

  it('링크·버튼은 그 자리의 동작이 우선한다', () => {
    const { card, find } = mountCard(document.body)
    expect(opensCardDetail(find('.profile'), card)).toBe(false)
    expect(opensCardDetail(find('.like'), card)).toBe(false)
  })

  it('카드가 띄운 대화상자 안의 클릭은 뒤로 새지 않는다', () => {
    const { card } = mountCard(document.body)
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.innerHTML = '<p class="inside">게시물 상세</p>'
    card.append(modal)
    expect(opensCardDetail(modal.querySelector('.inside'), card)).toBe(false)
  })

  /**
   * 종으로 펼친 판은 그 자체가 대화상자다. 조상까지 세던 시절에는 이 판 안에서
   * 게시물을 눌러도 상세가 열리지 않았다 — 컬럼에서는 열리는데 종에서만 안 열렸다.
   */
  it('카드 바깥의 대화상자(종으로 펼친 판)는 막지 않는다', () => {
    const panel = document.createElement('aside')
    panel.setAttribute('role', 'dialog')
    document.body.append(panel)
    const { card, find } = mountCard(panel)

    expect(opensCardDetail(find('.body'), card)).toBe(true)
    // 그 판 안에서도 카드 안쪽 규칙은 그대로다.
    expect(opensCardDetail(find('.profile'), card)).toBe(false)
  })

  it('인용 상자를 기준으로 물으면 상자 밖 요소는 막지 않는다', () => {
    const { card, find } = mountCard(document.body)
    const quote = find('.quote')

    expect(opensCardDetail(find('.quote-body'), quote)).toBe(true)
    // 원글 쪽 링크는 인용 상자가 품고 있지 않다 — 그 판정은 카드가 맡는다.
    expect(opensCardDetail(find('.profile'), quote)).toBe(true)
    expect(opensCardDetail(find('.profile'), card)).toBe(false)
  })

  it('글을 긁는 중이었다면 클릭으로 보지 않는다', () => {
    const { card, find } = mountCard(document.body)
    const range = document.createRange()
    range.selectNodeContents(find('.body'))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(opensCardDetail(find('.body'), card)).toBe(false)

    selection?.removeAllRanges()
    expect(opensCardDetail(find('.body'), card)).toBe(true)
  })
})
