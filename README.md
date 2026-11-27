# Bingwu Tools

面向个人的极简高频工具聚合入口，参考 Vercel / Geist 设计语言构建。纯前端静态生成（Astro 7 + Tailwind CSS v4 + TypeScript），由本地 `src/data/tools.json` 驱动，支持 Git 推送自动部署到 Netlify。

## 核心特性

- **极简 Geist 视觉**：高对比度黑白灰、1px 极细边框、浅色/暗色双主题（默认跟随系统并支持手动切换）
- **配置驱动 + 构建校验**：编辑 `src/data/tools.json` 即可维护分类与工具，自带 JSON Schema 补全与 Zod 构建期校验
- **多维检索与 URL 同步**：左侧单选分类 + 多选标签（AND 交集）+ 全字段检索（名称、描述、标签、别名、域名），筛选状态同步至 URL
- **本地点击频次记忆**：按 `localStorage` 记录主链接点击次数自动前置高频工具，切回页面/刷新时静默重排，支持切换默认顺序或一键重置
- **键盘优先体验**：`/` 或 `⌘K` 聚焦搜索、`↑↓←→` 切换卡片、`Enter` 直达打开、`Esc` 清空

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 本地开发预览
pnpm build        # 校验 tools.json 并构建静态产物至 dist/
pnpm preview      # 本地预览生产构建
```

## 维护工具清单

直接编辑 `src/data/tools.json`：

- `categories`：显式定义左侧栏分类顺序与名称
- `tools`：新增或调整工具条目（`icon` 可选，不填默认自动获取域名 Favicon，失败自动降级为首字母方块；`links` 最多可配 2 个次级入口如文档或 GitHub）

推送到 Git 后，Netlify 会根据根目录 `netlify.toml` 自动执行构建与上线。
