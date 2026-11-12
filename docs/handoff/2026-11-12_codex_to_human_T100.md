# T100 交接

## 做了什么

- 从 `https://github.com/liangsheng-sys/st-reader` 拉取源码，在 `task/T100-tt-html` 分支修复。
- TT 的公开源码 `src/lib.js` 使用异步 `getHljs()` 加载高亮库，`SillyTavern.libs` 来自 core bundle。已核对 v2.4.0 与 main。
- 旧阅读器遇到带语言的代码块时访问缺失的 `hljs.getLanguage()`，正式楼层入口捕获异常后改为原样显示。合成浏览器环境复现了这条失败路径。
- `loadHostRuntime()` 在初始化时补齐阅读器使用的高亮库。ST 自带库直接复用，TT 经宿主加载接口获取。宿主库对象保持原值。
- 可选高亮包失败时记录原因，正文继续排版，HTML 块仍可进入沙箱。
- 运行时改动仅涉及 `src/core/hostRuntime.js`、`src/core/formatter.js`。公开 core ↔ UI 签名保持兼容。

## 改动文件

- `src/core/hostRuntime.js`、`src/core/formatter.js`。
- `src/core/hostRuntime.test.js`、`src/core/hostRuntimeBrowser.test.js`。
- `dev/selftest.mjs`、`index.js` 的自测接线。
- `docs/03_TECH_SPEC.md`、`docs/04_TASKS.md`、`docs/06_ISSUES.md` 与本交接。

## 人类验收步骤

1. 完全退出 TT，解压交付的 `st-reader-tt-compatible.zip`。
2. 打开 TT 已安装的 `st-reader` 插件文件夹，把里面的 `src/core/hostRuntime.js` 和 `src/core/formatter.js` 先复制到别处备份。
3. 从解压出的 `st-reader/src/core/` 取这两个同名文件，覆盖插件目录里的对应文件。
4. 重新打开 TT，进入原来有问题的聊天，再打开阅读器，选择 HTML 的“渲染”。
5. 应看到网页内容，点“原文”看到代码，再点“渲染”恢复网页。含 JavaScript 的普通 HTML 可以执行交互。
6. 在合成开发实例中，全量复制源码后，可在控制台运行 `await stcrSelfTest({core:false,hostRuntime:true})`，独立验证 4 项浏览器回归。

## 验证结果

- `node dev/selftest.mjs` 通过 219 项，含 5 项新增宿主库检查。
- `node src/ui/ui.test.js` 通过 46 项。
- 现有 Chrome 无头浏览器通过 12 项检查，分别使用 TT 异步高亮接口、可选高亮加载失败、ST 同步高亮接口三种合成宿主。使用正式 `initFormatter → buildFloor → createHtmlManager → createSandbox` 路径，确认沙箱脚本执行、渲染与原文切换、普通代码和思维链代码保留。
- 同一浏览器合成环境加载修改前的两个文件时，首个 HTML 围栏检查复现“楼层回退成了原样显示”。
- 浏览器检查仅加载本地测试素材，并拦截外部请求与所有 `/api/` 请求。没有安装新的浏览器或 npm 依赖，临时测试环境已清理。
- `dev/test-release.cmd` 的 Node 与 UI 阶段通过，性能阶段因缺少 `E:\st-reader\.dev\data\default-user\chats\STCR_T11_Mist\STCR-90-大文件-1600楼.jsonl` 退出。完整发布回归尚未通过。

## 只读自查

- `rg --no-ignore -n "chats/save|chats/rename|chats/delete|chats/import|group/save|group/delete|group/import|saveChat\(|deleteMessage\(" index.js src vendor style.css` 共 8 行，仅 `readonlyGuard.js` 的 7 行拒绝名单与 `htmlSnapshot.test.js` 的 1 行拒绝用例。
- `node dev/audit-readonly.mjs` 通过。扩展写聊天调用与宿主聊天赋值均为 0 行。守卫及审计名单保持原值。
- 未访问任何真实聊天、角色或设置文件，未读写 `F:\Claude\xinllm\SillyTavern\data`。

## 验收边界

- 本次是公开源码核对与模拟 TT 接口的浏览器验证，用户安装的 TT 实机仍待验收。
- 上游现有 HTML 检测规则继续适用。依赖酒馆助手专有 API 的页面仍受原有兼容范围约束。
- 版本号沿用上游 0.4.0，补丁仅在本地分支提交。

## 给下一个人的话

- 优先在用户 TT 实机按上述步骤确认原问题。若仍出现“原样显示”，使用楼层工具里的“复制错误信息”读取具体异常。
- 完整发布回归需要原开发实例与合成大聊天样本。本次结果没有代替该验收。
