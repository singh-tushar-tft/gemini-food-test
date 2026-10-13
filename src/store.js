'use strict';
const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 3600 * 1000;
class TTLCache {
  constructor(ttl = TTL_MS) { this.ttl = ttl; this.m = new Map(); }
  get(k) { const e = this.m.get(k); if (!e) return null; if (e.exp < Date.now()) { this.m.delete(k); return null; } return e.v; }
  set(k, v) { if (v) this.m.set(k, { v, exp: Date.now() + this.ttl }); }
}

// Food DB: persists to disk when possible, falls back to in-memory only.
// Set NO_PERSIST=1 to always run memory-only (no disk writes).
class JsonStore {
  constructor(dir) {
    this.foods = {};
    this.queue = [];
    this._persist = process.env.NO_PERSIST !== '1';

    if (!this._persist) {
      console.log('[store] NO_PERSIST=1 – running in memory-only mode (no disk writes).');
      return;
    }

    // Probe writability before committing
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write_probe');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
    } catch (e) {
      console.warn(`[store] Data dir "${dir}" is not writable (${e.code}). Running in memory-only mode.`);
      this._persist = false;
      return;
    }

    this.dir = dir;
    this.foodsFile = path.join(dir, 'foods.json');
    this.queueFile = path.join(dir, 'verification_queue.json');
    this.foods = this._load(this.foodsFile, {});
    this.queue = this._load(this.queueFile, []);
    console.log(`[store] Persisting to ${dir} (${Object.keys(this.foods).length} foods loaded).`);
  }

  _load(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
  _save(f, v) {
    if (!this._persist) return;
    try {
      const t = f + '.tmp';
      fs.writeFileSync(t, JSON.stringify(v, null, 2));
      fs.renameSync(t, f);
    } catch (e) {
      console.warn(`[store] Write failed (${e.code}), switching to memory-only mode.`);
      this._persist = false;
    }
  }

  getFood(key) { return this.foods[key] || null; }
  putFood(key, rec) {
    const existing = this.foods[key];
    if (existing && existing.verified && !rec.verified) return existing;
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
    this.foods[key].verified = true;
    this.foods[key].verified_at = new Date().toISOString();
    this.queue = this.queue.filter((q) => q.key !== key);
    this._save(this.foodsFile, this.foods);
    this._save(this.queueFile, this.queue);
    return this.foods[key];
  }
}

module.exports = { TTLCache, JsonStore };

