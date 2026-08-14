// 확장 아이콘 생성기. 이미지 편집 도구 없이 저장소만으로 아이콘을 재현할 수 있게
// 벡터 정의를 코드로 두고 PNG 로 굽는다. 디자인을 바꾸면 `node scripts/make-icons.mjs` 만 다시 돌리면 된다.
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons')
const SIZES = [16, 32, 48, 128]

/** 모서리 둥근 정사각형 비율과 X 획 두께. 전부 아이콘 한 변에 대한 비율이다. */
const CORNER = 0.24
const STROKE = 0.13
const INSET = 0.29

const GRADIENT_TOP = [91, 157, 255]
const GRADIENT_BOTTOM = [37, 99, 235]

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** 둥근 사각형 내부이면 true. 좌표는 0..1 정규화. */
function insideRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 점에서 선분까지의 거리. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy))
  const dx = wx - t * vx
  const dy = wy - t * vy
  return Math.hypot(dx, dy)
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 4 // 픽셀당 4x4 슈퍼샘플링으로 계단 현상을 없앤다
  const half = STROKE / 2

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgCoverage = 0
      let strokeCoverage = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          if (!insideRoundedRect(x, y, CORNER)) continue
          bgCoverage += 1

          const d = Math.min(
            distanceToSegment(x, y, INSET, INSET, 1 - INSET, 1 - INSET),
            distanceToSegment(x, y, 1 - INSET, INSET, INSET, 1 - INSET),
          )
          if (d <= half) strokeCoverage += 1
        }
      }

      const total = samples * samples
      const alpha = bgCoverage / total
      const stroke = strokeCoverage / total

      const t = py / Math.max(1, size - 1)
      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const base = GRADIENT_TOP[channel] * (1 - t) + GRADIENT_BOTTOM[channel] * t
        // 흰 X 를 배경 위에 합성한다.
        pixels[offset + channel] = Math.round(base * (1 - stroke) + 255 * stroke)
      }
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }

  return pixels
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10~12 = compression/filter/interlace = 0

  // 각 스캔라인 앞에 필터 바이트(0 = None)를 붙인다.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

await mkdir(outDir, { recursive: true })
for (const size of SIZES) {
  const png = encodePng(size, renderRgba(size))
  await writeFile(resolve(outDir, `icon${size}.png`), png)
  console.log(`icons/icon${size}.png (${png.length} bytes)`)
}
