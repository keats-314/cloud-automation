#!/usr/bin/env python3
# 浙大范围收窄：看板只收「双选会」，剔除招聘专场/宣讲会。
# 依据：用户明确要求"双选会和招聘、宣讲不一样，我们只要双选会的信息"。
# 浙大官方接口回查确认：2026秋季(9月及以后)名称含"双选会"的场次 = 0，
#       现有192条均为"校园招聘专场/招聘活动/校园宣讲/招录军官专场"(非双选会)。
import json, sys

PATH = "data/candidates.json"
KEEP_EVENT_TYPES = {"双选会"}          # 只保留真正的双选会
NON_DS = {"双选会/招聘会", "宣讲会"}    # 浙大接口混入的招聘/宣讲类

d = json.load(open(PATH, encoding="utf-8"))
before = len(d["records"])

removed = []
kept = []
for r in d["records"]:
    if r.get("school") == "浙江大学" and r.get("event_type") in NON_DS:
        removed.append(r)
    else:
        kept.append(r)

d["records"] = kept
json.dump(d, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"移除浙大非双选会记录: {len(removed)} 条 (宣讲会/招聘专场)")
print(f"保留浙大双选会记录: {sum(1 for r in kept if r.get('school')=='浙江大学')} 条")
print(f"总记录: {before} -> {len(kept)}")
