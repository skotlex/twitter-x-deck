/**
 * 영상을 눌렀을 때·소리가 바뀌었을 때 무엇을 할지 가리는 판정.
 *
 * 컴포넌트에서 떼어 둔 이유는 하나다 — 이 판정은 브라우저가 영상에 붙여 주는 기본
 * 조작과 맞물려 있다. 눌러서 재생·정지하는 것도, 재생바의 소리 단추도 브라우저가
 * 쥐고 있어서, 화면만 봐서는 어느 쪽이 한 일인지 가릴 수 없다.
 */

/** 미리보기와 실제 재생을 가르는 상태. 한 번 켜면 마우스가 떠나도 계속 돈다. */
interface Playing {
  /** 그 자리에서 틀 수 있는 첨부인지. 사진은 아니다. */
  playable: boolean
  /** 사용자가 이 영상을 보기로 한 상태인지. */
  engaged: boolean
}

/** 영상을 눌렀을 때 할 일. */
export type MediaClick =
  /** 원본 보기로 연다 — 사진과 틀 수 없는 첨부. */
  | 'open'
  /** 이 영상을 제대로 튼다. 소리를 켜고, 되돌아 돌지 않는다. */
  | 'start'
  /** 브라우저에 맡긴다 — 눌러서 재생·정지. */
  | 'toggle'

/**
 * 미리보기로 이미 돌고 있어도 소리를 켜기 전 첫 클릭은 'start' 다.
 *
 * 그 클릭까지 브라우저에 맡기면 "보겠다"고 누른 것이 정지로 끝난다 — 브라우저는
 * 돌고 있는 영상을 누르면 세우는 것으로 받기 때문이다. 소리를 켠 뒤로는 맡긴다.
 * 그때부터는 정지도 사용자가 바라는 일이고, 여기서 막으면 재생바의 단추 위에서만
 * 세울 수 있다.
 */
export function mediaClick({ playable, engaged }: Playing): MediaClick {
  if (!playable) return 'open'
  return engaged ? 'toggle' : 'start'
}

/**
 * 방금 바뀐 소리를 사용자가 맞춘 것인지.
 *
 * 재생바의 소리 단추를 누른 것은 클릭으로 알려 오지 않는다 — 재생바 안은 브라우저가
 * 따로 쥐고 있어 카드까지 올라오지 않는다. 남는 단서는 소리가 바뀌었다는 것뿐이다.
 * 그래서 미리보기(늘 음소거로 두는 상태)인데 소리가 켜져 있으면 사용자가 켠 것으로
 * 본다. 반대로 미리보기용으로 우리가 끈 음소거는 사용자가 한 일이 아니다.
 *
 * GIF 는 소리가 없으니 애초에 셈에서 뺀다.
 */
export function isUserVolume({
  silent,
  engaged,
  muted,
}: {
  /** 소리가 없는 첨부(GIF)인지. */
  silent: boolean
  engaged: boolean
  /** 지금 이 영상이 음소거인지. */
  muted: boolean
}): boolean {
  if (silent) return false
  return engaged || !muted
}
