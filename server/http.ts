import type { IncomingMessage, ServerResponse } from 'node:http';

/** Node http helpers shared by the Vite dev proxy (recipeImage.ts) and the production server (node.ts). */
export const IMAGE_ROUTE = '/api/recipe-image';
export const RECIPES_ROUTE = '/api/recipes';
const MAX_BODY = 10_000;

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}
