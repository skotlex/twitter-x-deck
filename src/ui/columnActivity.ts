/**
 * 컬럼 안에서 '지금 방해하면 안 되는 일' 이 돌고 있는지 알리는 통로.
 *
 * 영상·GIF 를 보고 있거나 번역을 기다리는 동안 새 글이 목록 맨 위에 끼어들면, 보고
 * 있던 것이 그 높이만큼 아래로 밀려난다. 스크롤이 맨 위에 있어도 마찬가지다.
 * 그래서 그동안에는 새 글을 알약으로 세워두고, 사용자가 누를 때 반영한다.
 *
 * 카드는 컬럼 안쪽 깊은 곳에 있으므로 props 로 끌고 내려가지 않고 context 로 알린다.
 * 값은 한 번 만들어 고정하므로, 여기에 기대는 카드가 다시 그려지는 일은 없다.
 */
import { createContext, useContext, useEffect } from 'react'

export interface ColumnActivity {
  /** 시작을 알린다. 돌려받은 함수를 부르면 끝난 것으로 센다. */
  begin: () => () => void
}

export const ColumnActivityContext = createContext<ColumnActivity | null>(null)

/**
 * `active` 인 동안 이 컬럼을 '진행 중' 으로 표시한다.
 *
 * 카드가 사라지면 정리도 함께 끝난다 — 영상이 걸린 채로 컬럼이 잠기는 일이 없다.
 */
export function useColumnActivity(active: boolean): void {
  const activity = useContext(ColumnActivityContext)

  useEffect(() => {
    if (!active || !activity) return
    return activity.begin()
  }, [active, activity])
}
