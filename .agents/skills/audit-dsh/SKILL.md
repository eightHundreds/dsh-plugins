---
name: audit-dsh
description: >-
  Audit DeepSeek Harness Desktop composition and activation.
  Use when a new session fails, a plugin is installed but unused,
  a Host or preset row is waiting for a service, bundles reset after a crash,
  a link: checkout cannot resolve its own dependencies,
  or an id-targeted patch is skipped.
---

# Audit DSH

调查 Desktop 上「配置写了但运行时没有」的问题。这是 **audit**，不是修核心、也不是泛化 debug。代码层的 tight loop 交给 `diagnosing-bugs`。安装/HMR 怎么配，读 [`docs/agents/desktop-debug-install.md`](../../../docs/agents/desktop-debug-install.md)。

组合命令、路径和症状表在 [`reference.md`](reference.md)。要 **compose**、对 `waiting for` 分类、查崩溃恢复或 `link:` 解析时再打开。

## Guardrails

- 从 `../deepseek-harness` 只读核心；不改核心、不改已安装应用、不重新打包核心。
- 用户没要求改配置时，不写 `~/.dsh/profiles/desktop`。**compose** / import 的 cwd 放在仓库或 `/tmp`，不放在 profile 里。
- 官方 `dsh-*` / `cordis` peer 由 Host runtime resolution 提供；插件自己的 `dependencies` 必须能从源码目录解析。

## 1. Name the plane

把用户原文（报错、截图、时间）落到一个 **plane**：

| plane | 典型信号 |
|---|---|
| preset | `agent-preset/invalid`、`waiting for <service>`、新建会话失败 |
| host | Host 起不来、crash log、插件页报 bundle error |
| client | UI 空白、`exports["./client"]`、侧栏/设置不渲染 |
| install | `link:` 断、`skippedBundles`、依赖解析失败 |

preset 里的 `tool-bash … waiting for shell` 是 preset 在等 **host** 的 `ctx.shell`。提供方在 host（`bash-sandbox` / 替代者），不在 preset。

完成：写出一句「\<plane\> 在等 / 缺 / 失败了 \<name\>」，且能指出该服务应由哪一行提供。

## 2. Snapshot the live profile

只读：

- `~/.dsh/profiles/desktop/package.json`：`name` 必须是 `dsh-profile-desktop`；记下 `dependencies` 与 `dsh.profile.bundles`（两份名单，不是一份）。
- 同目录 `cordis.patch.yml`：与症状有关的 `id` / `insert` / `disabled` / `name`。
- 正在跑的 Desktop 进程启动时间，对比上述文件 mtime。进程早于文件 = 它跑的是旧树。
- Host 崩过再查 `~/Library/Logs/DeepSeek Harness` 与 `package.json.bak-*` / `cordis.patch.yml.bak-*`。

完成：能引用当前 `bundles` 全文、相关 patch 行，并判定进程是否新于这些文件。`name` 若不是 `dsh-profile-desktop`，先停，报告 profile 清单被换过。

## 3. Compose

按 `bundles` 顺序叠各 bundle patch，再叠用户层，得到生效条目表。打开 [`reference.md`](reference.md) 用其中的 **compose** 命令；`skippedBundles` 必须打印出来。

对每个相关 `id` 记录：`name`、`disabled`、是否由 `insert` 而来、`config` 里和症状有关的键。`!!js` 未求值时按运行平台读（darwin 上 `process.platform === 'win32'` 为假）。

完成：每个相关 `id` 要么出现在组合结果里（带 `disabled`），要么有「为何不在」——`skippedBundles`、`entry not found`、或 `name mismatch`。

## 4. Classify the gap

**compose** 与症状只许落在一类：

| 类 | 判定 |
|---|---|
| 行不存在 | 不在 `bundles`（`id:` 改不出来）；或 `insert` 没跑；或 `name` 对不上被跳过 |
| 行在但 disabled | 官方行被关、替代行没挂上 |
| 行在且启用，服务仍缺 | 激活失败：import、`inject` pending、构造抛错 |
| Host 未 settled | preset **audit** 先等 Loader；Host 没结束时 `waiting for` 还不是终局 |

`id:` 只改已有行；新行必须 `insert`。覆盖里的 `name` 是匹配条件。web-app 关掉 host 上的 `tool-bash` 是预期：会话用的是 preset 那一行。

`link:` 激活失败时：从源码目录 `import` 一次（cwd 不在 profile）。缺的是插件自己的 `dependencies`（装在本仓库），不是 profile 里的官方 peer。

完成：只选一类，并点出组合表或 import 输出里的一条证据。

## 5. Report

先给原因（配置 / 激活 / 进程仍是旧树），再给下一步。未要求改配置时停在报告。安装缺口指向 `desktop-debug-install.md`。代码 bug 需要 tight loop 时交给 `diagnosing-bugs`。

完成：用户能凭一类原因决定「改 bundles / 在本仓库 `pnpm install` / 重启 Desktop / 查 Host 激活」，且没有改过未授权的文件。
