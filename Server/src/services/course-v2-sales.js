function shouldIncludeRequiredAddons(requireAddonForNew, returningEligible) {
  return Boolean(Number(requireAddonForNew || 0)) && returningEligible !== true;
}

function isBundleIssuableShopProductStatus(status) {
  return !['archived', 'disabled', 'inactive'].includes(String(status || '').trim().toLowerCase());
}

async function resolveReturningEligibility(queryable, {
  productId,
  userId,
  forUpdate = false,
} = {}) {
  if (!queryable || !productId || !userId) return null;
  const [rows] = await queryable.query(
    `SELECT previous.id
       FROM course_product_returning_requirements requirement
       JOIN course_tickets previous
         ON previous.ticket_product_id = requirement.qualifying_ticket_product_id
       LEFT JOIN course_students previous_student ON previous_student.id = previous.student_id
      WHERE requirement.product_id = ?
        AND (previous.user_id = ? OR previous_student.user_id = ?)
        AND (
          requirement.lookback_days IS NULL
          OR previous.issued_at >= DATE_SUB(NOW(), INTERVAL requirement.lookback_days DAY)
        )
      ORDER BY previous.issued_at DESC, previous.id DESC
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [productId, userId, userId]
  );
  return Boolean(rows[0]);
}

module.exports = {
  shouldIncludeRequiredAddons,
  isBundleIssuableShopProductStatus,
  resolveReturningEligibility,
};
