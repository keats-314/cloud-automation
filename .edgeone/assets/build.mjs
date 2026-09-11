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

  // ①-b 合并第三方聚合平台抓取结果（source_type=thirdparty）
  let thirdparty = [];
  try { thirdparty = JSON.parse(readFileSync("data/thirdparty_payload.json", "utf8")).records || []; } catch {}
  if (thirdparty.length) {
    for (const r of thirdparty) payload.records.push(r);
    console.log(`合并第三方聚合场次: ${thirdparty.length} 条`);
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

  // 过滤过去/往年场次（已完成报道）+ 第三方场次同样适用
  // 强完成态直接判过期；弱完成态仅在无日期时判过期；未来态词保护，避免误杀预告
  const STALE_STRONG = ["成功举办", "圆满结束", "圆满落幕", "圆满举办", "顺利举行", "顺利举办", "落下帷幕", "完美收官", "已举办", "已结束", "已圆满", "顺利召开", "召开", "已逾"];
  const STALE_WEAK = ["回顾", "总结", "简报", "成果", "现场直击", "现场", "直击", "签约", "达成意向", "吸引", "参会企业", "提供岗位", "招聘成果", "侧记"];
  const FUTURE_KW = ["即将", "拟于", "计划", "预告", "报名", "定于", "将于", "筹备", "预计", "邀请"];
  const isStale = (r) => {
    if (r.stale) return true;
    if (r.is_this_year === false) return true;
    const txt = (r.title || "") + " " + (r.place || "");
    if (FUTURE_KW.some((k) => txt.includes(k))) return false; // 未来态保护
    if (STALE_STRONG.some((k) => txt.includes(k))) return true;
    if (!r.date && STALE_WEAK.some((k) => txt.includes(k))) return true; // 无日期+弱完成态(回顾/现场直击等)→ 保守判过期
    return false;
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

  // ⑥ 完整性对比校验报告（官方/搜索源 vs 第三方源 互校 + 可疑项识别）
  const officialCovered = new Set(payload.records.filter((r) => !r.monitoring && r.source_type !== "thirdparty").map((r) => r.school));
  const thirdpartyCovered = new Set(payload.records.filter((r) => r.source_type === "thirdparty").map((r) => r.school));
  const srcCount = {};
  for (const r of payload.records) srcCount[r.source_type] = (srcCount[r.source_type] || 0) + 1;
  const audit = {
    generatedAt: new Date().toISOString(),
    today: TODAY,
    expectedTotal: EXPECTED_SCHOOLS.length,
    coveredOfficial: officialCovered.size,
    coveredThirdparty: thirdpartyCovered.size,
    monitorCount: monitorInjected,
    missingSchools: EXPECTED_SCHOOLS.filter((s) => !officialCovered.has(s)),
    thirdpartyFillingGaps: [...thirdpartyCovered].filter((s) => !officialCovered.has(s)), // 官方缺失但第三方补充的潜在遗漏
    sourceBreakdown: srcCount,
    suspicious: payload.records.filter((r) => !r.date && !r.monitoring).map((r) => ({ school: r.school, title: r.title, source_type: r.source_type })),
  };
  writeFileSync("data/audit_report.json", JSON.stringify(audit, null, 2));
  console.log(`✓ 完整性校验: 官方覆盖 ${audit.coveredOfficial}/${audit.expectedTotal} 校, 第三方补充 ${audit.coveredThirdparty} 校, 监测中 ${audit.monitorCount} 校, 缺失 ${audit.missingSchools.length} 校`);

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
