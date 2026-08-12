import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev-only endpoint that writes a canvas snapshot to disk.
 *
 * The game renders to a canvas, so there is no DOM to inspect; being able to POST
 * a frame from the page and open the file is the only practical way to review the
 * visuals when the browser pane isn't on screen. Serve-mode only — it never ships.
 */
function screenshotEndpoint(): Plugin {
  return {
    name: 'samarkand-screenshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const [header, payload] = body.split(',', 2);
            if (!payload) throw new Error('expected a data: URL');

            const extension = header?.includes('png') ? 'png' : 'jpg';
            const name = (req.url ?? '/frame').replace(/[^a-zA-Z0-9_-]/g, '') || 'frame';
            const target = join(projectRoot, 'dev', 'shots', `${name}.${extension}`);

            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.from(payload, 'base64'));

            res.statusCode = 200;
            res.end(target);
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [screenshotEndpoint()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
