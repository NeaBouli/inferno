// middleware/adminCheck.js — Nur autorisierte User IDs für /admin

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => parseInt(id.trim()))
  .filter(Boolean);

async function adminOnly(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ADMIN_IDS.includes(userId)) {
    // Silent ignore — kein Hinweis dass es den Command gibt
    return;
  }
  return next();
}

module.exports = adminOnly;
