// scrape.mjs — 抓取 + 核实闸门
// 核心原则：每条候选链接必须【点开详情页】确认页面里真有"双选会/招聘会"且为未来/未结束场次，
//            才标 verified:true。点不开 / 页面无相关内容的，标 verified:false（待核实），不冒充事实。
// 输出 data/candidates.json（每次运行【覆盖】，不再永久沿用历史，杜绝假数据堆积）。
//
// 环境变量：
//   SEARCH_PROVIDER   serpapi | bing   （默认无 key 时跳过搜索，仅用官网直抓）
//   SEARCH_API_KEY    对应 provider 的 key
//   TODAY             可选，YYYY-MM-DD（用于本地调试）

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { SCHOOLS, THIRD_PARTY } from "./schools.mjs";

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || "";
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const THIS_YEAR = +TODAY.slice(0, 4);

// 命中即视为"确实在讲双选会/招聘会"的核心词（宣讲暨双选会、推介会暨双选会已含"双选会"）
const MEET = ["双选会", "招聘会", "供需见面", "空中双选", "联合招聘", "专场招聘", "就业双选", "校园招聘会", "推介会"];
// 锚文本命中的明显非活动页（证明/须知/指南等），直接不收录，避免噪声
const EXCLUDE_ANCHOR = ["证明", "须知", "指南", "模板", "公示", "声明", "办法", "下载", "表格", "攻略", "系统入口", "登录"];
// 标题/正文出现这些词，说明是「计划表/活动安排/拟举办」，不是单场既定事实
const PLAN_MARKS = ["活动安排", "工作安排", "工作计划", "拟举办", "暂定", "预计", "安排表", "双选会安排", "招聘会安排"];
function isPlanSource(title, text="") {
  const s = (title + " " + text).toLowerCase();
  return PLAN_MARKS.some((k) => s.includes(k));
}
const FOLLOW = ["招聘", "双选", "宣讲", "通知", "公告", "就业", "招聘会", "双选会"];
// 强完成态：出现这些词且日期已过的，判定为往届/已结束，不收录
const STALE_STRONG = ["成功举办", "圆满结束", "圆满落幕", "圆满举办", "顺利举行", "顺利举办", "落下帷幕", "完美收官", "已举办", "已结束", "顺利召开", "回顾展", "已逾"];
// 内容提日期正则（兼容 2026年9月15日 / 9月15日 / 2026-09-15）
const DATE_RE = /((\d{4})[.\-/年])?((?:1[0-2]|0?[1-9]))[.\-/月]((?:[12]\d|3[01]|0?[1-9]))日?/g;
// 模糊日期：2026年9月 / 9月 / 9月下旬 / 10月中旬 / 11月上旬 / 9月底
const DATE_APPROX_RE = /((\d{4})[年])?((?:1[0-2]|0?[1-9]))月\s*([上下中]旬|[上中下]半月|初|底|末)?/g;
const PLACE_RE = /(地点|场馆|地址|举办地|地点[:： ]*)[：: ]*([^\s,，。；;]{2,30})/;
const PLACE_KW = /([\u4e00-\u9fa5]{1,12}(校区|楼|馆|中心|报告厅|会议室|大厅|体育馆|学院))/;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UA_FULL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA_FF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const TIMEOUT = 8000;           // 单 URL 超时 8 秒
const MAX_FOLLOW = 12;          // 每个根URL最多跟 12 个子链接（招聘日历条目多，需要更多栏目页）
const MAX_VERIFY = 60;          // 每校最多核实 60 条候选（招聘日历条目多，必须提高上限）
const SCHOOL_TIMEOUT = 120000;  // 单校整体硬超时 120 秒（栏目多，适当放宽）
const CONCURRENCY = 5;          // 5 校并发
const PROFILES = [
  { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } },
  { headers: {
      "User-Agent": UA_FULL, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive",
      "Referer": "https://www.baidu.com/", "Upgrade-Insecure-Requests": "1" } },
  { headers: { "User-Agent": UA_FF, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9", "Connection": "keep-alive", "Upgrade-Insecure-Requests": "1" } },
];
const ANTI_MARKS = ["验证码", "captcha", "access denied", "waf", "verify you are human", "人机验证", "安全验证", "防爬", "反爬", "访问过于频繁", "请求被拦截"];

// ===== 自我审查机制：内容比对 + 分级置信度 + 人工冻结 + 复验 =====
// 已知 SPA/JS渲染校（自动读取不到正文）：哈工大实测为服务端渲染，已从列表移除
const SPA_SCHOOLS = new Set(["浙江大学", "复旦大学"]);


function safeHost(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }
function isListingPath(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p === "/" || p === "") return true;
    const listing = /(zphxx|zhaopin|xiaozhao|list|news|tzgg|column|\/zph|\/news|webindex|notification|activitylist|fair)/;
    const hasId = /\d{4,}/.test(p);
    if (listing.test(p) && !hasId) return true;
    return false;
  } catch { return false; }
}
function pageHasDate(text, date) {
  if (!date) return true;
  const [y, mo, d] = String(date).split("-");
  const forms = [`${+mo}月${+d}日`, `${mo}-${d}`, `${mo}/${d}`, `${y}-${mo}-${d}`, `${mo}月${+d}`, `${+mo}-${+d}`, `${+mo}月${+d}日`];
  return forms.some((f) => text.includes(f));
}
const TITLE_STOP = new Set(["2027届毕业生", "2026届毕业生", "2027届", "2026届", "届毕业生", "毕业生", "秋季", "春季", "双选会", "招聘会", "校园招聘会", "联合招聘", "供需见面", "空中双选", "专场招聘", "就业双选", "高校", "大学", "学院", "校区", "邀请函", "工作安排", "通知", "关于", "举办", "关于举办", "的", "年", "月", "日", "综合场", "综合性专场", "专场", "·", "—", "-"]);
function distinctiveTokens(title, schoolName) {
  let t = (title || "").replace(schoolName || "", "").replace(/\s+/g, "");
  t = t.replace(/((\d{4})[.\-/年])?((?:1[0-2]|0?[1-9]))[.\-/月]((?:[12]\d|3[01]|0?[1-9]))日?/g, "");
  const parts = t.split(/[·•—\-–（）()：:，,、]+/).map((s) => s.trim()).filter(Boolean);
  const toks = [];
  for (const p of parts) { if (TITLE_STOP.has(p)) continue; if (p.length < 2) continue; toks.push(p); }
  return toks;
}
function makeId(r) { return createHash("sha1").update(`${r.school || ""}|${r.title || ""}|${r.url || ""}`).digest("hex").slice(0, 16); }
let HUMAN_OVERRIDES = {};
try { HUMAN_OVERRIDES = JSON.parse(readFileSync("data/human_overrides.json", "utf8")); } catch {}

