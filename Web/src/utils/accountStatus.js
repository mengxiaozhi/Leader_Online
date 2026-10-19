const RELATION_LABELS = {
  account: '帳號',
  owner: '所屬帳號',
  provider: '服務商帳號',
  deliveryPoint: '交車點帳號',
  driver: '司機帳號',
  coach: '教練帳號',
}

export function accountStatusMessages(record = {}) {
  const relations = Array.isArray(record?.accountRelations) ? record.accountRelations : []
  const messages = relations.flatMap(entry => {
    const { relation, status } = entry || {}
    if (!['deleted', 'missing'].includes(status)) return []
    const label = RELATION_LABELS[relation] || '關聯帳號'
    return [`${label}${status === 'deleted' ? '已刪除' : '已不存在'}`]
  })
  if (!messages.length && record?.accountDeleted === true) messages.push('帳號已刪除')
  return [...new Set(messages)]
}
