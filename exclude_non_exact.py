#!/usr/bin/env python3
# 旧规则"时间不明确要标出来、不能删"作废。
# 新规则：没有确定的时间信息（dateConfidence != "exact"）的整条都不呈现，
# 从 candidates.json 中删除。
import json

PATH = "data/candidates.json"

d = json.load(open(PATH, encoding="utf-8"))
before_rec = len(d["records"])
before_clue = len(d["clues"])

d["records"] = [r for r in d["records"] if r.get("dateConfidence") == "exact"]
d["clues"] = [c for c in d["clues"] if c.get("dateConfidence") == "exact"]

json.dump(d, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"移除无确定时间条目: records {before_rec} -> {len(d['records'])} ({before_rec - len(d['records'])} 条), clues {before_clue} -> {len(d['clues'])} ({before_clue - len(d['clues'])} 条)")
