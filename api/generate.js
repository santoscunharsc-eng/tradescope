// Vercel Serverless Function: POST /api/generate
// Keeps the Gemini key on the server, validates Lemon Squeezy licenses,
// enforces a free tier and a monthly cap for paid licenses.

const crypto = require('crypto');

const FREE_LIMIT = parseInt(process.env.FREE_LIMIT || '2', 10);
const PAID_MONTHLY_LIMIT = parseInt(process.env.PAID_MONTHLY_LIMIT || '60', 10);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const TYPES = [
  'Custom Millwork & Cabinetry',
  'Residential Carpentry & Framing',
  'Full Kitchen & Interior Remodel',
  'Commercial Finish Carpentry'
];
const DETAILS = ['Standard Commercial', 'High Risk Mitigation', 'Detailed Itemized Scope'];
const REGIONS = {
  US: 'United States. Reference state-specific contractor licensing, mechanics lien / lien waiver practice, and sales tax as applicable. Use USD.',
  CA: 'Canada. Reference provincial construction lien / holdback legislation, GST/HST/PST as applicable, and note Quebec-specific rules where relevant. Use CAD.',
  CH: 'Switzerland. Reference SIA norms (e.g. SIA 118 general conditions) where applicable, VAT (MWST/TVA/IVA), and the contractor warranty/notice-of-defects framework. Use CHF.'
};

// ---------- tiny counter store (Upstash Redis REST, memory fallback) ----------
const mem = new Map();
const U = () => ({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

async function redis(path) {
  const { url, token } = U();
  const r = await fetch(`${url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return j.result;
}
async function incr(key, ttlSeconds) {
  const { url, token } = U();
  if (url && token) {
    const n = await redis(`incr/${encodeURIComponent(key)}`);
    if (n === 1) await redis(`expire/${encodeURIComponent(key)}/${ttlSeconds}`);
    return n;
  }
  const n = (mem.get(key) || 0) + 1;
  mem.set(key, n);
  return n;
}
async function decr(key) {
  const { url, token } = U();
  if (url && token) return redis(`decr/${encodeURIComponent(key)}`);
  mem.set(key, Math.max(0, (mem.get(key) || 1) - 1));
}

// ---------- license check ----------
async function validateLicense(licenseKey) {
  try {
    const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: licenseKey })
    });
    const d = await r.json();
    if (!d.valid || !d.license_key || d.license_key.status !== 'active') return false;
    if (process.env.LS_STORE_ID && String(d.meta?.store_id) !== String(process.env.LS_STORE_ID)) return false;
    if (process.env.LS_PRODUCT_ID && String(d.meta?.product_id) !== String(process.env.LS_PRODUCT_ID)) return false;
    return true;
  } catch {
    return false;
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}
function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
}

function buildPrompt(region) {
  return `You are TradeScope AI, an experienced construction and cabinetry estimator who drafts Statements of Work (SOW) for independent contractors and small trade businesses.
Convert the contractor's raw project notes into a clear, professional, well-organized SOW.

Jurisdiction context: ${REGIONS[region]}

Output structure (use exactly these numbered headings):
1. PROJECT OVERVIEW & GOALS
2. SCOPE OF WORK & INCLUSIONS (grouped under Carpentry, Materials, Preparation, Finish)
3. EXCLUSIONS & CLIENT RESPONSIBILITIES
4. PROJECT TIMELINE & PAYMENT SCHEDULE
5. CHANGE ORDERS, WARRANTY & ACCEPTANCE
6. SIGNATURE BLOCK

Rules:
- Use only facts given in the notes. If something important is missing (dimensions, finishes, site access, permits), write it as "[TO BE CONFIRMED: ...]" instead of inventing it.
- Never invent prices, license numbers, statute numbers or legal citations.
- Keep a professional, direct tone. Plain text, no markdown symbols like ** or #.
- End with one line: "This document is a drafting aid and does not constitute legal advice. Have it reviewed by a qualified professional in your jurisdiction before use."
- Output language: English.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Server is not configured.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const type = TYPES.includes(body.type) ? body.type : TYPES[0];
  const detail = DETAILS.includes(body.detail) ? body.detail : DETAILS[0];
  const region = REGIONS[body.region] ? body.region : 'US';
  const brief = String(body.brief || '').trim().slice(0, 4000);
  const payment = String(body.payment || '').trim().slice(0, 200) || '50% deposit / 40% on delivery / 10% on final sign-off';
  const licenseKey = String(body.licenseKey || '').trim().slice(0, 200);

  if (brief.length < 20) return res.status(400).json({ error: 'Please describe the project in a bit more detail.' });

  // ---- access control ----
  let counterKey, limit, ttl, plan;
  if (licenseKey) {
    const ok = await validateLicense(licenseKey);
    if (!ok) return res.status(401).json({ error: 'Invalid or inactive license key.' });
    const month = new Date().toISOString().slice(0, 7);
    counterKey = `paid:${sha(licenseKey)}:${month}`;
    limit = PAID_MONTHLY_LIMIT;
    ttl = 60 * 60 * 24 * 35;
    plan = 'pro';
  } else {
    counterKey = `free:${sha(clientIp(req))}`;
    limit = FREE_LIMIT;
    ttl = 60 * 60 * 24 * 30;
    plan = 'free';
  }

  const used = await incr(counterKey, ttl);
  if (used > limit) {
    await decr(counterKey);
    return res.status(402).json({
      error: plan === 'free'
        ? 'Free generations used up. Unlock the full version to keep going.'
        : 'Monthly generation limit reached. It resets next month.',
      code: plan === 'free' ? 'free_limit' : 'monthly_limit'
    });
  }

  // ---- generate ----
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildPrompt(region) }] },
        contents: [{
          role: 'user',
          parts: [{ text: `Trade category: ${type}\nLegal rigor: ${detail}\nPayment terms: ${payment}\n\nProject notes:\n${brief}` }]
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 6000 }
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`);
    const sow = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!sow) throw new Error('Empty response');
    return res.status(200).json({ sow, plan, remaining: Math.max(0, limit - used) });
  } catch (err) {
    await decr(counterKey); // refund the generation on failure
    return res.status(502).json({ error: 'Generation failed. Please try again in a moment.' });
  }
};
