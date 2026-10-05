# @dsk/starter-bundle

纯组合包，无 JavaScript 入口。dsh.bundle.patch 引用 Hello 插件；开发时 dependencies 使用 workspace:^。

pnpm release:pack 会递归内嵌内部插件的预编译文件并声明 bundledDependencies。用户安装 GitHub Release 的本包附件即可，无需 npm 中的 Hello 包，也无需本机编译。普通 pnpm pack 输出仍只有组合包本身，不能当作正式交付附件。

安装本包或 Hello 单包任选其一启用，避免重复挂载相同 id。
