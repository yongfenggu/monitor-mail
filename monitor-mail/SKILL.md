---
name: monitor-mail
description: 实时监听 Agent Mail 邮箱（基于 agently-cli），新邮件抵达时按用户选择的策略处理（仅提醒 / 审稿后发 / 完全自动 / 条件自动）。当用户提到"监听邮箱"、"开启自动回复邮件"、"帮我盯收件箱"、"watch my mail"等场景时，激活此 skill。
version: 1.0.0
---

# monitor-mail

实时监听 `agently-cli` 当前绑定的 Agent Mail 邮箱。新邮件抵达后由 AI 读全文，按用户选择的策略处理：可只提醒、可拟稿待审、可完全自动回、可按规则条件自动回。

## 何时激活此 skill

当用户说出以下任一类话语时启动本 skill：

- "开启自动回复邮件"、"自动回邮件"
- "监听邮箱"、"盯一下邮箱"、"watch my mail"
- "新邮件来了帮我回"
- "停掉监听"（用于停止已运行的 monitor）

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

- 成功（含 `"ok": true`）→ 记录 primary alias 为变量 `ALIAS`，继续 Step 2
- 失败 / 命令找不到 / 未授权 → 引导用户读 https://agent.qq.com/doc/cli-setup.md，**结束流程**

### Step 2 — 询问轮询间隔

QQ 后端限频 200 次/小时。用 AskUserQuestion 让用户选：

- **30 秒**（推荐，120/h）
- 10 秒（≈ 实时；360/h，可能限频）
- 60 秒（保守）
- 自定义

记为变量 `INTERVAL`。

### Step 3 — 询问回复策略（关键分流点）

用 AskUserQuestion 在四种策略里选一：

- **(a) 仅提醒**：新邮件只在对话里告诉用户，不代为回复
- **(b) 审稿后发**：AI 读全文 → 草拟回复 → 给用户看草稿 → 用户说"发"才发
- **(c) 完全自动**：除内置安全跳过外，AI 拟稿并直接两步确认发出
- **(d) 条件自动**：按用户自定义规则筛选，命中规则的自动回，未命中的转为仅提醒

记为变量 `MODE`。

按 `MODE` 分支：

- `MODE = a` 或 `MODE = b` → **跳过** Step 4 和 Step 5（无需自检和 Always 允许），直接到 Step 6
- `MODE = c` 或 `MODE = d` → 顺次执行 Step 4 → Step 5 → Step 6

### Step 4 — 自检（仅 c / d 模式）

**目的**：在让 AI 全自动回邮件前做一次端到端测试，验证 send/reply 链路通畅，并触发 Claude Code 的权限弹窗让用户知情授权。

告诉用户：

> 接下来给你自己发一封测试邮件，验证 send/reply 链路。会触发 Claude Code 的权限弹窗（`agently-cli message +send` 和 `+reply`），请选 **Allow**。

执行：

1. **自检发送**（两步确认）：
   ```bash
   RESP=$(agently-cli message +send --to "$ALIAS" --subject "monitor-mail self-test" --body "monitor-mail 自检邮件，请忽略。")
   TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
   agently-cli message +send --to "$ALIAS" --subject "monitor-mail self-test" --body "monitor-mail 自检邮件，请忽略。" --confirmation-token "$TOKEN"
   ```
2. **等待自检邮件抵达**：最多 60 秒，每 5 秒轮询 `agently-cli message +list --limit 5`，找 subject 含 `monitor-mail self-test` 的那封，记下 `message_id`
3. **自检回复**（两步确认）：
   ```bash
   RESP=$(agently-cli message +reply --id <self_test_msg_id> --body "self-test OK")
   TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
   agently-cli message +reply --id <self_test_msg_id> --body "self-test OK" --confirmation-token "$TOKEN"
   ```
4. 全程在对话里同步进度。

任何一步失败 → 告诉用户具体原因，**结束流程**，不启动 monitor。

### Step 5 — 温柔提示 Always 允许（仅 c / d 模式）

仅展示，**不自动改 settings.json**：

