# dsh-focus-chat

[![npm version](https://img.shields.io/npm/v/@dingyi222666/dsh-focus-chat.svg)](https://www.npmjs.com/package/@dingyi222666/dsh-focus-chat)

[English](README.md) | 中文

一个给 dsh Web GUI 的插件，加了一个 **聚焦对话** 标签页——用 Claude Code 的方式精简地读对话。

## 截图

| 关闭——普通聊天视图 | 开启——聚焦对话视图 |
| --- | --- |
| ![关闭：普通聊天视图](screenshots/before.png) | ![开启：聚焦对话视图](screenshots/after.png) |

不再一步步盯着过程，一个助手回合会收成一条摘要行：

> 思考了 36 秒，载入了 3 项上下文，运行了 2 个命令，编辑了 8 次，读取了 17 个文件，列出了 18 个目录

整回合还能再收成一条 `工作了 X 分 Y 秒` 行。点任何一行都能展开成完整细节——工具卡片、思考、上下文注入、产物、复制/fork 操作——全部和普通聊天行同款画法。中途插话会把折叠按段切开，每段带自己的时长；被停止的回合显示 `用户 X 后停止` 而不是"工作了"。后台任务的结算通知（tool-jobs 的 `bash pnpm install [status: completed]` 这类 `notice` 注入）会归入摘要行的 `后台任务 N 个` 段，而不是原样写一条 `注入了 …`；展开该行仍能看到完整的通知正文。文件操作（编辑/读写）的失败不会写进摘要行——`edited N files` 读的是结果，只有命令和其他工具才带失败标注。

想看"刚才到底发生了什么"就切过来，想看完整过程就切回聊天视图。

## 安装

```sh
# 从 npm 安装（需要 dsh >= 0.1.0-rc.6）
dsh plugin --profile web add @dingyi222666/dsh-focus-chat
# 重启 dsh web，标签页自动挂载
dsh web
```

然后打开任意对话里的 聚焦对话 标签页。

说明：

- `dsh plugin` 相当于给 web profile 加一个依赖。bundle 型插件需要在 profile 的 `dsh.profile.bundles` 里出现它的完整包名才会被加载（新版本 dsh 会自动加；如果你的版本没加，请手动补上）；bundle patch 在下次启动时生效。
- 用仓库源码启动的 CLI 时，请直接调用 bin（`node --import tsx/esm apps/cli/src/bin.ts ...`）。

## 为什么要单独一个标签页？为什么不直接改聊天视图？

一句话：聊天视图的内部对第三方插件是封闭的——这是设计如此——而且这个插件刻意不碰 dsh 自己的源码。具体来说：

- **键控槽位是独占的，不是共享的。**聊天的行通过 `conversation.chat.node`、`tool.call.toolview`、`conversation.chat.turnTail` 这类槽位渲染。这些槽位由聊天入口自己声明，槽位系统在加载期拒绝重复声明——冲突本身就是设计在说话。插件既不能往聊天对话流里插自己的行，甚至连声明聊天自己的槽位都不行。
- **插件不能复用聊天的渲染代码。**跨 bundle 边界导入另一个插件包的值是被禁止的（bundle purity 门禁），所以没有任何办法借用聊天的组件——每一行都只能用共享原语和公开快照自己画。
- **唯一合法的插入点是 `conversation.view` 列表槽**——整个消息界面。这就是为什么插件自带一整个视图，而不是去改聊天视图的显示方式。

想让聊天视图本身换个行为，那是聊天包仓库内的改动——正是这个插件要避免的。

## 缺什么

聚焦对话是忠实的阅读界面，不是第二个聊天视图：

- **没有 Inspect / 详情面板深链。**聊天的 Inspect 入口依赖插件够不到的内部机制；工具卡片内容一样，只是没有"跳去详情"的按钮。
- **别的插件给聊天加的工具卡片扩展在这里不渲染。**聚焦视图用内置的卡片渲染。
- **折叠按连续工具轮次。**两段之间有任何可见内容（回复、命令、你的插话）就保持分开。
- **行内文件链接依赖可选的文件提及服务**——和聊天视图同一个开关。

## 开发

- `yarn run build` — 产出浏览器 bundle 和 Node 半边。
- `src/client/focus-model.ts` — 纯逻辑（折叠、合并、行模型）；`src/client/FocusView.tsx` — 视图。
- `yarn test` — 行为测试；`yarn run typecheck` — 类型门禁。
- `--dev` 的 `dsh web` 会自动热加载重建的 bundle——改完 `yarn run build` 一般就能看到效果。

## 模型体验

无。该视图是对已记录对话快照的纯客户端派生，这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。
