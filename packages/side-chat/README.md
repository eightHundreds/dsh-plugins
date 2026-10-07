# @dsk/side-chat

DSH 右侧边栏侧聊：在已完成回复的操作栏点击分支图标按钮，继承截至该轮 `turn/end` 的上下文，在 DSH 原生右侧边栏（`sidebar.right.pane.tab`）以独立 Tab 呈现侧聊，主会话不导航。

## 架构与最佳实践

本插件完全采用 DSH 官方右侧边栏（参考 `ui-subagent` 官方侧边栏对话最佳实践）：
- **侧边栏 Tab 注册**：通过 `ctx.sidebarRightTabs.register()` 注册 `kind: 'sidechat'` Tab。
- **对话面板直接复用官方 Conversation**：通过 `SessionProvider session={reference}` 结合官方核心插槽 `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, ...)`，完整复用 DSH 原生聊天面板（包括官方富文本输入框、工具卡片、流式渲染、审批与提问交互、代码块复制等全部能力），**绝不自写半吊子消息转译与简陋输入框**。
- **分支触发按钮**：挂载于官方每条助手回复的标准操作栏插槽 `conversation.chat.assistant-actions`，与复制按钮并列，采用官方 `<IconBranchOutlineRegular />` 图标与 Tooltip。
- **自动联动**：点击分支后直接触发 `ctx.sidebarRight.openTab('sidechat')`，自动打开右侧边栏并聚焦侧聊 Tab。
- **零弹层、零核心修改**：遵循官方扩展契约，完全运行于纯插件沙箱内。

## 行为

- 每个来源主会话保留侧聊分支列表；一次在右侧栏呈现选中的分支（多个分支支持在 Tab 顶部切换）。
- 分支是普通、可持久化的 DSH Session，具备官方原生的完整能力。
- 关闭或折叠侧边栏只是释放客户端 UI 引用，不停止后台任务，不删除会话。
- localStorage 仅记录 child/source ID、分支对应序号等元数据；所有消息由 DSH 原生管理。

## 开发

Node 24 / pnpm 11。按仓库规范使用 tsdown；Client 输出平台 factory closure，非独立 ESM 页面。

```sh
pnpm --filter @dsk/side-chat typecheck
pnpm --filter @dsk/side-chat build
pnpm --filter @dsk/side-chat test
```

## Desktop 本地安装

遵循仓库 [Desktop 调试安装规范](../../docs/agents/desktop-debug-install.md)：以本目录的 `link:` 安装，bundle 添加 `@dsk/side-chat`，HMR root 添加本包 `lib` 绝对路径；初始发现可能需要刷新/重启。此插件使用已发布公共 API，可安装到匹配的 rc.2 Desktop。

## 验证

自动测试只覆盖控制器、持久化、消息投影与会话适配纯逻辑，不新增 UI 单元测试。人工验收须检查主聊不跳转、截止边界、流式正文、停止、交互跳转、窄窗、输入法、HMR/卸载引用释放。当前自动检查通过；Desktop 交互验收尚未执行。