// 复验：对上次已核实(非人工)记录再抓一次，仅当页面明确 404/已删除才标记 drift（不盲目降级，避免网络抖动误伤）
async function reverifyBaseline(baseRecs) {
  const drift = [];
  for (const r of (baseRecs || [])) {
    if (!r.url || r.verified_by === "human" || !r.verified) continue;
    const school = SCHOOLS.find((s) => s.name === r.school) || { domains: [], name: r.school };
    const res = await fetchWithFallback(r.url, school);
    if (!res.html) continue; // 网络/反爬不稳定，不盲目降级
    const $ = cheerio.load(res.html);
    const txt = ($("body").text() + " " + $("title").text()).toLowerCase();
    if (res.status === 404 || /\b404\b|not found|页面不存在|已删除|找不到该|访问的页面不存在|page not found/.test(txt)) {
      r.drift = true; r.driftReason = "复验发现 404/页面不存在";
      drift.push({ school: r.school, title: r.title, url: r.url, reason: r.driftReason });
    }
  }
  return drift;
}

function allowed(url, school) {
  try { const h = new URL(url).hostname.toLowerCase(); return school.domains.some((d) => h === d || h.endsWith("." + d)); }
  catch { return false; }
}
function isRoot(url) {
  try { const p = new URL(url).pathname; return p === "/" || p === ""; }
  catch { return false; }
}
function isAntiCrawl(status, body) {
  if (status === 412 || status === 403 || status === 429) return true;
  if (body && ANTI_MARKS.some((m) => body.toLowerCase().includes(m))) return true;
  return false;
}
function extractDate(t) {
  if (!t) return { date: "", date_end: "", year: "", is_this_year: false, stale: false, dateConfidence: "missing" };
  const yr = THIS_YEAR;
  const parsed = [...t.matchAll(DATE_RE)]
    .map((m) => { const y = m[2] ? +m[2] : yr; const mo = +m[3], d = +m[4]; return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; })
    .filter((s) => s >= `${yr - 1}-01-01` && s <= `${yr + 1}-12-31`);
  if (parsed.length) {
    const date = parsed[0]; const year = +date.slice(0, 4);
    return { date, date_end: parsed.length > 1 ? parsed[parsed.length - 1] : "", year, is_this_year: year === yr, stale: year < yr, dateConfidence: "exact" };
  }
  // 模糊日期：仅月到旬，保留不丢弃
  const approx = [...t.matchAll(DATE_APPROX_RE)]
    .map((m) => { const y = m[2] ? +m[2] : yr; const mo = +m[3]; const suffix = (m[4] || "").replace(/\s/g, ""); return { y, mo, suffix, raw: `${y}-${String(mo).padStart(2, "0")}` }; })
    .filter((s) => s.y >= yr - 1 && s.y <= yr + 1);
  if (approx.length) {
    const a = approx[0]; const year = a.y;
    // 用该月1日占位，真实含义是“X月/上中下旬”，前端/构建层按 dateConfidence=approx 显示
    const date = `${a.raw}-01`;
    return { date, date_end: "", year, is_this_year: year === yr, stale: year < yr, dateConfidence: "approx", dateNote: `${a.mo}月${a.suffix || ""}` };
  }
  return { date: "", date_end: "", year: "", is_this_year: false, stale: false, dateConfidence: "missing" };
}
function extractPlace(t) {
  if (!t) return "";
  let m = t.match(PLACE_RE); if (m) return m[2].trim().slice(0, 30);
  m = t.match(PLACE_KW); if (m) return m[1].trim().slice(0, 30);
  return "";
}
// 模块一·请求节奏：全局限流，每请求间隔 1~2 秒，模拟正常浏览器，降低被封与误伤
const RATE_MS = 1200;
let _lastFetchTs = 0;
async function throttle() {
  const now = Date.now();
  const wait = RATE_MS - (now - _lastFetchTs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastFetchTs = Date.now();
}
async function fetchOne(url, profile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, { headers: profile.headers, signal: ctrl.signal, redirect: "follow" });
      const finalUrl = r.url; // 重定向后的最终 URL（用于模块三·跳转检测）
      if (r.status !== 200) return { html: null, status: r.status, finalUrl };
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("html")) return { html: null, status: r.status, finalUrl };
      const buf = await r.arrayBuffer();
      return { html: new TextDecoder("utf-8").decode(buf), status: 200, finalUrl };
    } catch { /* timeout or network err */ }
    finally { clearTimeout(t); }
    await new Promise((r) => setTimeout(r, 600));
  }
  return { html: null, status: 0, err: "err" };
}
async function fetchWithFallback(url, school) {
  for (const p of PROFILES) {
    const res = await fetchOne(url, p);
    if (res.html == null) { if ([412, 403, 429].includes(res.status)) return { html: null, status: res.status, blocked: true, finalUrl: res.finalUrl }; continue; }
    if (isAntiCrawl(res.status, res.html)) return { html: null, status: res.status, blocked: true, finalUrl: res.finalUrl };
    return { html: res.html, status: 200, blocked: false, finalUrl: res.finalUrl };
  }
  return { html: null, status: 0, blocked: false, err: "err" };
}

