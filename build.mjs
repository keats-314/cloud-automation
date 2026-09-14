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

// 判断某 URL 是否指向"首页/栏目大杂烩页"（点开仍需自己找），用于自检报告
// 注意：详情页常带条目标识（xwid=/fair_id=/bilateralchosefairId=/news_detail/数字/长哈希），不可误判为大网页
function isBigWebpage(url) {
  try {
    const u = new URL(url);
    const full = (u.pathname + u.search + u.hash).toLowerCase();
    const hasDetailId =
      /(xwid|fair_?id|bilateralchosefairid|item_?id|news_?id|article_?id|doc_?id|info_?id|aid|sid|mid)=[^\s&]+/i.test(full)
      || /\/news_detail\/\d+/i.test(full)
      || /\/detail\/\w+/i.test(full)
      || /\/newsinfo\/id\/\d+/i.test(full)
      || /[0-9a-f]{10,}/i.test(full);
    if (hasDetailId) return false;
    const p = u.pathname.toLowerCase();
    if (p === "/" || p === "") return true;
    const listing = /(zphxx|zhaopin|xiaozhao|list|news|tzgg|column|\/zph|\/news|webindex|notification|activitylist|fair|index)/;
    return listing.test(p) && !/\d{4,}/.test(p);
  } catch { return false; }
}

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

