# @dsk/lsp-ts

TypeScript / JavaScript language pack，复用官方 `ctx.lsp` 和 `@deepseek-ai/dsh-lsp-stdio`。不实现 JSON-RPC、不创建自己的进程池、不提供额外模型工具。

## 使用

要求 Host 使用官方 0.2.0-rc.2 SDK。必须在同一执行环境组合一次官方 Lsp service、dsh-tool-lsp，以及匹配的 fs/subprocess provider；本包只消费这些服务，不自动创建第二份基础设施。

安装语言服务器：

```sh
pnpm add -g typescript typescript-language-server
```

通过仓库 GitHub Release 的 tarball 安装本包。安装补丁只添加 @dsk/lsp-ts 行；若部署没有 ctx.lsp 或官方 tool-lsp，需在部署中配置官方基础设施。其它插件调用同一 ctx.lsp，即共享官方运行时。

默认 command 为 typescript-language-server，args 为 [--stdio]；映射 .ts/typescript、.tsx/typescriptreact、.js/javascript、.jsx/javascriptreact。

Desktop 的 PATH 可能与终端不同；可设置绝对 command 路径或 env.PATH。command 必须是绝对路径或 PATH 名称，不能是相对路径。示例配置：

```yaml
- name: '@dsk/lsp-ts'
  config:
    command: /absolute/path/to/typescript-language-server
    args: [--stdio]
    env:
      PATH: /absolute/path/to/node/bin:/usr/bin:/bin
    extensionToLanguage:
      .mts: typescript
      .cts: typescript
```

command/args 替换默认值；env 交由官方 subprocess 合并；extensionToLanguage 合并默认映射，同名键覆盖。initializationOptions、configuration、maxMessageBytes、maxStderrBytes、maxDocumentBytes、shutdownTimeoutMs、killGraceMs 直接使用官方 schema/defaults。

## 行为和边界

- 仅官方 goToDefinition、findReferences、goToImplementation、hover 四操作。模型工具用一基 UTF-16 坐标，ctx.lsp 用零基坐标。
- 加载时解析命令，不启动 Language Server。缺少命令时注册官方 LspProvider fallback，查询抛出官方 LspError，code=LSP_UNAVAILABLE，包含命令和安装/重载建议。安装后需重载插件。
- 只捕获官方 SubprocessExecutableNotFoundError；配置无效、重复 provider/扩展冲突、传输失败和卸载取消保留官方错误。
- provider id 固定 ts。不要与另一个管理 .ts/.tsx/.js/.jsx 的 provider 同时启用；官方注册表原子拒绝冲突。
- 官方 stdio 宿主在一个 provider 内按 canonical workspace 共享进程，懒启动；不同 workspace 独立。插件卸载或 Harness 正常退出时，官方 ctx.effect 清理进程及 subprocess 管理的进程范围。
- 官方公开 seam 没有 workspace/session-close 或释放某个 workspace 的接口：单个 session 关闭不会保证立刻释放池中进程；只保证 provider 释放时的清理。多个独立 Host/provider 实例也不会共享跨进程的全局池。
- 不提供 diagnostics、format、completion 等超出官方 seam 的功能。

## 验证

pnpm --filter @dsk/lsp-ts typecheck / build / test。测试使用真实官方 Cordis + fs-local + subprocess-local + lsp-stdio 和 typescript-language-server，验证四操作、并发/符号链接规范化共享、两个 workspace、lazy spawn 和卸载 waitForExit，以及缺少命令、自定义路由、取消、冲突和配置错误。

这是官方栈集成测试，不是 Desktop 安装验收。实际 Desktop profile 激活和模型工具可用性仍须在安装后验证。

## 来源

移植自 [dsh-lsp-packs](https://github.com/988hj7tczd-oss/dsh-lsp-packs/tree/258bb6409c504fa1eed20b6f70d13009522ca0ce/dsh-lsp-ts)，MIT（完整许可随包保留）。截至调查时 3 stars、0 forks。修正上游 catch-all fallback 和丢失自定义扩展映射的问题。

对照官方 master 5badb15009ae1756c3afe0ae0cef1faafc290ccc；本地只读 checkout 639ed015397290b3745d163aafe02ffee4aa3f84 的 lsp、lsp-stdio、tool-lsp 三个入口 blob 与该 master 相同。参考 [官方 LSP 文档](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/lsp.md)。
