const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 })
const dateOnly = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })
const dateWithYear = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
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

/** 미디어 격자의 종횡비. 1장일 때만 원본 비율을 살린다. */
export function aspectRatio(width: number, height: number): number {
  if (!width || !height) return 16 / 9
  return Math.min(Math.max(width / height, 0.6), 2.2)
}
