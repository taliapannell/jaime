import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { generateImage, type Env } from './imageCore';
import { IMAGE_ROUTE, readJson, sendJson } from './http';

/**
 * Dev/preview-server proxy for recipe image generation, so the image API key stays
 * server-side while developing. Production uses node.ts instead.
 * POST /api/recipe-image { prompt } -> { image: "data:image/jpeg;base64,..." }.
 */
export default function recipeImage(): Plugin {
  let env: Env = {};

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url?.split('?')[0] !== IMAGE_ROUTE) return next();
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    try {
      const { prompt } = await readJson(req);
      const { status, body } = await generateImage(env, prompt);
      sendJson(res, status, body);
    } catch {
      sendJson(res, 400, { error: 'Invalid request' });
    }
  };

  return {
    name: 'recipe-image-proxy',
    configResolved(config) {
      // Empty prefix loads server-only vars (no VITE_ prefix), which never reach the client bundle.
      env = loadEnv(config.mode, config.envDir, '');
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
