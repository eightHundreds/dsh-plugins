# @dshx/tool-edit

DeepSeek Harness 的 rich `edit` 工具：replace、patch、apply_patch 和 hashline 四种模式。编辑成功写入后，通过部署中的 `@dshx/lsp` `ctx.lsp` 查询全文件诊断，并把摘要附加到工具结果。插件不启动自己的语言服务器。

Bundle 默认开启 `diagnosticsOnEdit`。没有挂载 `ctx.lsp`、语言服务器不支持该文件，或诊断查询失败时，编辑仍然成功，只是结果不附带诊断。

```yaml
- id: tool-edit
  name: '@dshx/tool-edit'
  config:
    mode: hashline
    diagnosticsOnEdit: true
    diagnosticsDeduplicate: true
```

Bundle 在 Host 中挂载插件，监听 `agent/created`，在每个 Agent 自己的 scope 注册 `edit` 与 `tool:edit` 提示词。采用 [Rianico/dsh-better-edit](https://github.com/Rianico/dsh-better-edit/blob/main/src/index.ts) 的作用域遮蔽方案：官方 preset 保留完整的 `tool-fs`，`read`、`read_image`、`write` 继续由官方提供，增强版 `edit` 在 Agent 层优先生效。无需选择自定义预设，也不全局禁用 `str_replace_editor`。

Agent 销毁或 Host 插件卸载时释放注册；热更时也为已有 Agent 安装。配置默认 `mode: hashline`、`diagnosticsOnEdit: false`，bundle 显式选择 `auto` 并开启诊断。移除 bundle 后，后续会话恢复官方编辑器。

源码基于 [hy-sde/dsh-tool-edit](https://github.com/hy-sde/dsh-tool-edit)（MIT），其编辑引擎来自 oh-my-pi。上游自带的 LSP 客户端、写入前格式化和 TypeScript 7 启动选择已移除；诊断改由 `@dshx/lsp` 提供。
