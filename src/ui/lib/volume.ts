/**
 * 영상 소리 크기를 덱 전체가 함께 쓴다.
 *
 * 영상마다 소리를 다시 맞추는 것은 성가시다. 한 번 맞춰두면 그다음 트는 영상도
 * 같은 크기로 나오고, 새로고침을 건너도 그대로다.
 * GIF 는 소리가 없으므로 여기에 끼우지 않는다 — 항상 음소거로 둔다.
 */
const KEY = 'xdeck:volume'

interface Level {
  volume: number
  muted: boolean
}

function read(): Level {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Level>
      const volume = typeof parsed.volume === 'number' ? parsed.volume : 1
      return { volume: Math.min(1, Math.max(0, volume)), muted: Boolean(parsed.muted) }
    }
  } catch {
    // 저장소가 막힌 환경. 이번 세션 동안만 기억한다.
  }
  return { volume: 1, muted: false }
}

let level = read()

/** 새로 트는 영상에 지금까지 맞춰둔 크기를 입힌다. ref 로 그대로 넘길 수 있다. */
export function applyVolume(video: HTMLVideoElement | null): void {
  if (!video) return
  video.volume = level.volume
  video.muted = level.muted
}

/** 사용자가 소리를 만졌다. 다음 영상부터 이 크기로 나온다. */
export function rememberVolume(video: HTMLVideoElement): void {
  level = { volume: video.volume, muted: video.muted }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(level))
  } catch {
    // 못 남겨도 이번 세션 동안은 유지된다.
  }
}
