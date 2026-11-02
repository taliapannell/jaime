import Anthropic from '@anthropic-ai/sdk';
import { FLAVORS, MOODS } from '../src/data';
import type { Env } from './imageCore';

/**
 * Host-independent recipe generation with Claude, shared by the Vite dev proxy (recipeImage.ts),
 * the production server (node.ts) and the AWS Lambda handler (lambda.ts).
 * Claude invents the recipes and writes the photo prompt for each; the image model renders it.
 */
const MODEL = 'claude-opus-5-5';
const RECIPE_COUNT = 4;
const MAX_BEANS_PER_FLAVOR = 4;
const UPSTREAM_TIMEOUT_MS = 45_000;

export interface GeneratedRecipe {
  id: string;
  name: string;
  description: string;
  ingredients: { flavorId: string; count: number }[];
  newFlavorName: string;
  newFlavorNotes: string;
  imagePrompt: string;
}
export interface RecipesResult {
  status: number;
  body: { recipes: GeneratedRecipe[] } | { error: string };
}

const SYSTEM = `You are the recipe designer for JAIME, a jelly bean dispenser that mixes gourmet jelly beans into new flavor combinations.

Given two anchor flavors, the guest's mood and the beans currently loaded, design exactly ${RECIPE_COUNT} recipes, from a faithful classic pairing to a bold experimental blend.
- Use only flavor ids from the "loaded" list, 2-5 beans total per flavor at most ${MAX_BEANS_PER_FLAVOR}, and include at least one anchor in every recipe.
- Recipe names are short and playful. Descriptions are one sentence. newFlavorName names the brand-new flavor the blend creates (2-3 words); newFlavorNotes is one sentence of tasting notes.
- imagePrompt is a photo brief for an image model: a studio macro photo of a handful of the new jelly beans, describing bean colors that suggest the blended flavors, a mood-appropriate lighting and backdrop, and ending with "No text, no logos." Keep it under 80 words.
- Keep everything family-friendly.`;

/** JSON schema for structured outputs; flavor ids are constrained to what is loaded. */
function schema(loadedIds: string[]) {
  return {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: { flavorId: { type: 'string', enum: loadedIds }, count: { type: 'integer' } },
                required: ['flavorId', 'count'],
                additionalProperties: false,
              },
            },
            newFlavorName: { type: 'string' },
            newFlavorNotes: { type: 'string' },
            imagePrompt: { type: 'string' },
          },
          required: ['name', 'description', 'ingredients', 'newFlavorName', 'newFlavorNotes', 'imagePrompt'],
          additionalProperties: false,
        },
      },
    },
    required: ['recipes'],
    additionalProperties: false,
  };
}

/** Merges duplicate flavors and caps each count at what the dispenser holds. */
function clampIngredients(ingredients: GeneratedRecipe['ingredients'], stock: Record<string, number>) {
  const merged = new Map<string, number>();
  for (const { flavorId, count } of ingredients) {
    merged.set(flavorId, (merged.get(flavorId) ?? 0) + Math.max(0, Math.round(count)));
  }
  return [...merged]
    .map(([flavorId, count]) => ({ flavorId, count: Math.min(count, MAX_BEANS_PER_FLAVOR, stock[flavorId] ?? 0) }))
    .filter((i) => i.count > 0);
}

/** Validates the request, asks Claude for recipes and returns them. Never throws. */
export async function generateRecipes(env: Env, input: Record<string, unknown>): Promise<RecipesResult> {
  const flavor1 = FLAVORS.find((f) => f.id === input.flavor1Id);
  const flavor2 = FLAVORS.find((f) => f.id === input.flavor2Id);
  const mood = MOODS.find((m) => m.id === input.moodId);
  const rawStock = typeof input.stock === 'object' && input.stock !== null ? (input.stock as Record<string, unknown>) : {};
  const stock = Object.fromEntries(
    FLAVORS.map((f) => [f.id, typeof rawStock[f.id] === 'number' ? (rawStock[f.id] as number) : 0]),
  );
  if (!flavor1 || !flavor2 || !mood) return { status: 400, body: { error: 'Invalid selection' } };

  const loaded = FLAVORS.filter((f) => stock[f.id] > 0);
  if (loaded.length === 0) return { status: 409, body: { error: 'Dispenser is empty' } };
  if (!env.ANTHROPIC_API_KEY) return { status: 503, body: { error: 'Recipe API is not configured' } };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 1 });
  const request = {
    anchors: [flavor1, flavor2].map((f) => ({ id: f.id, name: f.name, loaded: stock[f.id] > 0 })),
    mood: mood.name,
    loaded: loaded.map((f) => ({ id: f.id, name: f.name, color: f.color, beans: stock[f.id] })),
  };

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Recipe ideation is quick creative work; low effort keeps the Mixing screen snappy.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema(loaded.map((f) => f.id)) } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(request) }],
    });
    if (response.stop_reason !== 'end_turn') {
      console.error(`[recipes] stop_reason ${response.stop_reason}`, response.stop_details ?? '');
      return { status: 502, body: { error: 'Recipe generation failed' } };
    }
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = JSON.parse(text) as { recipes: Omit<GeneratedRecipe, 'id'>[] };

    const recipes = parsed.recipes
      .slice(0, RECIPE_COUNT)
      .map((r, i) => ({ ...r, id: `r${i + 1}`, ingredients: clampIngredients(r.ingredients, stock) }))
      .filter((r) => r.ingredients.length > 0);
    if (recipes.length === 0) return { status: 502, body: { error: 'No recipes returned' } };
    return { status: 200, body: { recipes } };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error(`[recipes] upstream ${err.status}: ${err.message}`);
    else console.error('[recipes]', err);
    return { status: 502, body: { error: 'Recipe generation failed' } };
  }
}
