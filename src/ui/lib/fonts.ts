/**
 * 글꼴 선택에 필요한 것들.
 *
 * 로컬 글꼴 목록은 브라우저가 아무에게나 주지 않는다 — 사용자가 직접 누른 순간에만
 * 물어볼 수 있고, 허락도 받아야 한다. 그래서 목록을 미리 채워둘 수 없고, 거절당하거나
 * 지원하지 않는 환경도 정상 경로로 다뤄야 한다.
 */

/** 브라우저가 돌려주는 글꼴 하나. 우리는 집안 이름만 쓴다. */
interface LocalFontData {
  family: string
}

type QueryLocalFonts = () => Promise<LocalFontData[]>

/** 목록을 못 받았을 때 대신 보여줄 후보. 없는 글꼴은 그냥 기본으로 그려진다. */
export const COMMON_FONTS = [
  'Pretendard Variable',
  'Malgun Gothic',
  'NanumGothic',
  'NanumBarunGothic',
  'Noto Sans KR',
  'Spoqa Han Sans Neo',
  'Segoe UI',
  'Arial',
  'Georgia',
  'Consolas',
  'D2Coding',
]

/** 고른 글꼴 뒤에 받쳐둘 기본 묶음. 한글이 빠진 글꼴을 골라도 글이 깨지지 않는다. */
const FALLBACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif`

export type FontLoad =
  | { ok: true; families: string[] }
  | { ok: false; reason: 'unsupported' | 'denied' }

/** 타입 정의에 아직 없는 API 라 여기서 좁게 선언해 꺼낸다. */
function localFontQuery(): QueryLocalFonts | null {
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts
  return typeof query === 'function' ? query.bind(window) : null
}

/** 이 PC 에 설치된 글꼴 집안 이름을 읽어온다. 반드시 사용자가 누른 자리에서 부른다. */
export async function loadLocalFontFamilies(): Promise<FontLoad> {
  const query = localFontQuery()
  if (!query) return { ok: false, reason: 'unsupported' }
  try {
    const fonts = await query()
    const families = [...new Set(fonts.map((font) => font.family))].sort((a, b) =>
      a.localeCompare(b, 'ko'),
    )
    return { ok: true, families }
  } catch {
    // 거절했거나 사용자 조작 없이 불렀을 때. 둘 다 여기로 떨어진다.
    return { ok: false, reason: 'denied' }
  }
}

/**
 * 설정값을 CSS `font-family` 로 바꾼다. 고르지 않았으면 `undefined` —
 * 인라인 스타일을 아예 걸지 않아 스타일시트의 기본 글꼴이 그대로 산다.
 * 이름에 든 따옴표·중괄호는 지운다. 그대로 넣으면 규칙 자체가 깨진다.
 */
export function fontStack(family: string): string | undefined {
  const clean = family.trim().replace(/["'\\;{}]/g, '')
  return clean ? `"${clean}", ${FALLBACK}` : undefined
}
