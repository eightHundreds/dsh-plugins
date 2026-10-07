# Audit DSH — compose, paths, symptoms

只在 **compose**、分类 `waiting for`、查崩溃恢复或 `link:` 解析时读。

## Paths

| 用途 | 路径 |
|---|---|
| 当前 profile | `~/.dsh/profiles/desktop/` |
| profile 清单 | `package.json`（`dependencies` ≠ `dsh.profile.bundles`） |
| 用户层 patch | `cordis.patch.yml`（最后一层；`id:` 找不到就跳过） |
| 根条目 | `cordis.yml`（启动器空根；Loader 可能回写，不代替 bundles） |
| 崩溃恢复备份 | `package.json.bak-*`、`cordis.patch.yml.bak-*` |
| Host crash | `~/Library/Logs/DeepSeek Harness/` |
| 核心（只读） | 仓库旁 `../deepseek-harness`，不读 `node_modules` 里的 dsh |
| 应用版本 | `~/Library/Logs` 旁的运行时：`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` |

Desktop 启动参数里的 profile 目录与 asar 内 `dsh` 是两棵树。asar 里的 `dsh/package.json` 是应用运行时清单，不是 profile。

崩溃恢复会把 `bundles` 收成官方两个（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`），用户 patch 改名为 `.bak-<timestamp>`。`id:` 关官方行、替代行靠 bundle `insert` 时，恢复后官方被关、替代行不存在。

## Compose

在 `../deepseek-harness` 下跑，cwd 不要是 profile。安装锚点用绝对路径，不要用 stdin 的 `import.meta.url`。

```bash
# DSH_AUDIT_RE 默认匹配 bash|shell|sandbox|subprocess
cd ../deepseek-harness && DSH_AUDIT_RE='bash|shell|sandbox|subprocess' pnpm exec tsx --input-type=module <<'EOF'
import { loadProfileDirectory, composeEntries } from './packages/boot/app-boot/src/profile.ts'
import { resolve } from 'node:path'
const profile = loadProfileDirectory(
  'dsh',
  resolve(process.env.HOME, '.dsh/profiles/desktop'),
  resolve(process.cwd(), 'apps/cli/package.json'),
)
console.log('layers', profile.layers.map(l => l.packageName))
console.log('skipped', profile.skippedBundles)
const warnings = []
const entries = composeEntries(
  [...profile.layers.map(l => l.patches), profile.patches],
  m => warnings.push(m),
)
const re = new RegExp(process.env.DSH_AUDIT_RE || 'bash|shell|sandbox|subprocess', 'i')
for (const e of entries.filter(e => re.test(`${e.id} ${e.name}`))) {
  console.log(JSON.stringify({ id: e.id, name: e.name, disabled: e.disabled, config: e.config }))
}
console.log('warn', warnings.filter(w => re.test(w) || /not found|mismatch/i.test(w)))
EOF
```

`skippedBundles` 空且 `layers` 空：读到的不是 profile 清单（常见于 `name` 变成了 `@deepseek-ai/dsh-desktop-runtime`）。

兼容性：`evaluatePluginCompatibility` 拿 app-boot 版本对 `@deepseek-ai/dsh` / `dsh-*` peer。不满足则该 bundle 被 skip，不进 `layers`。

## Patch

- `id:` 只改已在列表里、且 `name` 一致（若写了 `name`）的行。
- 新行用 `insert`。bundle 不在 `bundles` 里，它的 `insert` 不会跑。
- `name` 对不上 → 跳过并警告 `name mismatch`。
- 用户层在全部 bundle 层之后。后写的 `id:` 整份替换该行 `config`，不深合并。
- 重复 `id`、不同 `name` 可以并存（官方服务行 + 插件 insert 行）。

## Waiting

`auditRows`：启用行 `fiber.await()` 失败 → failed；`inject` 里仍有 `ctx.get(name) === undefined` → `waiting for <name>`。

preset **audit** 若仍 pending，会再 `loader.await()` 一次。Host 未 settled 时，preset 的 `waiting for shell` 还不是终局。

`tool-bash` 的 `inject` 含 `shell`。`shell` 由 host 的 sandbox 执行器提供（官方 `bash-sandbox`，或替代者如 `bash-rtk`）。web-app 禁用 host 上的 `tool-bash`；会话用 preset 里那一行。

## link:

`link:` 的真实路径在插件仓库。Node 从该目录往上找，看不到 profile 的 `node_modules`。

- 插件 `dependencies`：本仓库 `pnpm install`，源码旁或 hoist 必须能解析。
- 插件 `peerDependencies`（`dsh-*`、`cordis`）：Host 拦截到应用那一份。不要装进 profile 再供一份。

从 `/tmp` 对源码 `import` 一次。`Cannot find package` 指向源码侧缺 dependency。解析到全局 pnpm 里旧的 `0.1.x` 而不是应用的 `0.2.x`，说明没走 Host 拦截。

## Worked: waiting for shell

1. plane = preset 等 host `shell`。
2. **compose**：`bash-sandbox` disabled、`bash-rtk` 不在表里 → 行不存在（崩溃恢复清了 bundles，用户层 `id: bash-rtk` 改空气）。
3. **compose**：`bash-rtk` 在且 enabled，subprocess/sandbox/sandbox-policy 都在 → 配置完整，查激活（源码 `import`、`schemastery` 是否从 `packages/bash-rtk` 可解析）。
4. `verify:desktop` 通过只说明 `link:` / bundles / HMR 路径在；不证明 Host 提供了 `shell`。