> 测试通过。如果想避免每次自动回复都触发权限弹窗，可以把下面两条加到 `~/.claude/settings.json` 或当前项目的 `.claude/settings.json` 的 `permissions.allow` 数组里：
>
> ```
> "Bash(agently-cli message +send:*)"
> "Bash(agently-cli message +reply:*)"
> ```
>
> 我**不会**自动写你的 settings——这是你的决定。

### Step 6 — 配置回复策略（按场景适配，**不要**用固定 checklist）

> ⚠️ **关键原则**：不要对所有用户用同一组写死的问题。先了解 **身份 + 场景**，再设计具体问什么。

**6.1 — 先问两个上下文问题（b / c / d 模式都问）**：

用 AskUserQuestion：

1. **这个邮箱主要用途？**（工作 / 个人 / 客服 / 营销 / 投递 / 其他自填）
2. **AI 代回时以什么身份？**（个人助理 / 秘书 / 客服坐席 / 老板自己的延伸 / 其他自填）

记为变量 `CONTEXT = { purpose, persona }`。

**6.2 — 按 CONTEXT + MODE 设计后续问题**：

下面是**示例参考**，**不是固定模板**——你应当根据 CONTEXT 调整问什么、问几个、怎么问。

按模式覆盖的通用维度：

- **MODE = b 审稿后发**：
  - 草稿口吻（正式 / 亲切 / 简洁 / 用户自由描述）
  - 主人身份/联系方式可不可以透露（默认不透露）

- **MODE = c 完全自动**：
  - 草稿口吻
  - 回复对象：全部 / 白名单（只回某些 sender）
  - 主人身份/联系方式默认不透露，问是否要例外（如对家人可以透露）

- **MODE = d 条件自动**：
  - **触发规则**（多选 + 自由描述）：仅未读 / 主题含某关键词 / 来自某些 sender / 工作时间内 / AI 判断为简单致谢类 / 自由描述
  - **不触发时的兜底**：转为仅提醒
  - 草稿口吻
  - 主人身份/联系方式

按场景**启发**该问什么（启发，不是套模板）：

| CONTEXT | 应该重点问的问题示例 |
|---|---|
| 工作邮箱 + 个人助理 | 同事白名单是谁、紧急关键词、工作时间外要不要回 |
| 客服邮箱 + 客服坐席 | 哪些诉求 AI 直接回（查单号 / 退款流程），哪些必须升级到人工，标准答复模板 |
| 个人邮箱 + 自己的延伸 | 家人朋友优先级，广告/订阅类直接跳过的关键词 |
| 投递邮箱（如 hr@） + 助理 | 标准化收到回执，是否区分 HR / 候选人 / 招聘机构 |

把所有回答汇总为变量 `POLICY`（自由结构对象），后面 Step 8 按 `POLICY` 执行。

**追加问 + 全局审查**：

问完上述后，给用户**汇总一遍**：

> 我整理一下你的配置：
> - 模式：`<MODE>`
> - 场景：`<purpose>` + `<persona>`
> - 触发规则：`<...>`
> - 草稿口吻：`<...>`
> - 主人身份是否透露：`<...>`
> - 其他：`<...>`
>
> 有什么要改的吗？

收到确认后再继续。

### Step 7 — 启动 monitor

**7.1 — 运行中实例检查**

启动前先扫一下机器，避免和其他会话/agent 已经在跑的 monitor 重复——重复会导致同一封邮件被回复多次。

```bash
pgrep -fl "monitor-mail.*watch\.mjs" || true
```

- 没匹配到 → 直接进 7.2 启动
- 有匹配 → 用 AskUserQuestion 让用户选：
  - **停掉旧的再开新的**：`kill <旧PID>` 后启动
  - **取消本次启动**：避免重复回复，结束流程
  - **继续启动（明确并行）**：仅当用户清楚知道会重复（例如同邮箱不同模式分工）时选

**7.2 — 启动**

用 `Monitor` 工具（`persistent: true`）启动：

```bash
node "<SKILL_DIR>/bin/watch.mjs" --interval <INTERVAL>
```

`<SKILL_DIR>` 是本 SKILL.md 所在目录（通常 `~/.agents/skills/monitor-mail/`），用 `realpath` 或文件系统检查推断绝对路径。

