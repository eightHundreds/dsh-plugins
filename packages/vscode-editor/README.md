# @dsk/vscode-editor

将 DSH 右侧文件预览中的 JavaScript / TypeScript 文件优先交给 Monaco 显示。支持 `js`、`jsx`、`mjs`、`cjs`、`ts`、`tsx`、`mts`、`cts`；官方代码与纯文本查看器保留在查看器菜单中。

当前为只读预览：语法高亮、行号、查找、文本选择、自动布局及官方换行开关。内容仍由官方预览服务分页读取，继续使用原有加载更多、刷新和外部修改提示；支持通过文件导航参数定位已加载的行。没有保存、文件树替换或共享编辑器服务。

主题使用官方 `ctx.theme.getTheme()` 和 `theme/change` 事件。明暗模式决定 Monaco 基础语法配色，背景、文字、行号、注释、选区、光标、边框、查找高亮和滚动条从 DSH CSS token 解析，兼容第三方主题覆盖以及 `color-mix()` 颜色。

Monaco CSS 与字体内嵌于客户端包，editor worker 通过本地 `/vscode-editor/assets` 路由加载，无运行时 CDN。适配 DSH `0.2.0-rc.2`；客户端声明 `platform: web`，对应 Desktop 使用的同一浏览器插件运行时。

## 开发

```bash
pnpm --filter @dsk/vscode-editor typecheck
pnpm --filter @dsk/vscode-editor build
pnpm --filter @dsk/vscode-editor dev
pnpm --filter @dsk/vscode-editor test
```

`dev` 监听客户端源码；Host 变更需重新执行 build。包独立发布，通过 GitHub Release 附件交付。Desktop 本地开发使用 `link:` 安装并配置 HMR 的 lib 监听目录。

## 手工验收

安装后打开 JS/TS 文件，确认默认显示 Monaco；切换官方查看器、换行、调整侧栏宽度，并检查查找、文件刷新和加载更多。测试文件链接的行号导航、明暗主题、第三方自定义配色，以及插件关闭后恢复官方预览。浏览器网络中 editor worker 应返回 200，控制台不应出现 worker 降级警告。

Monaco Editor 版权所有 Microsoft，使用 MIT 许可证。
