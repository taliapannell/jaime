import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import { generateImage, type Env } from './imageCore';
import { IMAGE_ROUTE, RECIPES_ROUTE, readJson, sendJson } from './http';
import { generateRecipes } from './recipeCore';

/**
 * Dev/preview-server proxy for recipe and image generation, so the API keys stay
 * server-side while developing. Production uses node.ts instead.
 * POST /api/recipes { flavor1Id, flavor2Id, moodId, stock } -> { recipes: [...] }.
 * POST /api/recipe-image { prompt } -> { image: "data:image/jpeg;base64,..." }.
 */
export default function recipeImage(): Plugin {
  let env: Env = {};

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (route !== IMAGE_ROUTE && route !== RECIPES_ROUTE) return next();
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    try {
      const input = await readJson(req);
      const { status, body } =
        route === IMAGE_ROUTE ? await generateImage(env, input.prompt) : await generateRecipes(env, input);
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
