// C9 高校（九校联盟）双选会监控配置
// 聚焦 C9，域名用于同域判定；roots 为各校官方就业网根地址（核实闸门会点开详情页确认）。
export const SCHOOLS = [
  { id: "pku",   name: "北京大学",         province: "北京",   domains: ["pku.edu.cn"],       roots: ["https://career.pku.edu.cn", "https://scc.pku.edu.cn", "https://www.pku.edu.cn"] },
  { id: "thu",   name: "清华大学",         province: "北京",   domains: ["tsinghua.edu.cn"],  roots: ["https://career.tsinghua.edu.cn", "https://www.tsinghua.edu.cn"] },
  { id: "fudan", name: "复旦大学",         province: "上海",   domains: ["fudan.edu.cn"],     roots: ["https://job.fudan.edu.cn", "https://www.fudan.edu.cn"] },
  { id: "sjtu",  name: "上海交通大学",     province: "上海",   domains: ["sjtu.edu.cn"],      roots: ["https://www.job.sjtu.edu.cn", "https://career.sjtu.edu.cn", "https://www.sjtu.edu.cn"] },
  { id: "zju",   name: "浙江大学",         province: "浙江",   domains: ["zju.edu.cn"],       roots: ["https://www.career.zju.edu.cn", "https://career.zju.edu.cn", "https://www.zju.edu.cn"] },
  { id: "nju",   name: "南京大学",         province: "江苏",   domains: ["nju.edu.cn"],       roots: ["https://job.nju.edu.cn", "https://www.nju.edu.cn"] },
  { id: "ustc",  name: "中国科学技术大学", province: "安徽",   domains: ["ustc.edu.cn"],      roots: ["https://www.job.ustc.edu.cn", "https://career.ustc.edu.cn", "https://www.ustc.edu.cn"] },
  { id: "hit",   name: "哈尔滨工业大学",   province: "黑龙江", domains: ["hit.edu.cn"],       roots: ["https://career.hit.edu.cn", "https://job.hit.edu.cn", "https://www.hit.edu.cn"] },
  { id: "xjtu",  name: "西安交通大学",     province: "陕西",   domains: ["xjtu.edu.cn"],      roots: ["https://job.xjtu.edu.cn", "https://career.xjtu.edu.cn", "https://www.xjtu.edu.cn"] },
];

// 省/市官方聚合平台（暂未启用，聚焦 C9 官方源）
export const PROVINCIAL = {};

export const EXPECTED_SCHOOLS = SCHOOLS.map((s) => s.name);

// 第三方聚合平台（暂未启用，避免引入未核实噪声）
export const THIRD_PARTY = [];
