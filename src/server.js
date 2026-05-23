/**
 * Freemail 主入口
 * @module server
 */

import { Hono } from 'hono';
import { authMiddleware } from './middleware/app.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import staticRoutes from './routes/static.js';
import { handleEmailEvent } from './email/handler.js';
import { getOrCreateMailboxId } from './db/mailboxes.js';
import { createJwt } from './middleware/auth.js';
import { generateRandomId } from './utils/common.js';
import { getInitializedDatabase } from './db/connection.js';

const app = new Hono();

// 全局安全响应头
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.req.url.startsWith('https:')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  await next();
});

// =================【兼容老版注册器：一键创建新邮箱接口】=================
app.post("/admin/new_address", async (c) => {
  const adminAuth = c.req.header("x-admin-auth") || "";
  const ADMIN_PASSWORD = c.env.ADMIN_PASSWORD || c.env.ADMIN_PASS || "";
  if (!ADMIN_PASSWORD || adminAuth !== ADMIN_PASSWORD) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  let DB;
  try {
    DB = await getInitializedDatabase(c.env);
  } catch (error) {
    return c.json({ error: "Database connection failed" }, 500);
  }
  const MAIL_DOMAINS = (c.env.MAIL_DOMAIN || "temp.example.com").split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);
  try {
    const body = await c.req.json().catch(() => ({}));
    const rawName = String(body.name || "").trim();
    const targetDomain = String(body.domain || MAIL_DOMAINS[0] || "temp.example.com").trim();
    const letters1 = rawName.slice(0, 5).toLowerCase() || generateRandomId(5);
    const numbers = (rawName.match(/\d+/) || [String(Math.floor(Math.random() * 999) + 1)])[0];
    const letters2 = rawName.replace(/^[a-z]+/, "").replace(/\d+/, "").toLowerCase() || generateRandomId(3);
    const name = letters1 + numbers + letters2;
    const email = `${name}@${targetDomain}`;
    const mailboxId = await getOrCreateMailboxId(DB, email);
    if (!mailboxId) {
      return c.json({ error: "Failed to create mailbox" }, 500);
    }
    const JWT_TOKEN = c.env.JWT_TOKEN || c.env.JWT_SECRET || "";
    const SESSION_EXPIRE_DAYS = parseInt(c.env.SESSION_EXPIRE_DAYS, 10) || 7;
    const jwt = await createJwt(JWT_TOKEN, {
      role: "mailbox",
      username: email,
      mailboxId,
      mailboxAddress: email,
      scope: "mailbox"
    }, SESSION_EXPIRE_DAYS);
    return c.json({ address: email, jwt }, 200);
  } catch (e) {
    console.error("new_address error:", e);
    return c.json({ error: String(e?.message || "Internal error") }, 500);
  }
});
// =====================================================================

// 公开认证路由（/api/logout, /api/login）
app.route('/', authRoutes);

// 认证中间件
app.use('/api/*', authMiddleware());
app.use('/receive', authMiddleware());

// 受保护 API 路由（/api/session, /receive, /api/*）
app.route('/', apiRoutes);

// 静态资源路由（必须在最后）
app.route('/', staticRoutes);

export default {
  fetch: app.fetch,
  async email(message, env, ctx) {
    return handleEmailEvent(message, env, ctx);
  }
};
