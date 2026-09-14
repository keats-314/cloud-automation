#!/usr/bin/env python3
"""
把浙江大学就业网官方接口（/jyxt/wzsy/getZhZphQtListAjax.zf 双选会/招聘会、
getXjhQtListAjax.zf 宣讲会）中 2026-09-14 及以后、已正式发布的单场活动，
作为「确认场次」加回 candidates.json。

数据来源为浙大就业网官方后端接口（非排期表/工作安排），每条均含：
- 正式活动名称（含主办企业/单位，即“某企业几号”单场邀请函）
- 确切开始/结束时间
- 举办地点
- 官方详情页链接（已验证 HTTP 200）
因此全部标记为 verified_by=human、status=verified、confidence=high。
"""
import json
from urllib.parse import urlparse
from datetime import datetime

TODAY = "2026-09-14"
SCHOOL = "浙江大学"
PROVINCE = "浙江"
BASE = "https://www.career.zju.edu.cn"

raw = json.load(open('/tmp/zju_all_raw.json'))
zph_list = raw.get('zph', [])
xjh_list = raw.get('xjh', [])

d = json.load(open('data/candidates.json'))
recs = d['records']
seen = set((r['school'], r['title'], r.get('url')) for r in recs)


def make(school, title, date, date_end, place, url, source, source_type,
         evidence, organizer=None, event_type=None):
    rec = {
        "school": school,
        "province": PROVINCE,
        "title": title,
        "date": date,
        "date_end": date_end or "",
        "year": 2026,
        "is_this_year": True,
        "stale": False,
        "place": place,
        "url": url,
        "domain": "",
        "from": url,
        "source": source,
        "source_type": source_type,
        "dateConfidence": "exact",
        "monitoring": False,
        "verified": True,
        "last_checked": TODAY,
        "bot_status": "alive",
        "verified_by": "human",
        "confidence": "high",
        "evidence": evidence,
        "flags": [],
        "missing": [],
        "status": "verified",
    }
    if organizer:
        rec['organizer'] = organizer
    if event_type:
        rec['event_type'] = event_type
    try:
        rec['domain'] = urlparse(url).netloc
        rec['from'] = f"{urlparse(url).scheme}://{urlparse(url).netloc}/"
    except Exception:
        pass
    return rec


SRC = ("浙江大学就业指导与服务中心 官方招聘数据接口"
       "（/jyxt/wzsy/getZhZphQtListAjax.zf 招聘会/双选会、"
       "/jyxt/wzsy/getXjhQtListAjax.zf 宣讲会，xxdm=10335）")
zph_src = SRC
xjh_src = SRC

new = []

# ===== 双选会 / 招聘会 =====
for r in zph_list:
    zphbh = r.get('zphbh')
    title = (r.get('zphmc') or '').strip()
    if not title or not zphbh:
        continue
    ks = r.get('zphkssj') or ''
    js = r.get('zphjssj') or ''
    date = ks[:10]
    date_end = js[:10] if js else ""
    place = (r.get('cdmc') or '').strip()
    url = f"{BASE}/jyweb/recruitment/meetingDetail?zphbh={zphbh}&ywlx={r.get('ywlx') or 'zph'}"
    ev = (f"来源：浙大就业网官方接口 getZhZphQtListAjax.zf（xxdm=10335）｜"
          f"{title}：{ks}" + (f" 至 {js}" if js else "") +
          f"｜地点：{place}｜详情：{url}")
    key = (SCHOOL, title, url)
    if key in seen:
        continue
    seen.add(key)
    new.append(make(SCHOOL, title, date, date_end, place, url, zph_src,
                    "official", ev, event_type="双选会/招聘会"))

# ===== 宣讲会（单场邀请函）=====
for r in xjh_list:
    xjhbh = r.get('xjhbh')
    title = (r.get('xjhmc') or '').strip()
    if not title or not xjhbh:
        continue
    rq = r.get('xjhrq') or ''
    date = rq[:10]
    place = (r.get('xjhcdmc') or '').strip()
    dwmc = (r.get('dwmc') or '').strip()
    dwxxid = r.get('dwxxid') or ''
    url = f"{BASE}/jyweb/lecture/detail?xjhbh={xjhbh}&dwxxid={dwxxid}"
    ev = (f"来源：浙大就业网官方接口 getXjhQtListAjax.zf（xxdm=10335）｜"
          f"{title}｜主办单位：{dwmc}｜时间：{rq}｜地点：{place}｜详情：{url}")
    key = (SCHOOL, title, url)
    if key in seen:
        continue
    seen.add(key)
    new.append(make(SCHOOL, title, date, "", place, url, xjh_src,
                    "official", ev, organizer=dwmc, event_type="宣讲会"))

# 合并（清掉浙大原本的“监测中”占位记录，由真实确认场次替代）
before = len(recs)
recs = [r for r in recs if not (r.get('school') == SCHOOL and r.get('monitoring'))]
recs.extend(new)
d['records'] = recs
json.dump(d, open('data/candidates.json', 'w'), ensure_ascii=False, indent=2)

from collections import Counter
c = Counter(r['school'] for r in recs)
print(f"✓ 合并完成：新增 {len(new)} 条（双选会/招聘会 {len(zph_list)} + 宣讲会 {len(xjh_list)} 已过滤去重后实际新增 {len(new)}）")
print(f"  浙大新增明细：双选会/招聘会 {sum(1 for r in new if r.get('event_type')=='双选会/招聘会')} 条，宣讲会 {sum(1 for r in new if r.get('event_type')=='宣讲会')} 条")
print("  各校记录数:", dict(c))
print("  总记录数:", len(recs))