收到 `{"event":"watch_started", alias, seeded, interval_s}` 通知后，告诉用户：

> 监听已启动（**<MODE>** 模式），绑定 `<alias>`，已锚定 `<seeded>` 封旧邮件作为基线。

### Step 8 — 处理 new_mail 事件（按 MODE 分流）

每次 Monitor 推来 `{"event":"new_mail", id, from, name, subject, snippet, at, is_read}`：

**8.1 — 通用硬跳过**（所有模式，不报告或仅一句话报告）：
- `from == ALIAS`（自己）
- `from == "admin@agent.qq.com"`（Agent Mail 系统通知）
- POLICY 的 sender 黑名单命中

**8.2 — 按 MODE 分流**：

- **MODE = a 仅提醒**：
  - 不拉全文，不回复
  - 在对话里告诉用户：「新邮件 from `<from>` / subj `<subject>` / `<snippet>`，要不要做点什么？」

- **MODE = b 审稿后发**：
  1. `agently-cli message +read --id <id>` 拉全文
  2. 按 POLICY（口吻、身份等）拟稿
  3. 给用户看草稿：
     > 准备回 `<from>`，原标题 `<subject>`。
     >
     > 草稿：
     > ```
     > <草稿>
     > ```
     > 要发吗？（发 / 改：XX / 不回）
  4. 用户说"发" → 两步确认发出 → 报告
  5. 用户说"改：…" → 按指示重新拟稿，回到 3
  6. 用户说"不回" → 跳过

- **MODE = c 完全自动**：
  1. 检查 POLICY 的回复对象（白名单/全部）→ 不在白名单则按"仅提醒"处理
  2. 拉全文 → 按 POLICY 拟稿 → 两步确认发出
  3. 报告：
     > 已回 `<from>` / 原标题 `<subject>` / 回复大意 `<gist>`

- **MODE = d 条件自动**：
  1. 用 POLICY 的触发规则评估这封邮件（关键词命中？sender 在白名单？时间窗内？AI 判定为致谢类？...）
  2. **命中** → 同 MODE c 的 2/3 步：拉全文 → 拟稿 → 发出 → 报告（附"触发了哪条规则"）
  3. **未命中** → 同 MODE a：仅提醒，附"为什么没自动回（规则未命中）"

**两步确认发送的标准模板**（c / d 的自动发，以及 b 用户批准后用）：

```bash
RESP=$(agently-cli message +reply --id <id> --body "<回复内容>")
TOKEN=$(echo "$RESP" | jq -r '.data.confirmation_token')
agently-cli message +reply --id <id> --body "<回复内容>" --confirmation-token "$TOKEN"
```

### 停止监听

用户说"停掉"/"stop"/"关掉监听"时：
1. 调用 `TaskStop` 杀掉 monitor 任务
2. 告诉用户："监听已停止。"

### 修改策略（运行中）

用户说"换成审稿后发"、"加个白名单"、"改下口吻"之类时：
1. 不需要重启 monitor
2. 用 AskUserQuestion 增量更新 `POLICY` 或 `MODE`
3. 告诉用户："已更新策略：<diff>。新到的邮件会用新策略。"

## 事件流契约（watch.mjs → Monitor）

| 事件 | 含义 | Claude 应对 |
|---|---|---|
| `watch_started` | monitor 启动并完成基线锚定 | 告知用户监听上线 |
| `new_mail` | 新邮件抵达 | 走 Step 8 流程（按 MODE 分流）|
| `poll_stuck` | 连续 3 次轮询失败 | 告诉用户 monitor 可能挂了，问是否重启 |

## 注意事项

- monitor 是**会话内**的：会话结束 / Claude Code 关掉 → monitor 死亡，不再自动回复
- 这是有意的安全设计——不在用户视野外发邮件
- 想要 7×24，需要另外架构（launchd + 无会话 Agent），不在本 skill 范围内
- **默认不透露主人真实身份/联系方式**——要透露必须用户明确同意
- `MODE` / `POLICY` 是会话内变量，**不写盘**。下次会话需要重新配置（这也是安全设计：每次启动重新对齐意图）
