# Changesets

修改交付包时运行 pnpm changeset，选择受影响包与 semver 等级。独立包版本不等于整批 Release tag。

pnpm release:version 更新版本、内部依赖和 changelog；随后 pnpm install 更新锁文件并提交。推送 v* tag 触发 GitHub Release 附件工作流，检查草稿后发布。无需 npm 发布或 NPM_TOKEN。

首次先确认包名、许可证、GitHub 远端；changeset status 需要已有初始提交。
