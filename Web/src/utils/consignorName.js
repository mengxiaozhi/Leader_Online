export const normalizeConsignorName = value => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ')
  : ''

export const resolveConsignorName = (value, buyerName) =>
  normalizeConsignorName(value) || normalizeConsignorName(buyerName)

export const formatConsignorName = (value, { required = false } = {}) =>
  normalizeConsignorName(value) || (required ? '尚未填寫' : '未提供（不影響託運）')
