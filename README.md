# 双选会监控看板 · 云端全自动刷新

**目标**：不登录 WorkBuddy、不开电脑、不在线，每天自动完成「检索双选会 → 重建看板 → 部署上线」全流程。

## 架构

```
GitHub Actions (每天 北京08:00 定时)
   │
   ├─ scrape.mjs   对 41 校逐一官网直抓(Tier1)；直抓失败的校回退搜索引擎 API 核实
   │                 → 写 data/seed_payload.json + 增量追加 data/search_seed.json
   │
   ├─ build.mjs    合并 Tier1 + 搜索核实 + Tier3 → 过滤过去/往年场次
   │                → dateConfidence / 来源分级 / 覆盖完整性兜底 → 生成 dist/
   │
   └─ edgeone CLI  deploy → 重新部署到 EdgeOne（项目 shuangxuan-dashboard）
```

执行环境是 GitHub 的云端 runner，**与你本地电脑完全无关**。

## 你需要做的一次性操作（约 10 分钟）

### 1. 建 GitHub 仓库并推送本项目
把 `cloud-automation/` 目录下的全部内容推到一个**新的 GitHub 仓库**（如 `shuangxuan-dashboard`）。

```bash
cd cloud-automation
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/<你的用户名>/shuangxuan-dashboard.git
git push -u origin main
```

### 2. 配置仓库 Secrets（Settings → Secrets and variables → Actions → New repository secret）
| Secret 名 | 说明 | 获取方式 |
|---|---|---|
| `EDGEONE_TOKEN` | EdgeOne 部署令牌 | EdgeOne 控制台 → [Pages → 设置 → API Token](https://console.cloud.tencent.com/edgeone/pages?tab=settings) → 创建并复制 |
| `SEARCH_PROVIDER` | 搜索引擎类型 | 填 `serpapi` 或 `bing` |
| `SEARCH_API_KEY` | 搜索引擎 API Key | 见下方「搜索引擎选择」 |

### 3. 开启 Actions
仓库 → Actions 标签 → 若显示 "workflows aren't being run" → 点 **Enable**。

完成。之后每天北京时间 08:00 会自动跑，你什么都不用做。

## 搜索引擎选择（反爬校的全网检索核实）

Tier1 能直抓的校每天自动更新；直抓失败/反爬的校用搜索引擎补。三家对比：

| Provider | 免费额度 | 适合度 | 备注 |
|---|---|---|---|
| **bing** | 1000 次/月（Azure 免费层） | ⭐ 推荐每日全量 | Azure 账号，需信用卡验证（不扣费） |
| **serpapi** | 100 次/月 | 适合做兜底 | 注册即得 key，最简单；每日 41 校超额度，建议仅作补充 |
| **google** | 100 次/天（CSE） | 一般 | 需先建 Custom Search Engine 拿 `cx`，本脚本暂仅适配 serpapi/bing |

> 若暂时不配搜索引擎 key：脚本会自动跳过搜索步骤，仅用官网直抓 + 历史 `search_seed.json`（已含 199 条基线）重建，看板照常更新，只是反爬校不再每日自动补新。

## 时区说明
GitHub Actions 的 `cron` 固定用 **UTC**。当前 `daily.yml` 已按 `0 0 0 * * *` 配置 = **北京时间每天 08:00**。
想改时间：北京时 = UTC + 8，例如北京 09:00 → `0 1 0 * * *`。

## 本地测试（可选）
```bash
cp .env.example .env   # 填入 key
npm install
npm run refresh        # = scrape + build，生成 dist/
```
部署到 EdgeOne 可用本地 CLI：
```bash
export PAGES_SOURCE=skills
npx edgeone@latest makers deploy -n shuangxuan-dashboard -t "$EDGEONE_TOKEN" --json
```

## 数据持久化
每次刷新后，`data/search_seed.json`、`data/seed_payload.json` 会 commit 回仓库，作为跨日基线；`dist/` 为构建产物（可不追踪，部署时生成）。

## 注意事项
- EdgeOne 预览链接的 `?eo_token=...` 约 3 小时后过期（需带参访问）。**部署的项目本身是持久的**，每天重新部署会刷新 URL；如需永久稳定无 token 链接，在 EdgeOne 控制台把 `shuangxuan-dashboard` 设为「公开访问」。
- 看板链接（部署后从 Actions 日志 / EdgeOne 控制台获取）：`https://shuangxuan-dashboard-<hash>.edgeone.cool`
