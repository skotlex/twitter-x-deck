// 확장 아이콘 생성기. 이미지 편집 도구 없이 저장소만으로 아이콘을 재현할 수 있게
// 벡터 정의를 코드로 두고 PNG 로 굽는다. 디자인을 바꾸면 `node scripts/make-icons.mjs` 만 다시 돌리면 된다.
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons')
const SIZES = [16, 32, 48, 128]

/** 배경 정사각형의 모서리 반경. 아이콘 한 변에 대한 비율이다. */
const CORNER = 0.24

/**
 * x.com 로고 마크. 공식 24x24 아트웍의 꼭짓점을 그대로 옮겼다.
 * 획 끝이 비스듬히 잘려 있어 닫기 버튼(둥근 끝 X)과 구분된다.
 * 첫 윤곽이 바깥, 둘째 윤곽이 왼쪽 위–오른쪽 아래 획을 가르는 구멍이다 (even-odd).
 */
const GLYPH_CONTOURS = [
  [
    [18.244, 2.25],
    [21.552, 2.25],
    [14.325, 10.51],
    [22.827, 21.75],
    [16.17, 21.75],
    [10.956, 14.933],
    [4.99, 21.75],
    [1.68, 21.75],
    [9.41, 12.915],
    [1.254, 2.25],
    [8.08, 2.25],
    [12.793, 8.481],
  ],
  [
    [17.083, 19.77],
    [18.916, 19.77],
    [7.084, 4.126],
    [5.117, 4.126],
  ],
]

/** 아이콘 한 변 대비 로고의 긴 변 비율. */
const GLYPH_SCALE = 0.54

/** 로고를 0..1 좌표계 한가운데로 옮기고 GLYPH_SCALE 에 맞춰 균등 축소한다. */
const GLYPH = (() => {
  const points = GLYPH_CONTOURS.flat()
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = GLYPH_SCALE / Math.max(maxX - minX, maxY - minY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return GLYPH_CONTOURS.map((contour) =>
    contour.map(([x, y]) => [0.5 + (x - cx) * scale, 0.5 + (y - cy) * scale]),
  )
})()

// x.com 의 검정 계열. 위아래로 아주 옅은 기울기만 줘서 어두운 배경에서도 면이 죽지 않게 한다.
const GRADIENT_TOP = [26, 28, 32]
const GRADIENT_BOTTOM = [10, 11, 14]

/** 둥근 사각형 내부이면 true. 좌표는 0..1 정규화. */
function insideRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 로고 내부이면 true. even-odd 규칙으로 안쪽 구멍까지 처리한다. */
function insideGlyph(x, y) {
  let inside = false
  for (const contour of GLYPH) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i, i += 1) {
      const [xi, yi] = contour[i]
      const [xj, yj] = contour[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4)
  // 로고의 비스듬한 획 끝이 작은 크기에서도 뭉개지지 않도록 픽셀당 6x6 슈퍼샘플링한다
  const samples = 6

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgCoverage = 0
      let glyphCoverage = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          if (!insideRoundedRect(x, y, CORNER)) continue
          bgCoverage += 1

          if (insideGlyph(x, y)) glyphCoverage += 1
        }
      }

      const total = samples * samples
      const alpha = bgCoverage / total
      const stroke = glyphCoverage / total

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
