// 多订阅者每日广播
// 读取本轮抓取结果（dist/records.json），从「中间站」拉取订阅者列表（或全部收件人），
// 逐一单独发送邮件（避免把所有人邮箱暴露在同一个 To 头里）。
// 若未配置中间站，则回退到单一收件人 TO_EMAIL（保持旧逻辑可用）。

import fs from 'fs';
import nodemailer from 'nodemailer';

const recordsPath = 'dist/records.json';
const dashboardUrl = process.env.DASHBOARD_URL || 'https://keats-314.github.io/cloud-automation/';
const today = new Date().toISOString().slice(0, 10);

function loadRecords() {
  try {
    return JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
  } catch (e) {
    console.log('读取 records 失败:', e.message);
    return { total: 0, new: 0, updated: '', records: [] };
  }
}

function buildBody(total, nnew, updated) {
  return `双选会监控 · 每日自动播报（${today}）

📊 当前总记录数：${total} 条
🆕 本轮新增：${nnew} 条
🕒 数据更新时间：${updated}

👉 完整看板（永久链接，点开即看）：
${dashboardUrl}

—— 本邮件由系统每日 08:00 自动抓取后群发。如需退订，回复「退订」或访问看板底部取消订阅。`;
}

// 获取收件人：优先从 Kit（ConvertKit）受众列表拉取，其次旧中间站接口，最后回退 TO_EMAIL
async function getRecipients() {
  const apiKey = process.env.KIT_API_KEY;
  const formId = process.env.KIT_FORM_ID;
  const ep = process.env.SUBSCRIBE_ENDPOINT;
  const key = process.env.ADMIN_KEY;
  const toEmail = process.env.TO_EMAIL;
  let list = [];

  // 1) Kit (ConvertKit) 受众（主来源）
  if (apiKey) {
    try {
      const url = 'https://api.kit.com/v4/subscribers?per_page=1000';
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + apiKey } });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.subscribers)) list = j.subscribers.map(s => s.email_address).filter(Boolean);
        console.log('Kit 返回订阅者:', list.length, '人');
      } else {
        console.log('Kit 拉取返回非 200:', r.status, await r.text().catch(() => ''));
      }
    } catch (e) {
      console.log('Kit 拉取异常，回退:', e.message);
    }
  }

  // 2) 旧自定义中间站接口（兼容保留）
  if (ep && key && list.length === 0) {
    try {
      const url = ep.replace(/\/$/, '') + '/subscribers?key=' + encodeURIComponent(key);
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.emails)) list = j.emails;
        console.log('中间站返回订阅者:', list.length, '人');
      } else {
        console.log('中间站拉取返回非 200:', r.status);
      }
    } catch (e) {
      console.log('中间站拉取失败，回退单收件人:', e.message);
    }
  }

  // 3) 单一收件人兜底
  if (toEmail) {
    list = list.concat(toEmail.split(',').map(s => s.trim()).filter(Boolean));
  }
  // 去重（转小写比较，保留原大小写首个）
  const seen = new Set();
  const dedup = [];
  for (const e of list) {
    const k = String(e).toLowerCase();
    if (!seen.has(k)) { seen.add(k); dedup.push(e); }
  }
  return dedup;
}

async function main() {
  const smtpServer = process.env.SMTP_SERVER;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;

  if (!smtpServer || !smtpUser || !smtpPass) {
    console.log('未配置 SMTP 密钥，跳过邮件发送。');
    return;
  }

  const rec = loadRecords();
  const recipients = await getRecipients();
  if (recipients.length === 0) {
    console.log('无收件人，跳过。');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpServer,
    port: Number(smtpPort) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass }
  });

  const body = buildBody(rec.total || 0, rec.new || 0, rec.updated || '');
  let ok = 0;
  for (const to of recipients) {
    try {
      await transporter.sendMail({
        from: smtpUser,
        to,
        subject: `【双选会监控】每日播报 ${today}`,
        text: body
      });
      ok++;
      console.log('已发送 ->', to);
    } catch (e) {
      console.log('发送失败', to, e.message);
    }
  }
  console.log(`广播完成：成功 ${ok}/${recipients.length}`);
}

main().catch(e => { console.error('广播异常:', e); process.exit(1); });
