# Instructions for AI Agents

## Overview
DSH 插件 Monorepo (pnpm workspace + TypeScript)。
所有包统一使用 `@dsk/<插件名>` scope。包独立发布，通过 GitHub Release 附件交付，不发布 npm。

## Rules & Constraints
- **UI / 测试规则**: 前端交互类、UI 类代码不编写单元测试。纯逻辑与后端服务编写测试。
- **环境要求**: Node 24 (通过 fnm)，pnpm 11+。
- **生命周期与资源**: 外部资源使用 `ctx.effect` 清理，服务依赖声明 `inject`。

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
