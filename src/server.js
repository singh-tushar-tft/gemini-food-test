'use strict';
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const llm = require('./llm');
const { TTLCache, JsonStore } = require('./store');
const { normalizeFoodName, scoreItem, scaleNutrition, summarizeMeal } = require('./scoring');

function createApp({ dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), llmImpl = llm } = {}) {
  const app = express();
  const cache = new TTLCache();
  const store = new JsonStore(dataDir);
  const ACCESS = process.env.ACCESS_CODE || '';
  const ADMIN = process.env.ADMIN_CODE || ACCESS;

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false }));

  const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const auth = (code) => (req, res, next) => (!code || eq(req.get('x-access-code') || '', code)) ? next() : res.status(401).json({ error: 'Invalid access code' });

  app.get('/api/health', (req, res) => res.json({ ok: true, mock: llmImpl.MOCK, model: llmImpl.MODEL, needs_code: !!ACCESS }));

  app.post('/api/clarify', auth(ACCESS), async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 1500) return res.status(400).json({ error: 'text required (max 1500 chars)' });
    try { const { data } = await llmImpl.clarify(text); res.json(data); }
    catch (e) { console.error(e); res.status(502).json({ error: 'Clarification failed' }); }
  });

  app.post('/api/calculate', auth(ACCESS), async (req, res) => {
    const { text = '', items, answers = {}, profile = {} } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 12) return res.status(400).json({ error: 'items required (1-12)' });
    try {
      const keyed = items.map((it) => {
        const a = Object.entries(answers).filter(([k]) => String(k).startsWith(it.id + ':') || k === it.id).map(([, v]) => v).join(' ');
        return { it, key: normalizeFoodName(`${it.name} ${a}`) + `|${it.quantity}|${normalizeFoodName(it.portion || '')}` };
      });
      const resolved = {}, misses = [];
      for (const { it, key } of keyed) {
        const hit = cache.get(key) || (store.getFood(key) && { ...store.getFood(key), _src: 'db' });
        if (hit) resolved[it.id] = { rec: hit, from: hit._src || 'cache' }; else misses.push(it);
      }
      let sources = [];
      if (misses.length) {
        const out = await llmImpl.calculate(misses, answers, text);
        sources = out.sources;
        for (const r of out.data.items || []) {
          const k = keyed.find((x) => x.it.id === r.id);
          if (!k || !r.per_100g || !(Number(r.total_weight_g) > 0)) continue;
          const rec = store.putFood(k.key, { name: r.name, per_100g: r.per_100g, glycemic_index: r.glycemic_index ?? null, total_weight_g: Number(r.total_weight_g), basis: r.basis, source: r.source, confidence: r.confidence, avoid_in: r.avoid_in || [], clinical_note: r.clinical_note || '', verified: false });
          cache.set(k.key, rec);
          resolved[r.id] = { rec, from: 'llm' };
        }
      }
      const out = [], unresolved = [];
      for (const { it } of keyed) {
        const r = resolved[it.id];
        if (!r) { unresolved.push(it.name); continue; }
        const { rec } = r;
        const grams = rec.total_weight_g;
        const nutrition = scaleNutrition(rec.per_100g, grams);
        const diabetes = { ...scoreItem(nutrition, rec.glycemic_index), avoid_in: rec.avoid_in, clinical_note: rec.clinical_note };
        out.push({ food_name: it.name, data_source: r.from, verified: !!rec.verified, confidence: rec.confidence, source: rec.source, basis: rec.basis, quantity: it.quantity, portion: it.portion, total_weight_g: grams, nutrition, diabetes });
      }
      if (!out.length) return res.status(502).json({ error: 'Could not resolve nutrition', unresolved });
      res.json({ items: out, ...summarizeMeal(out, profile), unresolved, sources, disclaimer: 'Estimates for logging support; not medical advice. Unverified entries await clinical review.' });
    } catch (e) { console.error(e); res.status(502).json({ error: 'Calculation failed' }); }
  });

  app.get('/api/admin/queue', auth(ADMIN), (req, res) => res.json(store.queue));
  app.post('/api/admin/verify', auth(ADMIN), (req, res) => {
    const r = store.verify(String(req.body?.key || ''));
    r ? res.json(r) : res.status(404).json({ error: 'not found' });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`YHealth food agent on :${port} (mock=${llm.MOCK}, model=${llm.MODEL})`));
}
module.exports = { createApp };
