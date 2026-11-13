# T103 交接 · 智库图片显示与隐藏

## 做了什么

- 用户指定适配 `ruoege49-ship-it/zhiku-tavern-helper` 并增加显示开关。核对公开源码提交 `f8ecdc5e94a0e58f90fded6ffd0cabc6e8ce61bc`，独立实现保存格式读取。
- 支持按候选保存的插图、漫画页和画师库直接插入聊天的图片。所选版本在楼层正文下方显示。漫画独立叠字用图片下方的安全文字展示，并应用阅读器脱敏。
- 底部图片按钮和 Aa → 显示 →“显示智库图片”共用持久化设置，默认显示。隐藏后停止加载并释放对象地址。
- 本地图片库使用只读事务。缺库时中止建库，缺图时显示原因。预建楼延迟到实际挂载与接近视口后加载，切换候选和移除分页会释放旧图。
- 版本为 0.4.2，发布仓库为 `https://github.com/ambroselbt28-gif/st-reader`。

## 改动文件

- `src/core/zhikuImages.js`、`messageModel.js`、`formatter.js` 负责数据副本、图片地址、只读本地库与宿主外部媒体权限。
- `src/ui/zhikuImages.js`、`floorToolbar.js`、`reader.js`、`logic.js`、`settingsBar.js`、`templates/reader.html`、`style.css` 负责正式楼层接线、懒加载和开关。
- `src/core/zhikuImages.test.js`、`zhikuImagesBrowser.test.js`、`dev/selftest.mjs`、`index.js` 负责可执行验证。
- 更新版本、使用说明、README、更新日志、任务板、问题记录与 §5.24 合同。

## 人类验收步骤

1. 打开 TT，在扩展管理里找到安装自 `ambroselbt28-gif/st-reader` 的阅读器，点更新，然后重新加载 TT。新安装时，在安装扩展的地址框粘贴上述仓库地址。
2. 打开一个已经用智库生成过图片的聊天，点酒馆顶栏书本图标进入阅读器。到有图片的楼层，应在正文下方看到对应图片。
3. 点阅读器底部的图片图标，图片应隐藏。再点一次，应恢复显示。手机上按钮为图片图标。
4. 点 Aa，找到“显示”一行的“显示智库图片”，切换开关，图片和底部按钮状态应同步。
5. 关闭图片后退出阅读器，再次打开，图片应保持隐藏。重新加载 TT 后也应保持选择。
6. 选择一楼有不同图片的多个候选，在阅读器里切换，图片应跟着候选切换。退出阅读器后检查酒馆原聊天的候选仍保持之前的选择。
7. 找一个智库漫画楼，核对所选漫画版本和图下对白。换过设备的本地图片可能提示“此设备未找到”，这时可核对生成图片时使用的设备。
8. 开发实例恢复后，在 `http://localhost:8100` 的浏览器控制台粘贴 `await stcrSelfTest({core:false,zhikuImages:true})`，查看全绿结果。

## 已执行验证

- `node dev/selftest.mjs` 通过 231 项，其中本卡新增 12 项。
- `node src/ui/ui.test.js` 通过 46 项。
- 本机 Chrome 的合成宿主在 320、390、1366px 下各执行 9 项图片浏览器回归。实际使用 IndexedDB Blob 和正式 `buildFloor` 入口，验证缺库中止创建、并行对象地址共享、预建楼与隐藏状态延迟加载、显示与隐藏释放、候选隔离、漫画文字脱敏、迟到图片释放、直接插图与禁止外部媒体。
- 三档宽度均经正式 `openReader()` 打开合成聊天，点页脚按钮和 Aa 开关，关闭重开并恢复图片。按钮完整处于视口内，手机触控区为 44×44px。合成原始聊天 JSON 保持逐字一致，外部请求与禁写接口请求均为 0，未捕获异常为 0。
- 浏览器回归发现 30px 底栏会裁切 44px 图片按钮，已为存在图片的阅读器会话增加底栏高度并复测。
- `git diff --check` 通过。
- 完整原开发实例回归 `node dev/test-performance.mjs --chat-cache --backup --core-browser --ui-browser` 因 `E:\st-reader\.dev\data\default-user\chats\STCR_T11_Mist\STCR-90-大文件-1600楼.jsonl` 缺失退出。本机仅有 C、D 盘，指定的 E 盘开发实例和 F 盘宿主源码路径均不可用。本次浏览器验证采用临时合成宿主，配置文件和浏览器临时数据均在项目 `.tmp/`，原开发实例性能验证仍待恢复环境后执行。

## 只读自查

- 执行 `rg --no-ignore -n 'chats/save|chats/rename|chats/delete|chats/import|group/save|group/delete|group/import|saveChat\(|deleteMessage\(|deleteLastMessage\(|renameChat\(|clearChat\(|addOneMessage\(|updateChatMetadata\(|saveMetadata\(' index.js src vendor style.css`，命中共 8 行。`src/core/readonlyGuard.js` 第 4–10 行是原有禁用路径清单，`src/core/htmlSnapshot.test.js` 第 12 行是原有拒绝输入样本。新增代码命中为 0。
- `node dev/audit-readonly.mjs` 通过。扩展中的禁写方法调用为 0，宿主数据赋值为 0。网络新增命中均为图片 URL 纯逻辑样本和被阻止的浏览器样本。图片加载由校验后的 img 地址触发，扩展自有第三方服务为 0。
- 正式图片数据库仅使用 `transaction('images', 'readonly')`。浏览器测试把库名重定向到唯一的 `stcr-t103-*` 合成库，合成库写入与删除仅用于自测。
- 本任务读取、列出、复制或写入真实 ST 用户数据的次数为 0，访问 `F:\Claude\xinllm\SillyTavern\data` 的次数为 0。

## 已知边界

- 当前设备缺少智库的本地图片时显示缺失原因。相同站点和设备的本地库、酒馆图片文件及内嵌图片可用于展示。
- 本卡适配阅读器显示。新增媒体区位于正文锚点之外，现有文字卡片与文档导出各自沿用原正文入口。
- TT 实机的智库组合仍待上述人类步骤验收。

## 给下一个人的话

- §5.24 新增候选模型字段和可选 `ctx.attachZhiku`，现有公开函数签名保持兼容。图片 UI 接线由本次用户直接安排。
- 原工作区位于 `task/T102-reader-floor-jump`，有尚未提交的楼层跳转改动。本卡基于已发布 `c7edb90` 在独立 worktree 完成，原分支工作保留原位。发布前已重新核对 `publish/main`。后续合并楼层跳转时保留两个页脚入口和图片状态类，复核窄屏底栏空间。
- 临时浏览器脚本、测试库文件和截图在交付前清理，长期回归入口为仓库内测试模块和 `stcrSelfTest`。