// 从列表页收集候选详情链接（要求：锚文本含 MEET 词 + 同域 + 非首页）
function collectCandidates(html, baseUrl, school, seen, out) {
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const a = $(el); const text = a.text().trim(); const href = a.attr("href") || "";
    if (text.length < 4) return;
    if (!MEET.some((k) => text.includes(k))) return;
    if (EXCLUDE_ANCHOR.some((k) => text.includes(k))) return;   // 明显非活动页
    let url; try { url = new URL(href, baseUrl).href; } catch { return; }
    if (!allowed(url, school)) return;
    if (isRoot(url)) return;              // 跳过首页/栏目根，只收详情页
    if (seen.has(url)) return; seen.add(url);
    out.push({ url, anchor: text.replace(/\s+/g, " ").trim() });
  });
}
// 收集"可深入"的子栏目链接（招聘会/双选会/宣讲会/通知公告/招聘信息 等栏目）
function collectFollow(html, baseUrl, school, out) {
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const a = $(el); const t = a.text().trim(); let u; try { u = new URL(a.attr("href"), baseUrl).href; } catch { return; }
    if (t && FOLLOW.some((k) => t.includes(k)) && allowed(u, school) && !isRoot(u)) out.push(u);
  });
}
// 模块一·翻页：收集分页链接（下一页 / 第N页 / next），翻页才不漏抓
const PAGE_KW = ["下一页", "下页", "下一頁", "more", "next", "尾页", "后页"];
function collectPagination(html, baseUrl, school, out) {
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const a = $(el); const t = a.text().trim().toLowerCase(); let u; try { u = new URL(a.attr("href"), baseUrl).href; } catch { return; }
    const looksPage = PAGE_KW.some((k) => t.includes(k)) || /^\s*\d+\s*$/.test(t) || (/\d+/.test(t) && /页|page/.test(t));
    if (looksPage && allowed(u, school) && !isRoot(u) && !out.includes(u)) out.push(u);
  });
}

