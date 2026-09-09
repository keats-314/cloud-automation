// build.mjs — 重建层（提炼自 planb_plus.mjs，脱离 WorkBuddy 运行时）
// 合并 Tier1(seed_payload) + 方案B(search_seed) + Tier3(tier3_seed)
//   → 过滤过去/往年场次 → dateConfidence → 来源分级 → 覆盖完整性兜底
//   → 写 records.json + 内联 dist/index.html + dist/records.json
// 用法: node build.mjs            (TODAY 取系统当天)
//       node build.mjs --today 2026-09-09

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { SCHOOLS, PROVINCIAL, EXPECTED_SCHOOLS } from "./schools.mjs";

const TODAY = process.argv.includes("--today")
  ? process.argv[process.argv.indexOf("--today") + 1]
  : new Date().toISOString().slice(0, 10);

const PROVINCIAL_DOMAINS = new Set(Object.values(PROVINCIAL).flat());

function inferConfidence(r) {
  if (r.dateConfidence) return r.dateConfidence;
  if (!r.date) return "approx";
  return /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? "exact" : "approx";
}
function inferSourceType(r) {
  if (r.source_type) return r.source_type;
  const d = r.domain || "";
  if (PROVINCIAL_DOMAINS.has(d)) return "province";
  if (d.endsWith(".edu.cn")) return "official";
  return "thirdparty";
}

function braceSafeReplaceData(html, jsonStr) {
  const marker = "let DATA = ";
  const i = html.indexOf(marker);
  if (i < 0) { console.warn("⚠ 未找到 let DATA，跳过内联"); return html; }
  let j = i + marker.length, depth = 0, started = false;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) { j++; break; } }
  }
  return html.slice(0, i) + marker + jsonStr + ";" + html.slice(j);
}

function main() {
  const payload = JSON.parse(readFileSync("data/seed_payload.json", "utf8"));
  let searchSeed = [];
  try { searchSeed = JSON.parse(readFileSync("data/search_seed.json", "utf8")).records || []; } catch {}
  let tier3 = [];
  try { tier3 = JSON.parse(readFileSync("data/tier3_seed.json", "utf8")).seeds || []; } catch {}
  console.log(`读取 Tier1: ${payload.records.length} | 方案B: ${searchSeed.length} | Tier3种子: ${tier3.length}`);

  // ① 方案B 按校覆盖 Tier1
  const bySchool = {};
  for (const r of searchSeed) (bySchool[r.school] ||= []).push(r);
  for (const [schoolName, recs] of Object.entries(bySchool)) {
    payload.records = payload.records.filter((r) => r.school !== schoolName);
    for (const r of recs) payload.records.push(r);
  }

  // ③ dateConfidence
  for (const r of payload.records) r.dateConfidence = inferConfidence(r);

  // ② 来源分级
  for (const r of payload.records) r.source_type = inferSourceType(r);

  // ④ Tier3 兜底
  const covered = new Set(payload.records.map((r) => r.school));
  let injected = 0;
  for (const seed of tier3) {
    if (!covered.has(seed.school)) {
      payload.records.push(seed);
      injected++;
    }
  }
  console.log(`Tier3 兜底注入: ${injected} 校`);

  // 过滤过去/往年场次
  const STALE_KW = ["圆满落幕", "圆满结束", "成功举办", "已举办", "已结束", "回顾", "总结", "往届", "2025届", "2026届毕业生", "2026届本科"];
  const isStale = (r) => {
    if (r.stale) return true;
    if (r.is_this_year === false) return true;
    const txt = (r.title || "") + " " + (r.place || "");
    return STALE_KW.some((k) => txt.includes(k));
  };
  const before = payload.records.length;
  payload.records = payload.records.filter((r) => {
    if (isStale(r)) return false;
    const end = r.date_end || r.date;
    if (end && end < TODAY) return false;
    return true;
  });
  console.log(`过滤过去/往年场次: ${before} → ${payload.records.length}（移除 ${before - payload.records.length} 条）`);

  // ⑤ 覆盖完整性兜底：应覆盖校中 0 活跃场次 → 注入「监测中·待核实」
  const activeSchools = new Set(payload.records.map((r) => r.school));
  let monitorInjected = 0;
  for (const school of EXPECTED_SCHOOLS) {
    if (!activeSchools.has(school)) {
      payload.records.push({
        school,
        title: "（监测中·待核实：暂无已确认的未来场次，等待每日检索档刷新）",
        date: "", date_end: "", year: +TODAY.slice(0, 4),
        is_this_year: true, stale: false,
        place: "", url: "", domain: "", from: "",
        source: "监测中", verified: false, source_type: "official",
        dateConfidence: "approx", monitoring: true,
      });
      monitorInjected++;
    }
  }
  if (EXPECTED_SCHOOLS.length) console.log(`覆盖完整性兜底注入「监测中」: ${monitorInjected} 校（应覆盖 ${EXPECTED_SCHOOLS.length} 校）`);
  payload.expectedTotal = EXPECTED_SCHOOLS.length;
  payload.monitorCount = monitorInjected;

  payload.total = payload.records.length;
  const bySchoolCount = {};
  for (const r of payload.records) bySchoolCount[r.school] = (bySchoolCount[r.school] || 0) + 1;
  console.log("按校分布:", JSON.stringify(bySchoolCount));

  writeFileSync("records.json", JSON.stringify(payload, null, 2));

  mkdirSync("dist", { recursive: true });
  copyFileSync("index.html", "dist/index.html");
  let html = readFileSync("dist/index.html", "utf8");
  html = braceSafeReplaceData(html, JSON.stringify(payload));
  writeFileSync("dist/index.html", html);
  copyFileSync("records.json", "dist/records.json");
  console.log("✓ dist/index.html + dist/records.json 已生成");
}

main();
