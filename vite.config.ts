import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** pdf.js runtime resources straight from node_modules/pdfjs-dist —
 *  served in dev, emitted into dist/pdfjs/ at build time, so they always
 *  match the installed pdf.js version:
 *  - cmaps/: predefined Adobe CMaps (CJK and other CID-keyed text)
 *  - wasm/:  OpenJPEG (JPEG 2000), JBIG2 + CCITT fax (scans), QCMS (ICC)
 *  - iccs/:  ICC profiles for CMYK conversion
 *  Without them pdf.js leaves such images blank and such text missing. */
const PDFJS_DIR = path.resolve(__dirname, 'node_modules/pdfjs-dist');
const PDFJS_RESOURCES: Record<string, (file: string) => boolean> = {
  cmaps: (f) => f.endsWith('.bcmap') || f === 'LICENSE',
  wasm: (f) => !f.startsWith('quickjs'), // PDF scripting stays off
  iccs: () => true,
};

function pdfjsResources(): Plugin {
  const list = () =>
    Object.entries(PDFJS_RESOURCES).flatMap(([dir, keep]) =>
      fs
        .readdirSync(path.join(PDFJS_DIR, dir))
        .filter(keep)
        .map((f) => `${dir}/${f}`)
    );
  return {
    name: 'pdfedit-pdfjs-resources',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        if (!list().includes(rel)) return next();
        const type = rel.endsWith('.wasm')
          ? 'application/wasm'
          : rel.endsWith('.js')
            ? 'text/javascript'
            : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        fs.createReadStream(path.join(PDFJS_DIR, rel)).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of list()) {
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/${rel}`,
          source: fs.readFileSync(path.join(PDFJS_DIR, rel)),
        });
      }
    },
  };
}

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json devUrl)
export default defineConfig({
  plugins: [react(), pdfjsResources()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
  },
});
