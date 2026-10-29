import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { generateImage } from './imageCore';
import { IMAGE_ROUTE, readJson, sendJson } from './http';

/**
 * Production server for the ETI hosting platform: serves the built app from dist/ and
 * POST /api/recipe-image from one Node process. Image API keys come from the process
 * environment (see .env.example). Auth is handled upstream by the load balancer (Cognito).
 */
const PORT = Number(process.env.PORT) || 8080;
const ROOT = resolve(process.env.STATIC_DIR || 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveImage(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  let prompt: unknown;
  try {
    prompt = (await readJson(req)).prompt;
  } catch {
    return sendJson(res, 400, { error: 'Invalid request' });
  }
  const { status, body } = await generateImage(process.env, prompt);
  sendJson(res, status, body);
}

async function serveStatic(pathname: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  // The app uses hash routing, so any extensionless path gets the shell.
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!extname(rel)) rel = '/index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(404).end();
    return;
  }

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    // Vite fingerprints everything under /assets; index.html must revalidate to pick up new builds.
    'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (pathname === IMAGE_ROUTE) await serveImage(req, res);
    else await serveStatic(pathname, req, res);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    else res.destroy();
  }
});

// Outlive the ALB's 60s idle timeout so it never reuses a socket Node has just closed (intermittent 502s).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(PORT, () => console.log(`JAIME listening on :${PORT}, serving ${ROOT}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
