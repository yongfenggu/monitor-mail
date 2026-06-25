#!/usr/bin/env node
// monitor-mail watcher — cross-platform polling daemon for agently-cli.
//
// Contract:
//   stdout : one JSON object per line. The Monitor tool turns each line into
//            a conversation event for Claude to react to.
//   stderr : human-readable diagnostics. Not consumed as events.
//
// Events emitted on stdout:
//   {"event":"watch_started", alias, seeded, interval_s}
//   {"event":"new_mail",      id, from, name, subject, snippet, at, is_read}
//   {"event":"poll_stuck",    fails, at}            // 3 consecutive failures
//
// Usage:
//   node watch.mjs                 # default 30s
//   node watch.mjs --interval 60   # custom interval (>=5s)

import { execSync } from "node:child_process";

const args = process.argv.slice(2);
let interval = 30;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--interval" || a === "-i") {
    const v = parseInt(args[++i] ?? "30", 10);
    if (!isNaN(v)) interval = v;
  } else if (a === "--help" || a === "-h") {
    process.stderr.write(
      "Usage: node watch.mjs [--interval SECONDS]\n" +
      "Polls agently-cli for new mail and emits one JSON line per new message on stdout.\n"
    );
    process.exit(0);
  }
}
if (interval < 5) interval = 5;            // hard floor — protect QQ rate limits
const intervalMs = interval * 1000;

function log(msg) {
  process.stderr.write(`[monitor-mail] ${msg}\n`);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// Strip the trailing "tip:" or "hint:" lines that agently-cli appends after JSON.
function stripTipLines(out) {
  return out.split(/\n(?:tip|hint):/i)[0];
}

function runCli(argString) {
  try {
    const out = execSync(`agently-cli ${argString}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000,
    });
    return JSON.parse(stripTipLines(out));
  } catch (e) {
    return null;
  }
}

// --- Bootstrap ---------------------------------------------------------------

const me = runCli("+me");
if (!me || !me.ok) {
  log("agently-cli +me failed. Is it installed and authed? Run: agently-cli auth login");
  process.exit(2);
}
const primary = (me.data?.aliases || []).find((a) => a.is_primary) || me.data?.aliases?.[0];
const alias = primary?.email || "unknown";

const seen = new Set();
const seed = runCli("message +list --limit 50");
if (seed && seed.ok && Array.isArray(seed.data?.data)) {
  for (const m of seed.data.data) {
    if (m.message_id) seen.add(m.message_id);
  }
}

emit({
  event: "watch_started",
  alias,
  seeded: seen.size,
  interval_s: interval,
});

// --- Poll loop --------------------------------------------------------------

let fails = 0;

function pollOnce() {
  const resp = runCli("message +list --limit 20");
  if (!resp || !resp.ok) {
    fails++;
    if (fails >= 3) {
      emit({ event: "poll_stuck", fails, at: new Date().toISOString() });
      fails = 0;
    }
    return;
  }
  fails = 0;
  const msgs = resp.data?.data || [];
  // Inbox returns most-recent-first; iterate reversed so events emit in chronological order.
  for (const m of [...msgs].reverse()) {
    if (!m.message_id || seen.has(m.message_id)) continue;
    seen.add(m.message_id);
    emit({
      event: "new_mail",
      id: m.message_id,
      from: m.from?.email || "",
      name: m.from?.name || "",
      subject: m.subject || "",
      snippet: (m.snippet || "").slice(0, 120),
      at: m.created_at || "",
      is_read: !!m.is_read,
    });
  }
}

function shutdown() {
  log("shutdown");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setInterval(pollOnce, intervalMs);
