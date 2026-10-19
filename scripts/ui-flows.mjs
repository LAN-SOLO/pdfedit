// UI flows for pdfedit in headless Chromium with a mocked Tauri IPC layer:
// DE+EN, dark+light, at the minimum window size (860x560). Checks layout
// overflow, untranslated strings, native confirmations (Cancel keeps data),
// translated backend errors, PDF links, update dialog, pages dialog.
//
//   pnpm exec vite --port 1437 --strictPort &
//   node scripts/ui-flows.mjs <chrome-binary> http://127.0.0.1:1437 <screenshot-dir>
// The mock mirrors tauri-plugin-dialog 2.7: window.confirm/alert/prompt are
// async stubs calling an unregistered command (so any use of them breaks).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [chrome, base, out] = process.argv.slice(2);
import { createRequire } from 'node:module';
// fixture: 2 pages, an external URI link, an internal link, a text field
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, PDFName, PDFString } = require('pdf-lib');
const fixture = await (async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  p1.drawText('Bericht Seite eins - Link unten', { x: 50, y: 780, size: 20, font });
  p1.drawText('https://example.com/extern', { x: 50, y: 700, size: 16, font });
  p1.drawText('Zu Seite 2', { x: 50, y: 640, size: 16, font });
  p2.drawText('Seite zwei', { x: 50, y: 780, size: 20, font });
  const ctx = doc.context;
  const uri = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [45, 690, 300, 720], Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/extern') } });
  const internal = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [45, 630, 200, 660], Border: [0, 0, 0],
    Dest: [p2.ref, PDFName.of('XYZ'), 0, 842, 0] });
  p1.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(uri), ctx.register(internal)]));
  doc.getForm().createTextField('kundenname').addToPage(p1, { x: 50, y: 500, width: 200, height: 24 });
  return Buffer.from(await doc.save()).toString('base64');
})();
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, 'prof-'));
const proc = spawn(chrome, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  proc.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) res(m[1]);
  });
  setTimeout(() => rej(new Error('no chrome')), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let mid = 0;
const pending = new Map();
const exceptions = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    exceptions.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++mid;
    pending.set(i, (m) => (m.error ? reject(new Error(method + ' ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mockScript = (lang) => `
(() => {
  const LANG = ${JSON.stringify(lang)};
  Object.defineProperty(Navigator.prototype, 'language', { get: () => LANG });
  Object.defineProperty(Navigator.prototype, 'languages', { get: () => [LANG] });
  const b64 = ${JSON.stringify(fixture)};
  const bytes = () => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  const cfg = (window.__mock = { calls: [], confirmAnswer: false, readError: null, listeners: {}, destroyed: false,
    pickPath: '/Users/batman/Dokumente/Bericht März 2026.pdf', savePath: null, written: null,
    update: { version: '1.0.1', notes: '- Fehlerbehebungen', date: '2026-10-19 12:00:00.0 +00:00:00' } });
  const cbs = {}; let n = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(cb) { const id = n++; cbs[id] = cb; return id; },
    unregisterCallback(id) { delete cbs[id]; },
    convertFileSrc: (p) => p,
    async invoke(cmd, args) {
      cfg.calls.push({ cmd, args });
      switch (cmd) {
        case 'plugin:app|version': return '1.0.0';
        case 'plugin:event|listen': (cfg.listeners[args.event] ||= []).push(args.handler); return args.handler;
        case 'plugin:event|unlisten': for (const k in cfg.listeners) cfg.listeners[k] = cfg.listeners[k].filter((h) => h !== args.eventId); return null;
        case 'pick_pdf': return cfg.pickPath;
        case 'read_pdf': if (cfg.readError) throw cfg.readError; return bytes();
        case 'confirm_dialog': return cfg.confirmAnswer;
        case 'plugin:window|destroy': cfg.destroyed = true; return null;
        case 'check_update': return cfg.update;
        case 'pick_save_pdf': return cfg.savePath;
        case 'write_pdf': cfg.written = args; return null;
        case 'list_system_fonts': return [];
        case 'install_update': throw 'update.install: signature mismatch';
      }
      throw new Error('unmocked command ' + cmd);
    },
  };
  // tauri-plugin-dialog 2.7 init script behaviour
  for (const k of ['confirm', 'alert', 'prompt'])
    window[k] = async () => { cfg.calls.push({ cmd: 'WINDOW_' + k }); throw new Error('plugin:dialog|' + k + ' not allowed'); };
  cfg.emit = (event, payload) => (cfg.listeners[event] || []).forEach((h) => cbs[h] && cbs[h]({ event, id: h, payload }));
  window.__h = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await this.sleep(100); } throw new Error('timeout: ' + fn); },
    btn(text) { return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.title === text || b.getAttribute('aria-label') === text); },
    click(text) { const b = this.btn(text); if (!b) throw new Error('no button ' + text); b.click(); },
    toast() { return document.querySelector('.toast')?.textContent ?? ''; },
    overflow() {
      const W = innerWidth, bad = [];
      if (document.documentElement.scrollWidth > W + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth + '>' + W);
      for (const el of document.querySelectorAll('button, .tab, h1, h2, h3, .modal, .toolbar, .tabbar, input, select, label')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.right > W + 1 && !el.closest('.tabs, .pdfjs-container, .toolbar, .pagesgrid')) bad.push((el.className || el.tagName) + ' right=' + Math.round(r.right));
        if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'hidden') bad.push('clipped button: ' + el.textContent.trim().slice(0, 30));
      }
      return bad;
    },
  };
})();`;

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function run(lang, theme) {
  const tag = `${lang}-${theme}`;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(`[${tag}] ` + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(path.join(out, `${tag}-${name}.png`), Buffer.from(data, 'base64'));
  };
  await send('Runtime.enable', {}, s);
  await send('Page.enable', {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 560, deviceScaleFactor: 1, mobile: false }, s);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript(lang === 'de' ? 'de-DE' : 'en-US') }, s);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('theme', '${theme}'); localStorage.setItem('pdfedit.tutorialSeen.v3', '1') } catch {}` }, s);
  await send('Page.navigate', { url: base + '/' }, s);
  await sleep(3500);
  const L = `const { dicts } = await import('/src/i18n.ts'); const t = dicts.${lang}; const other = dicts.${lang === 'de' ? 'en' : 'de'};`;
  const untranslated = `${L}
    const clone = document.body.cloneNode(true); clone.querySelectorAll('.pdfjs-container, .sidebar, .pagesgrid').forEach(e => e.remove());
    const txt = clone.textContent + ' ' + [...clone.querySelectorAll('[title],[aria-label],[placeholder]')].map(e => (e.title||'') + ' ' + (e.getAttribute('aria-label')||'') + ' ' + (e.placeholder||'')).join(' ');
    const hits = [];
    for (const [k, v] of Object.entries(other)) if (typeof v === 'string' && v.length > 4 && v !== t[k] && txt.includes(v)) hits.push(k + '=' + v.slice(0, 40));
    return hits;`;

  // 1. start page + automatic update modal (date parsed from Rust's format)
  const upd = await ev(`${L} await __h.until(() => document.querySelector('.modal')); return { title: document.querySelector('.modal h3').textContent, body: document.querySelector('.modal').innerText };`);
  check(`${tag} update modal title`, upd.title.includes('1.0.1'), upd.title);
  check(`${tag} update modal shows parsed date`, /19\.10\.2026|10\/19\/2026/.test(upd.body), upd.body.split('\n').slice(0, 2).join(' | '));
  await shot('update-modal');
  const inst = await ev(`${L} __h.click(t.updateNow); await __h.until(() => __h.toast().includes(t.updateFailed)); return __h.toast();`);
  check(`${tag} update install error translated`, inst.includes(lang === 'de' ? 'Update-Installation fehlgeschlagen' : 'Installing the update failed'), inst);
  await ev(`${L} __h.click(t.updateLater); await __h.sleep(200);`);
  check(`${tag} start page no overflow`, (await ev('return __h.overflow()')).length === 0, JSON.stringify(await ev('return __h.overflow()')));
  check(`${tag} start page untranslated`, (await ev(untranslated)).length === 0, JSON.stringify(await ev(untranslated)));
  await shot('start');

  // 2. open error is translated (German OS text never in the English UI)
  const errToast = await ev(`${L} await __h.until(() => !document.querySelector('.toast'), 6000); __mock.readError = 'io.locked: Der Prozess kann nicht auf die Datei zugreifen'; __h.click(t.openPdf); await __h.until(() => __h.toast()); const x = __h.toast(); __mock.readError = null; return x;`);
  check(`${tag} io.locked translated`, errToast === `${await ev(`${L} return t.loadError + ': ' + t.errors['io.locked']`)}`, errToast);

  // 3. open the fixture
  await ev(`${L} await __h.until(() => !document.querySelector('.toast'), 6000); __h.click(t.openPdf); await __h.until(() => document.querySelector('.tab')); await __h.until(() => document.querySelector('.annotationLayer a'), 10000);`);
  const tabName = await ev(`return document.querySelector('.tabname').textContent`);
  check(`${tag} tab name with umlaut/space`, tabName === 'Bericht März 2026.pdf', tabName);
  await sleep(800);
  const ov = await ev('return __h.overflow()');
  check(`${tag} viewer no overflow at 860x560`, ov.length === 0, JSON.stringify(ov));
  check(`${tag} viewer untranslated`, (await ev(untranslated)).length === 0, JSON.stringify(await ev(untranslated)));
  const tb = await ev(`const tb = document.querySelector('.toolbar'); return { sw: tb.scrollWidth, cw: tb.clientWidth, ox: getComputedStyle(tb).overflowX, wrap: getComputedStyle(tb).flexWrap, h: tb.getBoundingClientRect().height }`);
  check(`${tag} toolbar fits or scrolls`, tb.sw <= tb.cw + 1 || tb.ox === 'auto' || tb.ox === 'scroll', JSON.stringify(tb));
  await shot('viewer');

  // 4. external link: no navigation, address copied/shown
  const link = await ev(`${L} const href0 = location.href; const a = [...document.querySelectorAll('.annotationLayer a')].find(a => a.href.startsWith('https://example.com'));
    if (!a) return { missing: true }; window.__clk = []; a.click(); await __h.sleep(1500); if (!__h.toast().includes('example.com')) return { noToast: __h.toast(), href: a.href, cls: a.parentElement.className, same: location.href === href0 }; return { same: location.href === href0, toast: __h.toast(),
    expected: [t.linkCopied('https://example.com/extern'), t.linkBlocked('https://example.com/extern')] };`);
  check(`${tag} external link does not navigate`, link.same && link.expected.includes(link.toast), JSON.stringify(link));
  const internal = await ev(`const a = [...document.querySelectorAll('.annotationLayer a')].find(a => (a.getAttribute('href')||'').startsWith('#'));
    if (!a) return 'no internal link'; a.click(); await __h.sleep(800); return document.querySelector('.toolbar input')?.value ?? '?';`);
  check(`${tag} internal link jumps to page 2`, internal === '2', internal);

  // 5. delete form field: native confirm, Cancel keeps it
  await ev(`${L} const tabBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t.sidebarTabObjects); if (tabBtn) tabBtn.click(); await __h.sleep(300);`);
  const hasObjTab = await ev(`return !!document.querySelector('.object-del')`);
  if (!hasObjTab) {
    const names = await ev(`return [...document.querySelectorAll('.sidebar button, aside button')].map(b => b.textContent.trim()).slice(0, 10)`);
    await ev(`${L} const b = [...document.querySelectorAll('button')].find(b => /Objekt|Object/.test(b.textContent)); b?.click(); await __h.sleep(500);`);
    console.log('   sidebar buttons:', names);
  }
  await ev(`await __h.until(() => document.querySelector('.object-del'), 5000)`);
  await ev(`__mock.confirmAnswer = false; __mock.calls = []; document.querySelector('.object-del').click(); await __h.sleep(800);`);
  const del1 = await ev(`${L} return { asked: __mock.calls.filter(c => c.cmd === 'confirm_dialog').map(c => c.args.message), still: !!document.querySelector('.object-del'), windowConfirm: __mock.calls.some(c => c.cmd.startsWith('WINDOW_')), expected: t.deleteFieldConfirm('kundenname'), dirty: !!document.querySelector('.dirtydot') }`);
  check(`${tag} field delete asks natively`, del1.asked.length === 1 && del1.asked[0] === del1.expected && !del1.windowConfirm, JSON.stringify(del1.asked));
  check(`${tag} field delete Cancel keeps field`, del1.still && !del1.dirty);
  await shot('objects');
  await ev(`__mock.confirmAnswer = true; document.querySelector('.object-del').click(); await __h.until(() => !document.querySelector('.object-del'), 8000); await __h.until(() => document.querySelector('.dirtydot'));`);
  check(`${tag} field delete OK removes field + dirty`, true);

  // 6. close dirty tab: Cancel keeps it
  await ev(`await __h.sleep(1500); __mock.confirmAnswer = false; __mock.calls = []; document.querySelector('.tabclose').click(); await __h.sleep(500);`);
  const tabStill = await ev(`${L} return { tab: !!document.querySelector('.tab'), msg: __mock.calls.find(c => c.cmd === 'confirm_dialog')?.args, exp: t.unsavedCloseConfirm }`);
  check(`${tag} dirty tab close Cancel keeps tab`, tabStill.tab && tabStill.msg?.message === tabStill.exp, JSON.stringify(tabStill.msg));

  // 7. window close (X): Cancel keeps the app, OK destroys
  await ev(`__mock.calls = []; __mock.emit('tauri://close-requested', null); await __h.sleep(500);`);
  const wc1 = await ev(`return { destroyed: __mock.destroyed, asked: __mock.calls.filter(c => c.cmd === 'confirm_dialog').length }`);
  check(`${tag} window close Cancel keeps app`, !wc1.destroyed && wc1.asked === 1, JSON.stringify(wc1));
  await ev(`__mock.confirmAnswer = true; __mock.emit('tauri://close-requested', null); await __h.sleep(500);`);
  check(`${tag} window close OK destroys`, await ev(`return __mock.destroyed`));
  await ev(`__mock.destroyed = false; __mock.confirmAnswer = false;`);

  // 8. pages dialog: translated buttons, layout, export notice
  await ev(`${L} __h.click(t.pagesButton); await __h.until(() => document.querySelector('.pagesmodal .pagecard-actions'), 8000); await __h.sleep(600);`);
  const pg = await ev(`${L} const b = [...document.querySelectorAll('.pagecard-actions button')].slice(0, 4).map(b => b.title); return { b, exp: [t.pageMoveUp, t.pageMoveDown, t.pageRotate, t.pageDelete], ov: __h.overflow() }`);
  check(`${tag} page card buttons titled`, JSON.stringify(pg.b) === JSON.stringify(pg.exp), JSON.stringify(pg.b));
  check(`${tag} pages dialog no overflow`, pg.ov.length === 0, JSON.stringify(pg.ov));
  check(`${tag} pages dialog untranslated`, (await ev(untranslated)).length === 0, JSON.stringify(await ev(untranslated)));
  await shot('pages');
  const exp = await ev(`${L} document.querySelector('.pagecard-thumb').click(); await __h.sleep(200);
    __mock.savePath = 'C:\\\\Users\\\\Jürgen\\\\Desktop\\\\Auszug.pdf';
    const eb = [...document.querySelectorAll('.pagesmodal button')].find(b => b.textContent.includes(t.pagesExportSelected?.(1) ?? '§§') || /xport/.test(b.textContent));
    if (!eb) return 'no export button: ' + [...document.querySelectorAll('.pagesmodal button')].map(b => b.textContent).join('|');
    if (eb.disabled) return 'export disabled';
    eb.click(); await __h.until(() => __mock.written, 8000); await __h.until(() => __h.toast().includes('Auszug.pdf'), 4000);
    return { toast: __h.toast(), exp: t.pagesExported('Auszug.pdf'), args: Object.keys(__mock.calls.find(c => c.cmd === 'pick_save_pdf')?.args ?? {}) }`);
  check(`${tag} export notice + replace labels sent`, typeof exp === 'object' && exp.toast === exp.exp && exp.args.includes('replaceMsg'), JSON.stringify(exp));
  await ev(`const x = [...document.querySelectorAll('.pagesmodal .mhead button')][0]; x?.click(); await __h.sleep(300);`);

  // 9. help panel
  await ev(`document.querySelector('.hlp-fab:not(.theme-fab)')?.click(); await __h.sleep(500);`);
  const hov = await ev('return __h.overflow()');
  check(`${tag} help no overflow`, hov.length === 0, JSON.stringify(hov));
  await shot('help');
  await send('Target.closeTarget', { targetId });
}

try {
  for (const lang of ['de', 'en']) for (const theme of ['dark', 'light']) {
    try {
      await run(lang, theme);
    } catch (e) {
      check(`${lang}-${theme} flow crashed`, false, String(e).slice(0, 400));
    }
  }
} finally {
  proc.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed; page errors: ${exceptions.length}`);
for (const e of [...new Set(exceptions)].slice(0, 15)) console.log('  ', e.slice(0, 300));
process.exit(failed ? 1 : 0);
