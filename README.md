# DSH 插件仓库 (dsh-plugins)

DeepSeek Harness (DSH) 社区插件 Monorepo。采用 pnpm workspace + TypeScript，通过 GitHub Release 附件交付，不发布 npm。

## 📦 包含插件

- **[`@dshx/bash-rtk`](packages/bash-rtk)**：基于 [RTK (Rust Token Killer)](https://github.com/rtk-org/rtk) 的终端命令改写执行器。无缝拦截并在命令前接入 RTK 压缩输出，节约大模型 60%–90% 输出 Token，并在执行轨迹中展示 `[rtk: <cmd>]`。
- **[`@dshx/hello`](packages/hello)**：DSH 插件生命周期与基础实现示例。
- **`@dshx/starter-bundle`**：常用插件预打包组合。

## 🛠️ 快速开发

```sh
# 1. 安装依赖
pnpm install

# 2. 新建插件 (支持纯 Host 插件与带前端 UI 的插件)
pnpm new:plugin <name>         # 创建纯 Host 插件
pnpm new:plugin <name> --ui    # 创建带 Web Client UI + CSS Modules 的双端插件

# 3. 完整检查 (类型检查 + 单元测试)
pnpm check
```

## 🚀 安装到 DSH Desktop 本地调试

参考 [Desktop 本地调试与安装规范](docs/agents/desktop-debug-install.md)：

1. `~/.dsh/profiles/desktop/package.json` 中使用 `link:` 引入本地插件目录。
2. `~/.dsh/profiles/desktop/cordis.patch.yml` 中配置 `hmr.root` 指向插件 `lib/` 绝对路径，并声明 `name: '@dshx/<插件名>'` 享受免重启 HMR 热更。

## 🚢 发布

推送 `v*` 格式 tag 即可自动触发 GitHub Actions 构建并生成 Draft Release 附件：

```sh
pnpm release:version  # 更新版本
git commit -am "chore: release"
git tag v0.1.0
git push origin --tags
```

