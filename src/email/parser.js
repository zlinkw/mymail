import PostalMime from 'postal-mime';

/**
 * 解析邮件原文
 * @param {string} raw2 - EML 邮件原始文本
 */
async function parseEmailBody(raw2) {
  if (!raw2) return { text: "", html: "" };
  const email = await PostalMime.parse(raw2);
  return {
    text: email.text || "",
    html: email.html || ""
  };
}

/**
 * 智能提取验证码
 */
function extractVerificationCode({ subject = "", text = "", html = "" } = {}) {
  const subjectText = String(subject || "");
  const textBody = String(text || "").replace(/\s+/g, " ").trim();
  const htmlBody = stripHtml(html).replace(/\s+/g, " ").trim();
  const sources = {
    subject: subjectText,
    body: (textBody || htmlBody || "").trim()
  };
  const minLen = 4;
  const maxLen = 8;
  
  function normalizeDigits(s) {
    const digits = String(s || "").replace(/\D+/g, "");
    if (digits.length >= minLen && digits.length <= maxLen) return digits;
    return "";
  }

  const kw = "(?:verification|one[-\\s]?time|two[-\\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認証码|認証コード|인증코드|코드)";
  const sepClass = "[\\u00A0\\s\\-\u2013\u2014_.\xB7\u2022\u2219\u2027'']";
  const codeChunk = `([0-9](?:${sepClass}?[0-9]){3,7})`;
  
  const subjectOrdereds = [
    new RegExp(`${kw}[^\r\n\\d]{0,20}(?<!\\d)${codeChunk}(?!\\d)`, "i"),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\r\n\\d]{0,20}${kw}`, "i")
  ];
  for (const r of subjectOrdereds) {
    const m = sources.subject.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }
  
  const bodyOrdereds = [
    new RegExp(`${kw}[\\s\\S]{0,30}?(?<!\\d)${codeChunk}(?!\\d)`, "i"),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[\\s\\S]{0,30}?${kw}`, "i")
  ];
  for (const r of bodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }
  
  const looseBodyOrdereds = [
    new RegExp(`${kw}[\\s\\S]{0,80}?(?<!\\d)${codeChunk}(?!\\d)`, "i"),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[\\s\\S]{0,80}?${kw}`, "i")
  ];
  for (const r of looseBodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n && !isLikelyNonVerificationCode(n, sources.body)) {
        return n;
      }
    }
  }
  
  // =================【最强通用 6 位验证码兜底逻辑】=================
  // 如果经过上述所有严格关键字匹配后依然没找到验证码，
  // 直接在邮件标题或正文中寻找首个连续的 6 位数字作为验证码，实现对 Trae、Cursor 等平台的绝对提取
  const loose6DigitRegex = /(?<!\d)([0-9]{6})(?!\d)/;
  
  const subM = sources.subject.match(loose6DigitRegex);
  if (subM && subM[1]) return subM[1];
  
  const bodyM = sources.body.match(loose6DigitRegex);
  if (bodyM && bodyM[1] && !isLikelyNonVerificationCode(bodyM[1], sources.body)) {
    return bodyM[1];
  }
  // =========================================================

  return "";
}

/**
 * 剥离 HTML 标签
 */
function stripHtml(html) {
  const s = String(html || "");
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, (_, n) => {
    try {
      return String.fromCharCode(parseInt(n, 10));
    } catch (_2) {
      return " ";
    }
  }).replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * 排除非验证码（如年份、邮编等）
 */
function isLikelyNonVerificationCode(digits, context = "") {
  if (!digits) return true;
  const year = parseInt(digits, 10);
  if (digits.length === 4 && year >= 2e3 && year <= 2099) {
    return true;
  }
  if (digits.length === 5) {
    const lowerContext = context.toLowerCase();
    if (lowerContext.includes("address") || lowerContext.includes("street") || lowerContext.includes("zip") || lowerContext.includes("postal") || /\b[a-z]{2,}\s+\d{5}\b/i.test(context)) {
      return true;
    }
  }
  const addressPattern = new RegExp(`\\b${digits}\\s+[A-Z][a-z]+(?:,|\\b)`, "i");
  if (addressPattern.test(context)) {
    return true;
  }
  return false;
}

export { parseEmailBody, extractVerificationCode, stripHtml, isLikelyNonVerificationCode };
