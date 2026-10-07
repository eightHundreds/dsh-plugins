# DSH Desktop 插件本地调试与安装规范

为了在 DSH Desktop 运行环境下获得免重启的热模块重载（HMR）体验，本地开发与安装插件时必须遵循以下规则。

## 1. 原则与目标
- **拒绝静态压缩包（`.tgz`）安装**：在本地开发/调试环境中，禁止通过 `file:.../*.tgz` 方式安装本仓库插件，因为静态副本不会联动源码产物。
- **强制使用本地目录软链接（`link:`）**：直接指向 `packages/<plugin-name>` 目录。
- **源码仓库必须先 `pnpm install`**：`link:` 只链目录，不会把插件自己的 `dependencies` 装进 Desktop profile。在本仓库根目录执行 `pnpm install`，让 `packages/<插件名>` 能从自身或 workspace hoist 解析这些包。官方 `dsh-*` / `cordis` peer 仍由 Desktop Host 提供，不要装进 profile。改了插件的 `dependencies` 后重新在本仓库安装；只在 profile 里 `pnpm install` 不够。
- **同步维护 HMR 监听根目录**：将构建产物目录 `lib/` 注入 Desktop profile 的 `hmr` 配置中，实现编译即生效。

---

## 2. Desktop Profile 配置位置
- **Profile 目录**：`~/.dsh/profiles/desktop/`
- **依赖声明文件**：`~/.dsh/profiles/desktop/package.json`
- **Cordis 插件/HMR 配置文件**：`~/.dsh/profiles/desktop/cordis.patch.yml`

---

## 3. 安装与热更配置步骤

当用户要求将本仓库中的插件安装到 DSH Desktop 时，执行以下标准流程：

### 步骤 1：在本仓库安装插件依赖
在仓库根目录执行 `pnpm install`（或 `pnpm --filter @dsk/<插件名> install`）。确认插件声明的 `dependencies` 能从 `packages/<插件名>` 解析到，而不是只存在于 Desktop profile 的 `node_modules`。

### 步骤 2：以 `link:` 协议更新依赖
修改 `~/.dsh/profiles/desktop/package.json`：
1. `dependencies` 中声明 `link:` 路径（使用本仓库在当前机器上的绝对路径，不要把某台机器的用户目录写进文档或提交）：
   ```json
   {
     "dependencies": {
       "@dsk/<插件名>": "link:<dsh-plugins 仓库根目录绝对路径>/packages/<插件名>"
     }
   }
   ```
2. 在 `dsh.profile.bundles` 数组中添加对应的包名（如已存在则保留）：
   ```json
   {
     "dsh": {
       "profile": {
         "bundles": [
           ...,
           "@dsk/<插件名>"
         ]
       }
     }
   }
   ```
3. 进入 `~/.dsh/profiles/desktop` 执行 `pnpm install`，只安装 `link:` 本身。不要指望这次安装补齐插件源码目录里的依赖。

### 步骤 3：配置 HMR 监听目录
编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`：
找到 `- id: hmr` 项，在 `config.root` 列表中添加该插件构建输出目录 `lib/` 的**绝对路径**（避免相对路径基准在 Desktop 运行时解析漂移）。路径在本机解析，不要把用户目录硬编码进仓库：
```yaml
- id: hmr
  config:
    root:
      - <dsh-plugins 仓库根目录绝对路径>/packages/<插件名>/lib
```
*(注意：保留既有的其他 HMR 监听路径)*

### 步骤 4：确认 bundle 补丁与 profile 覆盖

检查包的 `dsh.bundle.patch` 指向的补丁文件。DSH 按 `dsh.profile.bundles` 顺序应用 bundle 补丁，最后应用 profile 补丁。插件自带的冲突禁用规则已参与组合，无需在 profile 中重复；检查后续覆盖是否重新启用了冲突服务。

新增运行时行使用 `insert`，并在插入的行中提供 `name: '@dsk/<插件名>'`。对已有行使用 `id` 覆盖；覆盖中的 `name` 是匹配条件，不会补写或替换运行时包名。模块导出的 `name` 是插件标识，不要求等于包名。

### 步骤 5：运行静态安装检查（必须执行）

完成配置及构建后，在仓库根目录运行：

```bash
# 检查指定插件（也可使用 @dsk/session-title）
pnpm verify:desktop session-title
# 或直接运行脚本
node scripts/check/verify-desktop-install.mjs session-title

# 检查全部已声明或选择的 @dsk/* 插件
pnpm verify:desktop
# 或
node scripts/check/verify-desktop-install.mjs

# 使用自定义 DSH_HOME
DSH_HOME=/path/to/dsh-home pnpm verify:desktop session-title
```

不传插件名时检查 profile 中声明或选择的全部 `@dsk/*` 插件。默认使用 `~/.dsh/profiles/desktop`；设置 `DSH_HOME` 时使用该目录下的 `profiles/desktop`。

脚本检查绝对路径 `link:` 声明、实际 `node_modules` 软链接目标、bundle 选择、profile 中 HMR 启用状态与 `lib/` 路径、Host/Client 运行时导出文件、bundle 补丁解析，以及 profile 对本插件冲突禁用规则的显式反转。失败返回非零退出码；修复失败项后重新运行至通过。

通过只表示这些静态条件成立。脚本不组合其他 bundle、嵌套 include 或启动器覆盖，也不验证 peer 兼容性、Host 激活、Client 注册、UI 渲染或 HMR 事件。

### 步骤 6：验证 Desktop 实际行为（必须执行）

在 Desktop 中触发插件功能并确认结果；带配置 UI 的插件须打开对应页面确认控件渲染。要声称 HMR 生效，必须观察一次构建后的重载日志或可辨认的行为变化。记录验证方式与结果；无法访问 Desktop 时，报告“静态检查通过，运行时未验证”。

---

## 4. 调试与更新工作流
配置完成后：
1. 插件 `dependencies` 有变动时，先在本仓库重新 `pnpm install`，再构建。
2. 在本仓库对应插件目录执行构建或监听构建（如 `pnpm build` 或 `tsdown --watch`）。
3. 构建更新 `packages/<插件名>/lib/` 后，按步骤 6 观察 Desktop 的重载结果。新安装或修改监听配置后，若当前进程未加载新配置，重新启动 Desktop 再验证。
