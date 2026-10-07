# Instructions for AI Agents

## Overview
DSH 插件 Monorepo (pnpm workspace + TypeScript)。
所有包统一使用 `@dsk/<插件名>` scope。包独立发布，通过 GitHub Release 附件交付，不发布 npm。

## Rules & Constraints
- **运行环境**: 用户主要使用 Desktop 版本（非 Web 版）。Node 24 (通过 fnm)，pnpm 11+。
- **DSH 核心只读（硬性规则）**: 任何时候都不得修改 DSH 核心，包括 `../deepseek-harness` 源码、已安装应用内的核心文件及核心构建产物。功能只在本插件仓库实现；现有公开 API 不足时，报告限制并调整插件方案，不以补丁、替换核心插件或重新打包核心绕过。
- **DSH 源码查阅**: 只读调查 deepseek-harness 核心实现时，直接从 `../deepseek-harness` 源码读取，不从 `node_modules` 读取。
- **UI / 测试规则**: 前端交互类、UI 类代码不编写单元测试。纯逻辑与后端服务编写测试。
- **组件样式**: `packages/` 内自有组件样式统一使用 CSS Modules（`.module.css`）；上游依赖自带的 CSS 可按依赖要求导入，校验脚本会拦截本地普通 CSS 导入。
- **生命周期与资源**: 外部资源使用 `ctx.effect` 清理，服务依赖声明 `inject`。
- **客户端模块契约**: 声明 `dsh.client.platform: "web"` 的包必须通过 `exports["./client"]` 提供 bundle 路径，且格式必须为字符串或 `{ "default": string }`（不可用 `{ "import": ... }`），由 `scripts/check/verify-packages.mjs` 校验。
- **编译打包**: 从头自建的插件优先使用 `tsdown`；类型检查使用 `tsc --noEmit`。引入自定义构建插件前，先查所用构建工具的官方文档和公开配置，并用最小构建验证；仅当公开能力无法满足需求时再自定义扩展。采用其他打包器前先说明具体限制。

## Commands
- **安装依赖**: `pnpm install`
- **新建插件**: `pnpm new:plugin <name>`
- **类型检查**: `pnpm typecheck`
- **运行测试**: `pnpm test`
- **完整检查**: `pnpm check`
- **打包检查**: `pnpm pack:all`

## Agent Skills Configuration

### Issue Tracker
Local markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage Labels
5 canonical roles mapped to Chinese labels. See `docs/agents/triage-labels.md`.

### Domain Docs
Multi-context repository layout. See `docs/agents/domain.md`.

### Desktop Plugin Debug & Installation
安装或调整 Desktop 插件前，读取并执行 `docs/agents/desktop-debug-install.md`，按文档运行安装检查脚本并验证 Desktop 实际行为。报告时区分静态检查与运行时验证结果。

### Audit DSH
调查 Desktop 组合与激活（新建会话失败、插件装了没用、`waiting for` 服务、崩溃后 bundles 被清空、`link:` 解析失败）时，按 `.agents/skills/audit-dsh/SKILL.md` **audit**。先 compose 再生效树；未要求改配置时不写 profile。

