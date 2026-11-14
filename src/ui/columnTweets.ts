/**
 * 카드가 들어 있는 컬럼의 지금 목록을 꺼내 보는 손잡이.
 *
 * 사진을 열 때 같은 사람이 이어 쓴 글을 찾느라 쓴다. 목록 자체를 넘기지 않고 꺼내는
 * 함수를 넘긴다 — 카드는 memo 로 묶여 있어, 목록을 넘기면 글 하나가 들어올 때마다
 * 컬럼의 카드가 전부 다시 그려진다. 필요한 것은 누른 그 순간의 목록뿐이다.
 *
 * 컬럼 밖(덱 안 창 등)에서 그려진 카드에서는 빈 목록이 나온다. 그때는 그 글 하나만 연다.
 */
import { createContext } from 'react'
import type { DeckItem } from '@core/types'

export const ColumnTweetsContext = createContext<() => readonly DeckItem[]>(() => [])
