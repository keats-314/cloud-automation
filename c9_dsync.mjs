// c9_dsync.mjs — 每日全 C9 双选会同步引擎
// 作用：每天对各 C9 高校抓取「双选会」(标题含"双选会"，未来日期) 并合并进 data/candidates.json。
// 规则（与看板口径一致）：只收双选会；"专场/宣讲/招聘活动/招聘会"无"双选会"字样不收。
// 适配：浙大=官方JSON接口(已验证)；其余=官方列表页HTML解析(仅收录能解析出未来日期者，严谨不灌水)。
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SCHOOLS } from './schools.mjs';
import * as cheerio from 'cheerio';

const CAND = 'data/candidates.json';
const TODAY = new Date();
const TODAY_STR = TODAY.toISOString().slice(0, 10);
const THIS_YEAR = TODAY.getFullYear();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

function ymd(d) { return d.toISOString().slice(0, 10); }
function future(dateStr) { return dateStr && dateStr >= TODAY_STR; }

// 简易日期提取：返回 YYYY-MM-DD 或 null
function extractDateSimple(text) {
  if (!text) return null;
  let m = text.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (m) return `${THIS_YEAR}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// —— 浙大官方接口适配器（已验证，返回确切日期） ——
async function zjuAdapter(school) {
  const B = 'https://www.career.zju.edu.cn';
  const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Content-Type': 'application/json', 'Origin': B, 'Referer': B + '/jyweb/notification' };
  const out = [];
  try {
    let cur = 1;
    while (cur <= 20) {
      const r = await fetch(B + '/v5-api/jyxt/wzsy/getZhZphQtListAjax.zf', { method: 'POST', headers: H, body: JSON.stringify({ xxdm: '10335', current: cur, size: 100, zphmc: '双选会' }) });
      const j = await r.json();
      const recs = (j.result && j.result.records) || [];
      if (!recs.length) break;
      for (const x of recs) {
        if (!x.zphmc || !x.zphmc.includes('双选会')) continue;
        const ds = x.zphkssj ? x.zphkssj.slice(0, 10) : null;
        if (!future(ds)) continue;
        out.push({
          school: school.name, province: school.province, title: x.zphmc,
          date: ds, date_end: x.zphjssj ? x.zphjssj.slice(0, 10) : ds,
          place: x.cdmc || '', organizer: '',
          url: `${B}/jyweb/recruitment/meetingDetail?zphbh=${x.zphbh}&ywlx=zph`,
          domain: 'www.career.zju.edu.cn', source: `浙江大学就业网官方接口 getZhZphQtListAjax.zf（xxdm=10335，名称含"双选会"）`,
        });
      }
      const total = (j.result && j.result.total) || 0;
      if (out.length >= total || recs.length < 100) break;
      cur++;
    }
  } catch (e) { console.log('  [浙大API] 异常', e.message); }
  return out;
}

// —— 从页面/JS 中挖掘数据接口（Kendo transport / ajax / fetch 等） ——
function findApiEndpoints(html, base) {
  const eps = new Set();
  // Kendo: transport:{ read:{ url:"..." } } 或 url: "..."
  const re1 = /url\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re1.exec(html))) eps.add(m[1]);
  // fetch("...") / $.get("...") / ajax({url:"..."})
  const re2 = /(?:fetch|get|post|ajax)\s*\(\s*["']([^"']+)["']/g;
  while ((m = re2.exec(html))) eps.add(m[1]);
  const out = [];
  for (let e of eps) {
    if (!/list|List|zph|Zph|fair|Fair|recruit|meeting|get|Get|api|Api|data|Data|\.do|\.json/i.test(e)) continue;
    if (e.startsWith('//')) e = base.protocol + e;
    if (e.startsWith('/')) e = base.origin + e;
    if (!/^https?:\/\//.test(e)) continue;
    out.push(e);
  }
  return [...new Set(out)];
}

// —— 递归扫描 JSON，找出"标题含双选会 + 含举办日期"的对象（字段名无关，通用） ——
// 日期字段优先级：优先"举办时间"类键名（kssj/date/sj/rq/time/hold...），其次任意日期，避免误用发布时间
const EVENT_DATE_KEYS = /(kssj|jssj|hold|event|meet|zph|fair|start|begin|rq|date|time|sj|kss|jss)/i;
function pickDate(obj) {
  // 1) 优先举办时间类键
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && EVENT_DATE_KEYS.test(k)) {
      const dm = v.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/) || v.match(/(\d{1,2})月(\d{1,2})[日号]/);
      if (dm) return dm[0];
    }
  }
  // 2) 任意日期字段
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      const dm = v.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/) || v.match(/(\d{1,2})月(\d{1,2})[日号]/);
      if (dm) return dm[0];
    }
  }
  return null;
}
function scanJson(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const it of node) scanJson(it, acc); return; }
  let title = null, idraw = null;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (!title && (v.includes('双选会') || v.includes('宣讲暨双选会') || v.includes('推介会暨双选会'))) title = v;
      if (!idraw && /(id|ID|bh|bhId|url|href|link|detail|uuid)/.test(k) && v.length < 200) idraw = v;
    }
  }
  if (title) {
    const date = pickDate(node);
    if (date) acc.push({ title, date, idraw });
  }
  for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') scanJson(v, acc);
}

function toRec(school, item, base) {
  const ds = extractDateSimple(item.date);
  if (!future(ds)) return null;
  let url = school.roots[0];
  if (item.idraw && /^https?:\/\//.test(item.idraw)) url = item.idraw;
  else if (item.idraw) { try { url = new URL(item.idraw, base).toString(); } catch {} }
  return {
    school: school.name, province: school.province, title: item.title.trim(),
    date: ds, date_end: ds, place: '', organizer: '',
    url, domain: base.host, source: `官方列表页数据接口通用解析（${base.host}）`,
  };
}

// —— 通用适配器：先试静态锚点；若 0，再试从页面挖掘 JSON 接口并扫描 ——
async function htmlAdapter(school) {
  const out = [];
  for (const root of school.roots || []) {
    const html = await fetchText(root);
    if (!html) continue;
    const base = new URL(root);
    // 1) 静态锚点
    const $ = cheerio.load(html);
    $('a').each((_, el) => {
      const a = $(el);
      const txt = a.text().replace(/\s+/g, ' ').trim();
      if (!txt.includes('双选会')) return;
      let href = a.attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      try { href = new URL(href, base).toString(); } catch { return; }
      const ctx = (a.parent().text() || '') + ' ' + txt;
      const ds = extractDateSimple(ctx);
      if (!future(ds)) return;
      out.push({ school: school.name, province: school.province, title: txt, date: ds, date_end: ds, place: '', organizer: '', url: href, domain: base.host, source: `官方列表页静态解析（${root}）` });
    });
    if (out.length) break;
    // 2) JSON 接口回退
    const eps = findApiEndpoints(html, base);
    for (const ep of eps) {
      try {
        const r = await fetch(ep, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' }, redirect: 'follow' });
        const txt = await r.text();
        let j; try { j = JSON.parse(txt); } catch { continue; }
        const acc = [];
        scanJson(j, acc);
        for (const it of acc) { const rec = toRec(school, it, base); if (rec) out.push(rec); }
        if (out.length) break;
      } catch {}
    }
    if (out.length) break;
  }
  return out;
}

// —— 哈尔滨工业大学官方接口适配器（Kendo listTzgg，fbsj=举办日期，已验证） ——
async function hitAdapter(school) {
  const B = 'https://career.hit.edu.cn';
  const H = { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': B + '/zhxy-xszyfzpt/ssxx?xxfl=%E5%8F%8C%E9%80%89%E4%BC%9A' };
  const out = [];
  try {
    const r = await fetch(B + '/zhxy-xszyfzpt/ssxx/listTzgg', { method: 'POST', headers: H, body: 'info=' + encodeURIComponent(JSON.stringify({ page: 1, pageSize: 50, xxfl: '双选会' })) });
    const j = await r.json();
    const data = (j.module && j.module.data) || [];
    for (const x of data) {
      const title = x.fbxxbt || '';
      if (!title.includes('双选会')) continue;
      const ds = x.fbsj ? x.fbsj.slice(0, 10) : null;
      if (!future(ds)) continue;
      const url = x.tzurl ? x.tzurl : B + '/zhxy-xszyfzpt/ssxx?xxfl=%E5%8F%8C%E9%80%89%E4%BC%9A';
      out.push({ school: school.name, province: school.province, title, date: ds, date_end: ds, place: '', organizer: '', url, domain: 'career.hit.edu.cn', source: `哈尔滨工业大学就业网官方接口 listTzgg（xxfl=双选会）` });
    }
  } catch (e) { console.log('  [哈工大API] 异常', e.message); }
  return out;
}

const ADAPTERS = { zju: zjuAdapter, hit: hitAdapter };

// 去重：同校同日（双选会看板粒度，避免与已有手工记录重复，也避免同日多源重复）
function dedupeKey(r) { return `${r.school}|${r.date}`; }

async function main() {
  if (!existsSync(CAND)) { console.error('缺少', CAND); process.exit(1); }
  const data = JSON.parse(readFileSync(CAND, 'utf-8'));
  const exist = new Set((data.records || []).map(dedupeKey));
  let totalNew = 0;
  const report = [];

  for (const school of SCHOOLS) {
    const adapter = ADAPTERS[school.id] || htmlAdapter;
    const found = await adapter(school);
    const fresh = found.filter(r => !exist.has(dedupeKey(r)));
    for (const r of fresh) {
      exist.add(dedupeKey(r));
      data.records.push({
        ...r,
        year: Number(r.date.slice(0, 4)),
        is_this_year: Number(r.date.slice(0, 4)) === THIS_YEAR,
        stale: false,
        from: r.url,
        source_type: 'official',
        dateConfidence: 'exact',
        monitoring: false,
        verified: true,
        verified_by: 'auto',
        last_checked: TODAY_STR,
        added_by: 'c9_dsync',
        flags: ['auto_dsync'],
      });
    }
    totalNew += fresh.length;
    report.push(`${school.name}: 抓到${found.length} / 新收录${fresh.length}`);
    console.log(`  ${school.name}: 接口/解析 ${found.length} 条双选会，新收录 ${fresh.length} 条`);
  }

  writeFileSync(CAND, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n[c9_dsync] 完成：新增 ${totalNew} 条双选会（今日 ${TODAY_STR}）`);
  console.log(report.join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
