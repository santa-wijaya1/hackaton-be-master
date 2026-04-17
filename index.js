import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import busboy from 'busboy';
import { connectDB } from "./src/config/database.js";
import { fileURLToPath } from 'url';
import header from './src/templates/header.js';
import footer from './src/templates/footer.js';
import { generateClaudeHtml, analyzeBrand, generateBannerContent, updateBrandFromBrief, analyzeTravlrCompatibility } from './src/helper.js';
import { Brand } from './src/models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const claudeApiKey = process.env.CLAUDE_API_KEY;
const useClaude = Boolean(claudeApiKey);

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function requireClaude(res) {
  if (!useClaude) {
    sendError(res, 503, 'Claude API key not configured');
    return false;
  }
  return true;
}

function getQueryParams(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return url.searchParams;
}

// ── Static file server ───────────────────────────────────────────────────────

function serveStatic(req, res) {
  const filePath = path.join(__dirname, 'public', req.url.substring(8));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendError(res, 404, 'File not found');
      return;
    }
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
    };
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Route handlers ───────────────────────────────────────────────────────────

async function handleGenerateContent(req, res) {
  if (!requireClaude(res)) return;

  const prompt = getQueryParams(req).get('prompt');
  if (!prompt) {
    sendError(res, 400, 'Missing prompt parameter');
    return;
  }

  try {
    const content = await generateClaudeHtml(prompt);
    const fullPage = header + content + footer;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fullPage);
  } catch (err) {
    console.error('[generate-content]', err);
    sendError(res, 500, 'Error generating content');
  }
}

