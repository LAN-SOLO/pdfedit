// Headless core tests: loads tests/*.test.ts through Vite's SSR loader
// (same TypeScript/alias handling as the app, no extra test framework)
// and runs every exported `test_*` function. Exit code 1 on any failure.
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const filter = process.argv[2] ?? '';
let passed = 0;
let failed = 0;
try {
  const files = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.ts')).sort();
  for (const file of files) {
    const mod = await server.ssrLoadModule(`/tests/${file}`);
    for (const [name, fn] of Object.entries(mod)) {
      if (!name.startsWith('test_') || typeof fn !== 'function') continue;
      if (filter && !`${file}:${name}`.includes(filter)) continue;
      const t0 = Date.now();
      try {
        await fn();
        passed++;
        console.log(`ok   ${file} ${name} (${Date.now() - t0} ms)`);
      } catch (err) {
        failed++;
        console.log(`FAIL ${file} ${name}\n     ${err?.stack ?? err}`);
      }
    }
  }
} finally {
  await server.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
