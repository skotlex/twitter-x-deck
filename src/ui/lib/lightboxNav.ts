/** 라이트박스에서 보고 있는 자리. 몇 번째 글의 몇 번째 사진인지. */
export interface PhotoPosition {
  group: number
  index: number
}

/**
 * 한 장 옮긴 자리. 더 갈 곳이 없으면 null.
 *
 * 끝에서 처음으로 되돌아가지 않는다. 되감기면 끝에 닿았다는 것을 알 길이 없다.
 * 글의 끝에 닿으면 다음 글(타래)로 넘어가고, 앞으로 갈 때는 앞 글의 마지막 사진에
 * 선다 — 거꾸로 넘겨도 바로 이어 보이게.
 *
 * @param sizes 묶음마다의 사진 수. 사진이 없는 묶음은 건너뛴다.
 */
export function stepPhoto(
  sizes: readonly number[],
  at: PhotoPosition,
  delta: 1 | -1,
): PhotoPosition | null {
  const next = at.index + delta
  if (next >= 0 && next < (sizes[at.group] ?? 0)) return { group: at.group, index: next }

  for (let group = at.group + delta; group >= 0 && group < sizes.length; group += delta) {
    const size = sizes[group] ?? 0
    if (size > 0) return { group, index: delta > 0 ? 0 : size - 1 }
  }
  return null
}
