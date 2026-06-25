---
name: monitor-mail
description: 实时监听 Agent Mail 邮箱（基于 agently-cli），新邮件抵达时让 AI 读全文并自动回复。当用户提到"监听邮箱"、"开启自动回复邮件"、"帮我盯收件箱"、"watch my mail"等场景时，激活此 skill。
version: 1.0.0
---

# monitor-mail

实时监听 `agently-cli` 当前绑定的 Agent Mail 邮箱。新邮件抵达后由 AI 读全文、上下文判断、拟回复、并通过两步确认安全发出。

## 何时激活此 skill

当用户说出以下任一类话语时启动本 skill：

- "开启自动回复邮件"、"自动回邮件"
- "监听邮箱"、"盯一下邮箱"、"watch my mail"
- "新邮件来了帮我回"
- "停掉监听"（用于停止已运行的 watcher）

## 前置依赖

1. **Node.js** ≥ 18（跑 `bin/watch.mjs`）
2. **agently-cli** 已安装并已授权某个 alias

**运行前检查**：执行 `agently-cli +me`。若失败、命令找不到、或未授权，**不要在本 skill 内教安装/授权**，直接告诉用户：

> 还没安装好 Agent Mail CLI。请先阅读 https://agent.qq.com/doc/cli-setup.md ，按官方步骤安装并配置完，再回来叫我。

然后结束本次执行，**不要继续**进入后续步骤。

## 执行流程（按顺序）

### Step 1 — 验证 agently-cli

```bash
agently-cli +me
```

- 成功（含 `"ok": true`）→ 记录 primary alias，继续 Step 2
- 失败 / 命令找不到 / 未授权 → 引导用户读 https://agent.qq.com/doc/cli-setup.md 完成安装与授权，**结束流程**，不再继续后续步骤

### Step 2 — 询问轮询间隔

QQ 邮箱后端限频 200 次/小时。用 AskUserQuestion 工具让用户选间隔：

- **30 秒**（推荐，120/h，留足缓冲）
- 10 秒（≈ 实时；360/h，可能触发限频，谨慎）
- 60 秒（保守，60/h）
- 自定义

把用户的选择保留为变量 `INTERVAL`，后面 Step 5 启动时 `--interval $INTERVAL`。

### Step 3 — 权限测试（关键安全环节）

**目的**：在开启自动回复前做一次端到端测试，验证 send/reply 链路通畅，并触发 Claude Code 的权限弹窗。

告诉用户：

> 我要给你自己发一封测试邮件，验证 send/reply 链路。整个过程会触发 Claude Code 的权限弹窗（`agently-cli message +send` 和 `+reply`），请选 **Allow**。

执行：

1. **自检发送**（两步确认）：
   ```bash
   RESP=$(agently-cli message +send --to <primary_alias> --subject "monitor-mail self-test" --body "monitor-mail 自检邮件，请忽略。")
   TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
   agently-cli message +send --to <primary_alias> --subject "monitor-mail self-test" --body "monitor-mail 自检邮件，请忽略。" --confirmation-token "$TOKEN"
   ```
2. **等待自检邮件抵达**（最多等 60 秒，每 5 秒轮询一次 `agently-cli message +list --limit 5`，找 subject 含 "monitor-mail self-test" 的那封，记下 message_id）
3. **自检回复**（两步确认，对那封自检邮件）：
   ```bash
   RESP=$(agently-cli message +reply --id <self_test_msg_id> --body "self-test OK")
   TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
   agently-cli message +reply --id <self_test_msg_id> --body "self-test OK" --confirmation-token "$TOKEN"
   ```
4. 全程在对话里同步进度，让用户知道每一步发生了什么。

任何一步失败 → 提示用户具体失败原因，结束流程，不要启动 watcher。

### Step 4 — 温柔提示用户加入 Always 允许

测试通过后，**仅展示提示，不自动改 settings.json**：

> 测试通过。如果想避免每次自动回复都触发权限弹窗，可以把下面两条加到你的 `~/.claude/settings.json` 或当前项目的 `.claude/settings.json` 的 `permissions.allow` 数组里：
>
> ```
> "Bash(agently-cli message +send:*)"
> "Bash(agently-cli message +reply:*)"
> ```
>
> 我**不会**自动写你的 settings——这是你的决定。

### Step 5 — 启动 watcher

用 `Monitor` 工具（`persistent: true`）启动：

```bash
node "<SKILL_DIR>/bin/watch.mjs" --interval <INTERVAL>
```

`<SKILL_DIR>` 是本 SKILL.md 所在目录（通常 `~/.agents/skills/monitor-mail/`），用文件系统检查或 `realpath` 推断绝对路径。

启动后会立刻收到一条 `{"event":"watch_started", alias, seeded, interval_s}` 通知，确认 watcher 在线。告诉用户："监听已启动，绑定 `<alias>`，已锚定 <seeded> 封旧邮件作为基线。"

### Step 6 — 处理 new_mail 事件

每次 Monitor 推来 `{"event":"new_mail", id, from, name, subject, snippet, at, is_read}`：

1. **跳过判定**（直接忽略，不回，但在对话里告诉用户"跳过 XX 因 YY"）：
   - `from == <primary_alias>`（自己）
   - `from == "admin@agent.qq.com"`（Agent Mail 系统通知）
   - 主题/snippet 显示明显的群发广告/退订指示
2. 拉全文：
   ```bash
   agently-cli message +read --id <id>
   ```
3. **由 AI 判断怎么回**（不要硬编码模板）：
   - 简单问候 → 礼貌回应，落款"AI 助手"，附"会转达给主人"
   - 有具体问题/请求 → 简短确认收到，说明主人会处理或下次上线回复
   - 邀请/通知类 → 简短确认收到
   - 中文为主，简短礼貌，**不要承诺主人具体的回复时间**
4. 两步确认发出：
   ```bash
   RESP=$(agently-cli message +reply --id <id> --body "<回复内容>")
   TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
   agently-cli message +reply --id <id> --body "<回复内容>" --confirmation-token "$TOKEN"
   ```
5. 在对话里报告：
   > 已回 `<from_email>`
   > 原标题：`<subject>`
   > 我的回复大意：`<回复内容>`

### 停止监听

用户说"停掉"/"stop"/"关掉监听"时：
1. 调用 `TaskStop` 杀掉 watcher 任务（task ID 在启动 Monitor 时返回）
2. 告诉用户："监听已停止。"

## 事件流契约（watch.mjs → Monitor）

| 事件 | 含义 | Claude 应对 |
|---|---|---|
| `watch_started` | watcher 启动并完成基线锚定 | 告知用户监听上线 |
| `new_mail` | 新邮件抵达 | 走 Step 6 流程 |
| `poll_stuck` | 连续 3 次轮询失败 | 告诉用户 watcher 可能挂了，问是否重启 |

## 注意事项

- watcher 是**会话内**的，会话结束 / Claude Code 关掉 → watcher 死亡，不再有自动回复
- 这是有意的安全设计：不在用户视野外发邮件
- 想要 7×24，需要另外架构（launchd + 无会话 Agent），不在本 skill 范围内
- 不要把"主人"的真实身份/联系方式透露在自动回复里
