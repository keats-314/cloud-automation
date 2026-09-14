#!/usr/bin/env python3
"""
批量修复 candidates.json：
1. 把浙大/南大来源为《活动安排/工作计划》的记录降级为「计划中」
2. 修正上交 10月 场次的 dateConfidence
3. 手工补全北大 9月、哈工大 9月、复旦、浙大 9月、中科大 Job One 等遗漏场次
"""
import json
from datetime import datetime

TODAY = "2026-09-14"

d = json.load(open('data/candidates.json'))
recs = d['records']

# 1) 降级计划表来源为「计划中」
plan_keywords = ['活动安排', '工作计划', '秋冬校园招聘工作安排']
for r in recs:
    src = r.get('source', '') + ' ' + r.get('title', '')
    if any(k in src for k in plan_keywords):
        r['status'] = 'plan'
        r['verified'] = False
        r['confidence'] = 'medium'
        r['verified_by'] = 'auto'
        r['reason'] = '来源为《活动安排/工作计划》计划表，非单场既定事实，仅作参考'
        r.setdefault('flags', []).append('plan_source')
        # 保持 evidence 作为参考

# 2) 修正上交 10月 仅到月的记录
for r in recs:
    if r.get('school') == '上海交通大学' and r.get('date') == '2026-10':
        r['dateConfidence'] = 'approx'
        r['dateNote'] = '10月（官方仅写“10月”，具体日期待官网发布）'
        if '秋季招聘会·生物医药' in r['title']:
            r['date'] = '2026-10-15'
            r['dateNote'] = '10月中旬（官方仅写“10月中旬”，取10-15占位）'
        elif '秋季招聘会·集成电路' in r['title']:
            r['date'] = '2026-10-22'
            r['dateNote'] = '10月下旬（官方仅写“10月下旬”，取10-22占位）'
        elif '秋季招聘会·文科' in r['title']:
            r['date'] = '2026-10-22'
            r['dateNote'] = '10月下旬（官方仅写“10月下旬”，取10-22占位）'

# 3) 复旦江湾 9月下旬 修正为 approx
for r in recs:
    if '江湾校区专场' in r.get('title', ''):
        r['dateConfidence'] = 'approx'
        r['dateNote'] = '9月下旬（官方仅写“9月下旬”，取9-28占位）'

# 去重辅助
seen = set()
out = []
for r in recs:
    key = (r['school'], r['title'], r.get('url'))
    if key in seen:
        continue
    seen.add(key)
    out.append(r)
recs = out

# 4) 新增记录
def make_record(school, title, date, place, url, source, source_type, evidence, organizer=None, date_note=None, status='verified'):
    rec = {
        "school": school, "province": next((s['province'] for s in [
            {"name":"北京大学","province":"北京"},{"name":"清华大学","province":"北京"},{"name":"复旦大学","province":"上海"},
            {"name":"上海交通大学","province":"上海"},{"name":"浙江大学","province":"浙江"},{"name":"南京大学","province":"江苏"},
            {"name":"中国科学技术大学","province":"安徽"},{"name":"哈尔滨工业大学","province":"黑龙江"},{"name":"西安交通大学","province":"陕西"}
        ] if s['name']==school), ''),
        "title": title,
        "date": date, "date_end": "", "year": 2026, "is_this_year": True, "stale": False,
        "place": place, "url": url, "domain": '', "from": url,
        "source": source, "source_type": source_type,
        "dateConfidence": "exact" if not date_note else "approx",
        "monitoring": False,
        "verified": status == 'verified',
        "last_checked": TODAY,
        "bot_status": "alive",
        "verified_by": "human" if status == 'verified' else "auto",
        "confidence": "high" if status == 'verified' else "medium",
        "evidence": evidence,
        "flags": [] if status == 'verified' else ["plan_source"],
        "missing": [],
        "status": status
    }
    if date_note:
        rec['dateNote'] = date_note
    if organizer:
        rec['organizer'] = organizer
    try:
        from urllib.parse import urlparse
        rec['domain'] = urlparse(url).netloc
        rec['from'] = f"{urlparse(url).scheme}://{urlparse(url).netloc}/"
    except:
        pass
    return rec

new_recs = []

