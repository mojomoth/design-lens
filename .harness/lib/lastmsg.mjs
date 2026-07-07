// Extract the final assistant message + accumulated cost from a `claude -p --output-format=stream-json` log.
// Usage: node lastmsg.mjs <stream.jsonl> <out.last.txt> <out.cost>
// Tolerant by design: skips unparseable lines (watchdog kills can truncate mid-event), prefers the
// LAST {"type":"result"} event, falls back to the last assistant text block.
// The loop greps the completion promise ONLY from <out.last.txt> — never from the raw stream,
// which echoes the prompt (the prompt itself names the promise string, so grepping the stream
// would false-positive on iteration 1).
import { readFileSync, writeFileSync } from "node:fs";

const [, , streamPath, lastPath, costPath] = process.argv;
const lines = readFileSync(streamPath, "utf8").split("\n").filter(Boolean);

let result = "";
let cost = 0;
let lastAssistant = "";

for (const line of lines) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue; // truncated/garbled line — tolerate
  }
  if (ev.type === "result") {
    if (typeof ev.result === "string") result = ev.result;
    if (typeof ev.total_cost_usd === "number") cost = ev.total_cost_usd;
  }
  if (ev.type === "assistant") {
    const parts = ev.message?.content ?? [];
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    if (text) lastAssistant = text;
  }
}

writeFileSync(lastPath, result || lastAssistant);
writeFileSync(costPath, String(cost || 0));
