/**
 * 카드가 들어 있는 컬럼의 스크롤 상자.
 *
 * 카드가 '곧 보이게 될지' 를 재려면 화면이 아니라 이 상자를 기준으로 삼아야 한다.
 * 컬럼은 저마다 안에서 스크롤되므로, 화면 기준으로 여유를 두어도 상자 밖으로 잘린
 * 카드는 끝까지 '안 보임' 으로 잡힌다.
 *
 * 컬럼 밖(덱 안 창 등)에서 그려진 카드에는 없다. 그때는 화면을 기준으로 삼는다.
 */
import { createContext, type RefObject } from 'react'

export const ColumnScrollContext = createContext<RefObject<HTMLElement | null> | null>(null)