async function handleAnalyzeBrand(req, res) {
  if (!requireClaude(res)) return;

  const contentType = req.headers['content-type'] || '';

  // Multipart upload (screenshot or PDF)
  if (contentType.includes('multipart/form-data')) {
    let sourceUrl = null;
    let fileBuffer = null;
    let fileMimeType = null;

    await new Promise((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      const chunks = [];

      bb.on('field', (name, value) => {
        if (name === 'url') sourceUrl = value;
      });

      bb.on('file', (_name, stream, info) => {
        fileMimeType = info.mimeType;
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });

      bb.on('close', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fileBuffer && !sourceUrl) {
      sendError(res, 400, 'Provide a file or url field');
      return;
    }

    const file = fileBuffer ? { data: fileBuffer, mimeType: fileMimeType } : null;

    try {
      const brand = await analyzeBrand(sourceUrl, file);
      sendJson(res, 200, brand);
    } catch (err) {
      console.error('[analyze-brand]', err);
      sendError(res, 500, 'Error analyzing brand');
    }
    return;
  }

  // Plain GET with ?url=
  const sourceUrl = getQueryParams(req).get('url');
  if (!sourceUrl) {
    sendError(res, 400, 'Missing url parameter or multipart file upload');
    return;
  }

  try {
    const brand = await analyzeBrand(sourceUrl, null);
    sendJson(res, 200, brand);
  } catch (err) {
    console.error('[analyze-brand]', err);
    sendError(res, 500, 'Error analyzing brand');
  }
}

async function handleAnalyzeBrandFull(req, res) {
  if (!requireClaude(res)) return;

  const contentType = req.headers['content-type'] || '';

  let sourceUrl = null;
  let file = null;

  // Multipart upload (screenshot or PDF)
  if (contentType.includes('multipart/form-data')) {
    let fileBuffer = null;
    let fileMimeType = null;

    await new Promise((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      const chunks = [];

      bb.on('field', (name, value) => {
        if (name === 'url') sourceUrl = value;
      });

      bb.on('file', (_name, stream, info) => {
        fileMimeType = info.mimeType;
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });

      bb.on('close', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fileBuffer && !sourceUrl) {
      sendError(res, 400, 'Provide a file or url field');
      return;
    }

    file = fileBuffer ? { data: fileBuffer, mimeType: fileMimeType } : null;
  } else {
    sourceUrl = getQueryParams(req).get('url');
    if (!sourceUrl) {
      sendError(res, 400, 'Missing url parameter or multipart file upload');
      return;
    }
  }

  try {
    // Step 1: analyze brand
    const brandData = await analyzeBrand(sourceUrl, file);

    // Step 2: travlr compatibility (uses brand saved to DB, so re-fetch raw_data)
    const compatibility = await analyzeTravlrCompatibility(brandData);

    // Step 3: merge compatibility into raw_data and persist
    const brand = await Brand.findByPk(brandData.id);
    if (brand) {
      const raw = JSON.parse(brand.raw_data || '{}');
      raw.travlr_compatibility = compatibility;
      await brand.update({ raw_data: JSON.stringify(raw) });
    }

    sendJson(res, 200, { ...brandData, travlr_compatibility: compatibility });
  } catch (err) {
    console.error('[analyze-brand-full]', err);
    sendError(res, 500, 'Error running full brand analysis');
  }
}

async function handleCreateBanner(req, res) {
  if (!requireClaude(res)) return;

  const params = getQueryParams(req);
  const slug = params.get('slug');
  const brandId = params.get('brand_id');
  const brief = params.get('brief') || '';

  if (!slug && !brandId) {
    sendError(res, 400, 'Missing slug or brand_id query parameter');
    return;
  }

  try {
    const brand = brandId && !isNaN(Number(brandId))
      ? await Brand.findByPk(Number(brandId))
      : await Brand.findOne({ where: { slug } });
    if (!brand) {
      sendError(res, 404, 'Brand not found');
      return;
    }

    const brandData = JSON.parse(brand.raw_data);
    const result = await generateBannerContent(brandData, brief);

    // Pick first banner + first image as the default banner
    const firstBanner = result.banners[0] || {};
    const defaultBanner = {
      header:     firstBanner.header     || null,
      sub_header: firstBanner.sub_header || null,
      image:      (firstBanner.images && firstBanner.images[0]) || null,
    };

    // Persist banner back into raw_data (color_palette already set by analyzeBrand)
    const enrichedData = { ...brandData, banner: defaultBanner };
    await brand.update({ raw_data: JSON.stringify(enrichedData) });

    sendJson(res, 200, { ...result, color_palette: brandData.color_palette, banner: defaultBanner });
  } catch (err) {
    console.error('[create-banner]', err);
    sendError(res, 500, 'Error generating banner content');
  }
}

async function handleListBrands(_req, res) {
  try {
    const brands = await Brand.findAll({
      attributes: ['id', 'name', 'slug', 'logo', 'url', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
    });
    sendJson(res, 200, brands);
  } catch (err) {
    console.error('[list-brands]', err);
    sendError(res, 500, 'Error fetching brands');
  }
}

async function handleGetBrand(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const param = url.pathname.split('/').pop();

  try {
    const brand = isNaN(Number(param))
      ? await Brand.findOne({ where: { slug: param } })
      : await Brand.findByPk(Number(param));
    if (!brand) {
      sendError(res, 404, 'Brand not found');
      return;
    }
    const data = brand.toJSON();
    if (data.raw_data) {
      try { data.raw_data = JSON.parse(data.raw_data); } catch { /* leave as string */ }
    }
    sendJson(res, 200, data);
  } catch (err) {
    console.error('[get-brand]', err);
    sendError(res, 500, 'Error fetching brand');
  }
}

async function handleUpdateBrand(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/');
  // /brands/:id/update-prototype -> parts = ['', 'brands', ':id', 'update-prototype']
  const param = parts[2];

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  try {
    const brand = isNaN(Number(param))
      ? await Brand.findOne({ where: { slug: param } })
      : await Brand.findByPk(Number(param));

    if (!brand) {
      sendError(res, 404, 'Brand not found');
      return;
    }

    if (!payload.brief) {
      sendError(res, 400, 'Missing brief field');
      return;
    }

    const rawData = JSON.parse(brand.raw_data || '{}');

    const changes = await updateBrandFromBrief(rawData, payload.brief);

    if (changes.banner) {
      rawData.banner = changes.banner;
    }

    if (changes.color_palette) {
      rawData.color_palette = changes.color_palette;
      rawData.colors = [
        changes.color_palette.primary,
        changes.color_palette.secondary,
        changes.color_palette.tertiary,
        ...(changes.color_palette.others || []),
      ].filter(Boolean);
    }

    await brand.update({ raw_data: JSON.stringify(rawData) });

    sendJson(res, 200, rawData);
  } catch (err) {
    console.error('[update-brand]', err);
    sendError(res, 500, 'Error updating brand');
  }
}

async function handleUpdateRawData(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const param = url.pathname.split('/')[2];

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  try {
    const brand = isNaN(Number(param))
      ? await Brand.findOne({ where: { slug: param } })
      : await Brand.findByPk(Number(param));

    if (!brand) {
      sendError(res, 404, 'Brand not found');
      return;
    }

    // Deep merge payload into existing raw_data
    const current = JSON.parse(brand.raw_data || '{}');
    const merged = { ...current, ...payload };

    // Keep color_palette in sync if colors array was changed
    if (payload.colors) {
      const colors = payload.colors;
      merged.color_palette = {
        primary:   colors[0] || current.color_palette?.primary   || null,
        secondary: colors[1] || current.color_palette?.secondary || null,
        tertiary:  colors[2] || current.color_palette?.tertiary  || null,
        others:    colors.slice(3),
      };
    }
    // Or if color_palette was changed directly, sync colors array
    if (payload.color_palette && !payload.colors) {
      const cp = merged.color_palette;
      merged.colors = [cp.primary, cp.secondary, cp.tertiary, ...(cp.others || [])].filter(Boolean);
    }

    await brand.update({ raw_data: JSON.stringify(merged) });

    sendJson(res, 200, merged);
  } catch (err) {
    console.error('[update-raw-data]', err);
    sendError(res, 500, 'Error updating brand raw data');
  }
}

async function handleTravlrCompatibility(req, res) {
  if (!requireClaude(res)) return;

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const param = url.pathname.split('/')[2];

  try {
    const brand = isNaN(Number(param))
      ? await Brand.findOne({ where: { slug: param } })
      : await Brand.findByPk(Number(param));

    if (!brand) {
      sendError(res, 404, 'Brand not found');
      return;
    }

    const brandData = JSON.parse(brand.raw_data || '{}');
    const report = await analyzeTravlrCompatibility(brandData);

    brandData.travlr_compatibility = report;
    await brand.update({ raw_data: JSON.stringify(brandData) });

    sendJson(res, 200, report);
  } catch (err) {
    console.error('[travlr-compatibility]', err);
    sendError(res, 500, 'Error analysing Travlr compatibility');
  }
}

function handleNotFound(req, res) {
  sendError(res, 404, `Route not found: ${req.url}`);
}

// ── Router ───────────────────────────────────────────────────────────────────

const routes = [
  { match: (url) => url.startsWith('/public/'),          handler: serveStatic },
  { match: (url) => url.startsWith('/generate-content'), handler: handleGenerateContent },
  { match: (url) => url.startsWith('/analyze-brand-full'), handler: handleAnalyzeBrandFull },
  { match: (url) => url.startsWith('/analyze-brand'),    handler: handleAnalyzeBrand },
  { match: (url) => url.startsWith('/create-banner'),    handler: handleCreateBanner },
  { match: (url) => url === '/brands',                                         handler: handleListBrands },
  { match: (url, method) => /^\/brands\/[^/]+\/update-prototype$/.test(url) && method === 'POST', handler: handleUpdateBrand },
  { match: (url, method) => /^\/brands\/[^/]+\/raw-data$/.test(url) && method === 'POST', handler: handleUpdateRawData },
  { match: (url) => /^\/brands\/[^/]+\/travlr-compatibility$/.test(url),     handler: handleTravlrCompatibility },
  { match: (url) => /^\/brands\/[^/]+$/.test(url),                           handler: handleGetBrand },
];

function router(req, res) {
  const route = routes.find(({ match }) => match(req.url, req.method));
  const handler = route ? route.handler : handleNotFound;

  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('[unhandled]', err);
    sendError(res, 500, 'Internal server error');
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(router);

await connectDB();

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Claude enabled: ${useClaude}`);
  console.log('');
  console.log('Routes:');
  console.log(`  GET /public/<file>                     — static assets`);
  console.log(`  GET /generate-content?prompt=<text>    — AI HTML generation`);
  console.log(`  GET /analyze-brand?url=<url>           — brand intelligence JSON`);
  console.log(`  GET /analyze-brand-full?url=<url>      — brand intelligence + Travlr compatibility in one call`);
  console.log(`  GET /create-banner?slug=<slug>|brand_id=<id>&brief=<text> — generate 3 banner options (brief optional)`);
  console.log(`  GET /brands                            — list all analyzed brands`);
  console.log(`  GET /brands/<id|slug>                  — get brand detail with parsed raw_data`);
  console.log(`  POST /brands/<id|slug>/update-prototype — update color_palette and/or banner via brief`);
  console.log(`  POST /brands/<id|slug>/raw-data         — deep merge JSON into brand raw_data`);
  console.log(`  GET /brands/<id|slug>/travlr-compatibility — Travlr.com partnership opportunity report`);
});