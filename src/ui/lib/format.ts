const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 })
const dateOnly = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })
const dateWithYear = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
const clockOnly = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' })
const fullStamp = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** 통계 숫자를 짧게. 0 도 그대로 보여준다 — 반응이 없다는 것도 정보다. */
export function formatCount(value: number | undefined): string {
  if (!value) return '0'
  return value < 1000 ? String(value) : compact.format(value)
}

/**
 * 미리보기용으로 축소된 이미지 URL 을 원본 크기로 되돌린다.
 * pbs.twimg.com 은 `name` 파라미터로 크기를 정한다.
 */
export function originalMediaUrl(url: string): string {
  if (!url.includes('pbs.twimg.com')) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('name', 'orig')
    return parsed.href
  } catch {
    return url
  }
}

/**
 * 목록에 쓸 수 있는 사진 크기와 그 최대 가로 폭(px). 작은 것부터다.
 *
 * `thumb` 은 일부러 뺐다 — 그것만은 축소가 아니라 150×150 **정사각 크롭** 이라
 * 사진이 잘려 나온다. 위쪽도 `medium` 에서 끊는다. 목록에서 2048px(`large`) 를
 * 들고 있을 이유가 없고, 확대해서 볼 때는 라이트박스가 `originalMediaUrl` 로
 * 원본을 따로 받는다.
 */
export const MEDIA_STEPS: readonly { name: string; width: number }[] = [
  { name: 'small', width: 680 },
  { name: 'medium', width: 1200 },
]

/**
 * 그 자리에 실제로 필요한 만큼만 받도록 사진 주소의 크기를 정한다.
 *
 * 디코딩에 드는 메모리는 화면에 그려지는 크기가 아니라 **받은 픽셀 수** 로 정해진다.
 * 예전에는 파싱 시점에 `?name=medium`(1200px) 으로 굳혀 두어서, 컬럼이 340px 이든
 * 1200px 이든 똑같이 1200px 을 받았다. 컬럼은 `flex-1` 이라 창 크기와 컬럼 수에
 * 따라 폭이 크게 달라지므로 한 값으로 맞출 수가 없다.
 *
 * `name` 을 덮어쓰는 방식이라 이미 `?name=medium` 으로 저장된 글에도 그대로 듣는다 —
 * 저장값을 옮길 필요가 없다.
 *
 * @param needed 이 자리에 필요한 가로 **기기 픽셀** 수 (CSS 폭 × 화면 배율).
 */
export function sizedMediaUrl(url: string, needed: number): string {
  if (!url.includes('pbs.twimg.com')) return url
  const step = MEDIA_STEPS.find((candidate) => candidate.width >= needed) ?? MEDIA_STEPS.at(-1)
  if (!step) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('name', step.name)
    return parsed.href
  } catch {
    return url
  }
}

/** 타임라인용 상대 시각. 하루가 넘으면 날짜로 바꾼다. */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '방금'
  if (diff < hour) return `${Math.floor(diff / minute)}분`
  if (diff < day) return `${Math.floor(diff / hour)}시간`

  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return (sameYear ? dateOnly : dateWithYear).format(date)
}

export function formatStamp(timestamp: number): string {
  return fullStamp.format(new Date(timestamp))
}

/**
 * 시:분만 짚는다.
 * '3분 전' 같은 상대 표현과 달리 다시 그리지 않아도 낡지 않는다 — 아무 것도
 * 안 들어와 화면이 멈춰 있을 때 읽는 값이라 그 성질이 중요하다.
 */
export function formatClock(timestamp: number): string {
  return clockOnly.format(new Date(timestamp))
}

/** 미디어 격자의 종횡비. 1장일 때만 원본 비율을 살린다. */
export function aspectRatio(width: number, height: number): number {
  if (!width || !height) return 16 / 9
  return Math.min(Math.max(width / height, 0.6), 2.2)
}
