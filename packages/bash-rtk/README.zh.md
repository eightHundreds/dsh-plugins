# @dsk/bash-rtk

适配**未修改的官方 DSH** 的 RTK 沙箱 bash 执行器插件。只使用公开 SDK，不需要修改 DSH 核心、重新打包 Desktop 或安装定制 runtime。来源见 [UPSTREAM.md](<./UPSTREAM.md>)；[English](<./README.md>)。

## 兼容范围与实现

基于公开的 DSH `0.2.0-rc.2` SDK、Cordis `4.0.4`、Node 24。shell 和沙箱执行器 peer 固定为已验证版本；其他版本需要重新验证。RTK 需自行安装并放在宿主 PATH 上。

插件继承官方 `SandboxBashExecutor`，仅覆盖原型方法 `resolve()`：先由 `super.resolve()` 完成默认值、预算上限和调用方沙箱策略，再替换命令文本。`execute()` 完全继承官方实现，保留沙箱、子进程、输出、前后台句柄、超时和取消机制。没有 monkey patch、私有 accessor、Tool 参数修改，也不依赖新增的核心接口。

插件提供 `ctx.shell`，**不能和同一服务范围内其他 shell 执行器同时启用**。依赖 `subprocess`、`sandbox`、`sandboxPolicy` 服务；仅适用于 bash，不替代 PowerShell。

## 行为

| 输入 | 结果 |
|---|---|
| `git status` | `rtk git status` |
| `git status \| grep x` | 原样透传 |
| 含换行、括号、重定向、变量展开的命令 | 原样透传 |
| `GIT status`、带路径/引号的可执行名、环境赋值前缀 | 原样透传 |
| RTK 探测失败 | 原样透传，仍由官方沙箱机制执行 |

固定白名单见 [wrap.ts](<./src/wrap.ts>)，不是实时读取 RTK 支持列表；复杂度判断是保守字符检查，不是完整 shell 解析。RTK 可能改变选项、输出和退出码，不保证语义等价。

## 安装与启用

安装本仓库 Release tarball；RTK 需预先置于宿主 PATH。该插件自带 Bundle 补丁（`cordis.patch.yml`），在通过 DSH 插件机制安装时会**自动禁用官方 `bash-sandbox` 并启用 `bash-rtk`**：

```yaml
- id: bash-sandbox
  disabled: true
- insert:
    - id: bash-rtk
      name: '@dsk/bash-rtk'
      disabled: false
      config:
        probeTimeoutMs: 2000
```

若此前手动启用了 `bash-local` 或其他 shell provider，仍须确保其处于禁用状态。**保留 sandbox 后端、sandbox-policy 和 subprocess 服务**：关闭 `bash-sandbox` 这一 shell 行并不关闭沙箱，RTK 继承了它的执行实现。原执行器的自定义预算配置应复制到 RTK 行。

卸载 RTK 插件时，DSH 会自动清理补丁，用户重新启用官方 `bash-sandbox` 即可。构建本仓库不会直接修改已安装应用或 profile。

## 配置

保留官方 live 配置：`cwd`、`timeoutMs`、`maxTimeoutMs`、`maxOutputBytes`、`maxSpillBytes`、`graceMs`。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `rtkAvailable` | 启用时探测 | 可选覆盖；`true` 只跳过检测，不安装二进制 |
| `probeTimeoutMs` | `2000` | `rtk --version` 超时，正安全整数且不超过 Node timer 上限 |

每次启用只探测一次，不在每条命令上探测。安装或更新 RTK 后重新启用。探测只确认宿主 PATH 上 `--version` 成功，不校验全部子命令；单次执行覆盖 PATH 后仍可能找不到 RTK。执行失败不自动重跑，更不绕过沙箱降级。0.2 不支持已放弃方案的 `order` 配置。

## 开发

所有检查直接使用公开 SDK，执行器和沙箱测试无需相邻的 DSH checkout：

```sh
pnpm install
pnpm --filter @dsk/bash-rtk check
pnpm pack:all
```

MIT。