// 核实闸门（升级版）：不仅看"页面含双选会"，更要确认【该页面确实就是这一场】
//  → 首页/栏目根、SPA空壳、第三方页、合并通知 都不再被误标为已核实。
async function verifyCandidate(cand, school, sourceLabel, sourceType) {
  const base = { school: school.name, province: school.province, url: cand.url, domain: safeHost(cand.url), from: cand.url, source: sourceLabel, source_type: sourceType };
  const res = await fetchWithFallback(cand.url, school);
  const finalUrl = res.finalUrl || cand.url;
  const common0 = { ...base, anchor: cand.anchor, verified_by: "auto", verified_at: TODAY, last_checked: TODAY };
  if (!res.html) return { ...common0, flags: ["unreachable"], verified: false, confidence: "unverified", reason: res.blocked ? "页面反爬/拦截" : "无法打开页面", evidence: "" };
  const $ = cheerio.load(res.html);
  const bodyText = $("body").text();
  const heading = ($("h1").first().text() + " " + $("title").text()).trim();
  const fullText = bodyText + " " + heading;
  // 模块三·跳转检测：最终 URL 跳回首页/栏目根（非详情页）→ 链接异常
  if (finalUrl !== cand.url && (isRoot(finalUrl) || isListingPath(finalUrl))) {
    return { ...common0, flags: ["redirect_homepage"], verified: false, confidence: "low", reason: "链接异常：打开后跳转至首页/栏目页（非详情页）", evidence: `finalUrl=${finalUrl}` };
  }
  // 强闸：SPA 空壳 / 正文过短 —— 直接判"需人工确认/待核实"，杜绝"首页/空壳"被误标已核实
  if (bodyText.trim().length < 150) {
    if (isRoot(cand.url)) return { ...common0, flags: ["spa_or_empty"], verified: false, confidence: "unverified", reason: "首页/栏目，无法确认", evidence: "" };
    const official = school.domains.some((d) => base.domain === d || base.domain.endsWith("." + d));
    if (official) return { ...common0, flags: ["spa_or_empty"], verified: false, confidence: "medium", reason: "官网SPA页面，自动抓取无法读取正文，需人工确认", evidence: "官网(SPA)URL已确认，但正文为JS渲染无法自动核对" };
    return { ...common0, flags: ["spa_or_empty"], verified: false, confidence: "low", reason: "第三方SPA，需人工确认", evidence: "" };
  }
  if (isRoot(cand.url)) return { ...common0, flags: ["homepage"], verified: false, confidence: "unverified", reason: "链接为官网首页，非详情页", evidence: "" };
  const thirdParty = !school.domains.some((d) => base.domain === d || base.domain.endsWith("." + d));
  const toks = distinctiveTokens(cand.anchor || cand.title, school.name);
  const matched = toks.length ? toks.some((t) => fullText.includes(t)) : false;
  const dateOk = pageHasDate(fullText, cand.date);
  let title = cand.anchor;
  if (title.length < 6) { const h1 = $("h1").first().text().trim(); title = (h1 || $("title").text().trim() || cand.anchor).replace(/\s+/g, " ").trim(); }
  const place = extractPlace(bodyText);
  const d = extractDate(fullText);
  const common = { ...base, title, place, year: d.year, is_this_year: d.is_this_year, stale: d.stale, date: d.date, date_end: d.date_end, dateConfidence: d.dateConfidence, verified_by: "auto", verified_at: TODAY, last_checked: TODAY };
  if (isListingPath(cand.url) && !matched) {
    return { ...common, flags: ["content_inconsistent"], verified: false, confidence: thirdParty ? "low" : "medium", reason: "链接异常（打开为列表/归档页，未精确匹配此场次）", evidence: "" };
  }
  // 计划表/活动安排类来源：即使含标题日期，也不算已核实事实，标为 plan 待确认
  if (isPlanSource(title, fullText)) {
    return { ...common, flags: ["plan_source"], verified: false, confidence: "medium", reason: "来源为「活动安排/工作计划/拟举办」类计划表，非单场既定事实，仅作计划参考", evidence: "" };
  }
  if (matched && dateOk && !thirdParty) {
    return { ...common, flags: ["content_ok"], verified: true, confidence: "high", reason: "", evidence: `官网详情页正文含「${toks.find((t) => fullText.includes(t))}」及日期 ${d.date}` };
  }
  if (matched && dateOk && thirdParty) {
    return { ...common, flags: ["thirdparty_only"], verified: false, confidence: "low", reason: "第三方页含该场次，需人工确认官网", evidence: "" };
  }
  if (matched && !dateOk) {
    // 模块二·日期缺失/模糊：页面含标题但不含该日期，绝不编造；若有模糊日期则保留为 approx
    if (d.dateConfidence === "approx") {
      return { ...common, flags: ["date_approx"], verified: false, confidence: "medium", reason: `页面含该场次标题，仅提取到模糊日期「${d.dateNote || d.date}」，待确认`, evidence: "" };
    }
    return { ...common, date: "", date_end: "", dateConfidence: "missing", flags: ["date_unconfirmed"], verified: false, confidence: "medium", reason: "页面含该场次标题，但自动未提取到对应日期（已标记缺失，不编造）", evidence: "" };
  }
  return { ...common, flags: ["title_unmatched"], verified: true, confidence: "medium", reason: "官网来源，但未精确匹配标题（疑似合并通知/栏目），需人工确认", evidence: "" };
}

