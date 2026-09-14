// C9 高校（九校联盟）双选会监控配置
// 聚焦 C9，域名用于同域判定；roots 为各校官方就业网根地址（核实闸门会点开详情页确认）。
// 注意：roots 应优先放「列表/日历页」，让 bot 一次进入就能看到尽量多的详情链接。
export const SCHOOLS = [
  { id: "pku",   name: "北京大学",         province: "北京",   domains: ["pku.edu.cn"],       roots: ["https://scc.pku.edu.cn/frontpage/pku/html/recruitmentFairListAll.html?date=2026-09", "https://scc.pku.edu.cn", "https://career.pku.edu.cn"] },
  { id: "thu",   name: "清华大学",         province: "北京",   domains: ["tsinghua.edu.cn"],  roots: ["http://career.cic.tsinghua.edu.cn/xsglxt/f/jyxt/anony/xxfb", "https://career.tsinghua.edu.cn", "https://www.tsinghua.edu.cn"] },
  { id: "fudan", name: "复旦大学",         province: "上海",   domains: ["fudan.edu.cn"],     roots: ["https://career.fudan.edu.cn", "https://student.career.fudan.edu.cn", "https://www.fudan.edu.cn"] },
  { id: "sjtu",  name: "上海交通大学",     province: "上海",   domains: ["sjtu.edu.cn"],      roots: ["https://www.job.sjtu.edu.cn/career/zphxx", "https://www.job.sjtu.edu.cn", "https://career.sjtu.edu.cn"] },
  { id: "zju",   name: "浙江大学",         province: "浙江",   domains: ["zju.edu.cn"],       roots: ["https://www.career.zju.edu.cn/jyweb/notification", "https://www.career.zju.edu.cn/jyweb/zpxx", "https://www.career.zju.edu.cn", "https://www.zju.edu.cn"] },
  { id: "nju",   name: "南京大学",         province: "江苏",   domains: ["nju.edu.cn"],       roots: ["https://job.nju.edu.cn/#!/more/mutual_selections", "https://job.nju.edu.cn", "https://www.nju.edu.cn"] },
  { id: "ustc",  name: "中国科学技术大学", province: "安徽",   domains: ["ustc.edu.cn"],      roots: ["https://www.job.ustc.edu.cn/Campusdouble/list.aspx", "https://www.job.ustc.edu.cn/famousRecommand/list.aspx", "https://www.job.ustc.edu.cn", "https://career.ustc.edu.cn"] },
  { id: "hit",   name: "哈尔滨工业大学",   province: "黑龙江", domains: ["hit.edu.cn"],       roots: ["https://career.hit.edu.cn/zhxy-xszyfzpt/ssxx?xxfl=双选会", "https://career.hit.edu.cn", "https://job.hit.edu.cn"] },
  { id: "xjtu",  name: "西安交通大学",     province: "陕西",   domains: ["xjtu.edu.cn"],      roots: ["https://job.xjtu.edu.cn", "https://career.xjtu.edu.cn", "https://www.xjtu.edu.cn"] },
];

// 省/市官方聚合平台（暂未启用，聚焦 C9 官方源）
export const PROVINCIAL = {};

export const EXPECTED_SCHOOLS = SCHOOLS.map((s) => s.name);

// 第三方聚合平台：伯乐校招、前程无忧 Job One、云校招
// bot 只负责发现，所有第三方候选默认走 verifyCandidate 第三方闸门，不自动标 verified。
export const THIRD_PARTY = [
  { id: "bolexiaozhao", name: "伯乐校招",   domains: ["bolexiaozhao.com"], roots: ["https://www.bolexiaozhao.com/"] },
  { id: "51job",        name: "前程无忧",   domains: ["51job.com"],        roots: ["https://jobone.51job.com/"] },
  { id: "bysjy",        name: "云校招",     domains: ["bysjy.com.cn"],     roots: ["https://hr.bjbys.net.cn/"] },
];
