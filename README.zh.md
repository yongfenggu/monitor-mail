# monitor-mail

[English](README.md) | 中文

一个 Claude Code skill：实时盯着 Agent Mail 邮箱（基于 `agently-cli`），新邮件抵达时让 AI 读全文、按内容自动拟回复并安全发出。

## 安装

```bash
npx skills add yongfenggu/monitor-mail --skill -g -y
```

前置：

- Node.js ≥ 18
- Agent Mail CLI 已安装并已授权。还没装请先看 https://agent.qq.com/doc/cli-setup.md

## 使用

在 Claude Code 里直接说：

- `开启自动回复邮件`
- `监听邮箱`
- `帮我盯收件箱`

Claude 会先验证授权、问轮询间隔、做自检，然后启动 monitor。每来一封新邮件：读全文 → AI 拟回复 → 两步确认发出 → 在对话里告诉你。

停止：

- `停掉监听` / `stop`

## 工作机制

```
node bin/watch.mjs --interval 30
  ↓ execSync('agently-cli message +list')
agent.qq.com REST API
  ↓ 跟 seen message_ids 做差集
{"event":"new_mail",...}  →  stdout
  ↓ Monitor 工具消费
Claude 拉全文 → 拟回复 → +reply 两步 → 汇报
```

monitor 只在 Claude Code 会话存活期间跑。会话一结束 monitor 就停，不会再自动回复。

## License

MIT
