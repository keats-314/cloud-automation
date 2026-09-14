#!/usr/bin/env python3
"""
从 data/candidates.json 移出 plan_source 记录（排期表/工作安排类来源）。

规则：来源是《2026年秋季学期校园招聘工作安排》《活动安排》等排期表，
      并非官宣"某企业几号"、不是正式确定的事 → 不纳入抓取范围。

与 scrape.mjs / build.mjs 的拦截形成三层防线：
  - scrape.mjs：新发现 + 基线复验均跳过 plan_source，不落库
  - build.mjs：组装后硬过滤 plan_source（兜底）
  - 本脚本：清理历史上已写入 candidates.json 的 plan_source 记录

用法：python3 exclude_plansource.py
"""
import json

PATH = "data/candidates.json"
d = json.load(open(PATH))


def keep(r):
    return "plan_source" not in (r.get("flags") or [])


before_r, before_c = len(d["records"]), len(d["clues"])
removed = []
for r in d["records"] + d["clues"]:
    if not keep(r):
        removed.append(f"[{r.get('school')}] {r.get('title','')[:34]} | {r.get('source','')[:40]}")
d["records"] = [r for r in d["records"] if keep(r)]
d["clues"] = [r for r in d["clues"] if keep(r)]
after_r, after_c = len(d["records"]), len(d["clues"])

json.dump(d, open(PATH, "w"), ensure_ascii=False, indent=2)
print(f"records {before_r} -> {after_r}  (-{before_r - after_r})")
print(f"clues  {before_c} -> {after_c}  (-{before_c - after_c})")
print(f"共移出 {len(removed)} 条 plan_source 记录：")
for x in removed:
    print("  -", x)
