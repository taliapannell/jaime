import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Host-independent recipe image generation, shared by the Vite dev proxy (recipeImage.ts)
 * and the AWS Lambda handler (lambda.ts). Supports Azure OpenAI, OpenAI, and (when neither
 * key is set) Stability AI on Amazon Bedrock using the standard AWS credential chain.
 */
const MAX_PROMPT = 2000;
const UPSTREAM_TIMEOUT_MS = 60_000;
// Bedrock's text-to-image Stability models are only offered in us-west-2.
const DEFAULT_BEDROCK_IMAGE_MODEL = 'stability.stable-image-core-v1:1';
const DEFAULT_BEDROCK_IMAGE_REGION = 'us-west-2';

export type Env = Record<string, string | undefined>;
export interface ImageResult {
  status: number;
  body: { image: string } | { error: string };
}

/** Builds the upstream request for whichever provider is configured, or null if unconfigured. */
function upstream(env: Env, prompt: string): { url: string; headers: Record<string, string>; body: object } | null {
  const common = { prompt, size: '1024x1024', quality: 'medium', n: 1, output_format: 'jpeg', output_compression: 80 };

  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_IMAGE_DEPLOYMENT) {
    const base = env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
    const version = env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
    return {
      url: `${base}/openai/deployments/${env.AZURE_OPENAI_IMAGE_DEPLOYMENT}/images/generations?api-version=${version}`,
      headers: { 'api-key': env.AZURE_OPENAI_API_KEY },
      body: common,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      url: 'https://api.openai.com/v1/images/generations',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: { ...common, model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1' },
    };
  }
  return null;
}

let bedrock: BedrockRuntimeClient | undefined;

/** Generates an image with a Stability AI model on Bedrock and returns a data URL. */
async function generateWithBedrock(env: Env, prompt: string): Promise<ImageResult> {
  bedrock ??= new BedrockRuntimeClient({ region: env.BEDROCK_IMAGE_REGION || DEFAULT_BEDROCK_IMAGE_REGION });
  try {
    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: env.BEDROCK_IMAGE_MODEL || DEFAULT_BEDROCK_IMAGE_MODEL,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ prompt, output_format: 'jpeg', aspect_ratio: '1:1' }),
      }),
      { abortSignal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
    );
    const json = JSON.parse(new TextDecoder().decode(response.body)) as {
      images?: string[];
      finish_reasons?: (string | null)[];
    };
    const b64 = json.images?.[0];
    if (!b64 || json.finish_reasons?.[0]) {
      console.error(`[recipe-image] bedrock finish_reason: ${json.finish_reasons?.[0] ?? 'no image'}`);
      return { status: 502, body: { error: 'No image returned' } };
    }
    return { status: 200, body: { image: `data:image/jpeg;base64,${b64}` } };
  } catch (err) {
    console.error('[recipe-image] bedrock', err);
    return { status: 502, body: { error: 'Image generation failed' } };
  }
}

/** Validates the prompt, calls the configured image API and returns a data URL. Never throws. */
export async function generateImage(env: Env, prompt: unknown): Promise<ImageResult> {
  if (typeof prompt !== 'string' || !prompt.trim()) return { status: 400, body: { error: 'Missing prompt' } };

  const target = upstream(env, prompt.slice(0, MAX_PROMPT));
  if (!target) return generateWithBedrock(env, prompt.slice(0, MAX_PROMPT));

  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[recipe-image] upstream ${response.status}: ${await response.text()}`);
      return { status: 502, body: { error: 'Image generation failed' } };
    }
    const json = (await response.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return { status: 502, body: { error: 'No image returned' } };
    return { status: 200, body: { image: `data:image/jpeg;base64,${b64}` } };
  } catch (err) {
    console.error('[recipe-image]', err);
    return { status: 500, body: { error: 'Image generation failed' } };
  }
}
