// scrape.mjs — 云端检索层（替代 WorkBuddy 内的 WebSearch + Tier1 直抓）
// 流程：对 41 校逐一尝试官网直抓(Tier1)；直抓 0 条/反爬的校，回退搜索引擎 API 核实。
// 输出：data/seed_payload.json（Tier1 官方场次，按校刷新）+ 增量追加 data/search_seed.json（搜索核实场次）。
//
// 环境变量：
//   SEARCH_PROVIDER   serpapi | bing   （默认无 key 时跳过搜索，仅用直抓+历史 search_seed）
//   SEARCH_API_KEY    对应 provider 的 key
//   TODAY             可选，YYYY-MM-DD

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";
import { SCHOOLS } from "./schools.mjs";

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || "";
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const THIS_YEAR = +TODAY.slice(0, 4);

const MEET = ["双选会", "招聘会", "供需见面", "空中双选", "联合招聘", "专场招聘", "就业双选"];
const FOLLOW = ["招聘", "双选", "宣讲", "通知", "公告", "就业", "招聘会", "双选会"];
const STALE_KW = ["成功举办", "圆满结束", "圆满落幕", "回顾", "总结", "已结束", "已举办", "往届", "2025届", "2026届毕业生"];
const DATE_RE = /((\d{4})[.\-/年])?((?:1[0-2]|0?[1-9]))[.\-/月]((?:[12]\d|3[01]|0?[1-9]))日?/g;
const PLACE_RE = /(地点|场馆|地址|举办地|地点[:： ]*)[：: ]*([^\s,，。；;]{2,30})/;
const PLACE_KW = /([\u4e00-\u9fa5]{1,12}(校区|楼|馆|中心|报告厅|会议室|大厅|体育馆|学院))/;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UA_FULL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA_FF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";
const TIMEOUT = 12000;
const MAX_FOLLOW = 3;
const PROFILES = [
  { tag: "chrome", headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } },
  { tag: "full", headers: {
      "User-Agent": UA_FULL, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive",
      "Referer": "https://www.baidu.com/", "Upgrade-Insecure-Requests": "1" } },
  { tag: "firefox", headers: { "User-Agent": UA_FF, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9", "Connection": "keep-alive", "Upgrade-Insecure-Requests": "1" } },
];
const ANTI_MARKS = ["验证码", "captcha", "access denied", "waf", "verify you are human", "人机验证", "安全验证", "防爬", "反爬", "访问过于频繁", "请求被拦截"];

function allowed(url, school) {
  try { const h = new URL(url).hostname.toLowerCase(); return school.domains.some((d) => h === d || h.endsWith("." + d)); }
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
    } catch (e) { /* timeout or network err */ }
    finally { clearTimeout(t); }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { html: null, status: 0, err: "err" };
}
async function fetchWithFallback(url, school) {
  for (const p of PROFILES) {
    const res = await fetchOne(url, p);
    if (res.html == null) { if (res.status === 412 || res.status === 403 || res.status === 429) return { html: null, status: res.status, blocked: true }; continue; }
    if (isAntiCrawl(res.status, res.html)) return { html: null, status: res.status, blocked: true };
    return { html: res.html, status: 200, blocked: false };
  }
  return { html: null, status: 0, blocked: false, err: "err" };
}
function collect($, seen, school, recs) {
  $("a[href]").each((_, el) => {
    const a = $(el); const text = a.text().trim(); const href = a.attr("href") || "";
    if (!text || text.length < 4) return;
    if (!MEET.some((k) => text.includes(k))) return;
    let url; try { url = new URL(href, school.roots[0]).href; } catch { return; }
    if (!allowed(url, school)) return;
    if (seen.has(url)) return; seen.add(url);
    let d = extractDate(text);
    if (!d.date) { const p = a.closest("li,tr,div,td"); if (p.length) d = extractDate(p.text()); }
    const place = extractPlace(text) || (() => { const p = a.closest("li,tr,div,td"); return p.length ? extractPlace(p.text()) : ""; })();
    const staleKw = STALE_KW.some((k) => text.includes(k));
    recs.push({ school: school.name, province: school.province, title: text.replace(/\s+/g, " ").trim(),
      date: d.date, date_end: d.date_end, year: d.year, is_this_year: d.is_this_year, stale: d.stale || staleKw,
      place, url, domain: new URL(url).hostname, from: school.roots[0], source: "official", verified: true });
  });
}
async function scrapeRoots(school, seen) {
  for (const root of school.roots) {
    const rootRes = await fetchWithFallback(root, school);
    if (rootRes.html) {
      const $ = cheerio.load(rootRes.html); const recs = [];
      collect($, seen, school, recs);
      const follow = [];
      $("a[href]").each((_, el) => { const a = $(el); const t = a.text().trim(); let u; try { u = new URL(a.attr("href"), root).href; } catch { return; }
        if (t && FOLLOW.some((k) => t.includes(k)) && allowed(u, school) && follow.length < MAX_FOLLOW * 3) follow.push(u); });
      for (const fu of [...new Set(follow)].slice(0, MAX_FOLLOW)) {
        const f = await fetchWithFallback(fu, school); if (!f.html) continue;
        collect(cheerio.load(f.html), seen, school, recs);
      }
      if (recs.length) return { recs, state: "ok" };
    }
  }
  return { recs: [], state: "failed" };
}

