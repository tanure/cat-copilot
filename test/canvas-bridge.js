// Harness: exercise generateFromAgent against fake sessions without the app.
// Loads extension.mjs's function by extracting it, so we test the real source.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, "..", ".github", "extensions", "catpilot-canvas", "extension.mjs"), "utf8");
const start = src.indexOf("function generateFromAgent");
if (start < 0) throw new Error("generateFromAgent not found in extension.mjs");

// Brace-match to the end of the function so this harness keeps working when the
// implementation is edited (line-offset slicing silently extracts garbage).
let depth = 0, end = -1, seen = false;
for (let i = src.indexOf("{", start); i < src.length; i++) {
    const c = src[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") { depth--; if (seen && depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error("could not brace-match generateFromAgent");
const body = src.slice(start, end);

const make = new Function("sessionRef", "log", `${body}; return generateFromAgent;`);

const JSON_ANSWER = '{"title":"T","goal":"G","measure":"M","steps":"S","why":"W","due":"2026-08-14","priority":"P2","tags":"a","context":"c","importance":"High","urgency":"Low"}';

function fakeSession({ deliverAssistantEvent, history = [], answerAfterMs = 100, answer = JSON_ANSWER, idleAfterMs = null }) {
  const handlers = new Set();
  const events = [...history];
  return {
    getEvents: async () => [...events],
    on: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async () => {
      events.push({ type: "user.message", data: { content: "prompt" } });
      setTimeout(() => {
        const ev = { type: "assistant.message", data: { content: answer } };
        events.push(ev);
        if (deliverAssistantEvent) handlers.forEach((h) => h(ev));
        const idle = { type: "session.idle", data: {} };
        setTimeout(() => handlers.forEach((h) => h(idle)), idleAfterMs ?? 20);
      }, answerAfterMs);
      return "msg-1";
    },
  };
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// 1. The reported bug: events are gated, assistant.message never arrives.
{
  const s = fakeSession({ deliverAssistantEvent: false });
  const r = await make(s, () => {})("p", 8000, true);
  check("recovers when assistant.message is never delivered", r.ok && r.content === JSON_ANSWER, r.error || "got the draft");
}

// 2. Stream works — should still succeed, and fast.
{
  const s = fakeSession({ deliverAssistantEvent: true });
  const t0 = Date.now();
  const r = await make(s, () => {})("p", 8000, true);
  check("fast path still works when events do arrive", r.ok && r.content === JSON_ANSWER && Date.now() - t0 < 1500, `${Date.now() - t0}ms`);
}

// 3. Prior history containing an old JSON answer must not be mistaken for ours.
{
  const stale = '{"title":"STALE"}';
  const s = fakeSession({
    deliverAssistantEvent: false,
    history: [{ type: "assistant.message", data: { content: stale } }],
  });
  const r = await make(s, () => {})("p", 8000, true);
  check("ignores an answer that predates the prompt", r.ok && r.content === JSON_ANSWER, r.content?.slice(0, 30));
}

// 4. Chatter before the JSON must not settle the request.
{
  const s = fakeSession({ deliverAssistantEvent: true, answer: "Sure, let me think about that." });
  const r = await make(s, () => {})("p", 2500, true);
  check("does not settle on non-JSON chatter when JSON was asked for", r.ok === false, r.error?.slice(0, 40));
}

// 5. No getEvents at all (older host) — must not throw, falls back to the stream.
{
  const s = fakeSession({ deliverAssistantEvent: true });
  delete s.getEvents;
  const r = await make(s, () => {})("p", 5000, true);
  check("degrades gracefully without getEvents", r.ok && r.content === JSON_ANSWER, r.error || "");
}

// 6. Send failure surfaces immediately.
{
  const s = fakeSession({ deliverAssistantEvent: false });
  s.send = async () => { throw new Error("boom"); };
  const r = await make(s, () => {})("p", 5000, true);
  check("reports a send failure", r.ok === false && r.error === "boom", r.error);
}

// 7. session.error is surfaced.
{
  const handlers = new Set();
  const s = {
    getEvents: async () => [],
    on: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async () => { setTimeout(() => handlers.forEach(h => h({ type: "session.error", data: { message: "nope" } })), 50); return "m"; },
  };
  const r = await make(s, () => {})("p", 5000, true);
  check("surfaces a session error", r.ok === false && r.error === "nope", r.error);
}

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