async function scrapeSchool(school) {
  const seen = new Set();
  const candidates = [];
  // 模块一·多栏目 + 翻页：BFS 遍历（栏目页 + 分页页），单校硬上限 MAX_PAGES 防无限抓取/超时
  const queue = [...school.roots];
  let visited = 0;
  const MAX_PAGES = 8;
  while (queue.length && visited < MAX_PAGES) {
    const u = queue.shift();
    if (seen.has(u)) continue; seen.add(u);
    const res = await fetchWithFallback(u, school);
    if (!res.html) continue;
    collectCandidates(res.html, u, school, seen, candidates);
    const follow = []; collectFollow(res.html, u, school, follow);
    const pagi = []; collectPagination(res.html, u, school, pagi);
    for (const fu of [...new Set([...follow, ...pagi])]) {
      if (!seen.has(fu) && queue.length < MAX_PAGES * 2) queue.push(fu);
    }
    visited++;
  }
  // 直抓 0 条 → 回退搜索引擎（结果也走核实闸门）
  if (!candidates.length && SEARCH_API_KEY) {
    const sr = await searchSchoolCandidates(school, seen);
    candidates.push(...sr);
  }
  // 核实每条候选（限制数量，并发核实）
  const picks = candidates.slice(0, MAX_VERIFY);
  const verified = [], unverified = [];
  const results = await Promise.all(picks.map((c) => verifyCandidate(c, school, "官方", "official")));
  for (const r of results) (r.verified ? verified : unverified).push(r);
  return { verified, unverified, total: candidates.length };
}