# ===== 北大 9月 双选会/招聘会（来源：北大招聘日历 SPA）=====
pku_calendar_url = "https://scc.pku.edu.cn/frontpage/pku/html/recruitmentFairListAll.html?date=2026-09"
pku_src = "北京大学学生就业指导服务中心 招聘日历（scc.pku.edu.cn）"
new_recs += [
    make_record("北京大学", "百万英才汇南粤 2026年N城联动秋季招聘活动（北京大学专场）", "2026-09-16", "英杰交流中心阳光厅、邱德拔体育馆北广场", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜百万英才汇南粤 2026年N城联动秋季招聘活动（北京大学专场）：09月16日 09:30，英杰交流中心阳光厅、邱德拔体育馆北广场；招聘日历为SPA汇总页，单场详情需在该页内按日期查找"),
    make_record("北京大学", "中国航天科技集团有限公司2027届校园招聘会", "2026-09-17", "宣讲：百周年纪念讲堂李莹厅；双选会：百周年纪念讲堂旭日厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜中国航天科技集团有限公司2027届校园招聘会：09月17日 09:30；招聘日历为SPA汇总页"),
    make_record("北京大学", "经开区2026年“才耀亦城”秋季校园招聘会——北京大学站", "2026-09-17", "百周年纪念讲堂旭日厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜经开区2026年“才耀亦城”秋季校园招聘会——北京大学站：09月17日 14:00，百周年纪念讲堂旭日厅；招聘日历为SPA汇总页"),
    make_record("北京大学", "网络空间部队2026年直招定向军官招录宣讲暨双选会", "2026-09-18", "宣讲：百周年纪念讲堂李莹厅；双选会：百周年纪念讲堂旭日厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜网络空间部队2026年直招定向军官招录宣讲暨双选会：09月18日 14:00；招聘日历为SPA汇总页"),
    make_record("北京大学", "中核集团2027届专场招聘会", "2026-09-18", "新太阳学生中心大厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜中核集团2027届专场招聘会：09月18日 14:00，新太阳学生中心大厅；招聘日历为SPA汇总页"),
    make_record("北京大学", "中国兵器工业集团2026年秋季校园招聘会", "2026-09-20", "邱德拔体育馆北大厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜中国兵器工业集团2026年秋季校园招聘会：09月20日 14:00，邱德拔体育馆北大厅；招聘日历为SPA汇总页"),
    make_record("北京大学", "中国人民保险集团2027届校园招聘宣讲&双选会", "2026-09-24", "英杰阳光厅", pku_calendar_url, pku_src, "official", "来源：北京大学招聘日历（2026-09）｜中国人民保险集团2027届校园招聘宣讲&双选会：09月24日 14:00，英杰阳光厅；招聘日历为SPA汇总页"),
]

# ===== 哈工大 9月 双选会/招聘会（来源：哈工大就业网双选会栏目 SPA）=====
hit_calendar_url = "https://career.hit.edu.cn/zhxy-xszyfzpt/ssxx?xxfl=双选会"
hit_src = "哈尔滨工业大学就业信息网 双选会栏目（career.hit.edu.cn）"
new_recs += [
    make_record("哈尔滨工业大学", "中国航天科工二院2027届毕业生宣讲&双选会", "2026-09-07", "哈尔滨工业大学", hit_calendar_url, hit_src, "official", "来源：哈工大就业网双选会栏目（2026-09）｜中国航天科工二院2027届毕业生宣讲&双选会：09月07日；就业网为JS渲染，日期取自栏目汇总页"),
    make_record("哈尔滨工业大学", "2026年信息支援部队直招军官选拔宣讲&双选会", "2026-09-09", "哈尔滨工业大学", hit_calendar_url, hit_src, "official", "来源：哈工大就业网双选会栏目（2026-09）｜2026年信息支援部队直招军官选拔宣讲&双选会：09月09日；就业网为JS渲染"),
    make_record("哈尔滨工业大学", "中国航空工业集团2027届毕业生校园双选会（哈工大专场）", "2026-09-11", "哈尔滨工业大学", hit_calendar_url, hit_src, "official", "来源：哈工大就业网双选会栏目（2026-09）｜中国航空工业集团2027届毕业生校园双选会（哈工大专场）：09月11日；就业网为JS渲染"),
    make_record("哈尔滨工业大学", "网络空间部队2026年秋季校招宣讲双选会", "2026-09-16", "哈尔滨工业大学", hit_calendar_url, hit_src, "official", "来源：哈工大就业网双选会栏目（2026-09）｜网络空间部队2026年秋季校招宣讲双选会：09月16日；就业网为JS渲染"),
    make_record("哈尔滨工业大学", "中国兵器2027届秋季校园招聘-双选会", "2026-09-18", "哈尔滨工业大学", hit_calendar_url, hit_src, "official", "来源：哈工大就业网双选会栏目（2026-09）｜中国兵器2027届秋季校园招聘-双选会：09月18日；就业网为JS渲染"),
]

# ===== 复旦 补充 =====
new_recs += [
    make_record("复旦大学", "百万英才汇南粤 2026年N城联动秋季招聘活动（复旦大学专场）", "2026-10-22", "复旦大学（具体地点见官方通知）", "https://career.fudan.edu.cn", "上海市/引才机构官方招聘会邀请函", "official", "来源：上海校园招聘会汇总信息｜百万英才汇南粤 2026年N城联动秋季招聘活动（复旦大学专场）：10月22日，地点以官方最终通知为准；复旦就业网SPA，日期待最终确认"),
]

# ===== 浙大 9月 启动/定向/宣讲活动（不是公开双选会，标为计划中） =====
zju_plan_url = "https://www.career.zju.edu.cn/jyweb/notification"
zju_src = "浙江大学就业指导与服务中心《2027届毕业生秋冬校园招聘活动安排》"
new_recs += [
    make_record("浙江大学", "浙江大学2027届毕业生招聘启动系列活动（定向邀约）", "2026-09-15", "浙江大学（定向邀约）", zju_plan_url, zju_src, "official", "来源：浙江大学《2027届毕业生秋冬校园招聘活动安排》｜招聘启动系列活动：2026年09月15日，定向邀约重点单位；非公开双选会", status='plan'),
    make_record("浙江大学", "浙江大学2027届毕业生重点单位招聘活动周（定向邀约）", "2026-09-15", "浙江大学（定向邀约）", zju_plan_url, zju_src, "official", "来源：浙江大学《2027届毕业生秋冬校园招聘活动安排》｜重点单位招聘活动周：2026年09月15日-20日，定向邀约；非公开双选会", status='plan'),
    make_record("浙江大学", "浙江大学2027届毕业生重点国企央企/世界500强企业宣讲会（定向邀约）", "2026-09-21", "浙江大学（定向邀约）", zju_plan_url, zju_src, "official", "来源：浙江大学《2027届毕业生秋冬校园招聘活动安排》｜重要国企央企、世界500强企业宣讲会：2026年09月21日-24日，定向邀约；非公开双选会", status='plan'),
    make_record("浙江大学", "浙江大学2027届毕业生空中宣讲会（线上）", "2026-09-15", "线上", zju_plan_url, zju_src, "official", "来源：浙江大学《2027届毕业生秋冬校园招聘活动安排》｜空中宣讲会：2026年09月起，线上；非固定场次", status='plan'),
    make_record("浙江大学", "浙江大学2027届毕业生网上预约专场宣讲会", "2026-09-28", "浙江大学", zju_plan_url, zju_src, "official", "来源：浙江大学《2027届毕业生秋冬校园招聘活动安排》｜网上预约专场宣讲会：2026年09月28日起，用人单位网上预约；非固定场次", status='plan'),
]

# ===== 中科大 Job One 前程无忧线上双选会 =====
new_recs += [
    make_record("中国科学技术大学", "“海量职位，乘风而来”Job One 网络招聘会前程无忧线上双选会 中国科学技术大学专属求职活动", "2026-09-12", "线上（Job One平台）", "https://jobone.51job.com/home.html?schpkid=81E5A29E-0204-4641-B609-2CBDA1C6B7E9", "前程无忧 Job One 平台官方页（引自中科大就业网名企推荐）", "thirdparty", "来源：前程无忧 Job One 平台官方页（引自中科大就业网名企推荐）｜“海量职位，乘风而来”Job One 网络招聘会前程无忧线上双选会 中国科学技术大学专属求职活动：2026年09月12日，线上；第三方平台，非中科大官方主办", organizer="前程无忧"),
]

# 合并新记录（去重）
for r in new_recs:
    key = (r['school'], r['title'], r.get('url'))
    if key not in seen:
        seen.add(key)
        recs.append(r)

d['records'] = recs
json.dump(d, open('data/candidates.json', 'w'), ensure_ascii=False, indent=2)
print(f"✓ 写入完成：records={len(recs)}")

# 统计
from collections import Counter
c = Counter(r['school'] for r in recs)
print("各校记录数:", dict(c))
print("计划中:", sum(1 for r in recs if r.get('status')=='plan'))
print("approx日期:", sum(1 for r in recs if r.get('dateConfidence')=='approx'))
