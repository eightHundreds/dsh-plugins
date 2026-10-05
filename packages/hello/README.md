# @dsk/hello

Host 示例：加载时输出日志，卸载时通过 `ctx.effect` 清理。不是模型工具，也不修改系统提示词。

开发：`pnpm --filter @dsk/hello build`。默认用 pnpm release:pack 生成 GitHub Release 预编译附件；通过 DSH 插件管理安装附件 URL 后，检查 host 日志中的 loaded/disposed；本仓库的测试只覆盖 Cordis 挂载与清理，不宣称已安装到 DSH。

此名称仅作示例，发布前必须更名、确认许可证，并同步修改 patch 与组合 bundle。
