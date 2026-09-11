// build.mjs — 重建层（提炼自 planb_plus.mjs，脱离 WorkBuddy 运行时）
// 输入：data/candidates.json（scrape.mjs 本次运行产出，已带 verified 闸门，不沿用历史）
// 处理：已核实 → 主列表；待核实线索 → 单独标记（不冒充事实）；未覆盖校 → 监测中占位
//       → 去重 → 来源分级 → 完整性校验报告 → 写 records.json + 内联 dist/index.html
// 用法: node build.mjs            (TODAY 取系统当天)
//       node build.mjs --today 2026-09-09

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { SCHOOLS, EXPECTED_SCHOOLS, PROVINCIAL } from "./schools.mjs";

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

function main() {
  // 读 scrape 本次产出（覆盖式，无历史沿用）
  let cand = { records: [], clues: [] };
  try { cand = JSON.parse(readFileSync("data/candidates.json", "utf8")); } catch {}
  const verified = cand.records || [];
  const clues = cand.clues || [];
  console.log(`读取 candidates：已核实 ${verified.length} 条 | 待核实线索 ${clues.length} 条`);

  const records = [];

  // ① 已核实（点开详情页确认过的真实场次）→ 主列表
  for (const r of verified) {
    const rec = { ...r, dateConfidence: inferConfidence(r), source_type: inferSourceType(r), monitoring: false, verified: true, is_new: false };
    records.push(rec);
  }

  // ② 去重（同校+同标题+同URL 合并，保留已核实优先）
  const seen = new Set();
  const dedup = [];
  // 先把已核实放进去
  for (const r of records) {
    const k = r.school + "|" + r.title + "|" + r.url;
    if (seen.has(k)) continue; seen.add(k); dedup.push(r);
  }

  // ③ 待核实线索 → 标 verified:false，附 reason，不冒充事实（排在已核实之后）
  for (const c of clues) {
    const k = c.school + "|" + (c.anchor || c.title) + "|" + c.url;
    if (seen.has(k)) continue; seen.add(k);
    dedup.push({
      school: c.school, province: c.province,
      title: c.anchor || c.title || "(未知标题)",
      date: c.date || "", date_end: c.date_end || "", year: c.year || +TODAY.slice(0, 4),
      is_this_year: c.is_this_year !== false, stale: false,
      place: c.place || "", url: c.url || "", domain: c.domain || "",
      from: c.url || "", source: "待核实·" + (c.reason || "未打开"), source_type: c.source_type || "official",
      dateConfidence: "approx", monitoring: false, verified: false,
    });
  }

  // ④ 覆盖完整性兜底：应覆盖校中既无已核实也无待核实 → 注入「监测中·待核实」
  const covered = new Set(dedup.filter((r) => !r.monitoring).map((r) => r.school));
  let monitorInjected = 0;
  for (const school of EXPECTED_SCHOOLS) {
    if (!covered.has(school)) {
      dedup.push({
        school,
        title: "（监测中·待核实：本次检索未在该校官网/第三方发现可确认的未结束场次）",
        date: "", date_end: "", year: +TODAY.slice(0, 4),
        is_this_year: true, stale: false,
        place: "", url: "", domain: "", from: "",
        source: "监测中", verified: false, source_type: "official",
        dateConfidence: "approx", monitoring: true,
      });
      monitorInjected++;
    }
  }

  // ⑤ 最终排序：已核实在前，待核实居中，监测中置底；同类按日期升序
  dedup.sort((a, b) => {
    const rank = (r) => (r.monitoring ? 2 : r.verified ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.date || "").localeCompare(b.date || "");
  });

  // ⑥ 完整性校验报告
  const officialCovered = new Set(dedup.filter((r) => !r.monitoring && r.verified && r.source_type !== "thirdparty").map((r) => r.school));
  const thirdpartyCovered = new Set(dedup.filter((r) => r.verified && r.source_type === "thirdparty").map((r) => r.school));
  const audit = {
    generatedAt: new Date().toISOString(),
    today: TODAY,
    expectedTotal: EXPECTED_SCHOOLS.length,
    verifiedCount: dedup.filter((r) => r.verified && !r.monitoring).length,
    unverifiedCount: dedup.filter((r) => !r.verified && !r.monitoring).length,
    monitorCount: monitorInjected,
    coveredOfficial: officialCovered.size,
    coveredThirdparty: thirdpartyCovered.size,
    missingSchools: EXPECTED_SCHOOLS.filter((s) => !officialCovered.has(s) && !thirdpartyCovered.has(s)),
  };
  writeFileSync("data/audit_report.json", JSON.stringify(audit, null, 2));
  console.log(`✓ 完整性校验: 已核实 ${audit.verifiedCount} 条, 待核实 ${audit.unverifiedCount} 条, 监测中 ${audit.monitorCount} 校, 官方覆盖 ${audit.coveredOfficial}/${audit.expectedTotal} 校`);

  const payload = {
    updated: new Date().toISOString(),
    today: TODAY,
    total: dedup.length,
    verifiedCount: audit.verifiedCount,
    unverifiedCount: audit.unverifiedCount,
    monitorCount: monitorInjected,
    expectedTotal: EXPECTED_SCHOOLS.length,
    records: dedup,
  };
  writeFileSync("records.json", JSON.stringify(payload, null, 2));

  mkdirSync("dist", { recursive: true });
  copyFileSync("index.html", "dist/index.html");
  let html = readFileSync("dist/index.html", "utf8");
  html = html.replace("let DATA =", "let DATA =");
  // 用 braceSafe 替换内联 DATA
  const marker = "let DATA = ";
  const i = html.indexOf(marker);
  if (i >= 0) {
    let j = i + marker.length, depth = 0, started = false;
    for (; j < html.length; j++) {
      const c = html[j];
      if (c === "{") { depth++; started = true; }
      else if (c === "}") { depth--; if (started && depth === 0) { j++; break; } }
    }
    html = html.slice(0, i) + marker + JSON.stringify(payload) + ";" + html.slice(j);
  }
  writeFileSync("dist/index.html", html);
  copyFileSync("records.json", "dist/records.json");
  console.log(`✓ records.json + dist 生成：合计 ${dedup.length} 条（已核实 ${audit.verifiedCount} / 待核实 ${audit.unverifiedCount} / 监测中 ${audit.monitorCount}）`);
}

main();
