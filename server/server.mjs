// Backend for the Polotno + Printful demo.
//
// The editor runs in the browser, so it cannot hold the Printful credentials.
// This server holds them and exposes:
//
//   GET /health
//   GET /printful/print-area
//   POST /printful/mockups
//
// Env:
//   PRINTFUL_TOKEN, PRINTFUL_STORE_ID
//   PUBLIC_URL      this server's public URL; the provider downloads print files from it
//   ALLOWED_ORIGINS comma-separated, defaults to localhost:5173

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED_ORIGINS = (
  env.ALLOWED_ORIGINS ||
  'http://localhost:5173'
).split(',');

// The demo sells one tee: Bella+Canvas 3001. Colours map to
// the catalog's names. Overridable per env if the catalog changes.
const PRINTFUL_PRODUCT_ID = Number(env.PRINTFUL_PRODUCT_ID || 71);
const SIZE = env.DEMO_SIZE || 'M';
const COLORS = { black: 'Black', blue: 'True Royal', red: 'Red' };
const SIDES = ['front', 'back'];

const MAX_BODY = 25 * 1024 * 1024;
const FILE_TTL_MS = 10 * 60 * 1000;

// --- helpers ------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cached(fn, ttlMs = 60 * 60 * 1000) {
  const cache = new Map();
  return async (key) => {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await fn(key);
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  };
}

async function api(base, token, path, { method = 'GET', body, headers = {} } = {}) {
  // A provider with its own auth header passes Authorization: undefined.
  const allHeaders = Object.fromEntries(
    Object.entries({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }).filter(
      ([, v]) => v !== undefined
    )
  );
  const res = await fetch(base + path, {
    method,
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || json?.result || text;
    throw new HttpError(502, `${method} ${path} failed (${res.status}): ${detail}`);
  }
  return json;
}

const printful = (path, opts = {}) => {
  if (!env.PRINTFUL_TOKEN) throw new HttpError(503, 'PRINTFUL_TOKEN is not set');
  const headers = env.PRINTFUL_STORE_ID ? { 'X-PF-Store-Id': env.PRINTFUL_STORE_ID } : {};
  return api('https://api.printful.com', env.PRINTFUL_TOKEN, path, {
    ...opts,
    headers: { ...headers, ...opts.headers },
  });
};

const colorName = (id) => {
  const name = COLORS[id];
  if (!name) throw new HttpError(400, `Unknown color "${id}"`);
  return name;
};

// The demo posts base64 PNGs per side. Keep only real, non-empty PNG data.
function readSides(body) {
  const sides = {};
  for (const side of SIDES) {
    const value = body?.files?.[side];
    if (!value) continue;
    const base64 = String(value).replace(/^data:image\/png;base64,/, '');
    if (!base64.startsWith('iVBOR')) throw new HttpError(400, `${side} is not a PNG`);
    sides[side] = base64;
  }
  if (!Object.keys(sides).length) throw new HttpError(400, 'No design to send');
  return sides;
}

// --- temporary file hosting (Printful downloads print files by URL) -----------

const files = new Map();

const FILE_TYPES = { png: 'image/png', pdf: 'application/pdf' };

function hostFile(base64, ext = 'png') {
  const id = randomUUID();
  files.set(id, { data: Buffer.from(base64, 'base64'), ext, expires: Date.now() + FILE_TTL_MS });
  return `${PUBLIC_URL}/files/${id}.${ext}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, f] of files) if (f.expires < now) files.delete(id);
}, 60 * 1000).unref();

// --- Printful -------------------------------------------------------------------

const printfulCatalog = cached(async () => {
  const [{ result: product }, { result: printfiles }] = await Promise.all([
    printful(`/products/${PRINTFUL_PRODUCT_ID}`),
    printful(`/mockup-generator/printfiles/${PRINTFUL_PRODUCT_ID}`),
  ]);
  return { product, printfiles };
});

async function printfulVariant(colorId) {
  const { product, printfiles } = await printfulCatalog('catalog');
  const color = colorName(colorId);
  const variant = product.variants.find((v) => v.color === color && v.size === SIZE);
  if (!variant) throw new HttpError(502, `Printful has no ${color} / ${SIZE} variant`);
  const mapping = printfiles.variant_printfiles.find((v) => v.variant_id === variant.id);
  const areas = {};
  for (const side of SIDES) {
    const id = mapping?.placements?.[side];
    const file = printfiles.printfiles.find((p) => p.printfile_id === id);
    if (file) areas[side] = { width: file.width, height: file.height, dpi: file.dpi };
  }
  return { variant, areas };
}

async function printfulPrintArea(query) {
  const { variant, areas } = await printfulVariant(query.get('color') || 'black');
  return {
    product: `${PRINTFUL_PRODUCT_ID}`,
    variant: { id: variant.id, name: variant.name },
    areas,
    request: `GET https://api.printful.com/mockup-generator/printfiles/${PRINTFUL_PRODUCT_ID}`,
  };
}

