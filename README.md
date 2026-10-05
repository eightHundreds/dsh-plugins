# DSH 插件多包仓库

pnpm workspace + TypeScript，插件独立版本。默认通过 GitHub Release 预编译附件交付：不发布 npm、不提交构建产物、不要求用户编译。根包只负责开发，不是 DSH 插件。

## 开发

使用 fnm 管理 Node 24，pnpm 版本固定在根清单。

```sh
fnm use --install-if-missing
pnpm install
pnpm new:plugin my-feature
pnpm install
pnpm check
```

各插件在 packages 下；hello 是 host 生命周期示例，starter-bundle 是纯组合包；bash-rtk 是从 DeepTrial/dsh-bash-rtk 迁入的 MIT 插件，继承官方沙箱 bash 执行器，只在公开 `resolve()` 中改写命令，来源及适配记录见 [UPSTREAM.md](<packages/bash-rtk/UPSTREAM.md>)。各包单独固定开发 SDK；RTK 的全部检查直接使用 `0.2.0-rc.2` 公开包，不依赖修改后的 DSH 核心。正式附件不携带开发依赖。生成器拒绝覆盖已有包，不自动把新包加入组合包。外部资源使用 ctx.effect 清理，服务依赖声明 inject。

## GitHub Release 交付

```sh
pnpm release:pack <owner>/<repo> v0.1.0
pnpm test:release <owner>/<repo> v0.1.0
```

产物位于 artifacts/release/v0.1.0，含各包 tgz、SHA256SUMS、安装命令 install.md。artifacts、lib、node_modules 和本地 pnpm store 均已忽略，不进入 Git。参数只生成附件及命令，不上传、不设置远端。

Release 打包在临时目录处理包清单，不修改工作区：

- 保留编译输出、patch、exports、locale 和宿主 peers。
- 删除 scripts、devDependencies，不携带 TypeScript/Changesets 构建工具。
- 将内部 runtime dependencies/optionalDependencies 递归放入包的 node_modules，并声明 bundledDependencies。组合附件包含所需内部插件，无需 npm 注册包，也无需用户安装相邻附件。
- 组合 patch 中内部插件名称在交付时改为内嵌入口的相对路径；DSH 会以 patch 所在目录为基准解析，不依赖 profile 顶层能找到子包。
- 内部依赖环会失败；外部 runtime 依赖仍按清单解析。未来含原生或平台相关代码的插件要另做跨平台交付。

不能把内部依赖简单改为其他附件 URL：pnpm 11 默认 blockExoticSubdeps 会拒绝这种间接 URL 依赖。本仓库已在默认策略下验证内嵌方案。

### 自动流程

推送 v* tag 触发 release 工作流：冻结安装 → 完整检查 → 打包 → 干净环境 HTTP 安装验证 → 创建 GitHub **草稿 Release** → 上传全部附件与安装说明。无需 NPM_TOKEN，只使用仓库 GITHUB_TOKEN。工作流中的 tag 是整批附件的交付标识；各插件版本仍由 Changesets 独立管理。

维护者检查草稿后发布，附件 URL 才对公众可访问。已有 Release 重跑会替换同名附件；发布后不要修改已公开版本。不要只上传组合附件而漏掉测试与校验文件。

每次发布同时提供带版本号附件和不带版本号的固定别名，内容及 SHA256 完全一致。用户安装最新正式 Release 时始终使用同一条命令：

```sh
dsh plugin --profile demo add \
  "https://github.com/<owner>/<repo>/releases/latest/download/dsk-starter-bundle.tgz"
```

latest 由 GitHub 的最新正式 Release 决定，草稿与预发布不参与；需要固定版本时使用 releases/download/<tag>/<包名>-<版本>.tgz。固定 URL 是安装入口，不自动更新已安装插件；重复安装可能受 pnpm 锁文件/缓存影响，升级行为尚未验证。

组合包与 Hello 单包任选其一启用，避免重复挂载相同 id。必须用附件直链，不是 Release 页面或自动生成的源码压缩包。私有仓库认证另行处理。

## RTK 插件

独立安装最新正式附件（实际 owner/repo 替换后使用）：

```sh
dsh plugin --profile demo add "https://github.com/<owner>/<repo>/releases/latest/download/dsk-bash-rtk.tgz"
```

此插件使用本仓库包名 @dsk/bash-rtk，与上游安装二选一。**0.2 提供 shell 服务，继承官方 SandboxBashExecutor；同范围的 bash-sandbox/bash-local shell 行必须关闭，但 sandbox 后端、sandbox-policy 与 subprocess 服务必须保留。** 安装默认不启用；先在 PATH 安装 RTK，再按 [中文说明](<packages/bash-rtk/README.zh.md>) 启用 bash-rtk。未探测到 RTK 时命令透传，沙箱机制不变。

使用未修改的官方 `0.2.0-rc.2` 公开 SDK，无需修改 DSH 核心或重新打包 Desktop。全部测试基于公开依赖；实际 profile 的安装与启用需单独操作，构建不会替换正在运行的应用。

## 命令

| 命令 | 用途 |
| --- | --- |
| pnpm build / typecheck | 构建 / 类型检查 |
| pnpm dev | 本仓库 TypeScript watch，不保证 DSH HMR |
| pnpm check | host 与生成器测试、安装合同检查 |
| pnpm pack:all | 原始单包打包，仅用于本地检查；组合包尚未内嵌依赖 |
| pnpm release:pack owner/repo tag | 完整检查并生成正式交付附件 |
| pnpm test:release owner/repo tag | 校验 checksum、内部依赖与干净 HTTP 安装 |
| pnpm changeset / release:version | 记录变更 / 更新包版本与 changelog |

## 首次发布

1. 确认示例包名、插件 id、描述和许可证。目前 UNLICENSED，不替你选择开源授权；不需占用 npm 名称，但名称仍需避免与已有插件冲突。
2. 设置真实 repository 信息，提交源码与锁文件，添加 GitHub 远端。本地已初始化 main，尚无提交或远端，changeset status 要等初始提交后才能运行。
3. changeset → release:version → pnpm install → 检查版本与 changelog → 提交 → 推送 v* tag。
4. 检查 Actions 与草稿附件，再发布 Release，并在干净 DSH profile 安装、启用、卸载验证。

已验证当前 host 生命周期、发包合同及隔离 pnpm HTTP 安装；尚未上传真实 GitHub Release 或在运行中 DSH 激活。UI 插件后续需单独处理 ./client、dsh.client、ModuleLoader 与宿主 externals。

选型依据见 [社区调查](docs/community-research.md)。Changesets 是这里的版本管理选型，不是查实的 DSH 社区统一发布工具。
