'use strict';
// Deterministic scoring: the LLM supplies raw nutrition + GI; everything clinical is computed here.

function normalizeFoodName(s) {
  let t = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const rules = [[/\bchapp?at+h?i\b/g, 'chapati'], [/\bchapathi\b/g, 'chapati'], [/\bpaneer\b/g, 'paneer']];
  for (const [re, to] of rules) t = t.replace(re, to);
  return t;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function glClass(gl) { return gl < 10 ? 'Low' : gl <= 20 ? 'Moderate' : 'High'; }

// Diabetes score 9/3/1 (best/mid/worst) and colour from GL, with GI and added-sugar/alcohol nudges.
function scoreItem(n, gi) {
  const carbs = num(n.carbs_g);
  const giv = gi == null ? null : num(gi);
  const gl = giv == null ? null : round((giv * carbs) / 100, 1);
  let cls = gl == null ? (carbs < 5 ? 'Low' : carbs <= 20 ? 'Moderate' : 'High') : glClass(gl);
  if (carbs < 3) cls = 'Low';
  const score = cls === 'Low' ? 9 : cls === 'Moderate' ? 3 : 1;
  const color = score === 9 ? 'Green' : score === 3 ? 'Yellow' : 'Red';
  return { glycemic_index: giv, glycemic_load: gl, gl_classification: cls, diabetes_score: score, assigned_color: color };
}

function scaleNutrition(per100, grams) {
  const r = grams / 100, out = {};
  for (const k of ['calories', 'carbs_g', 'protein_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'alcohol_g']) {
    out[k] = round(num(per100[k]) * r, k === 'sodium_mg' ? 0 : 1);
  }
  return out;
}

const RANK = { Green: 0, Yellow: 1, Red: 2 };

function summarizeMeal(items, profile = {}) {
  const t = { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, alcohol_g: 0, weight_g: 0 };
  let gl = 0, scoreSum = 0, worst = 'Green';
  const counts = { Green: 0, Yellow: 0, Red: 0 };
  const flags = [];
  for (const it of items) {
    for (const k of Object.keys(t)) t[k] += k === 'weight_g' ? num(it.total_weight_g) : num(it.nutrition[k]);
    gl += num(it.diabetes.glycemic_load);
    scoreSum += it.diabetes.diabetes_score;
    counts[it.diabetes.assigned_color]++;
    if (RANK[it.diabetes.assigned_color] > RANK[worst]) worst = it.diabetes.assigned_color;
  }
  for (const k of Object.keys(t)) t[k] = round(t[k], k === 'sodium_mg' ? 0 : 1);
  gl = round(gl, 1);
  // Cumulative GL gap fix: a meal of individually-OK items can still spike glucose.
  let mealColor = worst;
  if (gl > 30 && mealColor !== 'Red') { mealColor = 'Red'; flags.push(`Total meal glycemic load ${gl} is high (>30) even though no single item is Red.`); }
  else if (gl > 20 && mealColor === 'Green') { mealColor = 'Yellow'; flags.push(`Total meal glycemic load ${gl} is moderate-high (>20).`); }
  if (t.alcohol_g > 0) flags.push('Contains alcohol: risk of delayed hypoglycaemia, especially on insulin or sulfonylureas; avoid on an empty stomach.');
  if (profile.hypertension && t.sodium_mg > 800) flags.push(`High sodium for one meal (${t.sodium_mg} mg) – relevant for hypertension.`);
  else if (t.sodium_mg > 1200) flags.push(`High sodium for one meal (${t.sodium_mg} mg).`);
  if (t.calories > 800 || items.length > 6) flags.push('Large meal (>800 kcal or >6 items). Is this one sitting, or should it be split into separate meals?');
  const macroKcal = t.carbs_g * 4 + t.protein_g * 4 + t.fat_g * 9 || 1;
  return {
    meal_totals: t,
    macros_pct: {
      carbs: round((t.carbs_g * 4 / macroKcal) * 100, 0),
      protein: round((t.protein_g * 4 / macroKcal) * 100, 0),
      fat: round((t.fat_g * 9 / macroKcal) * 100, 0)
    },
    diabetes_summary: {
      meal_color: mealColor,
      total_glycemic_load: gl,
      avg_diabetes_score: items.length ? round(scoreSum / items.length, 1) : 0,
      colour_counts: counts,
      flags
    }
  };
}

module.exports = { normalizeFoodName, scoreItem, scaleNutrition, summarizeMeal, glClass, round };
