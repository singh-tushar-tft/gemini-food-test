'use strict';
const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
const USE_SEARCH = process.env.WEB_SEARCH !== '0';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MOCK = process.env.MOCK_LLM === '1' || !API_KEY;
let client = null;
const getClient = () => (client ||= new GoogleGenAI({ apiKey: API_KEY }));

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

async function ask(system, user, { search = false, maxTokens = 4000 } = {}) {
  const ai = getClient();
  const config = {
    systemInstruction: system,
    maxOutputTokens: maxTokens,
  };
  if (search && USE_SEARCH) {
    config.tools = [{ googleSearch: {} }];
  }
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: user,
    config,
  });
  const text = resp.text || '';
  const sources = [];
  const candidate = resp.candidates?.[0];
  const metadata = candidate?.groundingMetadata;
  if (metadata?.groundingChunks) {
    for (const ch of metadata.groundingChunks) {
      if (ch.web?.uri) {
        sources.push({ title: ch.web.title || ch.web.uri, url: ch.web.uri });
      }
    }
  }
  return { data: extractJson(text), sources: [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 8) };
}

const CLARIFY_SYS = `You are YHealth's food-logging clarification agent for a diabetes/hypertension care app.
Parse the user's meal text into items. For EVERY item, ask ALL clarifications needed for an accurate nutrition calculation, batched in one round: preparation/cooking method, variant/brand/type, portion size in grams or a standard measure, added oil/ghee/sugar/sauce, restaurant vs home-made, and for drinks: size, sugar, alcohol %. Skip questions the user already answered. Offer 2-5 short options per question where sensible.
Return ONLY JSON: {"items":[{"id":"i1","name":"","quantity":1,"portion":""}],"questions":[{"id":"q1","item_id":"i1","question":"","options":["",""],"allow_custom":true}],"notes":""}`;

const CALC_SYS = `You are YHealth's nutrition calculation engine. Given parsed items and the user's clarification answers, return real nutrition data per 100 g (or per 100 ml) for each item as prepared, plus the total edible weight in grams for the quantity/portion the user ate, and the glycemic index (null if unknown or ~0 carbs). Prefer IFCT/USDA/ICMR-NIN or reputable brand/restaurant data; use web search when available and note the source. Never invent precision: put confidence 'high'|'medium'|'low' and mark estimates in basis. 
Return ONLY JSON: {"items":[{"id":"i1","name":"","quantity":1,"portion":"","total_weight_g":0,"per_100g":{"calories":0,"carbs_g":0,"protein_g":0,"fat_g":0,"fiber_g":0,"sugar_g":0,"sodium_mg":0,"alcohol_g":0},"glycemic_index":null,"basis":"","source":"","confidence":"medium","avoid_in":[],"clinical_note":""}]}`;

// ---------- mock mode (tests / demo without API key) ----------
function mockClarify(text) {
  const parts = text.split(/,| and |\n/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const items = parts.map((p, i) => ({ id: `i${i + 1}`, name: p.replace(/^\d+(\.\d+)?\s*/, ''), quantity: parseFloat(p) || 1, portion: '' }));
  const questions = items.map((it, i) => ({ id: `q${i + 1}`, item_id: it.id, question: `Portion size for ${it.name}?`, options: ['Small (100 g)', 'Medium (150 g)', 'Large (250 g)'], allow_custom: true }));
  return { data: { items, questions, notes: 'mock' }, sources: [] };
}
function mockCalc(items) {
  return {
    data: { items: items.map((it) => ({ ...it, total_weight_g: 150, per_100g: { calories: 130, carbs_g: 25, protein_g: 4, fat_g: 2, fiber_g: 2, sugar_g: 1, sodium_mg: 120, alcohol_g: /whisk|beer|wine|rum|vodka/i.test(it.name) ? 10 : 0 }, glycemic_index: 55, basis: 'mock', source: 'mock', confidence: 'low', avoid_in: [], clinical_note: '' })) },
    sources: []
  };
}

const isMock = () => process.env.MOCK_LLM === '1' || !API_KEY;
const clarify = (text) => (isMock() ? Promise.resolve(mockClarify(text)) : ask(CLARIFY_SYS, `Meal text: ${text}`, { maxTokens: 2500 }));
const calculate = (items, answers, text) => isMock()
  ? Promise.resolve(mockCalc(items))
  : ask(CALC_SYS, `Original text: ${text}\nParsed items: ${JSON.stringify(items)}\nClarification answers: ${JSON.stringify(answers)}`, { search: true });

module.exports = { clarify, calculate, get MOCK() { return isMock(); }, MODEL, extractJson };
