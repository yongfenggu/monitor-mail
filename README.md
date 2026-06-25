# monitor-mail

English | [中文](README.zh.md)

A Claude Code skill that watches an Agent Mail inbox in real time (via `agently-cli`) and lets the AI read each new message and auto-reply with a context-aware response.

## Features

- Cross-platform Node.js watcher (macOS / Linux / Windows)
- One-line install through `npx skills add`
- Two-phase confirmation preserves Claude Code's permission model
- Built-in self-test (send-to-self + reply) before enabling auto-reply
- Session-scoped — no silent sending when you're not in front of the terminal

## Installation

```bash
npx skills add yongfenggu/monitor-mail --skill -g -y
```

Prerequisites:

- Node.js ≥ 18
- Agent Mail CLI installed and authorized. See https://agent.qq.com/doc/cli-setup.md.

## Usage

In Claude Code, just say:

- `开启自动回复邮件`
- `监听邮箱`
- `watch my mail`

Claude will verify auth, ask you for a polling interval, run a self-test, and start the watcher. New mail triggers: read full body → AI drafts a reply → two-phase send → report to you in chat.

To stop:

- `停掉监听` / `stop`

## How it works

```
node bin/watch.mjs --interval 30
  ↓ execSync('agently-cli message +list')
agent.qq.com REST API
  ↓ diff against seen message_ids
{"event":"new_mail",...}  →  stdout
  ↓ Monitor tool consumes
Claude reads full → drafts reply → +reply (two-phase) → reports
```

The watcher only runs while your Claude Code session is alive. End the session, the watcher dies, no more auto-replies.

## License

MIT
