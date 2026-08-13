# dsh-focus-chat

[![npm version](https://img.shields.io/npm/v/@dingyi222666/dsh-focus-chat.svg)](https://www.npmjs.com/package/@dingyi222666/dsh-focus-chat)

English | [中文](README.zh.md)

A plugin for the dsh web GUI that adds a **focus chat** tab — a condensed, Claude Code–style way to read a conversation.

## Install

```sh
# 从 npm 安装（需要 dsh >= 0.1.0-rc.6）
dsh plugin --profile web add @dingyi222666/dsh-focus-chat
# 重启 dsh web，工具自动挂载
dsh web
```

Then open the 聚焦对话 / Focus chat tab in any conversation.

Notes:

- `dsh plugin` behaves like adding a dependency to your web profile. A bundle plugin is loaded once its full package name appears in the profile's `dsh.profile.bundles` list (adds automatically on recent dsh builds; add it manually if your build does not); the bundle patch applies on the next boot.
- With the repo source-launched CLI, run the args through the bin directly (`node --import tsx/esm apps/cli/src/bin.ts ...`).

## Screenshots

| Off — the normal chat view | On — the focus chat view |
| --- | --- |
| ![Off: the normal chat view](screenshots/before.png) | ![On: the focus chat view](screenshots/after.png) |

Instead of watching every step live, one assistant turn collapses into a single summary line:

> 思考了 36 秒，载入了 3 项上下文，运行了 2 个命令，编辑了 8 次，读取了 17 个文件，列出了 18 个目录
> (Thought for 36s, loaded 3 context items, ran 2 shell commands, edited 8 files, read 17 files, listed 18 directories)

…and the whole turn can fold into one `工作了 X 分 Y 秒` / `Worked for Xm Ys` line. Click any line to expand the full detail — tool cards, thinking, context injections, produced files, copy/fork actions — all drawn the same way as the normal chat rows. Your mid-turn interjections split the fold into per-stretch lines, each carrying its own duration, and a stopped turn reads `用户 X 后停止` / `Stopped after X` instead of "worked". When a context injection records its own one-line account — a tool-tasks background-task settlement like `bash pnpm install [status: completed]` — that account rides the summary line too (`注入了 …` / `injected …`), not just the `loaded N context items` count.

Switch to it whenever you want the "what happened?" view, and flip back for the full transcript.

## Why a separate tab, and not a patch into the chat view?

Short answer: the chat view's internals aren't open to third-party plugins — by design — and this plugin deliberately never touches dsh's own source. Concretely:

- **Keyed slots are owned, not shared.** The chat's rows render through slots like `conversation.chat.node`, `tool.call.toolview`, and `conversation.chat.turnTail`. Those slots are declared by the chat entries themselves, and the slot system rejects a second declaration at load time — the conflict *is* the design speaking. A plugin cannot insert its own rows into the chat transcript, and cannot even *declare* the chat's own slots.
- **Plugins can't reuse the chat's renderer code.** Importing values from another plugin package across the bundle boundary is forbidden (the bundle purity gate), so there's no way to borrow the chat's components — every row has to be drawn from the shared primitives and the public snapshot.
- **The only legal insertion point is the `conversation.view` list slot** — the whole message surface. That's why the plugin ships its own complete view instead of changing how the chat view displays.

If you want the chat view itself to behave differently, that's an in-repo change to the chat package — exactly what this plugin avoids.

## What's missing

Focus chat is a faithful reading surface, not a second chat view:

- **No Inspect / details-panel deep links.** The chat's Inspect affordance needs internals plugins can't touch. The tool cards render the same content, just without the jump-to-details button.
- **Third-party tool-card extensions don't render here.** Cards that other plugins add to the chat view won't appear in the focus view; the built-in card renderers are used instead.
- **Folding is per consecutive tool-run.** Any visible content between two runs (a reply, a command, your interjection) keeps them separate.
- **Inline file links need the optional file-mentions service** — the same off switch the chat view uses.

## Development

- `yarn run build` — builds the browser bundle and the Node half.
- `src/client/focus-model.ts` — the pure logic (folding, merging, row models); `src/client/FocusView.tsx` — the view.
- `yarn test` — behavior tests; `yarn run typecheck` — type gate.
- A `--dev` `dsh web` server hot-reloads rebuilt bundles — `yarn run build` alone is usually enough to see changes.

## Model Experience

None. The view is a pure client derivation over the already-logged conversation snapshot; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.
