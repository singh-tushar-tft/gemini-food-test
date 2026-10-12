const $ = (id) => document.getElementById(id);
let state = { items: [], questions: [] };
const hdr = () => ({ 'content-type': 'application/json', 'x-access-code': $('code').value });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const busy = (b, t) => { $('go').disabled = b; $('go').textContent = t; };

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
fetch('/api/health').then((r) => r.json()).then((h) => { if (!h.needs_code) $('codeBox').classList.add('hide'); if (h.mock) $('err').textContent = 'Demo mode (no API key): results are placeholders.'; });

$('go').onclick = async () => {
  $('err').textContent = '';
  try {
    if (!state.questions.length) {
      busy(true, 'Thinking…');
      state = await api('/api/clarify', { text: $('text').value });
      renderQs();
      if (!state.questions.length) await calc();
    } else await calc();
  } catch (e) { $('err').textContent = e.message; }
  const isCalc = state.questions.length && $('out').classList.contains('hide');
  busy(false, isCalc ? '⚡ Calculate' : 'Continue');
  $('go').classList.toggle('floating-btn', !!isCalc);
};

function renderQs() {
  const q = $('qs'); q.classList.toggle('hide', !state.questions.length);
  q.innerHTML = '<h3>A few quick questions</h3>' + state.questions.map((x) => {
    const it = state.items.find((i) => i.id === x.item_id);
    return `<div class="q" data-k="${esc(x.item_id + ':' + x.id)}"><b>${esc(it?.name || '')}: ${esc(x.question)}</b><div class="opts">` +
      (x.options || []).map((o, i) => `<label><input type="radio" name="${esc(x.id)}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('') +
      `</div>${x.allow_custom ? `<input class="custom" placeholder="Or type your own" style="margin-top:6px">` : ''}</div>`;
  }).join('');
  if (state.questions.length) {
    $('go').textContent = '⚡ Calculate';
    $('go').classList.add('floating-btn');
  }
}

async function calc() {
  const answers = {};
  document.querySelectorAll('#qs .q').forEach((d) => {
    const c = d.querySelector('.custom')?.value.trim(), r = d.querySelector('input[type=radio]:checked')?.value;
    const v = c || r; if (v) answers[d.dataset.k] = v;
  });
  busy(true, 'Calculating…');
  const res = await api('/api/calculate', { text: $('text').value, items: state.items, answers });
  window._last = res;
  $('go').classList.remove('floating-btn');
  renderOut(res);
}

const kv = (l, v, u = '') => `<div><b>${esc(v)}${u}</b><small>${l}</small></div>`;
function renderOut(r) {
  const t = r.meal_totals, d = r.diabetes_summary;
  $('out').classList.remove('hide');
  $('out').innerHTML = `<div class="card"><h3>Meal summary <span class="pill ${d.meal_color}">${d.meal_color}</span></h3>
  <div class="grid">${kv('kcal', t.calories)}${kv('carbs', t.carbs_g, ' g')}${kv('protein', t.protein_g, ' g')}${kv('fat', t.fat_g, ' g')}${kv('fibre', t.fiber_g, ' g')}${kv('sodium', t.sodium_mg, ' mg')}${kv('total GL', d.total_glycemic_load)}${kv('avg score', d.avg_diabetes_score)}</div>
  <div class="mut">Carbs ${r.macros_pct.carbs}% · Protein ${r.macros_pct.protein}% · Fat ${r.macros_pct.fat}%</div>
  ${d.flags.map((f) => `<div class="flag">${esc(f)}</div>`).join('')}
  ${r.unresolved?.length ? `<div class="flag">Could not resolve: ${esc(r.unresolved.join(', '))}</div>` : ''}</div>` +
  r.items.map((i) => `<div class="card"><b>${esc(i.food_name)}</b> <span class="pill ${i.diabetes.assigned_color}">${i.diabetes.assigned_color}</span>
  <div class="mut">${i.total_weight_g} g · ${esc(i.data_source)} · ${i.verified ? 'verified' : 'unverified'} · confidence ${esc(i.confidence)}</div>
  <div class="grid">${kv('kcal', i.nutrition.calories)}${kv('carbs', i.nutrition.carbs_g, ' g')}${kv('protein', i.nutrition.protein_g, ' g')}${kv('fat', i.nutrition.fat_g, ' g')}${kv('GI', i.diabetes.glycemic_index ?? '–')}${kv('GL', i.diabetes.glycemic_load ?? '–')}</div>
  <div class="mut">${esc(i.basis || '')} ${esc(i.diabetes.clinical_note || '')}</div></div>`).join('') +
  (r.sources?.length ? `<div class="card mut">Sources: ${r.sources.map((s) => `<a style="color:var(--ac)" target="_blank" rel="noopener" href="${esc(s.url)}">${esc(s.title || s.url)}</a>`).join(' · ')}</div>` : '') +
  `<div class="row"><button id="dl">Download JSON</button></div>`;
  $('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(window._last, null, 2)], { type: 'application/json' })); a.download = 'meal.json'; a.click(); };
  scrollToResult();
}

function scrollToResult() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  const slideDown = () => {
    const el = $('out');
    if (!el || el.classList.contains('hide')) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const rect = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    window.scrollTo({ top: scrollTop + rect.top - 16, behavior: 'smooth' });
  };
  requestAnimationFrame(slideDown);
  setTimeout(slideDown, 80);
  setTimeout(slideDown, 250);
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let baseText = '';

const setMsg = (msg, isErr = true) => {
  const el = $('err');
  el.textContent = msg;
  el.className = isErr ? 'err' : 'info';
};

const stopVoice = () => {
  if (recognition && isRecording) {
    try { recognition.stop(); } catch (_) {}
  }
  isRecording = false;
  $('mic').classList.remove('recording');
  $('mic').textContent = '🎤 Voice';
  if ($('err').className === 'info') setMsg('', false);
};

if (!SR) {
  $('mic').onclick = () => {
    setMsg('Voice input is not supported in this browser. Please use Google Chrome or Microsoft Edge.', true);
  };
} else {
  try {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onstart = () => {
      isRecording = true;
      $('mic').classList.add('recording');
      $('mic').textContent = '⏹ Stop Voice';
      setMsg('🎙️ Listening... Speak your food items now (click Stop when finished).', false);
      baseText = $('text').value.trim();
      if (baseText) baseText += ' ';
    };

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      $('text').value = (baseText + final + interim).trim();
    };

    recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMsg('Microphone access blocked. Please allow microphone permission in your browser address bar.', true);
      } else if (e.error === 'no-speech') {
        setMsg('No speech detected. Please speak clearly into your microphone.', true);
      } else if (e.error === 'audio-capture') {
        setMsg('No microphone found. Please connect a microphone and try again.', true);
      } else if (e.error === 'network') {
        setMsg('Speech recognition network error. Please check your internet connection.', true);
      } else {
        setMsg(`Voice error: ${e.error}. Please try again.`, true);
      }
      stopVoice();
    };

    recognition.onend = () => {
      stopVoice();
    };

    $('mic').onclick = () => {
      if (isRecording) {
        stopVoice();
      } else {
        setMsg('', false);
        try {
          recognition.start();
        } catch (err) {
          console.error('Recognition start error:', err);
          stopVoice();
          try {
            setTimeout(() => recognition.start(), 200);
          } catch (_) {
            setMsg('Unable to start microphone. Please check browser permissions.', true);
          }
        }
      }
    };
  } catch (err) {
    console.error('Failed to initialize SpeechRecognition:', err);
    $('mic').onclick = () => {
      setMsg('Failed to initialize voice recognition in this browser.', true);
    };
  }
}

$('reset').onclick = () => {
  stopVoice();
  state = { items: [], questions: [] };
  $('text').value = '';
  $('qs').classList.add('hide');
  $('out').classList.add('hide');
  $('go').classList.remove('floating-btn');
  $('go').textContent = 'Continue';
  setMsg('', false);
};
