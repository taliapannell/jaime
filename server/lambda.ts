import { generateImage } from './imageCore';
import { RECIPES_ROUTE } from './http';
import { generateRecipes } from './recipeCore';

/**
 * AWS Lambda handler for POST /api/recipes and /api/recipe-image (Function URL or API Gateway HTTP API, payload v2).
 * Configure the API keys as Lambda environment variables (see .env.example).
 * Serve it from the same CloudFront distribution as the app (path pattern /api/*) so the
 * browser calls it same-origin and no CORS setup is needed.
 */
interface HttpEvent {
  rawPath?: string;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event: HttpEvent) => {
  if (event.requestContext?.http?.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '{}');
    if (raw.length > 10_000) return reply(413, { error: 'Request too large' });
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return reply(400, { error: 'Invalid request' });
  }

  // Anything other than /api/recipes keeps the original image behavior.
  const { status, body } =
    event.rawPath === RECIPES_ROUTE ? await generateRecipes(process.env, input) : await generateImage(process.env, input.prompt);
  return reply(status, body);
};
