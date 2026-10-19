// Browser E2E for the canvas-dependent features (redact, region edit,
// compress, OCR, JPEG-2000 rendering, UI smoke test) — no test framework:
// drives any Chromium via the DevTools protocol (Node's built-in WebSocket).
//
//   pnpm exec vite --port 1437 --strictPort &      # dev server
//   CHROME=/path/to/chrome node scripts/e2e-browser.mjs [http://localhost:1437]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:1437';
const chrome = process.env.CHROME;
if (!chrome) {
  console.error('set CHROME to a Chromium/Chrome binary');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfedit-e2e-'));
const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--window-size=1280,900',
  'about:blank',
]);
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  proc.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error('chrome did not start')), 15000);
});

const browserWs = new WebSocket(wsUrl);
await new Promise((r) => browserWs.addEventListener('open', r));
let id = 0;
const pending = new Map();
const listeners = [];
browserWs.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else listeners.forEach((l) => l(msg));
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    browserWs.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

let exitCode = 1;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text.startsWith('[e2e]')) console.log(text.slice(6));
    }
    if (m.method === 'Runtime.exceptionThrown') console.log('page exception:', m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description ?? '');
  });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: base + '/' }, sessionId);
  await new Promise((r) => setTimeout(r, 3000));
  const res = await send(
    'Runtime.evaluate',
    {
      expression: `import('/tests/browser/e2e.ts').then(m => m.runAll()).then(r => JSON.stringify(r))`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 600000,
    },
    sessionId
  );
  if (res.exceptionDetails) {
    console.log('E2E crashed:', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  } else {
    const summary = JSON.parse(res.result.value);
    console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
    exitCode = summary.failed > 0 ? 1 : 0;
  }
} finally {
  proc.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(exitCode);
