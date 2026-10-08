# @dshx/lsp-ts

TypeScript / JavaScript language pack，复用 `@dshx/lsp` 的 `ctx.lsp` 与 stdio 宿主。不实现 JSON-RPC、不创建自己的进程池、不提供额外模型工具。

Desktop 运行时不携带官方 `@deepseek-ai/dsh-lsp` / `dsh-lsp-stdio`。本包只依赖 `@dshx/lsp` 做类型、错误和注册；不要再声明那两个官方包为运行时 peer。

## 使用

必须在同一执行环境组合一次 `@dshx/lsp`（提供 `ctx.lsp` 和模型工具），以及匹配的 fs/subprocess provider；本包只消费这些服务，不自动创建第二份基础设施。

使用 TypeScript 7 原生 LSP；本次验证的最新正式版本为 7.0.2。语言服务器由部署安装，本包不自动下载：

```sh
pnpm add -g typescript@latest
```

通过仓库 GitHub Release 的 tarball 安装本包。安装补丁只添加 @dshx/lsp-ts 行；若部署没有 `@dshx/lsp`，需先安装该底座。其它插件调用同一 ctx.lsp，即共享同一运行时。

默认 command 为 tsc，args 为 [--lsp, --stdio]；映射 .ts/typescript、.tsx/typescriptreact、.js/javascript、.jsx/javascriptreact。

TypeScript 6 及更早版本的 tsc 不支持此 LSP 启动方式。建议 command 使用 TypeScript 7 的绝对路径，避免误选项目旧版 tsc。插件开发用 typescript-native alias 锁定 7.0.2 做真实服务器测试，构建类型检查仍用仓库的 TypeScript 5.9.3。

Desktop 的 PATH 可能与终端不同；可设置绝对 command 路径或 env.PATH。command 必须是绝对路径或 PATH 名称，不能是相对路径。示例配置：

```yaml
- name: '@dshx/lsp-ts'
  config:
    command: /absolute/path/to/typescript/bin/tsc
    args: [--lsp, --stdio]
    env:
      PATH: /absolute/path/to/node/bin:/usr/bin:/bin
    extensionToLanguage:
      .mts: typescript
      .cts: typescript
```

command/args 替换默认值；env 交由 subprocess 合并；extensionToLanguage 合并默认映射，同名键覆盖。initializationOptions、configuration、maxMessageBytes、maxStderrBytes、maxDocumentBytes、shutdownTimeoutMs、killGraceMs 直接使用 `@dshx/lsp` 的 schema/defaults。

## 行为和边界

- 支持 `@dshx/lsp` 已暴露的操作（含 goToDefinition、findReferences、goToImplementation、hover、diagnostics、documentSymbols）。模型工具用一基 UTF-16 坐标，ctx.lsp 用零基坐标。
- 加载时解析命令，不启动 Language Server。缺少命令时注册 LspProvider fallback，查询抛出 LspError，code=LSP_UNAVAILABLE，包含命令和安装/重载建议。安装后需重载插件。
- 只捕获 SubprocessExecutableNotFoundError；配置无效、重复 provider/扩展冲突、传输失败和卸载取消保留底座错误。
- provider id 固定 ts。不要与另一个管理 .ts/.tsx/.js/.jsx 的 provider 同时启用；注册表原子拒绝冲突。
- stdio 宿主在一个 provider 内按 canonical workspace 共享进程，懒启动；不同 workspace 独立。插件卸载或 Harness 正常退出时，ctx.effect 清理进程及 subprocess 管理的进程范围。
- 公开 seam 没有 workspace/session-close 或释放某个 workspace 的接口：单个 session 关闭不会保证立刻释放池中进程；只保证 provider 释放时的清理。多个独立 Host/provider 实例也不会共享跨进程的全局池。

## 验证

pnpm --filter @dshx/lsp-ts typecheck / build / test。测试使用真实 Cordis + fs-local + subprocess-local + `@dshx/lsp` 和原生 TypeScript 7.0.2 的 tsc --lsp --stdio，验证四操作、并发/符号链接规范化共享、两个 workspace、lazy spawn 和卸载 waitForExit，以及缺少命令、自定义路由、取消、冲突和配置错误。

这是底座集成测试，不是 Desktop 安装验收。实际 Desktop profile 激活和模型工具可用性仍须在安装后验证。

## 来源

移植自 [dsh-lsp-packs](https://github.com/988hj7tczd-oss/dsh-lsp-packs/tree/258bb6409c504fa1eed20b6f70d13009522ca0ce/dsh-lsp-ts)，MIT（完整许可随包保留）。截至调查时 3 stars、0 forks。修正上游 catch-all fallback、丢失自定义扩展映射、Cordis array schema 未显式默认导致 --stdio 丢失的问题。