// 状态推断：修正「模糊日期占位日=当月1号」导致往届/过期场次被误判为「日期待确认」的问题。
// 规则：计划表→计划中；无日期→日期待确认；exact 按真实日判已结束/进行中；
//       approx 不能用"日"判断，改用"年月"粗判季节——往届年或同一年已过月份→已结束，
//       当月/未来月→保留「约」徽章，状态置日期待确认（真实日未知，不谎报进行中）。
function inferStatus({ isPlan, date, dateConfidence }, TODAY) {
  if (isPlan) return "计划中";
  if (!date) return "日期待确认";
  const t = new Date(TODAY + "T00:00:00");
  const d = new Date(date + "T00:00:00");
  if (isNaN(d.getTime())) return "日期待确认";
  if (dateConfidence === "approx") {
    const ty = t.getFullYear(), tm = t.getMonth() + 1;
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (y < ty) return "已结束";
    if (y === ty && m < tm) return "已结束";
    return "日期待确认";
  }
  return d < t ? "已结束" : "进行中/即将开始";
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
    // 计划表/活动安排/拟举办：不是既定事实，统一标为「计划中」
    const isPlan = r.status === "plan" || (r.flags || []).some((f) => f === "plan_source") || /活动安排|工作计划|拟举办|暂定|预计/.test(r.source || r.title || "");
    const dateConfidence = inferConfidence(r);
    const status = inferStatus({ isPlan, date: r.date, dateConfidence }, TODAY);
    const rec = { ...r, dateConfidence, source_type: inferSourceType(r), monitoring: false, verified: true, is_new: false,
      status,
      confidence: r.confidence || "medium", verified_by: r.verified_by || "auto", evidence: r.evidence || "",
      last_checked: r.last_checked || "", drift: !!r.drift, driftReason: r.driftReason || "" };
    records.push(rec);
  }

  // ①-b 合并通知检测：同一 URL 被多条已核实记录共用 → 说明该链接是多场汇总页（点开看到全部），
  //     需在看板显式标注"合并通知·多场"，避免用户以为点开是单场。
  const _urlCount = {};
  for (const r of records) if (r.url) _urlCount[r.url] = (_urlCount[r.url] || 0) + 1;
  for (const r of records) if (r.url && _urlCount[r.url] > 1) r.mergedNotice = true;

  // ② 去重（同校+同标题+同URL 合并，保留已核实优先）
  const seen = new Set();
  let dedup = [];
  // 先把已核实放进去
  for (const r of records) {
    const k = r.school + "|" + r.title + "|" + r.url;
    if (seen.has(k)) continue; seen.add(k); dedup.push(r);
  }

  // ③ 待核实线索 → 标 verified:false，附 reason + 异常标记，不冒充事实（排在已核实之后）
  for (const c of clues) {
    const k = c.school + "|" + (c.anchor || c.title) + "|" + c.url;
    if (seen.has(k)) continue; seen.add(k);
    const isPlan = c.status === "plan" || (c.flags || []).some((f) => f === "plan_source") || /活动安排|工作计划|拟举办|暂定|预计/.test(c.source || c.title || c.reason || "");
    const dateConfidence = c.dateConfidence || "approx";
    const status = inferStatus({ isPlan, date: c.date, dateConfidence }, TODAY);
    dedup.push({
      school: c.school, province: c.province,
      title: c.anchor || c.title || "(未知标题)",
      date: c.date || "", date_end: c.date_end || "", year: c.year || +TODAY.slice(0, 4),
      is_this_year: c.is_this_year !== false, stale: false,
      place: c.place || "", url: c.url || "", domain: c.domain || "",
      from: c.url || "", source: "待核实·" + (c.reason || "未打开"), source_type: c.source_type || "official",
      dateConfidence, status, monitoring: false, verified: false,
      confidence: c.confidence || "unverified", verified_by: c.verified_by || "auto",
      evidence: c.evidence || "", last_checked: c.last_checked || "", drift: !!c.drift, driftReason: c.driftReason || "",
      flags: c.flags || [], missing: c.missing || [], bot_status: c.bot_status || "", reason_detail: c.reason || "",
    });
  }

  // ③-b 排期表/工作安排类来源移出抓取范围（非官宣具体企业、非正式确定事实，不纳入看板）。
  //     放在去重之后、完整性兜底之前：移出后这些校若无其他确认场次则回退为「监测中」，而非假装有计划。
  {
    const _before = dedup.length;
    dedup = dedup.filter((r) => !((r.flags || []).includes("plan_source")));
    if (dedup.length !== _before) console.log(`  ※ 已移出范围（排期表/工作安排类来源）${_before - dedup.length} 条，不纳入看板`);
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

  // ⑥ 完整性校验报告（含自我审查自检数据）
  const officialCovered = new Set(dedup.filter((r) => !r.monitoring && r.verified && r.source_type !== "thirdparty").map((r) => r.school));
  const thirdpartyCovered = new Set(dedup.filter((r) => r.verified && r.source_type === "thirdparty").map((r) => r.school));
  const candAudit = cand.audit || {};
  const bySchool = {};
  for (const r of dedup) {
    const s = r.school; bySchool[s] = bySchool[s] || { high: 0, medium: 0, low: 0, unverified: 0, human: 0, total: 0 };
    bySchool[s].total++;
    if (r.verified_by === "human") bySchool[s].human++;
    const c = r.confidence || (r.verified ? "medium" : "unverified");
    bySchool[s][c] = (bySchool[s][c] || 0) + 1;
  }
  const needsConfirm = dedup
    .filter((r) => (r.confidence || "unverified") !== "high" && r.verified_by !== "human" && !r.monitoring)
    .map((r) => ({ school: r.school, title: r.title, date: r.date, url: r.url, confidence: r.confidence || "unverified", reason: r.note || r.source || "" }));
  const bigWebpage = dedup
    .filter((r) => !r.monitoring && r.url && isBigWebpage(r.url))
    .map((r) => ({ school: r.school, title: r.title, url: r.url }));
  // 模块三·链接异常清单：被标记 redirect_homepage / content_inconsistent / spa_or_empty / homepage 的记录
  const ANOMALY_FLAGS = ["redirect_homepage", "content_inconsistent", "spa_or_empty", "homepage"];
  const linkAnomalies = dedup
    .filter((r) => !r.monitoring && (r.flags || []).some((f) => ANOMALY_FLAGS.includes(f)))
    .map((r) => ({ school: r.school, title: r.title, url: r.url, flags: r.flags || [], reason: r.reason_detail || r.source || "" }));
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
    bySchool,
    needsConfirm,
    bigWebpage,
    linkAnomalies,
    drift: candAudit.drift || [],
    humanApplied: candAudit.humanApplied || 0,
  };
  writeFileSync("data/audit_report.json", JSON.stringify(audit, null, 2));
  console.log(`✓ 完整性校验: 已核实 ${audit.verifiedCount} 条, 待核实 ${audit.unverifiedCount} 条, 监测中 ${audit.monitorCount} 校, 官方覆盖 ${audit.coveredOfficial}/${audit.expectedTotal} 校`);
  console.log(`✓ 自检: 待人工确认 ${needsConfirm.length} 条 | 大网页链接 ${bigWebpage.length} 条 | 复验漂移 ${audit.drift.length} 条 | 人工冻结 ${audit.humanApplied} 条`);

  const payload = {
    updated: new Date().toISOString(),
    today: TODAY,
    total: dedup.length,
    verifiedCount: audit.verifiedCount,
    unverifiedCount: audit.unverifiedCount,
    monitorCount: monitorInjected,
    expectedTotal: EXPECTED_SCHOOLS.length,
    audit,
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
