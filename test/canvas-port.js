// Harness: the canvas server must reclaim its previous port after a reload.
// A panel keeps the URL it was opened with, so a fresh random port strands it.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "node:http";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, "..", ".github", "extensions", "catpilot-canvas", "extension.mjs"), "utf8");

// Brace-match a top-level function out of the real source so this harness keeps
// working when the implementation is edited.
function extract(name) {
    const start = src.indexOf(`function ${name}`);
    if (start < 0) throw new Error(`${name} not found in extension.mjs`);
    let depth = 0, end = -1, seen = false;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
        const c = src[i];
        if (c === "{") { depth++; seen = true; }
        else if (c === "}") { depth--; if (seen && depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) throw new Error(`could not brace-match ${name}`);
    return src.slice(start, end);
}

const tmp = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "catpilot-port-"));
const PORT_FILE = path.join(tmp, "catpilot-canvas-port");
const helpers = new Function("fsSync", "PORT_FILE",
    `${extract("rememberedPort")}\n${extract("rememberPort")}\nreturn { rememberedPort, rememberPort };`)(fs, PORT_FILE);
const listenOn = new Function(`${extract("listenOn")}; return listenOn;`)();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
    ok ? pass++ : fail++;
};

// 1. No memory yet -> caller must fall back to an ephemeral port.
check("no remembered port on a cold start", helpers.rememberedPort() === 0);

// 2. Round-trip.
helpers.rememberPort(45123);
check("remembers the port it bound", helpers.rememberedPort() === 45123);

// 3. Garbage / out-of-range values are ignored rather than crashing startup.
fs.writeFileSync(PORT_FILE, "not-a-port", "utf8");
check("ignores a corrupt port file", helpers.rememberedPort() === 0);
fs.writeFileSync(PORT_FILE, "80", "utf8");
check("ignores a privileged port", helpers.rememberedPort() === 0);

// 4. The real behaviour: bind, remember, restart, and land on the same port.
{
    const first = createServer(() => {});
    await listenOn(first, 0);
    const port = first.address().port;
    helpers.rememberPort(port);
    await new Promise((r) => first.close(r));

    const second = createServer(() => {});
    let reused = false;
    try { await listenOn(second, helpers.rememberedPort()); reused = second.address().port === port; }
    catch { reused = false; }
    await new Promise((r) => second.close(r));
    check("a restarted server reclaims the same port", reused, `port ${port}`);
}

// 5. When the remembered port is taken, binding it fails so the caller can
//    fall back instead of throwing out of startup.
{
    const holder = createServer(() => {});
    await listenOn(holder, 0);
    const taken = holder.address().port;
    const rival = createServer(() => {});
    let threw = false;
    try { await listenOn(rival, taken); } catch { threw = true; }
    try { rival.close(); } catch { /* never listened */ }
    await new Promise((r) => holder.close(r));
    check("a taken port rejects so startup can fall back", threw);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
