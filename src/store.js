'use strict';
const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 3600 * 1000;
class TTLCache {
  constructor(ttl = TTL_MS) { this.ttl = ttl; this.m = new Map(); }
  get(k) { const e = this.m.get(k); if (!e) return null; if (e.exp < Date.now()) { this.m.delete(k); return null; } return e.v; }
  set(k, v) { if (v) this.m.set(k, { v, exp: Date.now() + this.ttl }); }
}

// Tiny JSON-file DB: foods (per-100g records) and a verification queue.
class JsonStore {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir, { recursive: true });
    this.foodsFile = path.join(dir, 'foods.json');
    this.queueFile = path.join(dir, 'verification_queue.json');
    this.foods = this._load(this.foodsFile, {});
    this.queue = this._load(this.queueFile, []);
  }
  _load(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
  _save(f, v) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); }
  getFood(key) { return this.foods[key] || null; }
  putFood(key, rec) {
    const existing = this.foods[key];
    if (existing && existing.verified && !rec.verified) return existing; // never overwrite verified with unverified
    this.foods[key] = { ...rec, updated_at: new Date().toISOString() };
    this._save(this.foodsFile, this.foods);
    if (!rec.verified && !this.queue.find((q) => q.key === key)) {
      this.queue.push({ key, name: rec.name, source: rec.source, queued_at: new Date().toISOString() });
      this._save(this.queueFile, this.queue);
    }
    return this.foods[key];
  }
  verify(key) {
    if (!this.foods[key]) return null;
    this.foods[key].verified = true; this.foods[key].verified_at = new Date().toISOString();
    this.queue = this.queue.filter((q) => q.key !== key);
    this._save(this.foodsFile, this.foods); this._save(this.queueFile, this.queue);
    return this.foods[key];
  }
}
module.exports = { TTLCache, JsonStore };
