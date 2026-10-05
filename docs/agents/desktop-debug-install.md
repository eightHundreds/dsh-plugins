# DSH Desktop 插件本地调试与安装规范

为了在 DSH Desktop 运行环境下获得免重启的热模块重载（HMR）体验，本地开发与安装插件时必须遵循以下规则。

## 1. 原则与目标
- **拒绝静态压缩包（`.tgz`）安装**：在本地开发/调试环境中，禁止通过 `file:.../*.tgz` 方式安装本仓库插件，因为静态副本不会联动源码产物。
- **强制使用本地目录软链接（`link:`）**：直接指向 `packages/<plugin-name>` 目录。
- **同步维护 HMR 监听根目录**：将构建产物目录 `lib/` 注入 Desktop profile 的 `hmr` 配置中，实现编译即生效。

---

## 2. Desktop Profile 配置位置
- **Profile 目录**：`~/.dsh/profiles/desktop/`
- **依赖声明文件**：`~/.dsh/profiles/desktop/package.json`
- **Cordis 插件/HMR 配置文件**：`~/.dsh/profiles/desktop/cordis.patch.yml`

---

## 3. 安装与热更配置步骤

当用户要求将本仓库中的插件安装到 DSH Desktop 时，执行以下标准流程：

### 步骤 1：以 `link:` 协议更新依赖
修改 `~/.dsh/profiles/desktop/package.json`：
1. `dependencies` 中声明 `link:` 路径：
   ```json
   {
     "dependencies": {
       "@dsk/<插件名>": "link:/Users/ming/MC/dsh/dsh-plugins/packages/<插件名>"
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
3. 执行安装：进入 `~/.dsh/profiles/desktop` 执行 `pnpm install`。

### 步骤 2：配置 HMR 监听目录
编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`：
找到 `- id: hmr` 项，在 `config.root` 列表中添加该插件构建输出目录 `lib/` 的**绝对路径**（避免相对路径基准在 Desktop 运行时解析漂移）：
```yaml
- id: hmr
  config:
    root:
      - /Users/ming/MC/dsh/dsh-plugins/packages/<插件名>/lib
```
*(注意：保留既有的其他 HMR 监听路径)*

### 步骤 3：在 cordis.patch.yml 中按需启用服务并声明 `name`
如果该插件替换或新增了服务（例如 `bash-rtk` 替换了内置的 `bash-sandbox`），确认对应的开关配置：
> **关键点**：除了声明 `id` 外，**必须显式提供 `name: '@dsk/<插件名>'`**。DSH HMR 在文件变动时需要通过 `entry.options.name` 向上解析包名并在模块依赖树中查找受影响模块。若缺少 `name`，HMR 无法将文件变动与运行时插件关联，将不会触发 `partialReload()`。

```yaml
- id: <内置冲突服务>
  disabled: true
- id: <插件ID>
  name: '@dsk/<插件名>'
  disabled: false
```

---

## 4. 调试与更新工作流
配置完成后：
1. 在本仓库对应插件目录执行构建或监听构建（如 `pnpm build` 或 `tsdown --watch`）。
2. 构建更新 `packages/<插件名>/lib/` 后，Desktop 的 HMR 会监听到文件变化，自动卸载并重载插件，无需重启 DSH Desktop。
