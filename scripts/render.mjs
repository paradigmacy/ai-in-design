// Render a Rhino view through Replicate.
// Usage (from the ai-in-design folder):
//   node scripts/render.mjs eye-level
//   node scripts/render.mjs axonometric
//   node scripts/render.mjs view-2                    (your own saved Rhino view "2")
//   node scripts/render.mjs eye-level flux-3          (only one model)
//   set RES=2K && node scripts/render.mjs view-2      (higher resolution, costs more)
//
// Reads:  .env                         -> REPLICATE_API_TOKEN=...  (never commit, never VITE_)
//         scripts/prompt.txt           -> what the colours mean, the light
//         renders/<view>-input.png     -> the Rhino view (made by Claude in Rhino)
// Writes: renders/<view>-<model>-<time>.<ext>
// Each run costs a few cents per model. Render with a reason.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const view = process.argv[2] || 'eye-level';
const only = process.argv[3];

// --- key from .env (no package needed) ---
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  console.error('No .env file in ' + root + '. Create it by hand with one line: REPLICATE_API_TOKEN=your-key');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
);
const token = env.REPLICATE_API_TOKEN;
if (!token) { console.error('REPLICATE_API_TOKEN is missing in .env'); process.exit(1); }

const prompt = fs.readFileSync(path.join(root, 'scripts', 'prompt.txt'), 'utf8');
const inputPath = path.join(root, 'renders', `${view}-input.png`);
if (!fs.existsSync(inputPath)) { console.error('Missing input image: ' + inputPath); process.exit(1); }

const api = 'https://api.replicate.com/v1';
const headers = { Authorization: `Bearer ${token}` };

async function upload(file) {
  const form = new FormData();
  form.append('content', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const r = await fetch(`${api}/files`, { method: 'POST', headers, body: form });
  if (!r.ok) throw new Error(`Upload failed ${r.status}: ${await r.text()}`);
  return (await r.json()).urls.get;
}

async function run(model, input) {
  let r;
  for (let tries = 0; tries < 6; tries++) {
    r = await fetch(`${api}/models/${model}/predictions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input }),
    });
    if (r.status !== 429) break;
    const wait = Number(r.headers.get('retry-after')) || 10;
    console.log(`${model}: busy (429), trying again in ${wait} s`);
    await new Promise((s) => setTimeout(s, wait * 1000));
  }
  if (r.status === 429) throw new Error('Rate limit (429): still busy, wait a minute and run again.');
  if (!r.ok) throw new Error(`${model} failed ${r.status}: ${await r.text()}`);
  let p = await r.json();
  while (['starting', 'processing'].includes(p.status)) {
    await new Promise((s) => setTimeout(s, 2000));
    p = await (await fetch(p.urls.get, { headers })).json();
  }
  if (p.status !== 'succeeded') throw new Error(`${model} ${p.status}: ${p.error}`);
  return Array.isArray(p.output) ? p.output[0] : p.output;
}

// The newest versions on Replicate (checked 25.11.2026). Resolution 1K keeps the cost low; use 2K for a final image.
const res = (process.env.RES || '1K').trim().toUpperCase();
const models = {
  'nano-banana-2.1': (url) => ['google/nano-banana-2.1', { prompt, image_input: [url], aspect_ratio: 'match_input_image', resolution: res, output_format: 'png' }],
  'flux-3': (url) => ['black-forest-labs/flux-3-image', { prompt, images: [url], aspect_ratio: 'auto', resolution: res.toLowerCase(), output_format: 'png' }],
};

const url = await upload(inputPath);
console.log('Uploaded', path.basename(inputPath));
for (const [name, make] of Object.entries(models)) {
  if (only && only !== name) continue;
  const [model, input] = make(url);
  console.log(`Rendering ${view} with ${model} ...`);
  try {
    const out = await run(model, input);
    const ext = (new URL(out).pathname.split('.').pop() || 'png').slice(0, 4);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(root, 'renders', `${view}-${name}-${stamp}.${ext}`);
    fs.writeFileSync(file, Buffer.from(await (await fetch(out)).arrayBuffer()));
    console.log('Saved', path.relative(root, file));
  } catch (e) {
    console.error(String(e.message || e));
  }
}
