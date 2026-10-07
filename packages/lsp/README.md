# @dshx/lsp

DeepSeek Harness 的通用 LSP 基础设施插件：整合了 LSP 抽象总线（`ctx.lsp`）、通用 stdio 语言服务器进程宿主、以及面向 AI 模型的语义导航与分析工具（`lsp`）。

本插件**不内置任何具体语言服务器**，作为纯基础设施层运行。具体语言支持通过语言包（如 `@dshx/lsp-ts`）或通过 `servers` 配置项接入。

## 支持的操作

提供 7 大语义分析与导航操作：
- `diagnostics`（获取全文件语法与类型诊断错误）
- `documentSymbols`（获取全文件结构大纲树）
- `goToDefinition`（跳转到符号定义）
- `goToTypeDefinition`（跳转到类型声明）
- `findReferences`（查找符号引用，始终包含声明）
- `goToImplementation`（跳转到接口实现）
- `hover`（悬停文档与类型签名）

## 接入语言服务器

推荐搭配独立语言包使用（如 `@dshx/lsp-ts`），也可直接在 `cordis.patch.yml` 中通过配置声明：

```yaml
- id: dshx-lsp
  name: '@dshx/lsp'
  config:
    servers:
      typescript:
        command: /Users/ming/Library/pnpm/tsc
        args: [--lsp, --stdio]
        extensionToLanguage:
          .ts: typescript
          .tsx: typescriptreact
          .js: javascript
          .jsx: javascriptreact
```