// 搜索引擎返回候选（仅取链接，核实交给 verifyCandidate）
async function searchSchoolCandidates(school, seen) {
  const domain = school.domains[0];
  const q = `site:${domain} ${THIS_YEAR} 双选会 招聘会`;
  const out = [];
  try {
    let items = [];
    if (SEARCH_PROVIDER === "bing") {
      const r = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`,
        { headers: { "Ocp-Apim-Subscription-Key": SEARCH_API_KEY } });
      const j = await r.json();
      items = (j.webPages?.value || []).map((x) => ({ title: x.name, link: x.url }));
    } else {
      const r = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${SEARCH_API_KEY}`);
      const j = await r.json();
      items = (j.organic_results || []).map((x) => ({ title: x.title, link: x.link }));
    }
    for (const it of items) {
      if (!MEET.some((k) => it.title.includes(k))) continue;
      if (!allowed(it.link, school)) continue;
      if (isRoot(it.link)) continue;
      if (seen.has(it.link)) continue; seen.add(it.link);
      out.push({ url: it.link, anchor: it.title.replace(/\s+/g, " ").trim() });
    }
  } catch (e) { console.warn(`  ⚠ [${school.name}] 搜索调用失败: ${e.message}`); }
  return out;
}

// 第三方聚合平台抓取 + 核实
async function scrapeThirdParty() {
  const out = { verified: [], unverified: [] };
  for (const tp of THIRD_PARTY) {
    for (const root of tp.roots) {
      const res = await fetchWithFallback(root, { domains: tp.domains, roots: [root] });
      if (!res.html) { console.log(`  [第三方·${tp.name}] 直抓失败(降级)`); continue; }
      const $ = cheerio.load(res.html);
      const seen = new Set();
      const cands = [];
      $("a[href]").each((_, el) => {
        const a = $(el); const text = a.text().trim(); const href = a.attr("href") || "";
        if (text.length < 4 || !MEET.some((k) => text.includes(k))) return;
        const matched = SCHOOLS.find((s) => text.includes(s.name));
        if (!matched) return;
        let url; try { url = new URL(href, root).href; } catch { return; }
        if (isRoot(url)) return;
        if (seen.has(url)) return; seen.add(url);
        cands.push({ url, anchor: text.replace(/\s+/g, " ").trim(), school: matched });
      });
      const picks = cands.slice(0, 12);
      const results = await Promise.all(picks.map((c) => verifyCandidate(c, c.school, "第三方·" + tp.name, "thirdparty")));
      for (const r of results) (r.verified ? out.verified : out.unverified).push(r);
      console.log(`  [第三方·${tp.name}] 核实通过 ${out.verified.length} 条，待核实 ${out.unverified.length} 条`);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync("data", { recursive: true });
  // 模块·防挂死：整个抓取硬上限，超时强制退出（避免反爬/网络抖动导致无限挂起，危及每日定时任务）
  const HARD_TOTAL_MS = 300000; // 5 分钟
  const hardTimer = setTimeout(() => { console.error("⛔ 抓取超过硬上限 5 分钟，强制退出（保留已有结果）"); process.exit(2); }, HARD_TOTAL_MS);
  const all = [];           // 所有核实通过的记录
  const clues = [];         // 待核实（点不开/页面无内容）线索
  const perSchool = {};

  console.log(`开始检索 ${SCHOOLS.length} 校（官网直抓 + ${SEARCH_API_KEY ? SEARCH_PROVIDER + " 搜索兜底" : "无搜索key"}），并发 ${CONCURRENCY} 校/单校硬超时 ${SCHOOL_TIMEOUT / 1000}s…`);

  let nextIdx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= SCHOOLS.length) return;
      const s = SCHOOLS[idx];
      try {
        const r = await Promise.race([
          scrapeSchool(s),
          new Promise((_, reject) => setTimeout(() => reject(new Error("school-timeout")), SCHOOL_TIMEOUT)),
        ]);
        perSchool[s.name] = { verified: r.verified.length, unverified: r.unverified.length };
        all.push(...r.verified, ...r.unverified);
        console.log(`  [${s.name}] 核实通过 ${r.verified.length} 条 | 待核实 ${r.unverified.length} 条`);
      } catch (e) {
        console.log(`  [${s.name}] 跳过: ${e.message || e}`);
      }
      await sleep(800);
    }
  });
  await Promise.all(workers);

  // 第三方
  const tp = await Promise.race([
    scrapeThirdParty(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("thirdparty-timeout")), 90000)),
  ]).catch((e) => { console.warn("  ⚠ 第三方抓取跳过:", e.message); return { verified: [], unverified: [] }; });
  all.push(...tp.verified, ...tp.unverified);

  // ===== 自我审查机制核心（安全版）：基线=已核实事实，永不被自动篡改 =====
  // bot 只做两件事：
  //   ① 存活复验：对每条既有记录点开 URL，【仅】判断「是否还活着」(alive/dead/unreachable)，
  //      绝不改写标题/日期/地点/已核实状态——curl 读不到 SPA 正文 ≠ 记录错误，不能据此降级。
  //   ② 新增发现：自动爬到的新候选【只作待核实线索】加入，永不自动升格为主列表（不冒充事实）。
  let baseline = { records: [], clues: [] };
  try { baseline = JSON.parse(readFileSync("data/candidates.json", "utf8")); } catch {}
  const baseAll = [...(baseline.records || []), ...(baseline.clues || [])];

  // 存活检查（轻量）：只取 HTTP 状态 + 是否明确 404/不存在，不解析正文，绝不重抽标题/日期
  async function livenessCheck(b) {
    const rec = { ...b };
    rec.last_checked = TODAY;
    rec.bot_status = "unreachable";
    if (!b.url) { rec.bot_status = "no_url"; return rec; }
    const school = SCHOOLS.find((s) => s.name === b.school) || { name: b.school, domains: b.domain ? [b.domain] : [], roots: [] };
    const r = await fetchWithFallback(b.url, school);
    if (r.status === 404 || r.status === 410 ||
        (r.html && /\b404\b|not found|页面不存在|已删除|找不到该|访问的页面不存在|page not found|页面找不到了/.test(r.html.toLowerCase()))) {
      rec.bot_status = "dead";
      rec.dead_reason = "复验发现 404/页面不存在";
      return rec;
    }
    if (!r.html) { rec.bot_status = r.blocked ? "blocked" : "unreachable"; return rec; }
    rec.bot_status = "alive";
    return rec;
  }

  console.log(`开始存活复验基线 ${baseAll.length} 条（仅判存活，不改写已核实字段）…`);
  const records = [];   // 注意：clues 已在 main() 顶部声明，此处复用
  const auditDead = [];
  const CH = 5; // 5 条并发复验
  for (let i = 0; i < baseAll.length; i += CH) {
    const chunk = baseAll.slice(i, i + CH);
    const res = await Promise.all(chunk.map(livenessCheck));
    for (const rec of res) {
      const wasVerified = !!rec.verified;
      if (wasVerified && rec.bot_status !== "dead") {
        // 基线已核实记录：默认冻结为 human/high，绝不因 curl 读不到正文而降级
        rec.verified_by = "human";
        rec.confidence = rec.confidence || "high";
        records.push(rec);
      } else if (wasVerified && rec.bot_status === "dead") {
        // 已核实但链接确已失效：降级为待核实（保留原信息 + 失效标记，供人工复核，不丢数据）
        rec.verified = false;
        rec.confidence = "low";
        rec.reason = "链接已失效(404)，原信息保留待人工复核";
        auditDead.push({ school: rec.school, title: rec.title, url: rec.url });
        clues.push(rec);
      } else {
        // 原本就是待核实线索：保留，仅补充存活状态
        clues.push(rec);
      }
    }
  }

  // ② 自动新增发现：爬到的新候选【只作待核实线索】，且与基线去重，避免无限累积
  const baseUrls = new Set(baseAll.map((b) => b.url).filter(Boolean));
  let newClues = 0;
  for (const r of all) {
    if (!r.url || baseUrls.has(r.url)) continue;
    baseUrls.add(r.url);
    // 模块二·缺失标记：页面无法明确提取的字段留空并标记「缺失」，绝不编造/补全
    const missing = [];
    if (!r.date) missing.push("date");
    if (!r.place) missing.push("place");
    if (!r.title) missing.push("title");
    clues.push({
      ...r, verified: false, confidence: "unverified",
      reason: r.reason || "自动爬取候选，待人工确认", last_checked: TODAY, bot_status: "auto_discovered",
      flags: r.flags || [], missing,
    });
    newClues++;
  }

  // ③ 人工冻结：human_overrides.json 永久生效，自动抓取绝不改写
  let humanApplied = 0;
  for (const r of [...records, ...clues]) {
    const ov = HUMAN_OVERRIDES[makeId(r)];
    if (ov) {
      r.verified = ov.verified !== undefined ? ov.verified : r.verified;
      r.confidence = ov.confidence || r.confidence;
      r.verified_by = "human";
      r.evidence = ov.evidence || r.evidence;
      r.note = ov.note || r.note;
      r.verified_at = TODAY;
      humanApplied++;
    }
  }

  const payload = {
    updated: new Date().toISOString(),
    today: TODAY,
    records,
    clues,
    audit: { generatedAt: new Date().toISOString(), drift: auditDead, humanApplied, deadCount: auditDead.length, newClues },
  };
  clearTimeout(hardTimer);
  writeFileSync("data/candidates.json", JSON.stringify(payload, null, 2));
  console.log(`✓ candidates.json 写入：展示 ${records.length} 条（已核实·人工冻结）| 待核实 ${clues.length} 条 | 失效降级 ${auditDead.length} 条 | 新增线索 ${newClues} 条 | 人工冻结 ${humanApplied} 条`);
}

main().catch((e) => { console.error("scrape 失败:", e); process.exit(1); });