async function printfulMockups(body) {
  const sides = readSides(body);
  const { variant, areas } = await printfulVariant(body.color || 'black');
  const taskBody = {
    variant_ids: [variant.id],
    format: 'jpg',
    // A flat shot, one on a model and one lifestyle, only for designed sides.
    options: Object.keys(sides).map((side) => (side === 'back' ? 'Back' : 'Front')),
    option_groups: ['Flat', "Men's", "Women's Lifestyle"],
    files: Object.entries(sides).map(([side, base64]) => ({
      placement: side,
      image_url: hostFile(base64),
      position: {
        area_width: areas[side].width,
        area_height: areas[side].height,
        width: areas[side].width,
        height: areas[side].height,
        top: 0,
        left: 0,
      },
    })),
  };
  const { result: task } = await printful(
    `/mockup-generator/create-task/${PRINTFUL_PRODUCT_ID}`,
    { method: 'POST', body: taskBody }
  );

  // The generator is asynchronous: poll until the mockups are ready.
  const started = Date.now();
  let status = task;
  while (status.status === 'pending' && Date.now() - started < 60 * 1000) {
    await sleep(2000);
    ({ result: status } = await printful(
      `/mockup-generator/task?task_key=${encodeURIComponent(task.task_key)}`
    ));
  }
  if (status.status !== 'completed') {
    throw new HttpError(502, `Printful mockup task ${status.status}: ${status.error || ''}`);
  }

  return {
    variant: { id: variant.id, name: variant.name },
    // The main render per side, plus the model and lifestyle shots.
    mockups: status.mockups
      .flatMap((m) => [
        { side: m.placement, url: m.mockup_url },
        ...(m.extra || []).map((x) => ({ side: x.title || x.option, url: x.url })),
      ])
      .slice(0, 4),
    requests: [
      {
        title: 'Render mockups of the design',
        endpoint: `POST https://api.printful.com/mockup-generator/create-task/${PRINTFUL_PRODUCT_ID}`,
        body: taskBody,
      },
      {
        title: 'Then order it: same files, same placements',
        endpoint: 'POST https://api.printful.com/orders',
        body: {
          recipient: { name: '…', address1: '…', city: '…', country_code: '…', zip: '…' },
          items: [
            {
              variant_id: variant.id,
              quantity: 1,
              files: taskBody.files.map(({ placement, image_url, position }) => ({
                type: placement,
                url: image_url,
                position,
              })),
            },
          ],
        },
      },
    ],
  };
}

// --- rate limit -----------------------------------------------------------------

const hits = new Map();
function rateLimit(ip, limit = 12, windowMs = 60 * 1000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) throw new HttpError(429, 'Too many requests, try again in a minute');
  recent.push(now);
  hits.set(ip, recent);
}

// --- server ---------------------------------------------------------------------

const routes = {
  'GET /health': async () => ({ ok: true }),
  'GET /printful/print-area': (_, q) => printfulPrintArea(q),
  'POST /printful/mockups': (body) => printfulMockups(body),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Design too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(new HttpError(400, 'Body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const file = url.pathname.match(/^\/files\/([0-9a-f-]+)\.(png|pdf)$/);
  if (req.method === 'GET' && file) {
    const f = files.get(file[1]);
    if (!f || f.ext !== file[2]) return res.writeHead(404).end();
    return res.writeHead(200, { 'Content-Type': FILE_TYPES[f.ext] }).end(f.data);
  }

  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (!route) throw new HttpError(404, 'Not found');
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();
      rateLimit(ip);
    }
    const body = req.method === 'POST' ? await readBody(req) : null;
    const result = await route(body, url.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(req.method, url.pathname, e.message);
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`pod-proxy listening on ${PORT}`));
