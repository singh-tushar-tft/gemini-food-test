const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { scoreItem, summarizeMeal, normalizeFoodName } = require('../src/scoring');
const { createApp } = require('../src/server');
const llm = require('../src/llm');

test('normalise', () => {
  assert.strictEqual(normalizeFoodName('Chapathi'), 'chapati');
  assert.strictEqual(normalizeFoodName('Chappati!'), 'chapati');
  assert.notStrictEqual(normalizeFoodName('roti'), 'chapati');
});
test('single wheat roti is Yellow (GL 10.4)', () => {
  const s = scoreItem({ carbs_g: 18 }, 58);
  assert.strictEqual(s.glycemic_load, 10.4);
  assert.strictEqual(s.assigned_color, 'Yellow');
});
test('cumulative GL escalates meal colour', () => {
  const mk = (gl, c, sc) => ({ total_weight_g: 100, nutrition: { calories: 100, carbs_g: 10, protein_g: 1, fat_g: 1, fiber_g: 1, sugar_g: 1, sodium_mg: 10, alcohol_g: 0 }, diabetes: { glycemic_load: gl, assigned_color: c, diabetes_score: sc } });
  const r = summarizeMeal([mk(9, 'Green', 9), mk(9, 'Green', 9), mk(9, 'Green', 9), mk(9, 'Green', 9)]);
  assert.strictEqual(r.diabetes_summary.meal_color, 'Red');
});
test('alcohol flagged', () => {
  const it = { total_weight_g: 90, nutrition: { calories: 200, carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, alcohol_g: 30 }, diabetes: { glycemic_load: 0, assigned_color: 'Green', diabetes_score: 9 } };
  assert.ok(summarizeMeal([it]).diabetes_summary.flags.some((f) => /alcohol/i.test(f)));
});
test('API flow in mock mode + cache', async () => {
  process.env.MOCK_LLM = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-'));
  let calls = 0;
  const impl = { ...llm, MOCK: true, calculate: async (...a) => { calls++; return llm.calculate(...a); } };
  const app = createApp({ dataDir: dir, llmImpl: impl }).listen(0);
  const base = `http://127.0.0.1:${app.address().port}`;
  const code = process.env.ACCESS_CODE || '';
  const adminCode = process.env.ADMIN_CODE || code;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': code }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await post('/api/clarify', { text: '2 chapati, dal' });
  assert.ok(c.items.length === 2 && c.questions.length === 2);
  const r1 = await post('/api/calculate', { text: 'x', items: c.items, answers: {} });
  assert.ok(r1.meal_totals.calories > 0 && r1.diabetes_summary.meal_color);
  await post('/api/calculate', { text: 'x', items: c.items, answers: {} });
  assert.strictEqual(calls, 1, 'second call served from cache');
  assert.strictEqual((await fetch(base + '/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': code }, body: '{}' })).status, 400);
  assert.strictEqual((await fetch(base + '/api/admin/queue', { headers: { 'x-access-code': adminCode } })).status, 200);
  app.close();
});
