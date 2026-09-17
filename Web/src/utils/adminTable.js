export function normalizeTableDensity(value) { return value === 'compact' ? 'compact' : 'comfortable' }

export function tableScrollState({ clientWidth = 0, scrollWidth = 0, scrollLeft = 0, clientHeight = 0, scrollHeight = 0 }) {
  const maxScroll = Math.max(0, scrollWidth - clientWidth)
  return {
    overflow: clientWidth > 0 && maxScroll > 2,
    verticalOverflow: clientHeight > 0 && scrollHeight - clientHeight > 2,
    canScrollLeft: clientWidth > 0 && scrollLeft > 2,
    canScrollRight: clientWidth > 0 && maxScroll - scrollLeft > 2,
  }
}
