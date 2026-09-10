// 41 校固化配置（39 所 985 + 北邮 + 西电）
// 脱离 WorkBuddy 平台内部的 registry.js，云端自带。
// domains: 用于 site: 搜索与 .edu.cn 官方判定
// roots:   用于 Tier1 官网直抓的候选根地址（抓不到则回退搜索引擎）
export const SCHOOLS = [
  // 北京
  { id: "pku",   name: "北京大学",       province: "北京", domains: ["pku.edu.cn"],            roots: ["https://career.pku.edu.cn", "https://www.pku.edu.cn"] },
  { id: "thu",   name: "清华大学",       province: "北京", domains: ["tsinghua.edu.cn"],       roots: ["https://career.tsinghua.edu.cn", "https://www.tsinghua.edu.cn"] },
  { id: "ruc",   name: "中国人民大学",   province: "北京", domains: ["ruc.edu.cn"],            roots: ["https://career.ruc.edu.cn", "https://www.ruc.edu.cn"] },
  { id: "buaa",  name: "北京航空航天大学", province: "北京", domains: ["buaa.edu.cn"],          roots: ["https://job.buaa.edu.cn", "https://www.buaa.edu.cn"] },
  { id: "bit",   name: "北京理工大学",   province: "北京", domains: ["bit.edu.cn"],            roots: ["https://career.bit.edu.cn", "https://www.bit.edu.cn"] },
  { id: "cau",   name: "中国农业大学",   province: "北京", domains: ["cau.edu.cn"],            roots: ["https://career.cau.edu.cn", "https://www.cau.edu.cn"] },
  { id: "bnu",   name: "北京师范大学",   province: "北京", domains: ["bnu.edu.cn"],           roots: ["https://career.bnu.edu.cn", "https://www.bnu.edu.cn"] },
  { id: "muc",   name: "中央民族大学",   province: "北京", domains: ["muc.edu.cn"],           roots: ["https://muc.edu.cn", "https://www.muc.edu.cn"] },
  { id: "bupt",  name: "北京邮电大学",   province: "北京", domains: ["bupt.edu.cn"],          roots: ["https://job.bupt.edu.cn", "https://www.bupt.edu.cn"] },
  // 天津
  { id: "nankai",name: "南开大学",       province: "天津", domains: ["nankai.edu.cn"],         roots: ["https://career.nankai.edu.cn", "https://www.nankai.edu.cn"] },
  { id: "tju",   name: "天津大学",       province: "天津", domains: ["tju.edu.cn"],           roots: ["https://job.tju.edu.cn", "https://www.tju.edu.cn"] },
  // 辽宁
  { id: "dlut",  name: "大连理工大学",   province: "辽宁", domains: ["dlut.edu.cn"],           roots: ["https://job.dlut.edu.cn", "https://www.dlut.edu.cn"] },
  { id: "neu",   name: "东北大学",       province: "辽宁", domains: ["neu.edu.cn"],            roots: ["https://career.neu.edu.cn", "https://www.neu.edu.cn"] },
  // 吉林
  { id: "jlu",   name: "吉林大学",       province: "吉林", domains: ["jlu.edu.cn"],            roots: ["https://jdjyw.jlu.edu.cn", "https://www.jlu.edu.cn"] },
  // 黑龙江
  { id: "hit",   name: "哈尔滨工业大学", province: "黑龙江", domains: ["hit.edu.cn"],          roots: ["https://career.hit.edu.cn", "https://www.hit.edu.cn"] },
  // 上海
  { id: "fudan", name: "复旦大学",       province: "上海", domains: ["fudan.edu.cn"],          roots: ["https://www.fdzhp.com", "https://www.fudan.edu.cn"] },
  { id: "tongji",name: "同济大学",       province: "上海", domains: ["tongji.edu.cn"],         roots: ["https://tj91.tongji.edu.cn", "https://www.tongji.edu.cn"] },
  { id: "sjtu",  name: "上海交通大学",   province: "上海", domains: ["sjtu.edu.cn"],          roots: ["https://www.job.sjtu.edu.cn", "https://www.sjtu.edu.cn"] },
  { id: "ecnu",  name: "华东师范大学",   province: "上海", domains: ["ecnu.edu.cn"],           roots: ["https://career.ecnu.edu.cn", "https://www.ecnu.edu.cn"] },
  // 江苏
  { id: "nju",   name: "南京大学",       province: "江苏", domains: ["nju.edu.cn"],            roots: ["https://job.nju.edu.cn", "https://www.nju.edu.cn"] },
  { id: "seu",   name: "东南大学",       province: "江苏", domains: ["seu.edu.cn"],            roots: ["https://seu.91job.org.cn", "https://www.seu.edu.cn"] },
  // 浙江
  { id: "zju",   name: "浙江大学",       province: "浙江", domains: ["zju.edu.cn"],            roots: ["https://www.career.zju.edu.cn", "https://career.zju.edu.cn"] },
  // 安徽
  { id: "ustc",  name: "中国科学技术大学", province: "安徽", domains: ["ustc.edu.cn"],          roots: ["https://www.job.ustc.edu.cn", "https://www.ustc.edu.cn"] },
  // 福建
  { id: "xmu",   name: "厦门大学",       province: "福建", domains: ["xmu.edu.cn"],            roots: ["https://jyzd.xmu.edu.cn", "https://www.xmu.edu.cn"] },
  // 山东
  { id: "sdu",   name: "山东大学",       province: "山东", domains: ["sdu.edu.cn"],            roots: ["https://career.sdu.edu.cn", "https://www.sdu.edu.cn"] },
  { id: "ouc",   name: "中国海洋大学",   province: "山东", domains: ["ouc.edu.cn"],            roots: ["https://career.ouc.edu.cn", "https://www.ouc.edu.cn"] },
  // 湖北
  { id: "whu",   name: "武汉大学",       province: "湖北", domains: ["whu.edu.cn"],            roots: ["https://career.whu.edu.cn", "https://www.whu.edu.cn"] },
  { id: "hust",  name: "华中科技大学",   province: "湖北", domains: ["hust.edu.cn"],           roots: ["https://job.hust.edu.cn", "https://www.hust.edu.cn"] },
  // 湖南
  { id: "hnu",   name: "湖南大学",       province: "湖南", domains: ["hnu.edu.cn"],            roots: ["https://career.hnu.edu.cn", "https://www.hnu.edu.cn"] },
  { id: "csu",   name: "中南大学",       province: "湖南", domains: ["csu.edu.cn"],            roots: ["https://career.csu.edu.cn", "https://www.csu.edu.cn"] },
  { id: "nudt",  name: "国防科技大学",   province: "湖南", domains: ["nudt.edu.cn"],           roots: ["https://www.nudt.edu.cn"] },
  // 广东
  { id: "sysu",  name: "中山大学",       province: "广东", domains: ["sysu.edu.cn"],           roots: ["https://career.sysu.edu.cn", "https://www.sysu.edu.cn"] },
  { id: "scut",  name: "华南理工大学",   province: "广东", domains: ["scut.edu.cn"],           roots: ["https://jyzx.scut.edu.cn", "https://career.scut.edu.cn"] },
  // 四川
  { id: "scu",   name: "四川大学",       province: "四川", domains: ["scu.edu.cn"],            roots: ["https://jy.scu.edu.cn", "https://www.scu.edu.cn"] },
  { id: "uestc", name: "电子科技大学",   province: "四川", domains: ["uestc.edu.cn"],          roots: ["https://www.job.uestc.edu.cn", "https://www.uestc.edu.cn"] },
  // 重庆
  { id: "cqu",   name: "重庆大学",       province: "重庆", domains: ["cqu.edu.cn"],            roots: ["https://career.cqu.edu.cn", "https://www.cqu.edu.cn"] },
  // 陕西
  { id: "xjtu",  name: "西安交通大学",   province: "陕西", domains: ["xjtu.edu.cn"],           roots: ["https://job.xjtu.edu.cn", "https://www.xjtu.edu.cn"] },
  { id: "nwpu",  name: "西北工业大学",   province: "陕西", domains: ["nwpu.edu.cn"],           roots: ["https://job.nwpu.edu.cn", "https://www.nwpu.edu.cn"] },
  { id: "nwafu", name: "西北农林科技大学", province: "陕西", domains: ["nwafu.edu.cn"],        roots: ["https://job.nwafu.edu.cn", "https://www.nwafu.edu.cn"] },
  { id: "xidian",name: "西安电子科技大学", province: "陕西", domains: ["xidian.edu.cn"],       roots: ["https://job.xidian.edu.cn", "https://www.xidian.edu.cn"] },
  // 甘肃
  { id: "lzu",   name: "兰州大学",       province: "甘肃", domains: ["lzu.edu.cn"],            roots: ["https://career.lzu.edu.cn", "https://www.lzu.edu.cn"] },
];

// 省/市官方聚合平台（交叉检索，覆盖院系/行业专场）
export const PROVINCIAL = {
  "重庆": ["cqbys.com"],
  "北京": ["bjbys.net.cn"],
  "湖北": ["hr.bysjy.com.cn"],
  "上海": ["firstjob.shec.edu.cn"],
  "江苏": ["jse.edu.cn"],
  "陕西": ["sxges.cn"],
};

export const EXPECTED_SCHOOLS = SCHOOLS.map((s) => s.name);

// 第三方校招聚合平台（收录跨校/他站发布的 41 校相关双选会）
// domains: 用于 allowed 判定与 source_type 标记
// roots:   第三方平台双选会列表页（直抓；抓不到则降级，不影响主流程）
export const THIRD_PARTY = [
  { name: "国家大学生就业服务平台", domains: ["ncss.cn"], roots: ["https://www.ncss.cn/jobsfair"] },
  { name: "应届生求职网", domains: ["yingjiesheng.com"], roots: ["https://www.yingjiesheng.com/campus/index.html"] },
];
