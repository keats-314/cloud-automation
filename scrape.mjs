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
import * as cheerio from "cheerio";
import { SCHOOLS, THIRD_PARTY } from "./schools.mjs";

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || "";
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const THIS_YEAR = +TODAY.slice(0, 4);

// 命中即视为"确实在讲双选会/招聘会"的核心词
const MEET = ["双选会", "招聘会", "供需见面", "空中双选", "联合招聘", "专场招聘", "就业双选", "校园招聘会"];
// 锚文本命中的明显非活动页（证明/须知/指南等），直接不收录，避免噪声
const EXCLUDE_ANCHOR = ["证明", "须知", "指南", "模板", "公示", "声明", "办法", "下载", "表格", "攻略", "系统入口", "登录"];
const FOLLOW = ["招聘", "双选", "宣讲", "通知", "公告", "就业", "招聘会", "双选会"];
// 强完成态：出现这些词且日期已过的，判定为往届/已结束，不收录
const STALE_STRONG = ["成功举办", "圆满结束", "圆满落幕", "圆满举办", "顺利举行", "顺利举办", "落下帷幕", "完美收官", "已举办", "已结束", "顺利召开", "回顾展", "已逾"];
// 内容提日期正则（兼容 2026年9月15日 / 9月15日 / 2026-09-15）
const DATE_RE = /((\d{4})[.\-/年])?((?:1[0-2]|0?[1-9]))[.\-/月]((?:[12]\d|3[01]|0?[1-9]))日?/g;
const PLACE_RE = /(地点|场馆|地址|举办地|地点[:： ]*)[：: ]*([^\s,，。；;]{2,30})/;
const PLACE_KW = /([\u4e00-\u9fa5]{1,12}(校区|楼|馆|中心|报告厅|会议室|大厅|体育馆|学院))/;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UA_FULL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA_FF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const TIMEOUT = 8000;           // 单 URL 超时 8 秒
const MAX_FOLLOW = 3;           // 每个根URL最多跟 3 个子链接
const MAX_VERIFY = 10;          // 每校最多核实 10 条候选（覆盖即可，避免无限抓取）
const SCHOOL_TIMEOUT = 75000;   // 单校整体硬超时 75 秒
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
  if (!t) return { date: "", date_end: "", year: "", is_this_year: false, stale: false };
  const yr = THIS_YEAR;
  const parsed = [...t.matchAll(DATE_RE)]
    .map((m) => { const y = m[2] ? +m[2] : yr; const mo = +m[3], d = +m[4]; return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; })
    .filter((s) => s >= `${yr - 1}-01-01` && s <= `${yr + 1}-12-31`);
  if (!parsed.length) return { date: "", date_end: "", year: "", is_this_year: false, stale: false };
  const date = parsed[0]; const year = +date.slice(0, 4);
  return { date, date_end: parsed.length > 1 ? parsed[parsed.length - 1] : "", year, is_this_year: year === yr, stale: year < yr };
}
function extractPlace(t) {
  if (!t) return "";
  let m = t.match(PLACE_RE); if (m) return m[2].trim().slice(0, 30);
  m = t.match(PLACE_KW); if (m) return m[1].trim().slice(0, 30);
  return "";
}
async function fetchOne(url, profile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, { headers: profile.headers, signal: ctrl.signal, redirect: "follow" });
      if (r.status !== 200) return { html: null, status: r.status };
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("html")) return { html: null, status: r.status };
      const buf = await r.arrayBuffer();
      return { html: new TextDecoder("utf-8").decode(buf), status: 200 };
    } catch { /* timeout or network err */ }
    finally { clearTimeout(t); }
    await new Promise((r) => setTimeout(r, 600));
  }
  return { html: null, status: 0, err: "err" };
}
async function fetchWithFallback(url, school) {
  for (const p of PROFILES) {
    const res = await fetchOne(url, p);
    if (res.html == null) { if ([412, 403, 429].includes(res.status)) return { html: null, status: res.status, blocked: true }; continue; }
    if (isAntiCrawl(res.status, res.html)) return { html: null, status: res.status, blocked: true };
    return { html: res.html, status: 200, blocked: false };
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
// 收集"可深入"的子栏目链接
function collectFollow(html, baseUrl, school, out) {
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const a = $(el); const t = a.text().trim(); let u; try { u = new URL(a.attr("href"), baseUrl).href; } catch { return; }
    if (t && FOLLOW.some((k) => t.includes(k)) && allowed(u, school) && !isRoot(u)) out.push(u);
  });
}

// 核实闸门：点开候选页，确认【页面标题/H1 明确是双选会详情】+ 未结束
async function verifyCandidate(cand, school, sourceLabel, sourceType) {
  const base = { school: school.name, province: school.province, url: cand.url, domain: new URL(cand.url).hostname, from: cand.url, source: sourceLabel, source_type: sourceType };
  const res = await fetchWithFallback(cand.url, school);
  if (!res.html) return { ...base, anchor: cand.anchor, verified: false, reason: res.blocked ? "页面反爬/拦截" : "无法打开页面" };
  const $ = cheerio.load(res.html);
  const bodyText = $("body").text();
  const heading = ($("h1").first().text() + " " + $("title").text()).trim();
  const headingMeet = MEET.some((k) => heading.includes(k));
  if (!headingMeet && !MEET.some((k) => bodyText.includes(k))) {
    return { ...base, anchor: cand.anchor, verified: false, reason: "页面标题/正文未确认为双选会详情" };
  }
  const stale = STALE_STRONG.some((k) => bodyText.includes(k) || heading.includes(k));
  const d = extractDate(bodyText + " " + heading);
  if (stale && d.date && d.date < TODAY) {
    return { ...base, anchor: cand.anchor, verified: false, reason: "页面显示为已结束/往届场次" };
  }
  // 标题优先用列表锚文本（更贴近事件名），否则取页面 h1
  let title = cand.anchor;
  if (title.length < 6) { const h1 = $("h1").first().text().trim(); title = (h1 || $("title").text().trim() || cand.anchor).replace(/\s+/g, " ").trim(); }
  const place = extractPlace(bodyText);
  return {
    ...base,
    title, date: d.date, date_end: d.date_end, year: d.year,
    is_this_year: d.is_this_year, stale: d.stale || stale,
    place, verified: true, reason: "",
  };
}

async function scrapeSchool(school) {
  const seen = new Set();
  const candidates = [];
  for (const root of school.roots) {
    const rootRes = await fetchWithFallback(root, school);
    if (!rootRes.html) continue;
    collectCandidates(rootRes.html, root, school, seen, candidates);
    const follow = []; collectFollow(rootRes.html, root, school, follow);
    for (const fu of [...new Set(follow)].slice(0, MAX_FOLLOW)) {
      const f = await fetchWithFallback(fu, school); if (!f.html) continue;
      collectCandidates(f.html, fu, school, seen, candidates);
    }
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
        all.push(...r.verified);
        clues.push(...r.unverified);
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
  all.push(...tp.verified);
  clues.push(...tp.unverified);

  const payload = {
    updated: new Date().toISOString(),
    today: TODAY,
    records: all,           // 已核实（点开详情页确认）
    clues,                  // 待核实线索（不冒充事实）
  };
  writeFileSync("data/candidates.json", JSON.stringify(payload, null, 2));
  console.log(`✓ candidates.json 写入：已核实 ${all.length} 条，待核实线索 ${clues.length} 条`);
}

main().catch((e) => { console.error("scrape 失败:", e); process.exit(1); });
