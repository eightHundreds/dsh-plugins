# 上游来源与迁入说明

来源：https://github.com/DeepTrial/dsh-bash-rtk

迁入提交：2ed878009f2ac2045fc014048fe387f5fe883263（上游版本 0.1.1）。

作者 DeepTrial，MIT 授权。源码、测试与原中英文说明保留；LICENSE 随附件分发。本目录是本仓库维护的移植副本，不表示上游发布或背书。包名从 @deeptrial/dsh-bash-rtk 改为 @dshx/bash-rtk，保留 patch 行 id 以兼容启用步骤；不要同时安装本副本和上游版本。

0.2 使用公开的 DSH 0.2.0-rc.2 SDK，改为继承官方 SandboxBashExecutor，仅在 public resolve() 完成默认值与沙箱策略后改写命令，execute() 继承不变。不修改官方 DSH，不依赖未发布接口；此前核心扩展/定制 Desktop 方案已放弃。Cordis 使用 @deepseek-ai/cordis，类型检查、执行器及沙箱测试直接使用公开包。修复大小写/原型属性路由问题、限制复杂 shell 命令改写，并将 RTK 探测限制为每次启用一次、有超时。RTK 二进制仍需自行安装；安装默认 disabled，启用时替换同范围的 shell provider（不关闭 sandbox 后端），步骤见 [README.zh.md](<./README.zh.md>)。

安装本仓库最新正式附件：

```sh
dsh plugin --profile demo add "https://github.com/<owner>/<repo>/releases/latest/download/dshx-bash-rtk.tgz"
```

上游文档保留用于参考，其中上游发布 URL、开发链接路径和兼容性断言不能视为本仓库验证结果。
