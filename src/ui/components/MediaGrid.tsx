import { type PointerEvent, type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { MEDIA_MAX_HEIGHT, type MediaMode, type MediaSize } from '@core/settings'
import type { TweetMedia } from '@core/types'
import { useColumnActivity } from '../columnActivity'
import { GRID_SHARE, useColumnPixels } from '../columnWidth'
import { aspectRatio, sizedMediaUrl } from '../lib/format'
import {
  firefoxShowsScrubber,
  holdsFullscreen,
  isUserVolume,
  mediaClick,
  videoHoldsColumn,
} from '../lib/mediaPlayback'
import { applyVolume, rememberVolume } from '../lib/volume'
import { FullscreenIcon, ImageIcon, PlayIcon } from './icons'

/** 장수별 격자 배치. x.com 과 같은 규칙을 따른다. */
function layoutClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 3) return 'grid-cols-2 grid-rows-2'
  return 'grid-cols-2'
}

function itemClass(count: number, index: number): string {
  // 3장일 때 첫 장이 왼쪽 전체 높이를 차지한다.
  return count === 3 && index === 0 ? 'row-span-2' : ''
}

/** Firefox 재생바만의 버릇을 메우는 자리가 있어 가려 둔다. */
const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

/**
 * Firefox 재생바가 영상 폭을 다시 재게 만든다.
 *
 * Firefox 는 `controls` 가 켜질 때마다 재생바를 새로 만드는데, 그때는 폭을 재지 않고
 * 기본값 300px 로 부품을 늘어놓는다. 실제 폭은 영상 크기가 바뀌었다는 알림이 와야
 * 다시 잰다. 컬럼 안 영상은 300px 보다 좁아 재생바가 양옆으로 잘려 나가고, 전체화면에
 * 들어갔다 나와 크기가 한 번 바뀌어야 제 모양이 됐다.
 *
 * 그 알림은 화면 배치에서만 오고 스크립트로 흉내 낸 것은 버린다. 그래서 폭을 1px
 * 줄였다가 되돌려 크기를 실제로 한 번 바꾼다. 재생바가 언제 다 만들어지는지 알 길이
 * 없어 한 번 더 늦춰서 되풀이한다.
 *
 * **줄인 폭으로 배치를 한 번 계산시켜야 한다.** 줄여 두기만 하면 다음 프레임에 되돌릴
 * 때까지 배치가 한 번도 돌지 않는 일이 잦아, 크기가 바뀐 적이 없는 것이 된다. 그러면
 * 알림도 오지 않아 재생바가 300px 그대로 남았다 — 간헐적으로만 고쳐졌던 까닭이다.
 * (Firefox 160 에서 시점을 바꿔 가며 찍어 확인했다. 강제로 계산시키면 매번 맞는다.)
 *
 * 사용자가 영상 칸을 누르기 시작하면 남은 조정은 거둔다 — 누르는 도중에 크기를 건드리지 않게.
 */
function remeasureFirefoxControls(video: HTMLVideoElement, host: HTMLElement): () => void {
  const doc = video.ownerDocument
  const timers: number[] = []
  const frames: number[] = []
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    timers.forEach((id) => clearTimeout(id))
    frames.forEach((id) => cancelAnimationFrame(id))
    video.style.width = ''
    host.removeEventListener('pointerdown', stop, true)
    doc.removeEventListener('fullscreenchange', stop)
  }
  const nudge = () => {
    if (stopped || holdsFullscreen(video)) return
    video.style.width = 'calc(100% - 1px)'
    // 줄인 폭으로 배치를 계산시킨다. 이게 없으면 되돌릴 때까지 크기가 바뀐 적이 없는 셈이 된다.
    void video.offsetWidth
    frames.push(requestAnimationFrame(() => (video.style.width = '')))
  }
  // 재생바·전체화면 단추·위치 막대 어디를 누르든 영상 칸 안에서 시작한다.
  host.addEventListener('pointerdown', stop, true)
  doc.addEventListener('fullscreenchange', stop)
  frames.push(requestAnimationFrame(() => timers.push(window.setTimeout(nudge, 0))))
  timers.push(window.setTimeout(nudge, 250))
  return stop
}

