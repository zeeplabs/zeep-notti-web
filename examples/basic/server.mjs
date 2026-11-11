// Serves the sample page, the built SDK and the service worker on localhost.
// Run `pnpm build` first, then `pnpm example`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', '..', 'dist');
const port = Number(process.env.PORT ?? 5173);

// The worker must be served from the root so its scope covers the whole site.
const files = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/main.js': [join(here, 'main.js'), 'text/javascript; charset=utf-8'],
  '/sdk/index.js': [join(dist, 'index.js'), 'text/javascript; charset=utf-8'],
  '/notti-sw.js': [join(dist, 'notti-sw.js'), 'text/javascript; charset=utf-8'],
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const entry = files[path];
  if (!entry) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(entry[0]);
    res.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res
      .writeHead(500, { 'Content-Type': 'text/plain' })
      .end('Missing build output. Run `pnpm build` first.');
  }
});

// Bound to loopback only: a service worker needs localhost or https, and the
// sample has no reason to be reachable from the network.
server.listen(port, '127.0.0.1', () => {
  console.log(`Notti web sample on http://localhost:${port}`);
});