// ── 搜索引擎 API（替代 WorkBuddy WebSearch）──
async function searchSchool(school) {
  if (!SEARCH_API_KEY) return [];
  const domain = school.domains[0];
  const q = `site:${domain} ${THIS_YEAR} 双选会 招聘会`;
  try {
    let items = [];
    if (SEARCH_PROVIDER === "bing") {
      const r = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`,
        { headers: { "Ocp-Apim-Subscription-Key": SEARCH_API_KEY } });
      const j = await r.json();
      items = (j.webPages?.value || []).map((x) => ({ title: x.name, link: x.url, snippet: x.snippet || "" }));
    } else { // serpapi (google engine)
      const r = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${SEARCH_API_KEY}`);
      const j = await r.json();
      items = (j.organic_results || []).map((x) => ({ title: x.title, link: x.link, snippet: x.snippet || "" }));
    }
    const recs = [];
    for (const it of items) {
      if (!MEET.some((k) => it.title.includes(k) || it.snippet.includes(k))) continue;
      if (!allowed(it.link, school)) continue;
      const d = extractDate(it.title + " " + it.snippet);
      const staleKw = STALE_KW.some((k) => it.title.includes(k) || it.snippet.includes(k));
      recs.push({
        school: school.name, province: school.province,
        title: it.title.replace(/\s+/g, " ").trim(),
        date: d.date, date_end: d.date_end, year: d.year, is_this_year: d.is_this_year, stale: d.stale || staleKw,
        place: extractPlace(it.title + " " + it.snippet),
        url: it.link, domain: new URL(it.link).hostname, from: it.link,
        source: "搜索核实", verified: true,
      });
    }
    return recs;
  } catch (e) {
    console.warn(`  ⚠ [${school.name}] 搜索引擎调用失败: ${e.message}`);
    return [];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const payloadPath = "data/seed_payload.json";
  const seedPath = "data/search_seed.json";
  const oldPayload = JSON.parse(readFileSync(payloadPath, "utf8"));
  const oldSeed = JSON.parse(readFileSync(seedPath, "utf8"));
  const oldPayloadBySchool = {};
  for (const r of oldPayload.records || []) (oldPayloadBySchool[r.school] ||= []).push(r);

  const officialBySchool = {};
  const searchAdded = [];
  const seen = new Set();

  console.log(`开始检索 ${SCHOOLS.length} 校（Tier1 直抓 + ${SEARCH_API_KEY ? SEARCH_PROVIDER + " 搜索兜底" : "无搜索key(仅直抓)"}）…`);
  for (const s of SCHOOLS) {
    const r = await scrapeRoots(s, seen);
    if (r.recs.length) {
      officialBySchool[s.name] = r.recs;
      console.log(`  [${s.name}] 直抓成功 ${r.recs.length} 条`);
    } else {
      console.log(`  [${s.name}] 直抓 0 条 → 搜索引擎核实`);
      const sr = await searchSchool(s);
      if (sr.length) {
        console.log(`    ↳ 搜索核实 ${sr.length} 条`);
        searchAdded.push(...sr);
      }
      await sleep(500);
    }
    await sleep(1500); // 礼貌限速
  }

  // 刷新 seed_payload：今天直抓到的校用新官方数据，否则保留上次官方数据
  const newPayloadRecs = [];
  for (const s of SCHOOLS) {
    if (officialBySchool[s.name]?.length) newPayloadRecs.push(...officialBySchool[s.name]);
    else if (oldPayloadBySchool[s.name]?.length) newPayloadRecs.push(...oldPayloadBySchool[s.name]);
  }
  oldPayload.records = newPayloadRecs;
  oldPayload.updated = new Date().toISOString();
  writeFileSync(payloadPath, JSON.stringify(oldPayload, null, 2));
  console.log(`✓ seed_payload.json 刷新：${newPayloadRecs.length} 条（直抓成功校 ${Object.keys(officialBySchool).length} 所）`);

  // 搜索核实结果增量追加进 search_seed（按 学校|标题 去重）
  const seedSeen = new Set((oldSeed.records || []).map((r) => r.school + "|" + r.title));
  let added = 0;
  for (const r of searchAdded) {
    const k = r.school + "|" + r.title;
    if (!seedSeen.has(k)) { oldSeed.records.push(r); seedSeen.add(k); added++; }
  }
  oldSeed.updated = TODAY;
  writeFileSync(seedPath, JSON.stringify(oldSeed, null, 2));
  console.log(`✓ search_seed.json 新增搜索核实 ${added} 条，现共 ${(oldSeed.records || []).length} 条`);
}

main().catch((e) => { console.error("scrape 失败:", e); process.exit(1); });
