/**
 * API 模块统一入口
 * @module api
 */

import { handleUsersApi } from './users.js';
import { handleMailboxesApi } from './mailboxes.js';
import { handleEmailsApi } from './emails.js';
import { handleSendApi } from './send.js';
import { getJwtPayload, errorResponse } from './helpers.js';

/**
 * 处理所有 API 请求
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {Array<string>} mailDomains - 邮件域名列表
 * @param {object} options - 选项
 * @returns {Promise<Response>} HTTP 响应
 */
export async function handleApiRequest(request, db, mailDomains, options = {
    mockOnly: false,
    resendApiKey: '',
    adminName: '',
    r2: null,
    authPayload: null,
    mailboxOnly: false
}) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ================= 新增：深度兼容旧版 CloudflareTempMail 客户端 =================
    // 拦截旧版客户端请求的 /api/mails，使用全字段嗅探，彻底解决 SQLite 列名不匹配报错
    if (path === '/api/mails' && request.method === 'GET') {
        try {
            // 1. 校验并获取当前邮箱权限
            const payload = getJwtPayload(request, options);
            if (!payload || !payload.mailboxAddress) {
                return errorResponse('访问被拒绝', 403);
            }

            // 2. 解析脚本传过来的分页参数
            const limit = parseInt(url.searchParams.get('limit')) || 20;
            const offset = parseInt(url.searchParams.get('offset')) || 0;

            // 3. 获取真实的邮箱 ID
            let mailboxId = payload.mailboxId;
            if (!mailboxId) {
                const mbRes = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(payload.mailboxAddress).first();
                if (mbRes) mailboxId = mbRes.id;
            }

            if (!mailboxId) return Response.json([]);

            // 4. 使用 SELECT *，把映射工作交给 JS，这样就不会触发 SQLite 的列名报错了
            const { results } = await db.prepare(`
                SELECT * FROM messages 
                WHERE mailbox_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).bind(mailboxId, limit, offset).all();

            // 5. 自动嗅探匹配实际存在的列名，打包成旧版客户端期望的格式
            const mappedResults = (results || []).map(row => {
                // 自动匹配发件人字段：sender / mail_from / from / from_address
                const sender = row.sender || row.mail_from || row['from'] || row.from_address || row.source || '未知发件人';
                
                // 自动匹配邮件正文：优先纯文本(text)，其次是其他格式
                const body = row.text || row.body_text || row.intro || row.html || row.body_html || row.message || '';
                
                return {
                    id: row.id,
                    source: sender,
                    subject: row.subject || '',
                    message: body,
                    created_at: row.created_at
                };
            });

            return Response.json(mappedResults);
        } catch (e) {
            console.error('兼容接口报错:', e.message);
            return Response.json([]); // 防御性返回空数组，避免脚本闪退
        }
    }
    // ==============================================================================

    const isMock = !!options.mockOnly;
    const isMailboxOnly = !!options.mailboxOnly;

    // 邮箱用户只能访问特定的API端点和自己的数据
    if (isMailboxOnly) {
        const payload = getJwtPayload(request, options);
        const mailboxAddress = payload?.mailboxAddress;
        const mailboxId = payload?.mailboxId;
        
        // 允许的API端点
        const allowedPaths = ['/api/emails', '/api/email/', '/api/auth', '/api/quota', '/api/mailbox/info', '/api/mailbox/password'];
        const isAllowedPath = allowedPaths.some(allowedPath => path.startsWith(allowedPath));
        
        if (!isAllowedPath) {
            return errorResponse('访问被拒绝', 403);
        }
        
        // 对于邮件相关API，限制只能访问自己的邮箱
        if (path === '/api/emails' && request.method === 'GET') {
            const requestedMailbox = url.searchParams.get('mailbox');
            if (requestedMailbox && requestedMailbox.toLowerCase() !== mailboxAddress?.toLowerCase()) {
                return errorResponse('只能访问自己的邮箱', 403);
            }
            // 如果没有指定邮箱，自动设置为用户自己的邮箱
            if (!requestedMailbox && mailboxAddress) {
                url.searchParams.set('mailbox', mailboxAddress);
            }
        }
        
        // 对于单个邮件操作，验证邮件是否属于该用户的邮箱
        if (path.startsWith('/api/email/') && mailboxId) {
            const emailId = path.split('/')[3];
            if (emailId && emailId !== 'batch') {
                try {
                    const { results } = await db.prepare('SELECT mailbox_id FROM messages WHERE id = ? LIMIT 1').bind(emailId).all();
                    if (!results || results.length === 0) {
                        return errorResponse('邮件不存在', 404);
                    }
                    if (results[0].mailbox_id !== mailboxId) {
                        return errorResponse('无权访问此邮件', 403);
                    }
                } catch (e) {
                    return errorResponse('验证失败', 500);
                }
            }
        }
    }

    // 依次尝试各个 API 处理器
    let response;

    // 用户管理 API
    response = await handleUsersApi(request, db, url, path, options);
    if (response) return response;

    // 邮箱管理 API
    response = await handleMailboxesApi(request, db, mailDomains, url, path, options);
    if (response) return response;

    // 邮件 API
    response = await handleEmailsApi(request, db, url, path, options);
    if (response) return response;

    // 发送 API
    response = await handleSendApi(request, db, url, path, options);
    if (response) return response;

    return errorResponse('未找到 API 路径', 404);
}

export { handleUsersApi } from './users.js';
export { handleMailboxesApi } from './mailboxes.js';
export { handleEmailsApi } from './emails.js';
export { handleSendApi } from './send.js';