/**
 * 마우스가 떠난 뒤 영상 요소를 남겨 두는 시간 (Firefox).
 * 재생바의 전체화면 단추를 누른 뒤 화면 전환이 끝날 때까지 버틸 만큼이다.
 */
const FULLSCREEN_GRACE_MS = 1000

/** 전체화면을 빠져나온 뒤 마우스 위치가 다시 계산되기를 기다리는 시간. */
const POINTER_SETTLE_MS = 200

/** 0~1 사이로. */
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * 재생바에서 위치 막대가 빠졌을 때 대신 다는 막대.
 *
 * Firefox 는 영상이 좁으면 재생바에서 위치 막대를 뺀다(`firefoxShowsScrubber`).
 * 컬럼 안 세로 영상은 늘 그만큼 좁아서 어디쯤인지 볼 수도, 옮길 수도 없었다.
 * 재생바(높이 40px) 바로 위에 붙인다.
 *
 * 버튼 안이라 `<input type="range">` 를 쓸 수 없다 — 버튼 안에 다른 조작 요소를 둘 수 없다.
 */
function SeekBar({ video, time, duration }: { video: HTMLVideoElement; time: number; duration: number }) {
  const seekTo = (event: PointerEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    video.currentTime = clamp01((event.clientX - rect.left) / rect.width) * duration
  }
  const ratio = clamp01(duration > 0 ? time / duration : 0)
  const stop = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <span
      role="slider"
      tabIndex={-1}
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      onClick={stop}
      onPointerDown={(event) => {
        stop(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        seekTo(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event)
      }}
      className="group/seek absolute inset-x-2 bottom-10 z-10 flex h-4 cursor-pointer items-center"
    >
      {/* Firefox 재생바의 위치 막대와 같은 차림 — 어두운 바탕, 파란 진행분, 흰 손잡이. 밝은 화면 위에서도 보인다. */}
      <span className="relative h-1 w-full rounded-full bg-black/55 shadow-[0_0_0_1px_rgba(255,255,255,0.15)] transition-[height] group-hover/seek:h-1.5">
        <span className="absolute inset-y-0 left-0 rounded-full bg-[#00b6f0]" style={{ width: `${ratio * 100}%` }} />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${ratio * 100}%` }}
        />
      </span>
    </span>
  )
}

/** 가리킨 영역에서 돌 영상을 고르는 표식. 영역 안에서 맨 앞에 달린 것 하나가 대표다. */
const PLAYABLE_MARK = 'data-playable'

/**
 * 카드 안에서 따로 떼어 볼 영역의 표식.
 *
 * 인용 상자가 여기에 해당한다 — 인용 상자를 가리키면 그 안 영상이, 원글 쪽을
 * 가리키면 원글 영상이 돈다. 상자가 눈에 띄게 갈려 있으니 어느 쪽을 볼 셈인지도
 * 마우스 위치로 갈린다.
 */
export const MEDIA_REGION_MARK = 'data-media-region'

/** 이 요소가 든 영역. 표식이 붙은 상자가 있으면 그 상자, 없으면 카드 전체다. */
function regionOf(node: Element): Element | null {
  return node.closest(`[${MEDIA_REGION_MARK}]`) ?? node.closest('article')
}

function MediaItem({
  media,
  fit,
  pixels,
  sourceUrl,
  hoverPlay,
  onOpen,
}: {
  media: TweetMedia
  /** 높이가 잘리는 크기에서는 채워서 자르고, 원본 크기에서는 비율을 지킨다. */
  fit: 'cover' | 'contain'
  /** 이 칸에 필요한 가로 기기 픽셀. 사진을 어느 크기로 받을지가 여기서 갈린다. */
  pixels: number
  sourceUrl: string
  hoverPlay: boolean
  onOpen: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [hovered, setHovered] = useState(false)
  /** 이 영상이 실린 영역을 지금 보고 있고, 그 영역의 대표 영상이 이것인지. */
  const [regionLeads, setRegionLeads] = useState(false)
  /** 사용자가 눌러 소리를 켠 상태. 한 번 켜면 마우스가 떠나도 계속 돈다. */
  const [engaged, setEngaged] = useState(false)
  /** 지금 실제로 돌고 있는지. 컬럼을 붙들지 말지가 여기서 갈린다. */
  const [playing, setPlaying] = useState(false)
  const hostRef = useRef<HTMLButtonElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const playable = media.kind !== 'photo' && Boolean(media.playbackUrl)
  const silent = media.kind === 'animated_gif'
  // 이 자리에 들어갈 만큼만 받는다. 확대해서 볼 때는 라이트박스가 원본을 따로 받는다.
  const previewUrl = sizedMediaUrl(media.previewUrl, pixels)

  /**
   * 돌아야 하는지.
   *
   *   1순위 — 이 영상을 직접 가리켰다.
   *   2순위 — 이 영상이 실린 영역을 가리켰거나 그 안에 포커스가 있다.
   *           한 영역에 영상이 여럿이면 맨 앞 하나만 돈다.
   *   그리고 한 번 소리를 켠 영상은 조건과 무관하게 계속 돈다.
   */
  const wanted = playable && !failed && (engaged || (hoverPlay && (hovered || regionLeads)))

  /**
   * Firefox 에서는 마우스가 떠나도 영상 요소를 잠깐 남겨 둔다.
   *
   * 재생바의 전체화면 단추를 누르면 Firefox 는 화면을 어둡게 바꾸는 **도중에** 마우스가
   * 떠난 것으로 알려 온다. 그 자리에서 미리보기를 내리면 전환이 끝날 즈음엔 전체화면을
   * 걸 요소가 문서에 없어 "요청한 요소가 더 이상 문서 내에 존재하지 않는다" 며 거절된다.
   * 그 단추를 누른 것은 페이지에 알려 오지 않아(재생바 안은 브라우저가 쥐고 있다) 미리
   * 붙들 수도 없다. 그래서 떠난 뒤 잠깐은 요소를 남기고, 그새 전체화면이 되면 붙든다.
   * 남겨 두는 동안은 섬네일로 덮어 화면에서는 곧바로 내려간 것처럼 보인다.
   */
  const [lingering, setLingering] = useState(false)
  const [wasWanted, setWasWanted] = useState(wanted)
  if (wanted !== wasWanted) {
    // 그리는 도중에 맞춰 둬야 요소가 한 번도 빠지지 않는다 — 효과로 하면 이미 빠진 뒤다.
    setWasWanted(wanted)
    setLingering(IS_FIREFOX && !wanted)
  }
  useEffect(() => {
    if (!lingering) return
    const timer = window.setTimeout(() => setLingering(false), FULLSCREEN_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [lingering])

  const showVideo = wanted || lingering

  /**
   * 전체화면 때문에만 붙든 영상인지. 그렇다면 전체화면을 빠져나와 마우스가 떠날 때 놓는다.
   * 눌러서 소리를 켠 영상은 여기에 들지 않는다 — 그건 마우스가 떠나도 계속 돈다.
   */
  const heldForFullscreen = useRef(false)

  /*
   * 영상이 **도는 동안에는** 새 글을 목록에 끼워 넣지 않는다 — 보고 있던 화면이
   * 그 높이만큼 아래로 밀려난다. 그동안 온 글은 알약으로 세워둔다.
   *
   * 요소가 떠 있다는 것만으로는 붙들지 않는다. 소리를 켠 영상은 마우스가 떠나도
   * 남으므로, 그 기준으로 붙들면 한 번 누른 영상이 그 컬럼을 영영 잠근다.
   */
  useColumnActivity(videoHoldsColumn({ mounted: showVideo, playing }))

  /**
   * 이 영상이 든 영역을 지금 보고 있는지 지켜본다.
   *
   * 영상 자체가 아니라 그 영상이 든 영역을 기준으로 삼는다 — 글을 읽으려고 그 위에
   * 마우스를 둔 것만으로도 그 글의 영상은 볼 뜻이 있는 것이고, 반대로 지나가는
   * 카드의 영상까지 돌 이유는 없다. 키보드로 옮겨 다닐 때를 위해 포커스도 함께 본다.
   *
   * 한 영역에서 도는 영상은 하나다. 문서 순서로 맨 앞의 영상을 그때그때 찾으므로,
   * 라벨 모드에서 한쪽만 펼쳐 두었을 때처럼 목록이 도중에 바뀌어도 대표가 어긋나지
   * 않는다. 마우스가 어디에 있는지는 카드 전체에서 지켜본다 — 원글과 인용 상자
   * 사이를 오갈 때는 카드를 벗어나지 않아 각 영역의 mouseenter 만으로는 모자란다.
   */
  useEffect(() => {
    const node = hostRef.current
    if (!hoverPlay || !playable || !node) return
    const card = node.closest('article')
    const region = regionOf(node)
    if (!card || !region) return

    /** 지금 가리킨(또는 포커스가 간) 곳이 내 영역이고, 그 영역의 대표가 나인지. */
    const active = (target: EventTarget | null) =>
      target instanceof Element &&
      regionOf(target) === region &&
      region.querySelector(`[${PLAYABLE_MARK}]`) === node

    // 영역 안을 옮겨 다녀도 같은 값이 다시 계산될 뿐이고, 원글 ↔ 인용 상자로 건너가는
    // 순간에만 값이 갈린다. 그래서 영역별 mouseenter 대신 카드에서 올라오는 이벤트를 본다.
    const enter = (event: Event) => setRegionLeads(active(event.target))
    const leave = () => setRegionLeads(false)

    /** 마우스가 지금 내 영역 위에 있는지. 안에 든 별도 영역(인용 상자) 위는 셈에서 뺀다. */
    const pointerInside = () =>
      region.matches(':hover') && !region.querySelector(`[${MEDIA_REGION_MARK}]:hover`)

    /**
     * 포커스를 잃었다고 다 떠난 것은 아니다.
     *
     * 카드 안 버튼을 누르면 포커스가 카드 밖으로 밀려나는 일이 여럿 있다 — 처리하는
     * 동안 그 버튼이 비활성화되기도 하고(비활성화된 요소는 포커스를 잃는다), 번역이
     * 띄운 숨은 프레임이 제 입력란에 포커스를 가져가기도 한다. 그걸 이탈로 세면
     * 보고 있던 영상이 버튼을 눌렀다는 이유만으로 멈춘다.
     *
     * 그래서 두 가지를 먼저 본다 — 마우스가 아직 내 영역 위에 있으면 무엇이 포커스를
     * 가져갔든 이쪽을 보고 있는 것이고, 포커스가 카드 안에서 자리만 옮겼거나 아예
     * 사라진 것도 떠난 것이 아니다.
     */
    const leaveFocus = (event: FocusEvent) => {
      if (pointerInside()) return
      const next = event.relatedTarget as Node | null
      if (next === null || card.contains(next)) return
      leave()
    }

    card.addEventListener('mouseover', enter)
    card.addEventListener('mouseleave', leave)
    card.addEventListener('focusin', enter)
    card.addEventListener('focusout', leaveFocus)
    return () => {
      card.removeEventListener('mouseover', enter)
      card.removeEventListener('mouseleave', leave)
      card.removeEventListener('focusin', enter)
      card.removeEventListener('focusout', leaveFocus)
    }
  }, [hoverPlay, playable])

  /**
   * 소리는 요소를 바꾸지 않고 켠다. 눌렀다고 새 영상을 갈아 끼우면 보던 위치가
   * 처음으로 돌아간다 — 재생바를 잡아 옮기던 중이었다면 더 그렇다.
   *
   * 미리보기도 크기까지는 맞춰 둔다. 소리를 내지 않을 뿐 요소는 이미 떠 있고,
   * 재생바의 소리 단추로 켜는 순간 그 크기 그대로 나온다.
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    applyVolume(video, !engaged || silent)
  }, [engaged, silent, showVideo])

  /**
   * 전체화면으로 띄운 영상은 보기로 한 것이다. 재생바를 잡아 옮긴 것과 똑같이 다룬다.
   *
   * 미리보기는 마우스가 떠나면 내린다. 그런데 재생바의 전체화면 단추는 클릭으로 알려
   * 오지 않아(재생바 안은 브라우저가 쥐고 있다) 그 영상은 여전히 미리보기로 남는다.
   * Firefox 는 전체화면으로 넘어간 뒤 마우스가 떠난 것으로 알려 와, 미리보기로 남은
   * 영상이 그대로 내려지고 요소가 사라졌으니 전체화면도 곧바로 풀렸다.
   *
   * 전체화면에 들어간 순간 붙들어 두면, 마우스가 어디로 갔든 요소가 남고 소리도 켜진다.
   * (그 알림보다 마우스가 떠났다는 알림이 먼저 오기도 한다 — `lingering` 이 그 틈을 메운다.)
   */
  useEffect(() => {
    const video = videoRef.current
    if (!showVideo || engaged || !video) return
    const doc = video.ownerDocument
    const onChange = () => {
      if (!holdsFullscreen(video)) return
      heldForFullscreen.current = true
      setEngaged(true)
    }
    doc.addEventListener('fullscreenchange', onChange)
    return () => doc.removeEventListener('fullscreenchange', onChange)
  }, [showVideo, engaged])

  /**
   * 전체화면 때문에만 붙든 영상은 빠져나온 뒤 마우스가 떠나면 놓는다.
   *
   * 전에는 빠져나온 뒤에도 계속 돌아, 마우스가 다른 곳으로 가도 소리를 내며 이어졌다.
   * 빠져나온 순간 마우스가 이미 밖에 있으면 곧바로 놓는다. 마우스 위치는 화면이 원래
   * 크기로 돌아와 다시 계산된 뒤에야 맞으므로 잠깐 기다렸다가 본다.
   */
  useEffect(() => {
    const video = videoRef.current
    const host = hostRef.current
    if (!engaged || !video || !host) return
    const doc = video.ownerDocument
    let timer = 0
    const letGo = () => {
      heldForFullscreen.current = false
      setEngaged(false)
    }
    const onChange = () => {
      if (!heldForFullscreen.current || holdsFullscreen(video)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // 전체화면으로 넘어갈 때 떠났다고 알려 온 탓에 마우스 상태가 어긋나 있다. 바로잡는다.
        const over = host.matches(':hover')
        setHovered(over)
        if (over) host.addEventListener('mouseleave', letGo, { once: true })
        else letGo()
      }, POINTER_SETTLE_MS)
    }
    doc.addEventListener('fullscreenchange', onChange)
    return () => {
      window.clearTimeout(timer)
      doc.removeEventListener('fullscreenchange', onChange)
      host.removeEventListener('mouseleave', letGo)
    }
  }, [engaged])

  /**
   * 재생바를 띄우는지. 마우스를 올렸거나 이 영상을 보기로 했을 때만이다.
   * 남겨 두는 동안에도 켜 둔다 — 전체화면으로 넘어가는 도중에 재생바를 갈아 끼우지 않게.
   */
  const controlsOn = hovered || engaged || lingering

  // Firefox 재생바가 기본값 300px 이 아니라 실제 폭으로 부품을 늘어놓게 한다.
  useEffect(() => {
    const video = videoRef.current
    const host = hostRef.current
    if (!IS_FIREFOX || !showVideo || !controlsOn || !video || !host) return
    return remeasureFirefoxControls(video, host)
  }, [showVideo, controlsOn])

  /** 대신 다는 위치 막대에 쓸 값. Firefox 에서 영상이 떠 있을 때만 지켜본다. */
  const [track, setTrack] = useState({ width: 0, time: 0, duration: 0 })
  useEffect(() => {
    const video = videoRef.current
    if (!IS_FIREFOX || !showVideo || !video) return
    const read = () =>
      setTrack({
        width: video.clientWidth,
        time: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      })
    read()
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'seeking'] as const
    events.forEach((type) => video.addEventListener(type, read))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    observer?.observe(video)
    return () => {
      events.forEach((type) => video.removeEventListener(type, read))
      observer?.disconnect()
    }
  }, [showVideo])

  const needSeekBar =
    IS_FIREFOX &&
    showVideo &&
    controlsOn &&
    track.duration > 0 &&
    !firefoxShowsScrubber({
      width: track.width,
      duration: track.duration,
      fullscreen: Boolean(hostRef.current?.ownerDocument.fullscreenEnabled),
    })

  /** 이 영상을 전체화면으로. 단추를 누른 것은 이 영상을 보기로 한 것이라 소리도 켠다. */
  const enterFullscreen = () => {
    const video = videoRef.current
    if (!video) return
    // 이미 눌러서 보던 영상이면 빠져나온 뒤에도 그대로 돈다.
    if (!engaged) heldForFullscreen.current = true
    setEngaged(true)
    // 막힌 환경(권한 정책 등)이면 그 자리에서 계속 볼 뿐이다.
    video.requestFullscreen?.().catch(() => {})
  }

  if (failed) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="grid h-full w-full place-items-center bg-surface-2 px-4 text-center text-[13px] text-muted hover:text-accent"
      >
        재생할 수 없습니다 — x.com 에서 열기
      </a>
    )
  }

  return (
    <button
      ref={hostRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        const action = mediaClick({ playable, engaged })
        // 눌러서 본 영상은 전체화면 때문에 붙든 것이 아니다 — 마우스가 떠나도 계속 돈다.
        if (action !== 'open') heldForFullscreen.current = false
        // 소리를 켠 뒤로는 기본 동작을 막지 않는다. 눌러서 재생·정지하는 것은
        // 브라우저가 해주는 일인데, 여기서 막으면 재생 버튼 위에서만 세우게 된다.
        if (action === 'toggle') return
        event.preventDefault()
        if (action === 'open') {
          onOpen()
          return
        }
        setEngaged(true)
        // 미리보기로 이미 돌고 있던 영상이면 브라우저가 이 클릭을 '세워라' 로 받는다.
        // 막아도 재생바 쪽으로 새는 자리가 있어, 보기로 한 영상은 다시 틀어 둔다.
        videoRef.current?.play().catch(() => {})
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...(playable ? { [PLAYABLE_MARK]: '' } : {})}
      // 눌렀을 때 할 일이 다르면 커서도 달라야 한다. 동영상·GIF 는 그 자리에서
      // 재생되고, 사진만 원본 보기로 확대된다.
      className={`group/media relative block h-full w-full overflow-hidden bg-surface-2 ${
        playable ? 'cursor-pointer' : 'cursor-zoom-in'
      }`}
      aria-label={media.altText ?? (playable ? '동영상 재생' : '이미지 원본 보기')}
    >
      {/* 확대 효과는 두지 않는다. 카드 어디에 마우스를 올려도 섬네일이 들썩여 읽기를 방해한다. */}
      {showVideo && media.playbackUrl ? (
        <video
          ref={videoRef}
          src={media.playbackUrl}
          poster={previewUrl}
          // 재생바는 마우스를 올렸을 때만 띄운다. 저절로 도는 동안에도 늘 떠 있으면
          // 목록이 조작 장치로 뒤덮인다.
          controls={controlsOn}
          autoPlay
          playsInline
          preload="metadata"
          // 소리를 켜기 전까지는 되돌아 돈다. 소리를 켠 영상은 끝나면 멈춘다.
          loop={silent || !engaged}
          muted
          // 재생바를 잡아 옮겼다는 것은 이미 이 영상을 보기로 한 것이다. 누른 것과
          // 똑같이 다뤄 소리를 켠다. 되돌아 도느라 처음으로 돌아가는 것은 사용자가
          // 한 일이 아니므로 시작점 근처는 셈에서 뺀다.
          onSeeking={(event) => {
            if (event.currentTarget.currentTime > 0.05) setEngaged(true)
          }}
          // 재생바의 소리 단추로 켠 것도 눌러서 켠 것과 똑같이 다룬다. 그 단추는
          // 클릭으로 알려 오지 않으므로, 소리가 바뀐 것으로 알아챈다.
          onVolumeChange={(event) => {
            const video = event.currentTarget
            if (!isUserVolume({ silent, engaged, muted: video.muted })) return
            setEngaged(true)
            rememberVolume(video)
          }}
          // 컬럼을 붙드는 근거는 '돌고 있다' 하나다. 끝났거나 세운 것은 놓아준다.
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
          className={`h-full w-full bg-black ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      ) : (
        <img
          src={previewUrl}
          alt={media.altText ?? ''}
          loading="lazy"
          decoding="async"
          className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      )}
      {/*
        재생바와 따로 다는 전체화면 단추.

        크롬은 좁은 영상에서 전체화면을 ⋮ 차림표 안으로 숨긴다. Firefox 는 재생바를
        300px 로 늘어놓아 양 끝이 잘렸다(remeasureFirefoxControls 로 메운다). 어느 쪽이든
        한 번에 누를 자리를 두려고 재생바가 떠 있을 때 같이 띄운다.

        버튼 안이라 <button> 을 다시 쓸 수 없다 — 버튼 안의 버튼은 HTML 이 허락하지 않는다.
      */}
      {needSeekBar && videoRef.current && (
        <SeekBar video={videoRef.current} time={track.time} duration={track.duration} />
      )}
      {showVideo && controlsOn && (
        <span
          role="button"
          tabIndex={0}
          aria-label="전체화면으로 보기"
          title="전체화면"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            enterFullscreen()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            enterFullscreen()
          }}
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          <FullscreenIcon className="h-4 w-4" />
        </span>
      )}
      {/* 마우스가 떠난 뒤 잠깐 남겨 둔 영상은 섬네일로 덮는다. 화면에서는 곧바로 내려간 것과 같다. */}
      {lingering && (
        <img
          src={previewUrl}
          alt=""
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-20 h-full w-full bg-surface-2 ${
            fit === 'cover' ? 'object-cover' : 'object-contain'
          }`}
        />
      )}
      {playable && (!showVideo || lingering) && (
        <span className="absolute inset-0 z-30 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover/media:bg-black/70">
            <PlayIcon className="h-5 w-5 translate-x-[1px]" />
          </span>
        </span>
      )}
      {media.kind === 'animated_gif' && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
          GIF
        </span>
      )}
    </button>
  )
}

/** 무엇이 몇 개 붙어 있는지 한 줄로. 없는 종류는 아예 적지 않는다. */
function summarize(media: TweetMedia[]): string {
  const count = (kind: TweetMedia['kind']) => media.filter((item) => item.kind === kind).length
  return (
    [
      count('photo') && `사진 ${count('photo')}`,
      count('video') && `동영상 ${count('video')}`,
      count('animated_gif') && `GIF ${count('animated_gif')}`,
    ]
      .filter(Boolean)
      .join(' · ') || `첨부 ${media.length}`
  )
}

/**
 * 미디어가 들어갈 자리.
 *
 * 라벨 모드에서는 무엇이 붙어 있는지만 알려주고, 눌러야 그 자리에서 펼친다.
 * 펼친 상태는 카드마다 따로 기억한다 — 하나 열었다고 목록 전체가 열리면
 * 라벨로 둔 뜻이 없어진다.
 */
export function MediaSlot({
  media,
  mode,
  size,
  sourceUrl,
  hoverPlay,
  onOpen,
}: {
  media: TweetMedia[]
  mode: MediaMode
  size: MediaSize
  sourceUrl: string
  hoverPlay: boolean
  onOpen?: (index: number) => void
}) {
  const [revealed, setRevealed] = useState(false)

  if (mode === 'hide' || media.length === 0) return null

  if (mode === 'label' && !revealed) {
    const playable = media.some((item) => item.kind !== 'photo')
    const Glyph = playable ? PlayIcon : ImageIcon
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setRevealed(true)
        }}
        className="mt-2.5 flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px] font-medium text-muted transition-colors hover:border-button hover:text-text"
      >
        <Glyph className="h-3.5 w-3.5" />
        {summarize(media)} 보기
      </button>
    )
  }

  return (
    <MediaGrid
      media={media}
      size={size}
      sourceUrl={sourceUrl}
      hoverPlay={hoverPlay}
      onOpen={onOpen}
    />
  )
}

export interface MediaGridProps {
  media: TweetMedia[]
  /** 표시 크기. 작을수록 한 화면에 글이 많이 들어온다. */
  size: MediaSize
  /** 재생이 실패했을 때 열어줄 원문 주소. */
  sourceUrl: string
  /** 마우스를 올린 것만으로 미리 재생할지. */
  hoverPlay: boolean
  /** 사진을 눌렀을 때 원본 보기를 띄운다. */
  onOpen?: (index: number) => void
}

export function MediaGrid({ media, size, sourceUrl, hoverPlay, onOpen }: MediaGridProps) {
  const columnPixels = useColumnPixels()
  if (media.length === 0) return null

  const single = media.length === 1
  const first = media[0]
  const maxHeight = MEDIA_MAX_HEIGHT[size]
  const ratio = single && first ? aspectRatio(first.width, first.height) : 16 / 9

  const style: React.CSSProperties = { aspectRatio: ratio }
  if (maxHeight !== null) style.maxHeight = maxHeight

  // 높이를 자르는 크기에서는 여백이 생기지 않도록 채워서 자른다.
  const fit: 'cover' | 'contain' = maxHeight === null && single ? 'contain' : 'cover'

  /*
   * 이 격자의 칸 하나에 필요한 가로 픽셀.
   *
   * 사진이 여러 장이면 2열로 깔리므로 칸은 컬럼의 절반만 쓴다 — 4 장짜리 글은
   * 필요한 픽셀이 4 분의 1 로 떨어진다.
   *
   * 폭을 아직 재지 못했으면(컬럼 밖에서 그려질 때) 가장 큰 크기로 물러선다.
   * 작게 받았다가 곧바로 다시 받는 것이 제일 나쁘다.
   */
  const itemPixels = columnPixels > 0 ? columnPixels * (single ? 1 : GRID_SHARE) : Infinity

  return (
    <div
      className={`mt-2.5 grid gap-0.5 overflow-hidden rounded-xl border border-line-soft ${layoutClass(media.length)}`}
      style={style}
    >
      {media.slice(0, 4).map((item, index) => (
        <div key={`${item.previewUrl}-${index}`} className={`min-h-0 ${itemClass(media.length, index)}`}>
          <MediaItem
            media={item}
            fit={fit}
            pixels={itemPixels}
            sourceUrl={sourceUrl}
            hoverPlay={hoverPlay}
            onOpen={() => onOpen?.(index)}
          />
        </div>
      ))}
    </div>
  )
}
