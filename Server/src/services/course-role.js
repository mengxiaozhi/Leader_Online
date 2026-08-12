const COURSE_ROLE_REFRESHED = Symbol('courseRoleRefreshed');

function normalizeCoursePlatformRole(value) {
  const role = String(value ?? '').trim().slice(0, 32).toUpperCase();
  return role === 'STORE' ? 'SERVICE_PROVIDER' : role;
}

function courseRoleError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function refreshCourseRequestUser(pool, req) {
  const userId = String(req?.user?.id ?? '').trim();
  if (!userId) {
    throw courseRoleError('AUTH_REQUIRED', '請先登入', 401);
  }
  if (req[COURSE_ROLE_REFRESHED]?.userId === userId) return req.user;
  if (!pool || typeof pool.query !== 'function') {
    throw courseRoleError('COURSE_STAFF_AUTH_FAIL', '課程權限檢查缺少資料庫連線', 500);
  }

  const [rows] = await pool.query(
    'SELECT id, role FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  const current = rows?.[0];
  if (!current) {
    throw courseRoleError('AUTH_INVALID_TOKEN', '登入已過期或無效', 401);
  }

  req.user = {
    ...req.user,
    id: current.id,
    role: normalizeCoursePlatformRole(current.role || 'USER'),
  };
  req[COURSE_ROLE_REFRESHED] = {
    userId: String(current.id),
    role: req.user.role,
  };
  return req.user;
}

module.exports = {
  normalizeCoursePlatformRole,
  refreshCourseRequestUser,
};
