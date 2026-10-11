/* Whetstone: interview practice notebook on GitHub Pages.
   Data lives in this repo under data/; the page reads data/index.json and,
   with a GitHub token, writes questions and submissions back through the API. */
(() => {
'use strict';

/* ---------- vocab ---------- */
const SKILLS = {
  'correctness':['Logic bugs','The code gives wrong answers on valid input'],
  'edge-cases':['Edge cases','Empty, single-item, duplicate or extreme inputs are missed'],
  'bounds':['Off-by-one and boundaries','Loop limits, indices and grid edges'],
  'complexity':['Time and space efficiency','A faster or leaner approach exists'],
  'algo-choice':['Spotting the pattern','The right technique for the problem was not used'],
  'ds-choice':['Data structure choice','A better-suited structure would simplify or speed it up'],
  'structure':['Breaking the problem down','Tangled control flow or missing helper steps'],
  'clarity':['Readability and naming','Hard to follow in an interview setting'],
  'language':['Language idioms','Fighting the language or missing its standard tools'],
  'testing':['Checking your own work','No walk-through, tests or invariants'],
  'extensibility':['Building for the next part','Earlier parts were not structured so later rules slot in'],
  'clarifying':['Clarifying the problem','Coded on assumptions instead of asking about the unstated rules'],
  'communication':['Thinking out loud','Went quiet; the interviewer could not follow the approach as it formed'],
  'independence':['Working without nudges','Needed the interviewer to get unstuck or to notice the clock'],
};
const DIMS = [['clarifying','Clarifying'],['communication','Thinking aloud'],['independence','Independence'],['approach','Approach'],['correctness','Correctness'],['efficiency','Efficiency'],['edgeCases','Edge cases'],['testing','Own tests'],['clarity','Clarity'],['extensibility','Extensibility']];
const VERDICT = ['','Not there yet','Shaky','Borderline','Solid','Strong'];
const LANGS = {python:'Python', javascript:'JavaScript'};

/* ---------- state ---------- */
const S = { loading:true, index:null, questions:new Map(), subs:[], view:null, attempt:null, busy:null, dirty:false, plan:null, gyms:[] };
const DEFAULT_PLAN = {company:'OpenAI', stages:[{name:'Phone screen', date:'2026-10-22T09:00', rounds:['Coding','Architecture'], note:'both rounds must pass'}, {name:'Onsite', date:'', rounds:['Coding','Architecture','Previous design','Behavioral'], note:'unlocked by the phone screen; dates TBD'}]};
const $ = s => document.querySelector(s);
const app = $('#app');
let curEditor = null, timerInt = null, planInt = null;

/* ---------- helpers ---------- */
const PROPS = new Set(['value','checked','disabled','hidden','selected','open']);
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)){
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clone = o => JSON.parse(JSON.stringify(o));
const put = (el, ...kids) => { for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k); return el; };
function promptEl(text, cls){
  // Plain text with `inline code` spans; keeps line breaks.
  const el = h('div',{class:cls || 'prompt'});
  const parts = String(text || '').split(/(`[^`\n]+`)/);
  for (const p of parts){ if (!p) continue; if (p.startsWith('`') && p.endsWith('`') && p.length > 2) el.append(h('code',{text:p.slice(1,-1)})); else el.append(document.createTextNode(p)); }
  return el;
}
const str = (v,max) => (typeof v === 'string' ? v : '').trim().slice(0,max);
const clampInt = (v,lo,hi,d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi,Math.max(lo,n)) : d; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'question';
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const fmtDateTime = iso => new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function fmtSec(s){ s = Math.max(0, Math.round(s||0)); const m = Math.floor(s/60); return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}:${String(s%60).padStart(2,'0')}`; }
const avg = xs => xs.length ? xs.reduce((a,b) => a+b, 0)/xs.length : 0;
const median = xs => { if (!xs.length) return 0; const s = xs.slice().sort((a,b) => a-b); const m = Math.floor(s.length/2); return s.length % 2 ? s[m] : Math.round((s[m-1]+s[m])/2); };
function hireEstimate(fullAtts, fbs){
  const K = 3, last = fullAtts.filter(a => a.q.gates.length >= K).slice(-5);
  if (!last.length) return {verdict:'Not enough data', score:0, confidence:'no', cls:'none', summary:'Finish at least one full attempt (three or more parts) and the estimate appears.', parts:[]};
  const first = a => a.q.gates.slice(0, K).map(g => a.gates.get(g.id));
  const clean = avg(last.map(a => first(a).filter(s => s && gateStatus(s) === 'pass').length / K)) * 100;
  const pace = avg(last.map(a => { const gs = a.q.gates.slice(0, K); const budget = gs.reduce((x,g) => x + (g.minutes||0)*60, 0); const spent = first(a).reduce((x,s) => x + (s ? s.gateSec||0 : 0), 0); if (!budget) return 1; return Math.max(0, Math.min(1, 1 - Math.max(0, spent - budget) / budget)); })) * 100;
  const recentFb = fbs.slice(-8);
  const quality = recentFb.length ? (avg(recentFb.map(f => f.overall)) - 1) / 4 * 100 : null;
  const process = recentFb.length ? (avg(recentFb.map(f => ((f.scores.clarifying || f.overall) + (f.scores.testing || f.overall)) / 2)) - 1) / 4 * 100 : null;
  const nudgeCost = s => (s.nudges || []).reduce((x,r) => x + (r === 'stuck' ? 35 : r === 'idle' ? 15 : r === 'time100' ? 5 : 0), 0);
  const subsSeen = last.flatMap(a => first(a).filter(Boolean));
  const fromNudges = subsSeen.length ? avg(subsSeen.map(s => Math.max(0, 100 - nudgeCost(s)))) : null;
  const fromScores = recentFb.filter(f => f.scores.independence).length ? (avg(recentFb.filter(f => f.scores.independence).map(f => (f.scores.independence + (f.scores.communication || f.scores.independence)) / 2)) - 1) / 4 * 100 : null;
  const independence = fromNudges == null ? fromScores : fromScores == null ? fromNudges : (fromNudges + fromScores) / 2;
  const nudgeTotal = subsSeen.reduce((x,s) => x + (s.nudges || []).filter(r => r === 'stuck' || r === 'idle').length, 0);
  const parts = [{name:'First three parts passing', v:clean, note:'tests clean on parts 1–3, last ' + last.length + ' full attempt' + (last.length===1?'':'s')}, {name:'Inside the time budget', v:pace, note:'time on parts 1–3 vs their budgets'}, {name:'Review quality', v:quality, note:recentFb.length ? 'average verdict over the last ' + recentFb.length + ' reviews' : 'no reviews yet'}, {name:'Clarifying and testing', v:process, note:'asked the right questions, wrote own tests'}, {name:'Independence and narration', v:independence, note:nudgeTotal ? `${nudgeTotal} stuck/idle nudge${nudgeTotal===1?'':'s'} needed on parts 1–3; a stuck nudge costs 35 points, idle 15, overrunning a time check 5` : 'no stuck or idle nudges needed; thinking-aloud score from reviews'}, {name:'Design readiness', v:null, note:'not measured yet'}];
  const score = Math.round(clean*0.35 + pace*0.15 + (quality ?? 50)*0.25 + (process ?? 50)*0.10 + (independence ?? 60)*0.15);
  let verdict = score >= 80 ? 'Strong hire' : score >= 65 ? 'Hire' : score >= 50 ? 'Lean hire' : score >= 35 ? 'Lean no hire' : 'No hire';
  if (verdict === 'Strong hire') verdict = 'Hire';
  const confidence = last.length >= 4 && recentFb.length >= 4 ? 'medium' : 'low';
  const weakest = parts.filter(p => p.v != null).sort((a,b) => a.v-b.v)[0];
  const summary = `${verdict}: ${score}/100 on coding alone. ` + (weakest ? `The biggest drag is ${weakest.name.toLowerCase()} at ${Math.round(weakest.v)}%. ` : '') + (independence != null && independence < 50 ? 'You needed the interviewer to get moving; interviewers who barely help will read that as a no.' : clean >= 90 && pace >= 80 ? 'The three-part bar is met; quality and questions decide the rest.' : clean < 60 ? 'Clearing parts 1–3 cleanly is the gate; everything else matters after that.' : 'Close to the bar; pace and clean follow-ups are where the points are.');
  return {verdict, score, confidence, cls:score >= 65 ? 'good' : score >= 50 ? 'warn' : 'bad', summary, parts};
}
const tsId = () => new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
function pips(score){
  const cls = score<=2 ? 's-low' : score===3 ? 's-mid' : 's-high';
  const el = h('span',{class:'pips '+cls, role:'img', 'aria-label':`${score} of 5`});
  for (let i=1;i<=5;i++) el.append(h('i',{class:i<=score?'on':''}));
  return el;
}
let toastT = null;
function toast(msg){
  if (!msg) return;
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6000);
}
function setSaveState(kind, msg){
  const el = $('#saveState');
  el.className = 'save-state' + (kind==='err' ? ' err' : '');
  el.textContent = kind==='busy' ? 'Saving to GitHub…' : kind==='err' ? (msg || 'Not saved') : kind==='ok' ? 'Saved' : '';
}

/* ---------- settings ---------- */
const Cfg = {
  get(k, d=''){ try { return localStorage.getItem('whetstone.' + k) ?? d; } catch(e){ return d; } },
  set(k, v){ try { v ? localStorage.setItem('whetstone.' + k, v) : localStorage.removeItem('whetstone.' + k); } catch(e){} },
  backend(){ return (Cfg.get('backend') || (location.protocol.startsWith('http') && !location.hostname.endsWith('github.io') ? location.origin : 'http://localhost:8787')).replace(/\/$/, ''); },
};

/* ---------- local backend ---------- */
const API = {
  async call(method, path, body){
    let r;
    try { r = await fetch(Cfg.backend() + path, {method, headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined, cache:'no-store'}); }
    catch(e){ throw new Error('offline'); }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('Backend replied ' + r.status));
    return j;
  },
  health(){ return this.call('GET', '/api/health'); },
  index(){ return this.call('GET', '/api/index'); },
  question(id){ return this.call('GET', '/api/questions/' + encodeURIComponent(id)); },
  putQuestion(q){ return this.call('PUT', '/api/questions/' + encodeURIComponent(q.id), q); },
  deleteQuestion(id){ return this.call('DELETE', '/api/questions/' + encodeURIComponent(id)); },
  submission(id){ return this.call('GET', '/api/submissions/' + encodeURIComponent(id)); },
  submit(s){ return this.call('POST', '/api/submissions', s); },
  review(id){ return this.call('POST', '/api/submissions/' + encodeURIComponent(id) + '/review'); },
  export(){ return this.call('GET', '/api/export'); },
  import(data){ return this.call('POST', '/api/import', data); },
  plan(){ return this.call('GET', '/api/plan'); },
  putPlan(p){ return this.call('POST', '/api/plan', p); },
  gyms(){ return this.call('GET', '/api/gym'); },
  putGym(s){ return this.call('POST', '/api/gym', s); },
};

/* ---------- data ---------- */
async function loadIndex(){
  S.health = null;
  try { S.health = await API.health(); } catch(e){ S.health = null; }
  let idx = {questions:[], submissions:[]};
  if (S.health){ try { idx = await API.index(); } catch(e){ toast('The backend answered but the index failed: ' + e.message); } try { S.plan = await API.plan(); } catch(e){ S.plan = null; } try { S.gyms = (await API.gyms()).sessions || []; } catch(e){ S.gyms = []; } }
  S.index = idx;
  S.questions = new Map(idx.questions.map(q => [q.id, q]));
  S.subs = idx.submissions.slice().sort((a,b) => a.at.localeCompare(b.at));
}
async function fetchQuestion(id){
  const q = S.questions.get(id);
  if (q && q.gates && q.gates[0] && q.gates[0].prompt != null) return q;
  try { const full = await API.question(id); S.questions.set(id, full); return full; } catch(e){ return q || null; }
}
async function fetchSubmission(s){
  if (s.code != null) return s;
  try { return await API.submission(s.id); } catch(e){ return s; }
}
const runOf = s => s.cpython || s.browser || {};
const summarizeS = s => ({id:s.id, questionId:s.questionId, gateId:s.gateId, attemptId:s.attemptId, at:s.at, elapsedSec:s.elapsedSec, gateSec:s.gateSec, lines:s.lines, cpm:s.cpm ?? null, activeSec:s.activeSec ?? null, passed:runOf(s).passed ?? null, total:runOf(s).total ?? null, runtime:runOf(s).runtime || null, status:s.status || 'grading', feedback:s.feedback || null});

async function saveQuestion(q){
  setSaveState('busy');
  try { const sum = await API.putQuestion(q); setSaveState('ok'); S.questions.set(q.id, q); const i = S.index.questions.findIndex(x => x.id === q.id); i >= 0 ? S.index.questions[i] = sum : S.index.questions.push(sum); return true; }
  catch(e){ setSaveState('err'); toast(e.message === 'offline' ? 'The local backend is not running, so nothing was saved. Start it with: python server.py' : e.message); return false; }
}
async function saveSubmission(sub){
  const sum = summarizeS(sub);
  S.subs.push(sum); S.index.submissions.push(sum);
  setSaveState('busy');
  try { await API.submit(sub); setSaveState('ok'); return true; }
  catch(e){ setSaveState('err'); toast(e.message === 'offline' ? 'The local backend is not running: this submission is NOT saved. Start it with: python server.py' : 'Not saved: ' + e.message); return false; }
}
function applySubmissionUpdate(full){
  const sum = summarizeS(full);
  for (const list of [S.subs, S.index.submissions]){ const i = list.findIndex(x => x.id === full.id); if (i >= 0) list[i] = sum; }
  return sum;
}
async function waitForEval(sid, onUpdate, maxMs = 180000){
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs){
    await new Promise(r => setTimeout(r, 2500));
    let full; try { full = await API.submission(sid); } catch(e){ return null; }
    applySubmissionUpdate(full); onUpdate && onUpdate(full);
    if (['done','review-failed'].includes(full.status) || (full.status === 'reviewing' && !(S.health && S.health.hasKey))) return full;
  }
  return null;
}

/* ---------- derived ---------- */
function attemptsOf(qid){
  const by = new Map();
  for (const s of S.subs) if (s.questionId === qid){
    let a = by.get(s.attemptId); if (!a){ a = {id:s.attemptId, at:s.at, subs:[], gates:new Map()}; by.set(s.attemptId, a); }
    a.subs.push(s); a.gates.set(s.gateId, s); // last submission per gate wins
    a.at = a.at < s.at ? a.at : s.at;
  }
  const out = [...by.values()].sort((a,b) => a.at.localeCompare(b.at));
  for (const a of out){
    a.totalSec = Math.max(...a.subs.map(s => s.elapsedSec || 0), 0);
    a.passed = [...a.gates.values()].filter(s => s.total && s.passed === s.total).length;
    const fbs = [...a.gates.values()].map(s => s.feedback && s.feedback.overall).filter(Boolean);
    a.quality = fbs.length ? avg(fbs) : null;
  }
  return out;
}
function gateStatus(s){ if (!s) return ''; if (!s.total) return 'part'; return s.passed === s.total ? 'pass' : s.passed ? 'part' : 'fail'; }

/* ---------- Python / JS runner ---------- */
const PY_BASE = Cfg.get('pyodide') || 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const JS_WORKER = `
const fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v); } catch(e){ return String(v); } };
self.onmessage = async e => {
  const {code, tests, entry} = e.data, logs = [];
  const con = {log:(...a) => logs.push(a.map(fmt).join(' ')), error:(...a) => logs.push(a.map(fmt).join(' ')), warn:(...a) => logs.push(a.map(fmt).join(' ')), info:(...a) => logs.push(a.map(fmt).join(' '))};
  let fn, error = '';
  try { fn = new Function('console', code + '\\n;try { return (typeof ' + (entry || '__none__') + ' === "function") ? ' + (entry || 'undefined') + ' : undefined; } catch(_e){ return undefined; }')(con); }
  catch(err){ error = String(err && err.stack || err); }
  const cases = [];
  if (!error && tests.length){
    if (!fn) error = 'Entry function "' + entry + '" was not found. Define it at top level or set the entry name on the gate.';
    else for (const t of tests){
      const t0 = performance.now();
      try { let got = fn(...t.args); if (got && typeof got.then === 'function') got = await got; cases.push({got:JSON.stringify(got === undefined ? null : got), ms:performance.now()-t0}); }
      catch(err){ cases.push({err:String(err && err.message || err), ms:performance.now()-t0}); }
    }
  }
  self.postMessage({cases, stdout:logs.join('\\n').slice(0,20000), error, runtime:'browser js'});
};`;
const PY_WORKER = `
let py = null, loading = null;
async function boot(){
  self.postMessage({progress:'Loading Python (about 12 MB, cached after the first time)…'});
  importScripts('${PY_BASE}pyodide.js');
  py = await loadPyodide({indexURL:'${PY_BASE}'});
  self.postMessage({ready:true, version:py.version});
}
self.onmessage = async e => {
  if (e.data.warm){ try { await (loading = loading || boot()); } catch(err){ self.postMessage({pyFailed:String(err)}); } return; }
  const {code, tests, entry} = e.data, logs = [];
  try { if (!py) await (loading = loading || boot()); } catch(err){ self.postMessage({cases:[], stdout:'', error:'', pyFailed:String(err)}); return; }
  py.setStdout({batched:s => logs.push(s)}); py.setStderr({batched:s => logs.push(s)});
  let error = '';
  try { py.globals.set('__tests', JSON.stringify(tests.map(t => t.args))); py.globals.set('__entry', entry || ''); py.globals.set('__name__', tests.length ? '__submission__' : '__main__'); py.runPython(code); }
  catch(err){ const lines = String(err && err.message || err).split('\\n'); const k = lines.findIndex(l => l.includes('File "<exec>"')); error = (k >= 0 ? ['Traceback (most recent call last):', ...lines.slice(k)] : lines.filter(l => !/pyodide|_pyodide/.test(l))).map(l => l.replace('File "<exec>"', 'File "main.py"')).slice(-14).join('\\n'); }
  let cases = [];
  if (!error && tests.length){
    const r = py.runPython(\`
import json, traceback, time
__res = []
__fn = globals().get(__entry)
if not callable(__fn):
    __res = None
else:
    for __t in json.loads(__tests):
        __t0 = time.perf_counter()
        try:
            __r = __fn(*__t)
            __res.append({"got": json.dumps(__r, default=str), "ms": (time.perf_counter()-__t0)*1000})
        except Exception:
            __res.append({"err": traceback.format_exc(limit=2).strip().split(chr(10))[-1], "ms": (time.perf_counter()-__t0)*1000})
json.dumps(__res)\`);
    cases = JSON.parse(r);
    if (cases === null){ cases = []; error = 'Entry function "' + entry + '" was not found. Define it at top level or set the entry name on the gate.'; }
  }
  self.postMessage({cases, stdout:logs.join('\\n').slice(0,20000), error, runtime:'pyodide ' + py.version});
};`;
const Runner = {
  workers:{}, pyReady:false, pyFailed:'',
  worker(kind){
    if (!this.workers[kind]) this.workers[kind] = new Worker(URL.createObjectURL(new Blob([kind==='py' ? PY_WORKER : JS_WORKER], {type:'text/javascript'})));
    return this.workers[kind];
  },
  kill(kind){ if (this.workers[kind]){ this.workers[kind].terminate(); delete this.workers[kind]; } if (kind === 'py') this.pyReady = false; },
  warm(onStatus){
    if (this.pyReady || this.pyFailed) return;
    const w = this.worker('py');
    w.onmessage = e => { if (e.data.progress) onStatus && onStatus(e.data.progress); if (e.data.ready){ this.pyReady = true; onStatus && onStatus(''); } if (e.data.pyFailed){ this.pyFailed = e.data.pyFailed; onStatus && onStatus('Python failed to load: ' + e.data.pyFailed); } };
    w.postMessage({warm:true});
  },
  run(lang, code, tests, entry, onProgress){
    const kind = lang === 'python' ? 'py' : 'js';
    if (kind === 'py' && this.pyFailed) return Promise.resolve({cases:[], stdout:'', error:'Python runtime failed to load: ' + this.pyFailed});
    return new Promise(resolve => {
      const w = this.worker(kind), timeoutMs = kind === 'py' && !this.pyReady ? 90000 : 10000;
      const timer = setTimeout(() => { this.kill(kind); resolve({cases:[], stdout:'', error:'Stopped after ' + Math.round(timeoutMs/1000) + ' seconds. Look for an infinite loop.'}); }, timeoutMs);
      w.onmessage = e => {
        if (e.data.progress){ onProgress && onProgress(e.data.progress); return; }
        if (e.data.ready){ this.pyReady = true; return; }
        clearTimeout(timer);
        if (e.data.pyFailed){ this.pyFailed = e.data.pyFailed; this.kill('py'); resolve({cases:[], stdout:'', error:'Python runtime failed to load: ' + e.data.pyFailed}); return; }
        resolve(e.data);
      };
      w.onerror = err => { clearTimeout(timer); this.kill(kind); resolve({cases:[], stdout:'', error:String(err.message || 'The runner crashed.')}); };
      w.postMessage({code, tests, entry});
    });
  },
};
function parseTests(text){
  const tests = [], errors = [];
  (text || '').split('\n').forEach((line, i) => {
    const s = line.trim(); if (!s || s.startsWith('#') || s.startsWith('//')) return;
    const k = s.lastIndexOf('=>');
    if (k < 0){ errors.push(`Line ${i+1}: expected "args => result".`); return; }
    try { let args = JSON.parse(s.slice(0,k).trim()); if (!Array.isArray(args)) args = [args]; tests.push({args, expected:canon(JSON.parse(s.slice(k+2).trim())), raw:s}); }
    catch(e){ errors.push(`Line ${i+1}: not valid JSON on one side of "=>".`); }
  });
  return {tests, errors};
}
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  if (typeof v === 'number') return String(Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Number(v.toFixed(9)));
  return JSON.stringify(v);
}
async function runGate(q, gate, code, onProgress){
  const {tests, errors} = parseTests(gate.tests);
  if (errors.length) return {error:'Test cases on this gate are malformed:\n' + errors.join('\n'), cases:[], passed:0, total:0};
  const t0 = performance.now();
  const r = await Runner.run(q.lang || 'python', code, tests, gate.entry || '', onProgress);
  const out = {runtime:r.runtime || '', error:r.error || '', stdout:r.stdout || '', passed:0, total:tests.length, cases:[], ms:Math.round(performance.now() - t0)};
  (r.cases || []).forEach((c, i) => {
    const t = tests[i]; let pass = false, got = '';
    if (c.err) got = c.err; else { try { got = canon(JSON.parse(c.got)); } catch(e){ got = String(c.got); } pass = got === t.expected; }
    if (pass) out.passed++;
    out.cases.push({raw:t.raw, pass, got, err:!!c.err, ms:c.ms});
  });
  return out;
}
async function runScript(q, code, onProgress){
  const t0 = performance.now();
  const r = await Runner.run(q.lang || 'python', code, [], '', onProgress);
  return {script:true, runtime:r.runtime || '', error:r.error || '', stdout:r.stdout || '', passed:0, total:0, cases:[], ms:Math.round(performance.now() - t0)};
}
function renderRun(r){
  const box = h('div',{class:'run-out'});
  const head = h('div',{class:'run-head'});
  if (r.error) head.append(h('span',{class:'fail', text:'Error'}));
  else head.append(h('span',{class:r.passed===r.total ? 'ok' : 'fail', text:`${r.passed} of ${r.total} passed`}));
  head.append(h('span',{class:'spacer'}), h('span',{class:'hist', text:[r.runtime, r.ms != null ? r.ms + ' ms' : ''].filter(Boolean).join(', ')}));
  box.append(head);
  if (r.error) box.append(h('pre',{class:'stdout err', text:r.error}));
  for (const g of r.cases || []) box.append(h('div',{class:'case ' + (g.pass ? 'pass' : 'fail')},
    h('span',{class:'st ' + (g.pass ? 'ok' : 'fail'), text:g.pass ? '✓' : '✗'}), h('pre',{text:g.raw}),
    !g.pass && h('span'), !g.pass && h('pre',{class:'got', text:(g.err ? 'threw: ' : 'got: ') + g.got})));
  if (r.stdout) box.append(h('pre',{class:'stdout', text:r.stdout}));
  return box;
}

/* ---------- editor ---------- */
/* ---------- editor: completion ---------- */
const PY_WORDS = ('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
  'abs all any ascii bin bool bytearray bytes callable chr classmethod complex dict dir divmod enumerate eval filter float format frozenset getattr globals hasattr hash hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip ' +
  'self cls __init__ __repr__ __str__ __eq__ __hash__ __lt__ __len__ __iter__ __next__ __getitem__ __setitem__ __contains__ __call__ __enter__ __exit__ __name__ __main__ ' +
  'collections defaultdict deque Counter OrderedDict namedtuple heapq heappush heappop heapify heappushpop heapreplace nlargest nsmallest bisect bisect_left bisect_right insort itertools permutations combinations product accumulate chain groupby functools lru_cache cache reduce partial math inf gcd sqrt floor ceil log2 isqrt random typing List Dict Set Tuple Optional Iterable Iterator Callable dataclasses dataclass field string ascii_lowercase ascii_uppercase digits re sys setrecursionlimit threading Lock RLock Condition Semaphore Event Thread queue Queue PriorityQueue time perf_counter json dumps loads Exception ValueError KeyError IndexError TypeError StopIteration RuntimeError NotImplementedError ZeroDivisionError').split(' ');
const PY_METHODS = ('append extend insert pop remove clear index count sort reverse copy ' +
  'keys values items get setdefault update popitem ' +
  'add discard union intersection difference symmetric_difference issubset issuperset isdisjoint ' +
  'split rsplit join strip lstrip rstrip lower upper title capitalize swapcase startswith endswith find rfind replace isdigit isalpha isalnum isspace isupper islower zfill center ljust rjust format encode decode partition rpartition splitlines ' +
  'popleft appendleft rotate most_common elements subtract bit_length to_bytes from_bytes real imag conjugate is_integer as_integer_ratio ' +
  'acquire release wait notify notify_all set is_set put get_nowait put_nowait empty full qsize task_done ' +
  'read write readline readlines close seek tell match search findall finditer sub group groups start end span fullmatch compile').split(' ');
const JS_WORDS = 'const let var function return if else for while do switch case break continue new class extends super this null undefined true false typeof instanceof async await yield import export default try catch finally throw Map Set Array Object Number String Boolean Promise JSON Math console parseInt parseFloat isNaN Infinity push pop shift unshift slice splice map filter reduce forEach find findIndex includes indexOf join sort reverse concat flat flatMap some every keys values entries has get set add delete size length toString toFixed charAt charCodeAt fromCharCode substring substr trim split replace padStart padEnd repeat startsWith endsWith localeCompare'.split(' ');
function codeHint(cm, lang){
  const cur = cm.getCursor(), line = cm.getLine(cur.line);
  const tok = cm.getTokenAt(cur);
  if (tok.type === 'comment' || tok.type === 'string') return null;
  let start = cur.ch; while (start > 0 && /[\w$]/.test(line.charAt(start - 1))) start--;
  const prefix = line.slice(start, cur.ch), afterDot = start > 0 && line.charAt(start - 1) === '.';
  if (!prefix && !afterDot) return null;
  const seen = new Set(), list = [];
  const push = w => { if (w && w !== prefix && !seen.has(w) && w.toLowerCase().startsWith(prefix.toLowerCase())){ seen.add(w); list.push(w); } };
  // Names from the file itself first (definitions, variables), then the language's own vocabulary.
  const text = cm.getValue(); const re = /[A-Za-z_$][\w$]{1,}/g; const own = new Map(); let m;
  while ((m = re.exec(text))) own.set(m[0], (own.get(m[0]) || 0) + 1);
  const ownSorted = [...own.entries()].sort((a,b) => b[1]-a[1]).map(e => e[0]);
  if (afterDot){ for (const w of (lang === 'python' ? PY_METHODS : JS_WORDS)) push(w); for (const w of ownSorted) push(w); }
  else { for (const w of ownSorted) push(w); for (const w of (lang === 'python' ? PY_WORDS : JS_WORDS)) push(w); }
  if (!list.length) return null;
  return {list:list.slice(0, 40), from:CodeMirror.Pos(cur.line, start), to:CodeMirror.Pos(cur.line, cur.ch)};
}
const EdPrefs = {get(){ try { return JSON.parse(localStorage.getItem('whetstone.editor') || '{}'); } catch(e){ return {}; } }, set(p){ try { localStorage.setItem('whetstone.editor', JSON.stringify({...this.get(), ...p})); } catch(e){} }};
/* An in-progress attempt survives reloads: snapshot every few seconds, restore on return. */
const Draft = {
  key:'whetstone.attempt',
  save(a){ if (!a || a.done) return; try { const {asking, nudging, busy, lastSub, ...rest} = a; localStorage.setItem(this.key, JSON.stringify({...rest, voice:false, savedAt:Date.now()})); } catch(e){} },
  load(){ try { const d = JSON.parse(localStorage.getItem(this.key) || 'null'); return d && d.qid && Date.now() - d.savedAt < 36e5 * 24 ? d : null; } catch(e){ return null; } },
  clear(){ try { localStorage.removeItem(this.key); } catch(e){} },
};
window.addEventListener('beforeunload', e => { if (S.attempt && !S.attempt.done){ Draft.save(S.attempt); e.preventDefault(); e.returnValue = 'An attempt is in progress.'; } });
function applyEditorFont(host, size){ host.style.setProperty('--ed-size', size + 'px'); }
function makeEditor(host, {value='', lang='python', onChange, placeholder='', readOnly=false, onRun, onSubmit, theme='default', onType}){
  if (window.CodeMirror){
    let silent = false;
    const prefs = EdPrefs.get(); applyEditorFont(host, prefs.fontSize || 13.5);
    const hint = c => c.showHint({hint:cm => codeHint(cm, lang), completeSingle:false, alignWithWord:true, closeCharacters:/[\s()\[\]{};:>,]/});
    const cm = window.CodeMirror(host, {
      value, mode:lang === 'python' ? 'python' : 'javascript', lineNumbers:true, indentUnit:lang === 'python' ? 4 : 2, tabSize:4, indentWithTabs:false,
      matchBrackets:true, autoCloseBrackets:!readOnly, placeholder, readOnly, theme, lineWrapping:readOnly || !!prefs.wrap,
      inputStyle:'contenteditable', spellcheck:false, autocorrect:false, autocapitalize:false,
      keyMap:readOnly ? 'default' : 'sublime', styleActiveLine:!readOnly, showTrailingSpace:!readOnly, highlightSelectionMatches:readOnly ? false : {minChars:3, wordsOnly:true, annotateScrollbar:true},
      foldGutter:!readOnly, gutters:readOnly ? ['CodeMirror-linenumbers'] : ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      extraKeys:{
        Tab: c => { if (c.somethingSelected()) return c.indentSelection('add'); const cur = c.getCursor(), before = c.getLine(cur.line).slice(0, cur.ch); if (/[\w$.]$/.test(before)) return hint(c); c.replaceSelection(' '.repeat(c.getOption('indentUnit')),'end'); },
        'Shift-Tab': c => c.indentSelection('subtract'), Esc: c => c.getInputField().blur(),
        'Ctrl-Space': hint, 'Alt-Space': hint,
        'Cmd-Enter': () => onRun && onRun(), 'Ctrl-Enter': () => onRun && onRun(),
        'Shift-Cmd-Enter': () => onSubmit && onSubmit(), 'Shift-Ctrl-Enter': () => onSubmit && onSubmit(),
        'Cmd-=': c => bumpFont(c, 1), 'Cmd--': c => bumpFont(c, -1), 'Ctrl-=': c => bumpFont(c, 1), 'Ctrl--': c => bumpFont(c, -1),
        'Alt-Z': c => { const w = !c.getOption('lineWrapping'); c.setOption('lineWrapping', w); EdPrefs.set({wrap:w}); },
      },
    });
    const bumpFont = (c, d) => { const s = Math.min(22, Math.max(10, (EdPrefs.get().fontSize || 13.5) + d)); EdPrefs.set({fontSize:s}); applyEditorFont(host, s); c.refresh(); };
    if (!readOnly){
      let hintT = null;
      cm.on('inputRead', (c, ch) => { if (!ch.text || ch.text.length !== 1) return; const s = ch.text[0]; if (!/[\w.]/.test(s) || c.state.completionActive) return; clearTimeout(hintT); hintT = setTimeout(() => { if (!c.state.completionActive) hint(c); }, s === '.' ? 0 : 160); });
    }
    const inp = cm.getInputField();
    inp.setAttribute('aria-label', readOnly ? 'Code' : 'Code editor. Press Escape to leave the editor.');
    // Keep password managers (iCloud Passwords, 1Password, LastPass, Bitwarden) off the editor's input.
    for (const [k,v] of Object.entries({autocomplete:'off', 'data-1p-ignore':'', 'data-lpignore':'true', 'data-bwignore':'', 'data-form-type':'other', name:'code-editor'})) inp.setAttribute(k, v);
    const stats = {chars:0, lastEditAt:0};
    cm.on('change', (c, ch) => { if (silent) return; if (ch.origin && (ch.origin.startsWith('+') || ch.origin === 'paste')){ stats.chars += ch.text.join('\n').length; stats.lastEditAt = Date.now(); if (onType) onType(stats); } if (onChange) onChange(cm.getValue()); });
    requestAnimationFrame(() => cm.refresh());
    return {get:() => cm.getValue(), set:v => { silent = true; cm.setValue(v); silent = false; }, focus:() => cm.focus(), lines:() => cm.lineCount()};
  }
  const ta = h('textarea',{class:'plain', spellcheck:'false', placeholder, 'aria-label':'Code editor', value, readonly:readOnly,
    oninput:() => onChange && onChange(ta.value),
    onkeydown:e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onRun){ e.preventDefault(); onRun(); } }});
  host.append(ta);
  return {get:() => ta.value, set:v => { ta.value = v; }, focus:() => ta.focus(), lines:() => ta.value.split('\n').length};
}

/* ---------- feedback ---------- */
function renderReview(fb){
  const dims = h('div',{class:'dims'}, DIMS.map(([k,label]) => h('div',{class:'dim'}, h('span',{text:label}), pips(fb.scores[k] || fb.overall))));
  const body = h('div',{class:'r-body'}, h('p',{class:'summary', text:fb.summary}));
  if (fb.issues && fb.issues.length) body.append(h('div',{class:'issues'}, fb.issues.map(i => h('div',{class:'issue sev-'+i.severity}, h('p',null, h('span',{class:'chip', text:(SKILLS[i.skill]||[i.skill])[0]}), i.note), i.fix && h('p',{class:'fix', text:i.fix})))));
  if (fb.strengths && fb.strengths.length) body.append(h('div',null, h('div',{class:'label', text:'What worked'}), h('ul',null, fb.strengths.map(s => h('li',{text:s})))));
  if (fb.gaps && fb.gaps.length) body.append(h('div',{class:'gaps'}, h('span',{class:'label', text:'Counted toward your weak areas:'}), fb.gaps.map(g => h('span',{class:'mark', text:(SKILLS[g]||[g])[0]}))));
  if (fb.nextStep) body.append(h('p',{class:'next'}, h('strong',{text:'Practise next: '}), fb.nextStep));
  if (fb.questionsToAsk && fb.questionsToAsk.length) body.append(h('div',null, h('div',{class:'label', text:'Questions a strong candidate would have asked'}), h('ul',null, fb.questionsToAsk.map(s => h('li',{text:s})))));
  if (fb.improvedCode && fb.improvedCode.trim()){
    const host = h('div',{class:'editor short pad-ed'});
    const det = h('details',{class:'improved', ontoggle:e => { if (e.target.open && !host.dataset.ready){ host.dataset.ready = '1'; makeEditor(host, {value:fb.improvedCode, lang:fb.lang || 'python', readOnly:true, theme:'pad'}); } }},
      h('summary',null, h('strong',{text:'How a strong candidate would have written it'}), h('span',{class:'hist', text:'  (click to expand; not loaded into your editor)'})),
      fb.whyBetter && fb.whyBetter.length && h('ul',{class:'why'}, fb.whyBetter.map(s => h('li',{text:s}))),
      host,
      h('div',{class:'row', style:'margin-top:8px'}, h('button',{class:'btn small', text:'Copy code', onclick:async e => { try { await navigator.clipboard.writeText(fb.improvedCode); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy code'; }, 1500); } catch(err){ toast('Copy failed; select the code and copy it.'); } }})));
    body.append(det);
  }
  return h('div',{class:'review'},
    h('div',{class:'verdict'},
      h('div',null, h('div',{class:'big'}, String(fb.overall), h('small',{text:' of 5'})), h('div',{style:'font-weight:600', text:VERDICT[fb.overall]})),
      h('div',{class:'cx'}, h('div',null, h('b',{text:'Time'}), fb.time || 'n/a'), h('div',null, h('b',{text:'Space'}), fb.space || 'n/a')),
      dims,
      h('div',{class:'hist', text:'Reviewed by Claude' + (fb.model ? ', ' + fb.model : '') + ', ' + fmtDate(fb.at)})),
    body);
}

/* ---------- routing ---------- */
function route(){
  const full = location.hash.replace(/^#\/?/, ''), hash = full.split('#')[0], anchor = full.split('#')[1] || '';
  const [p0, p1, p2] = hash.split('/');
  const r = routeOf(p0, p1, p2); r.anchor = anchor; return r;
}
function routeOf(p0, p1, p2){
  if (!p0) return {view:'questions'};
  if (p0 === 'analytics') return {view:'analytics', qid:p1};
  if (p0 === 'settings') return {view:'settings'};
  if (p0 === 'new') return {view:'edit'};
  if (p0 === 'drills') return {view:'drills'};
  if (p0 === 'gym') return p1 ? (p2 === 'go' ? {view:'try', gym:p1} : {view:'gym', gid:p1}) : {view:'gym'};
  if (p0 === 'q' && p1) return {view:p2 === 'edit' ? 'edit' : p2 === 'try' ? 'try' : 'question', qid:p1};
  return {view:'questions'};
}
window.addEventListener('hashchange', () => { if (S.attempt && !S.attempt.done && route().view !== 'try'){ if (!confirm('Leave this attempt? Unsubmitted code is kept in the editor only until you leave.')){ location.hash = '#/q/' + S.attempt.qid + '/try'; return; } Draft.clear(); } render(); });
function render(){
  const r = route(); S.view = r.view;
  for (const a of document.querySelectorAll('.tab')) a.toggleAttribute('aria-current', false), (a.dataset.view === r.view || (a.dataset.view === 'questions' && ['question','try','edit'].includes(r.view) && !r.gym && !(S.questions.get(r.qid) || {}).kind) || (a.dataset.view === 'gym' && r.view === 'try' && r.gym)) && a.setAttribute('aria-current','page');
  if (timerInt){ clearInterval(timerInt); timerInt = null; }
  curEditor = null; app.replaceChildren();
  if (S.loading){ app.append(h('div',{class:'loading', text:'Opening your notebook…'})); return; }
  if (r.view !== 'try'){ if (S.attempt && S.attempt.voice) Voice.stop(); S.attempt = null; document.body.classList.remove('in-pad'); }
  if (planInt){ clearInterval(planInt); planInt = null; }
  if (r.view === 'questions') renderQuestions();
  else if (r.view === 'question') renderQuestion(r.qid);
  else if (r.view === 'try'){ if (r.gym){ const g = S.gyms.find(x => x.id === r.gym); if (S.attempt && S.attempt.gym && S.attempt.gym.id === r.gym && !S.attempt.done){ renderTry(S.attempt.qid, S.attempt.gym); return; } const n = g ? gymStation(g) : -1; if (!g || n < 0){ location.hash = g ? '#/gym/' + g.id : '#/gym'; return; } renderTry(g.drillIds[n], {id:g.id, n}); } else renderTry(r.qid); }
  else if (r.view === 'gym') renderGym(r.gid);
  else if (r.view === 'edit') renderEdit(r.qid);
  else if (r.view === 'analytics') renderAnalytics(r.qid);
  else if (r.view === 'drills') renderDrills();
  else renderSettings();
  if (r.anchor){ requestAnimationFrame(() => { const el = document.getElementById(r.anchor); if (el) el.scrollIntoView({behavior:'smooth', block:'start'}); }); }
  else window.scrollTo(0,0);
}

/* ---------- questions list ---------- */
function renderQuestions(){
  const qs = [...S.questions.values()].filter(q => q.kind !== 'drill').sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  app.append(renderCountdown());
  const d = Draft.load();
  if (d && S.questions.get(d.qid)) app.append(h('div',{class:'resume-box'}, h('div',null, h('b',{text:`Unfinished attempt: ${S.questions.get(d.qid).title}`}), h('span',{class:'hist', text:` · part ${d.gi + 1}, ${fmtSec((d.savedAt - (d.pausedTotal || 0) - d.startedAt)/1000)} on the clock, saved ${fmtDateTime(new Date(d.savedAt).toISOString())}`})), h('span',{class:'spacer'}),
    h('a',{class:'btn primary small', href:'#/q/' + d.qid + '/try', text:'Pick it up'}), h('button',{class:'btn quiet small', text:'Discard', onclick:e => { if (confirm('Discard the unfinished attempt?')){ Draft.clear(); e.target.closest('.resume-box').remove(); } }})));
  app.append(h('div',{class:'page-head'}, h('div',null, h('h2',{text:'Questions'}), h('p',{text:'Each question is a sequence of gated parts, timed separately. Submit a part to store the code, its test result and the time it took.'}))));
  if (!qs.length){ app.append(h('div',{class:'none'}, 'No questions yet. ', h('a',{href:'#/new', text:'Add the first one'}), '.')); return; }
  const grid = h('div',{class:'qgrid'});
  for (const q of qs){
    const atts = attemptsOf(q.id), last = atts[atts.length-1];
    const best = atts.reduce((m,a) => Math.max(m, a.passed), 0);
    const quals = atts.map(a => a.quality).filter(x => x != null);
    const bar = h('div',{class:'gatebar', role:'img', 'aria-label':`${last ? last.passed : 0} of ${q.gates.length} parts passed in the latest attempt`}, q.gates.map(g => h('i',{class:last ? gateStatus(last.gates.get(g.id)) : ''})));
    grid.append(h('article',{class:'qcard'},
      h('h3',null, h('a',{href:'#/q/' + q.id, text:q.title})),
      h('div',{class:'qmeta'}, h('span',{class:'diff d-' + q.difficulty, text:q.difficulty[0].toUpperCase() + q.difficulty.slice(1)}), q.topic && h('span',{text:q.topic}), h('span',{text:`${q.gates.length} part${q.gates.length===1?'':'s'}`}), h('span',{text:LANGS[q.lang] || q.lang}), q.variantOf && h('span',{text:'variant of ' + ((S.questions.get(q.variantOf) || {}).title || q.variantOf)})),
      bar,
      h('div',{class:'stats'},
        h('div',{class:'stat'}, h('b',{text:last ? `${last.passed}/${q.gates.length}` : '–'}), h('span',{text:last ? 'parts passed, last attempt' : 'not attempted'})),
        h('div',{class:'stat'}, h('b',{text:last ? fmtSec(last.totalSec) : '–'}), h('span',{text:'time, last attempt'})),
        h('div',{class:'stat'}, h('b',{text:quals.length ? avg(quals).toFixed(1) : '–'}), h('span',{text:quals.length ? 'quality, avg of 5' : 'no feedback yet'}))),
      h('div',{class:'hist', text:atts.length ? `${atts.length} attempt${atts.length===1?'':'s'}, best ${best}/${q.gates.length}, last ${fmtDate(last.at)}` : 'Fresh'}),
      h('div',{class:'row'}, h('a',{class:'btn primary small', href:'#/q/' + q.id + '/try', text:atts.length ? 'Try again' : 'Start'}), h('a',{class:'btn small', href:'#/q/' + q.id, text:'History'}))));
  }
  app.append(grid);
}

function renderCountdown(){
  const plan = S.plan || DEFAULT_PLAN;
  const wrap = h('section',{class:'plan'}), outer = h('div',{class:'planwrap'}, h('div',{class:'row'}, h('h4',{text:'Upcoming interviews'}), h('span',{class:'spacer'}), h('a',{class:'hist', href:'#/settings', text:'Edit dates'})), wrap);
  const cards = [];
  const draw = () => {
    for (const {st, el} of cards){
      el.replaceChildren();
      if (!st.date){ el.append(h('b',{class:'tbd', text:'TBD'}), h('span',{text:st.note || ''})); continue; }
      const ms = new Date(st.date) - Date.now();
      if (ms <= -6*3600e3){ el.append(h('b',{class:'tbd', text:'Done'}), h('span',{text:fmtDateTime(st.date)})); continue; }
      if (ms <= 0){ el.append(h('b',{class:'now', text:'Now'}), h('span',{text:'go get it'})); continue; }
      const d = Math.floor(ms/864e5), hh = Math.floor(ms%864e5/36e5), mm = Math.floor(ms%36e5/6e4);
      const big = h('b',{class:d < 7 ? 'soon' : ''}); big.append(d ? h('span',null, String(d), h('small',{text:'d'})) : null, h('span',null, String(hh), h('small',{text:'h'})), h('span',null, String(mm), h('small',{text:'m'})));
      el.append(big, h('span',{text:new Date(st.date).toLocaleString(undefined,{weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) + (st.note ? ' · ' + st.note : '')}));
    }
  };
  for (const st of plan.stages || []){
    const el = h('div',{class:'count'});
    cards.push({st, el});
    wrap.append(h('div',{class:'stage' + (st.date ? '' : ' locked')}, h('h3',{text:`${plan.company ? plan.company + ' ' : ''}${st.name}`}), h('div',{class:'rounds'}, (st.rounds || []).map(r => h('span',{text:r}))), el));
  }
  draw(); if (planInt) clearInterval(planInt); planInt = setInterval(draw, 15000);
  return outer;
}

/* ---------- question detail / history ---------- */
async function renderQuestion(qid){
  const q = await fetchQuestion(qid); if (!q){ app.append(h('p',{class:'none', text:'That question is not in the index.'})); return; }
  if (S.view !== 'question') return;
  const atts = attemptsOf(qid).reverse();
  app.append(h('div',{class:'page-head'},
    h('div',null, h('a',{class:'btn quiet small', href:'#/', text:'All questions'}), h('h2',{style:'margin-top:8px', text:q.title}),
      h('p',{text:[q.topic, q.difficulty, q.source].filter(Boolean).join(', ')}), q.url && h('p',null, h('a',{href:q.url, target:'_blank', rel:'noopener', text:'Source'}))),
    h('div',{class:'row'}, h('a',{class:'btn primary', href:'#/q/' + qid + '/try', text:'Start an attempt'}), h('a',{class:'btn', href:'#/q/' + qid + '/edit', text:'Edit'}), h('a',{class:'btn', href:'#/analytics/' + qid, text:'Analytics'}),
      S.health && S.health.hasKey && h('button',{class:'btn', text:'Similar question', title:'Claude writes a new question in this style with a different scenario', onclick:async e => { e.target.disabled = true; e.target.textContent = 'Writing a similar question (1–3 min)…';
        try { const r = await API.call('POST', '/api/questions/' + encodeURIComponent(qid) + '/variant', {}); await loadIndex(); toast(r.report.ok ? 'New question verified and saved.' : 'New question saved; some tests did not verify, check its Edit page.'); location.hash = '#/q/' + r.question.id; }
        catch(err){ toast(err.message); e.target.disabled = false; e.target.textContent = 'Similar question'; } }}),
      h('button',{class:'btn quiet', text:'Delete', onclick:async () => { if (!confirm('Delete this question and every submission for it?')) return; try { await API.deleteQuestion(qid); await boot(); location.hash = '#/'; } catch(e){ toast(e.message); } }}))));
  if (q.overview){ const o = promptEl(q.overview); o.style.cssText = 'max-width:80ch;margin-bottom:18px'; app.append(o); }
  app.append(h('div',{class:'section'}, h('h3',{text:'Parts'}), h('table',null, h('thead',null, h('tr',null, h('th',{text:'#'}), h('th',{text:'Part'}), h('th',{text:'Entry'}), h('th',{class:'num', text:'Budget'}), h('th',{class:'num', text:'Tests'}))),
    h('tbody',null, q.gates.map((g,i) => h('tr',null, h('td',{text:i+1}), h('td',{text:g.title}), h('td',null, h('code',{text:g.entry || '–'})), h('td',{class:'num', text:g.minutes ? g.minutes + ' min' : '–'}), h('td',{class:'num', text:parseTests(g.tests).tests.length})))))));
  const sec = h('div',{class:'section'}, h('h3',{text:'Attempts'}));
  if (!atts.length) sec.append(h('p',{class:'none', text:'No attempts yet.'}));
  for (const a of atts){
    const tbl = h('table',null, h('thead',null, h('tr',null, h('th',{text:'Part'}), h('th',{class:'num', text:'Time on part'}), h('th',{class:'num', text:'Tests'}), h('th',{class:'num', text:'Quality'}), h('th',{text:'Gaps'}), h('th',{text:''}))),
      h('tbody',null, q.gates.map((g,i) => { const s = a.gates.get(g.id); return h('tr',null, h('td',{text:`${i+1}. ${g.title}`}),
        h('td',{class:'num', text:s ? fmtSec(s.gateSec) : '–'}),
        h('td',{class:'num ' + (s ? (gateStatus(s) === 'pass' ? 'ok' : 'fail') : ''), text:s ? (s.total ? `${s.passed}/${s.total}` : 'not run') : 'not reached'}),
        h('td',{class:'num', text:s && s.feedback ? s.feedback.overall + '/5' : s && (s.status === 'grading' || s.status === 'reviewing') ? 'pending' : '–'}),
        h('td',{text:s && s.feedback ? s.feedback.gaps.map(x => (SKILLS[x]||[x])[0]).join(', ') : ''}),
        h('td',null, s && h('button',{class:'link', text:'Open', onclick:() => openSubmission(q, g, i, s)}))); })));
    const lastGate = q.gates.reduce((m, g, i) => a.gates.get(g.id) ? i : m, -1);
    sec.append(h('div',{class:'row', style:'margin-top:8px'}, h('h4',{text:`${fmtDateTime(a.at)}: ${a.passed}/${q.gates.length} parts, ${fmtSec(a.totalSec)}${a.quality != null ? ', quality ' + a.quality.toFixed(1) : ''}`}), h('span',{class:'spacer'}),
      h('button',{class:'btn small', text:'Resume from here', title:'New attempt with this code loaded, starting at the next part', onclick:async () => { const last = a.gates.get(q.gates[lastGate].id); const full = await fetchSubmission(last); S.resume = {qid, code:full.code || '', gi:Math.min(lastGate + (gateStatus(last) === 'pass' ? 1 : 0), q.gates.length - 1), reached:Math.min(lastGate + 1, q.gates.length - 1), from:a.id}; location.hash = '#/q/' + qid + '/try'; }})), tbl);
  }
  app.append(sec);
}
async function openSubmission(q, gate, gi, s){
  const full = await fetchSubmission(s);
  const box = h('div',{class:'section', id:'subview'}, h('div',{class:'row'}, h('h3',{text:`Submission for part ${gi+1}, ${fmtDateTime(s.at)}`}), h('span',{class:'spacer'}), h('button',{class:'btn quiet small', text:'Close', onclick:() => box.remove()})));
  const ed = h('div',{class:'editor', style:'height:clamp(200px,40vh,480px)'}); box.append(ed);
  if (full.browser) box.append(h('div',null, h('div',{class:'label', text:'In the browser'}), renderRun(full.browser)));
  if (full.cpython) box.append(h('div',{class:'cpy'}, h('div',{class:'label', text:'In CPython (server)'}), renderRun(full.cpython)));
  const fbHost = h('div');
  const showStatus = () => { fbHost.replaceChildren(); if (s.feedback) fbHost.append(renderReview(s.feedback));
    else if (full.status === 'grading' || full.status === 'reviewing') fbHost.append(h('div',{class:'thinking'}, h('span',{class:'dot'}), full.status === 'grading' ? 'Grading in CPython…' : 'Claude is reviewing this part…'));
    else fbHost.append(h('div',{class:'row'}, h('span',{class:'hist', text:full.status === 'review-failed' ? 'The review failed: ' + (full.reviewError || 'unknown error') : S.health && S.health.hasKey ? 'No review yet.' : 'Reviews are off: see Settings for how to turn them on.'}),
      S.health && S.health.hasKey && h('button',{class:'btn primary small', text:'Review with Claude now', onclick:async e => { e.target.disabled = true; fbHost.replaceChildren(h('div',{class:'thinking'}, h('span',{class:'dot'}), 'Claude is reading this submission…'));
        try { const fb = await API.review(s.id); s.feedback = fb; applySubmissionUpdate({...full, feedback:fb, status:'done'}); fbHost.replaceChildren(renderReview(fb)); } catch(err){ fbHost.replaceChildren(h('p',{class:'fail', text:err.message})); } }}))); };
  showStatus();
  if (!s.feedback && (full.status === 'grading' || full.status === 'reviewing')) waitForEval(s.id, f => { Object.assign(full, f); s.feedback = f.feedback; showStatus(); if (f.cpython && !box.querySelector('.cpy')) box.insertBefore(h('div',{class:'cpy'}, h('div',{class:'label', text:'In CPython (server)'}), renderRun(f.cpython)), fbHost); });
  box.append(fbHost);
  const old = $('#subview'); old ? old.replaceWith(box) : app.append(box);
  makeEditor(ed, {value:full.code || '(code not available offline)', lang:q.lang, readOnly:true});
  box.scrollIntoView({behavior:'smooth', block:'start'});
}

/* ---------- try (interview pad) ---------- */
async function renderTry(qid, gym){
  const q = await fetchQuestion(qid); if (!q){ app.append(h('p',{class:'none', text:'That question is not in the index.'})); return; }
  if (S.view !== 'try') return;
  if (S.attempt && gym && (!S.attempt.gym || S.attempt.gym.id !== gym.id || S.attempt.gym.n !== gym.n)) S.attempt = null;
  if (!S.attempt || S.attempt.qid !== qid){
    const prev = attemptsOf(qid); const lastSub = prev.length ? prev[prev.length-1].subs.slice(-1)[0] : null;
    const rs = S.resume && S.resume.qid === qid ? S.resume : null; S.resume = null;
    const d = !rs && Draft.load();
    if (d && d.qid === qid){
      const gap = Date.now() - d.savedAt;
      S.attempt = {...d, lastSub, done:false, pausedAt:0, pausedTotal:(d.pausedTotal || 0) + (d.pausedAt ? d.savedAt - d.pausedAt : 0) + gap, asking:false, nudging:false, voice:false};
      for (const s of Object.values(S.attempt.subs || {})) if (s.pending) waitForEval(s.id, full => { Object.assign(s, {feedback:full.feedback, cpython:full.cpython, reviewError:full.reviewError, pending:null}); if (S.attempt && S.attempt.tab === 'feedback') renderPadLeft(q); });
      toast(`Restored your attempt after a reload; the ${fmtSec(gap/1000)} away did not count. Part ${S.attempt.gi + 1}, ${fmtSec((Date.now() - S.attempt.pausedTotal - S.attempt.startedAt)/1000)} on the clock.`);
      if (gym) S.attempt.gym = gym;
    } else if (d && d.qid !== qid && !confirm(`You have an unfinished attempt on "${(S.questions.get(d.qid) || {}).title || d.qid}" from a reload. Starting this one discards it. Continue?`)){ location.hash = '#/q/' + d.qid + '/try'; return; }
    else {
    Draft.clear();
    S.attempt = {qid, id:gym ? gym.id : tsId(), gym:gym || null, startedAt:Date.now(), gi:rs ? rs.gi : 0, gateStartedAt:Date.now(), gateAcc:{}, code:rs ? rs.code : '', results:{}, subs:{}, lastSub, done:false, pausedAt:0, pausedTotal:0, tab:'question', console:[], reached:rs ? rs.reached : 0, chats:{}, resumedFrom:rs ? rs.from : null, typing:{}, lastEditAt:0, lastSpokeAt:0, nudged:{}, lastNudgeAt:0, lastStuckCheckAt:0, lastStuckCode:'', voice:false};
    }
    if (rs) toast(`Resumed with your code from ${fmtDateTime(rs.from.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'))}; starting at part ${S.attempt.gi + 1}.`);
    if (q.lang === 'python') Runner.warm(m => { const el = $('#pyStatus'); if (el) el.textContent = m; });
  }
  document.body.classList.add('in-pad');
  const a = S.attempt, gate = q.gates[a.gi];
  const now = () => (a.pausedAt || Date.now()) - a.pausedTotal;
  const tAll = h('span',{class:'timer'}), tGate = h('span',{class:'timer'});
  const typ = () => a.typing[gate.id] = a.typing[gate.id] || {chars:0, activeSec:0};
  const tick = () => {
    const all = (now() - a.startedAt)/1000, g = (a.gateAcc[a.gi] || 0) + (now() - a.gateStartedAt)/1000;
    tAll.textContent = fmtSec(all); tGate.textContent = fmtSec(g);
    if (!a.pausedAt && a.lastEditAt && Date.now() - a.lastEditAt < 5000) typ().activeSec++;
    const st = $('#typeStat'); if (st){ const ty = typ(); const cpm = ty.activeSec >= 5 ? Math.round(ty.chars / (ty.activeSec/60)) : null; st.textContent = `${curEditor ? curEditor.lines() : 0} lines` + (cpm != null ? ` · ${cpm} cpm` : ''); }
    tGate.classList.toggle('over', !!gate.minutes && g > gate.minutes*60);
    const budget = q.gates.reduce((s,x) => s + (x.minutes||0), 0); tAll.classList.toggle('over', !!budget && all > budget*60);
    if (!a.pausedAt && !a.subs[gate.id]) maybeNudge(q, g);
    if (Math.floor(all) % 5 === 0){ a.code = curEditor ? curEditor.get() : a.code; Draft.save(a); }
  };
  const nudged = () => a.nudged[gate.id] = a.nudged[gate.id] || {};
  const pushNudge = (reason, kind, text) => {
    const chat = a.chats[gate.id] = a.chats[gate.id] || [];
    chat.push({role:'interviewer', kind:'nudge', reason, text, at:Date.now()});
    a.lastNudgeAt = Date.now();
    toast('Interviewer: ' + text); speak(text);
    if (S.attempt === a && a.tab === 'ask') renderPadLeft(q); const b = $('#askCount'); if (b){ b.textContent = String(chat.filter(m => m.role === 'you' || m.kind === 'nudge').length); b.hidden = false; }
  };
  const maybeNudge = (q, g) => {
    const n = nudged(), budget = (gate.minutes || 0) * 60, nowT = Date.now();
    if (budget){
      for (const [key, frac] of [['time50', 0.5], ['time80', 0.8], ['time100', 1]]){
        if (!n[key] && g >= budget * frac){ n[key] = true; const left = Math.ceil(Math.max(0, budget - g) / 60);
          if (key === 'time100') pushNudge('time100', 'time', "We're at time for this part. Wrap up what you have, or tell me what you'd do and we move on.");
          else if (key === 'time80') pushNudge('time80', 'time', left <= 1 ? 'Under a minute left on this one.' : `About ${left} minutes left on this one.`);
          else if (key === 'time50' && !(curEditor ? curEditor.get() : a.code).trim()) pushNudge('time50', 'time', `We're halfway through the time for this part.`);
          return; } }
    }
    if (!(S.health && S.health.hasKey) || a.nudging) return;
    const lastActive = Math.max(a.lastEditAt || 0, a.lastSpokeAt || 0, a.gateStartedAt);
    const idleSec = (nowT - lastActive) / 1000, inPart = g;
    if (idleSec >= 240 && inPart >= 180 && nowT - a.lastNudgeAt > 300000){ a.lastNudgeAt = nowT; askNudge('idle'); return; }
    const code = curEditor ? curEditor.get() : a.code;
    if (inPart >= 360 && nowT - a.lastStuckCheckAt > 360000 && nowT - a.lastNudgeAt > 240000 && code.trim() && code !== a.lastStuckCode){ a.lastStuckCheckAt = nowT; a.lastStuckCode = code; askNudge('stuck-check'); }
  };
  const askNudge = async reason => {
    a.nudging = true;
    try { const r = await API.call('POST', '/api/interview/nudge', {questionId:q.id, gateId:gate.id, history:chatHistory(a.chats[gate.id] || []), code:curEditor ? curEditor.get() : a.code, elapsedSec:Math.round((a.gateAcc[a.gi] || 0) + (now() - a.gateStartedAt)/1000), budgetSec:(gate.minutes || 0) * 60, reason});
      if (S.attempt === a && !a.subs[gate.id] && r && r.text && r.kind !== 'none') pushNudge(r.kind, r.kind, r.text); }
    catch(e){ /* a silent interviewer is still an interviewer */ }
    a.nudging = false;
  };
  tick(); timerInt = setInterval(tick, 1000);
  const gatesNav = h('div',{class:'gates', role:'tablist'}, q.gates.map((g,i) => { const locked = i > a.reached; return h('button',{class:'gate' + (locked ? ' locked' : ''), role:'tab', disabled:locked, 'aria-current':i === a.gi ? 'true' : null, title:locked ? `Part ${i+1} is revealed when you submit part ${i}` : g.title, onclick:() => switchGate(q, i)}, h('span',{class:'pip ' + gateStatus(a.subs[g.id])}), locked ? `${i+1} 🔒` : `${i+1}`); }));
  const hasNext = a.gi < q.gates.length - 1, submittedHere = !!a.subs[gate.id];
  const topbar = h('div',{class:'padbar'},
    h('a',{class:'btn quiet small', href:a.gym ? '#/gym/' + a.gym.id : '#/q/' + qid, text:'← ' + (a.gym ? `Gym ${a.gym.n + 1}/${(S.gyms.find(x => x.id === a.gym.id) || {drillIds:[]}).drillIds.length}: ` : '') + (q.title.length > 38 ? q.title.slice(0,36) + '…' : q.title)}),
    gatesNav,
    h('span',{class:'spacer'}),
    h('div',{class:'timers'}, h('div',null, tGate, h('small',{text:`part ${a.gi+1}${gate.minutes ? ' / ' + gate.minutes + ' min' : ''}`})), h('div',null, tAll, h('small',{text:'total'}))),
    h('button',{class:'btn quiet small', id:'pauseBtn', text:a.pausedAt ? 'Resume' : 'Pause', onclick:() => { if (a.pausedAt){ a.pausedTotal += Date.now() - a.pausedAt; a.pausedAt = 0; } else a.pausedAt = Date.now(); $('#pauseBtn').textContent = a.pausedAt ? 'Resume' : 'Pause'; tick(); }}),
    hasNext && submittedHere && h('button',{class:'btn small', text:'Next part →', title:'Move on like an interviewer would, even if tests still fail', onclick:() => advanceGate(q)}),
    a.gym ? (submittedHere ? h('button',{class:'btn primary small', text:gymIsLast(a.gym) ? 'Finish session →' : 'Next drill →', onclick:() => gymAdvance(q)}) : h('button',{class:'btn quiet small', text:'Leave session', onclick:() => finishAttempt(q)})) : h('button',{class:'btn quiet small', text:'Finish', onclick:() => finishAttempt(q)}));
  const chatN = (a.chats[gate.id] || []).filter(m => m.role === 'you' || m.kind === 'nudge').length;
  const tabs = h('div',{class:'ptabs'},
    h('button',{class:'ptab', 'aria-current':a.tab === 'question' ? 'true' : null, text:'Question', onclick:() => { a.tab = 'question'; render(); }}),
    h('button',{class:'ptab', 'aria-current':a.tab === 'ask' ? 'true' : null, onclick:() => { a.tab = 'ask'; render(); }}, 'Interviewer', h('span',{class:'count', id:'askCount', text:chatN ? String(chatN) : '', hidden:!chatN})),
    h('button',{class:'ptab', 'aria-current':a.tab === 'feedback' ? 'true' : null, onclick:() => { a.tab = 'feedback'; render(); }}, 'Feedback', Object.keys(a.subs).length ? h('span',{class:'count', text:String(Object.keys(a.subs).length)}) : null));
  const left = h('aside',{class:'padleft'}, tabs, h('div',{class:'padscroll', id:'padleft'}));
  const edHost = h('div',{class:'editor pad-ed'});
  const console_ = h('div',{class:'console', id:'console'});
  const right = h('section',{class:'padright'},
    h('div',{class:'edbar'}, h('span',{class:'lang', text:LANGS[q.lang] || q.lang}), h('span',{class:'hist', id:'typeStat', title:'Lines in the editor · characters typed per active minute'}), h('span',{class:'hist', id:'pyStatus'}), h('span',{class:'spacer'}),
      Voice.supported() && h('button',{class:'btn quiet small mic' + (a.voice ? ' on' : ''), id:'micBtn', title:'Talk to the interviewer: ask a question, or just say what you are doing as you code. Click again to stop.', onclick:() => toggleVoice(q)}, a.voice ? '● Listening' : '🎙 Talk'),
      h('span',{class:'hist', id:'micLive', 'aria-live':'polite'}),
      a.lastSub && !a.code && h('button',{class:'btn quiet small', text:'Load my last submission', onclick:async () => { const f = await fetchSubmission(a.lastSub); if (f.code){ a.code = f.code; curEditor.set(f.code); } }}),
      h('button',{class:'btn run', id:'runBtn', onclick:() => runCurrent(q)}, '▶ Run ', h('kbd',{text:'⌘↵'})),
      h('button',{class:'btn primary', id:'submitBtn', onclick:() => submitCurrent(q)}, `Submit part ${a.gi+1} `, h('kbd',{text:'⇧⌘↵'}))),
    edHost, console_);
  app.append(topbar, h('div',{class:'pad'}, left, right));
  renderPadLeft(q);
  curEditor = makeEditor(edHost, {value:a.code, lang:q.lang, theme:'pad', placeholder:'# Build on the same file through the parts.\n# Your own tests go under: if __name__ == "__main__":', onChange:v => { a.code = v; }, onRun:() => runCurrent(q), onSubmit:() => submitCurrent(q), onType:st => { typ().chars += st.chars - (typ()._seen || 0); typ()._seen = st.chars; a.lastEditAt = st.lastEditAt; }});
  renderConsole();
  curEditor.focus();
}
const chatHistory = chat => chat.map(m => ({role:m.role, text:m.text, kind:m.kind || undefined, reason:m.reason || undefined}));
const looksLikeQuestion = t => /\?\s*$/.test(t) || /^(what|why|how|can|could|should|is|are|do|does|did|will|would|which|where|when|may|am)\b/i.test(t) || /\b(assume|assuming|okay to|allowed to|right\?)\b/i.test(t);
async function sayToInterviewer(q, text, spoken){
  const a = S.attempt; if (!a) return; const gate = q.gates[a.gi];
  const chat = a.chats[gate.id] = a.chats[gate.id] || [];
  const kind = looksLikeQuestion(text) ? 'ask' : 'say';
  chat.push({role:'you', kind:kind === 'say' ? 'say' : undefined, text, at:Date.now()});
  a.lastSpokeAt = Date.now();
  const badge = $('#askCount'); if (badge){ badge.textContent = String(chat.filter(m => m.role === 'you' || m.kind === 'nudge').length); badge.hidden = false; }
  if (!(S.health && S.health.hasKey)){ if (kind === 'ask') toast('The interviewer needs Claude on the server to answer: see Settings. Your message is logged.'); if (a.tab === 'ask') renderPadLeft(q); return; }
  a.asking = true; if (a.tab === 'ask') renderPadLeft(q);
  try { const r = await API.call('POST', '/api/interview/ask', {questionId:q.id, gateId:gate.id, history:chatHistory(chat), code:curEditor ? curEditor.get() : a.code}); const ans = r.answer || '(no answer)'; chat.push({role:'interviewer', text:ans, at:Date.now()}); if (spoken) speak(ans); else if (a.tab !== 'ask') toast('Interviewer: ' + ans); }
  catch(err){ chat.push({role:'interviewer', text:'(The interviewer could not answer: ' + err.message + ')', at:Date.now()}); }
  a.asking = false; if (S.attempt === a && a.tab === 'ask') renderPadLeft(q);
}
/* voice: browser speech recognition in, speech synthesis out; nothing leaves the machine except through the browser's own speech service */
const Voice = {
  rec:null,
  supported(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  start(onFinal, onInterim, onEnd){
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return false;
    const rec = this.rec = new R(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    let buf = '', timer = null;
    const flush = () => { const t = buf.trim(); buf = ''; if (t) onFinal(t); };
    rec.onresult = e => { let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) buf += ' ' + r[0].transcript; else interim += r[0].transcript; }
      onInterim(interim || buf.trim()); clearTimeout(timer); if (buf.trim()) timer = setTimeout(flush, 1200); };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('The browser blocked the microphone. Allow it for this site and try again.'); };
    rec.onend = () => { flush(); if (this.rec === rec && this.keep){ try { rec.start(); return; } catch(e){} } if (this.rec === rec){ this.rec = null; onEnd(); } };
    this.keep = true; try { rec.start(); } catch(e){ toast('Could not start listening: ' + e.message); this.rec = null; return false; }
    return true;
  },
  stop(){ this.keep = false; const r = this.rec; if (r){ try { r.stop(); } catch(e){} } },
};
function speak(text){ const a = S.attempt; if (!a || !a.voice || !window.speechSynthesis) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch(e){} }
function toggleVoice(q){
  const a = S.attempt; if (!a) return;
  const btn = $('#micBtn'), live = $('#micLive');
  if (a.voice){ Voice.stop(); a.voice = false; if (btn){ btn.textContent = '🎙 Talk'; btn.classList.remove('on'); } if (live) live.textContent = ''; return; }
  const ok = Voice.start(t => { if (live) live.textContent = ''; if (speechSynthesis && speechSynthesis.speaking) return; sayToInterviewer(q, t, true); },
    t => { if (live) live.textContent = t ? '“' + t.slice(-80) + '”' : ''; },
    () => { a.voice = false; const b = $('#micBtn'); if (b){ b.textContent = '🎙 Talk'; b.classList.remove('on'); } });
  if (!ok) return;
  a.voice = true; btn.textContent = '● Listening'; btn.classList.add('on');
  toast('Listening. Ask the interviewer anything, or just narrate what you are doing; the interviewer answers out loud.');
}
function renderPadLeft(q){
  const a = S.attempt, host = $('#padleft'); if (!a || !host) return;
  const gate = q.gates[a.gi];
  host.replaceChildren(); host.classList.toggle('chatmode', a.tab === 'ask');
  if (a.tab === 'question'){
    put(host, h('h3',{text:`Part ${a.gi+1} of ${q.gates.length}: ${gate.title}`}), a.gi > 0 && h('p',{class:'hist', text:'Follow-up. Build on your current code; earlier parts should keep working.'}), promptEl(gate.prompt));
    if (a.gi < q.gates.length - 1) host.append(h('p',{class:'hist', text:`${q.gates.length - a.gi - 1} more part${q.gates.length - a.gi - 1 === 1 ? '' : 's'} follow; each is revealed when you submit the one before it.`}));
    put(host, h('p',{class:'hist', text:gate.entry ? `Define ${gate.entry}(...) at top level; hidden tests call it when you submit. Your own tests go under if __name__ == "__main__": and Run executes them.` : 'No entry function set on this part.'}), !!gate.spec && h('p',{class:'hist', text:'Details are deliberately left out. Use the Interviewer tab (or Talk) for anything unclear; your questions count toward the grade.'}));
    if (a.gi > 0) host.append(h('details',{class:'earlier'}, h('summary',{text:'Earlier parts'}), q.gates.slice(0, a.gi).map((g,i) => h('div',null, h('h4',{text:`Part ${i+1}: ${g.title}`}), promptEl(g.prompt, 'prompt small')))));
    if (q.overview) host.append(h('details',{class:'earlier', open:a.gi === 0}, h('summary',{text:'Overview'}), promptEl(q.overview, 'prompt small')));
  } else if (a.tab === 'ask'){
    const chat = a.chats[gate.id] = a.chats[gate.id] || [];
    const log = h('div',{class:'chatlog'});
    if (!chat.length) log.append(h('p',{class:'hist', text:'The prompt leaves things unstated on purpose. Ask the way you would in the room: input sizes, empty input, ties, what to return when something is missing, whether you may assume something. What you ask is part of the grade.'}));
    for (const m of chat) log.append(h('div',{class:'msg ' + m.role + (m.kind === 'nudge' ? ' nudge' : m.kind === 'say' ? ' say' : '')}, h('span',{class:'who', text:m.role === 'you' ? (m.kind === 'say' ? 'You, aloud' : 'You') : m.kind === 'nudge' ? 'Interviewer, unprompted' + (m.reason ? ' · ' + ({time50:'time check', time80:'time check', time100:'time', idle:'idle', stuck:'stuck'}[m.reason] || m.reason) : '') : 'Interviewer'}), h('span',{class:'txt', text:m.text})));
    if (a.asking) log.append(h('div',{class:'msg interviewer'}, h('span',{class:'who', text:'Interviewer'}), h('span',{class:'txt thinking-txt', text:'…'})));
    const box = h('textarea',{rows:'2', placeholder:'Ask a question, or say what you are about to do…', onkeydown:e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); } }});
    const send = () => { const text = box.value.trim(); if (!text) return; box.value = ''; sayToInterviewer(q, text, false); };
    host.append(log, h('div',{class:'row'}, box, h('button',{class:'btn primary small', text:'Send', onclick:send})), h('p',{class:'hist', text:Voice.supported() ? 'Or press 🎙 Talk above the editor and speak; questions get answered, narration gets a nod. Nudges the interviewer gives without being asked are logged here and count against you.' : 'This browser has no speech recognition; Chrome or Safari do. Nudges the interviewer gives without being asked are logged here and count against you.'}));
    log.scrollTop = log.scrollHeight;
  } else {
    const ids = q.gates.map(g => g.id).filter(id => a.subs[id]);
    if (!ids.length) host.append(h('p',{class:'none', text:'Submit a part and its review shows here.'}));
    for (const id of ids.reverse()){
      const sub = a.subs[id], gi = q.gates.findIndex(g => g.id === id);
      host.append(h('h3',{text:`Part ${gi+1}: ${q.gates[gi].title}`}), h('p',{class:'hist', text:`${fmtSec(sub.gateSec)}, ${sub.browser && sub.browser.total ? sub.browser.passed + '/' + sub.browser.total + ' tests' : 'not run'}, ${(sub.chat || []).filter(m => m.role === 'you' && m.kind !== 'say').length} question(s) asked, ${(sub.chat || []).filter(m => m.kind === 'say').length} said aloud, ${(sub.chat || []).filter(m => m.kind === 'nudge').length} nudge(s)`}));
      if (sub.feedback) host.append(renderReview(sub.feedback));
      else if (sub.reviewError) host.append(h('p',{class:'fail', text:'Review failed: ' + sub.reviewError}));
      else if (sub.pending) host.append(h('div',{class:'thinking'}, h('span',{class:'dot'}), sub.pending));
      else host.append(h('p',{class:'hist', text:'No review for this part.'}));
    }
  }
}
function renderConsole(){
  const a = S.attempt, c = $('#console'); if (!a || !c) return;
  c.replaceChildren();
  if (!a.console.length){ c.append(h('div',{class:'cline muted', text:'Run executes your file as a script: write your own tests (asserts, prints, a main block) and see the output here. ⌘↵ runs, ⇧⌘↵ submits; submit grades against hidden tests and reviews your approach, code and tests.'}), h('div',{class:'cline muted', text:'Editor: completions as you type (Tab or ⌃Space to open, ↵ to accept), ⌘D select next occurrence, ⌘/ comment, ⌘F find, ⌥⌘F replace, ⌥↑↓ move line, ⇧⌘D duplicate line, ⌘= / ⌘- font size, ⌥Z wrap.'})); return; }
  for (const item of a.console.slice(-6)){
    if (item.kind === 'busy'){ c.append(h('div',{class:'cline'}, h('span',{class:'dot'}), ' ' + item.text)); continue; }
    const r = item.r;
    const status = r.error ? h('span',{class:'fail', text:r.script ? 'Error' : 'Hidden tests: error'}) : r.script ? h('span',{class:'ok', text:'Ran'}) : h('span',{class:r.passed === r.total ? 'ok' : 'fail', text:`Hidden tests: ${r.passed} of ${r.total} passed`});
    c.append(h('div',{class:'cline head'}, h('span',{class:'muted', text:item.when + '  '}), status, h('span',{class:'muted', text:'   ' + [r.runtime, r.ms != null ? r.ms + ' ms' : ''].filter(Boolean).join(', ')})));
    if (r.error) c.append(h('pre',{class:'cpre fail', text:r.error}));
    for (const g of r.cases || []) c.append(h('div',{class:'cline ' + (g.pass ? 'ok' : 'fail')}, (g.pass ? '✓ ' : '✗ ') + g.raw, !g.pass && h('span',{class:'got', text:'   ' + (g.err ? 'threw: ' : 'got: ') + g.got})));
    if (r.stdout) c.append(h('pre',{class:'cpre', text:r.stdout}));
    else if (r.script && !r.error) c.append(h('div',{class:'cline muted', text:'(no output; print or assert in your own test block to see something here)'}));
  }
  c.scrollTop = c.scrollHeight;
}
function advanceGate(q){
  const a = S.attempt; if (a.gi >= q.gates.length - 1) return;
  a.reached = Math.max(a.reached, a.gi + 1);
  switchGate(q, a.gi + 1);
}
function switchGate(q, i){
  const a = S.attempt; if (i === a.gi || i > a.reached) return;
  a.code = curEditor ? curEditor.get() : a.code;
  const nowMs = (a.pausedAt || Date.now()) - a.pausedTotal;
  a.gateAcc[a.gi] = (a.gateAcc[a.gi] || 0) + (nowMs - a.gateStartedAt)/1000;
  a.gi = i; a.gateStartedAt = nowMs; a.tab = 'question'; render();
}
async function runCurrent(q, hidden){
  const a = S.attempt, gate = q.gates[a.gi], btn = $('#runBtn'); if (!$('#console') || a.busy) return null;
  a.code = curEditor.get(); a.busy = true; btn.disabled = true;
  a.console.push({kind:'busy', text:hidden ? 'Checking against the hidden tests…' : 'Running your file…'}); renderConsole();
  const prog = m => { const last = a.console[a.console.length-1]; if (last && last.kind === 'busy'){ last.text = m; renderConsole(); } };
  const r = hidden ? await runGate(q, gate, a.code, prog) : await runScript(q, a.code, prog);
  a.busy = false; if (hidden) a.results[gate.id] = r;
  a.console = a.console.filter(x => x.kind !== 'busy'); a.console.push({kind:'run', r, when:new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'})});
  if (S.attempt === a && $('#console')){ renderConsole(); $('#runBtn').disabled = false; }
  return r;
}
async function submitCurrent(q){
  const a = S.attempt, gate = q.gates[a.gi]; if (a.busy) return;
  a.code = curEditor.get();
  if (a.code.trim().length < 10){ toast('Write something first.'); return; }
  const sb = $('#submitBtn'); sb.disabled = true;
  const r = await runCurrent(q, true);
  const nowMs = (a.pausedAt || Date.now()) - a.pausedTotal;
  const sub = {id:tsId() + '-' + gate.id, questionId:q.id, gateId:gate.id, attemptId:a.id, at:new Date().toISOString(), lang:q.lang, code:a.code, lines:a.code.split('\n').length,
    elapsedSec:Math.round((nowMs - a.startedAt)/1000), gateSec:Math.round((a.gateAcc[a.gi] || 0) + (nowMs - a.gateStartedAt)/1000),
    chat:chatHistory(a.chats[gate.id] || []), resumedFrom:a.resumedFrom || undefined,
    typedChars:(a.typing[gate.id] || {}).chars || 0, activeSec:(a.typing[gate.id] || {}).activeSec || 0, cpm:(a.typing[gate.id] && a.typing[gate.id].activeSec >= 5) ? Math.round(a.typing[gate.id].chars / (a.typing[gate.id].activeSec/60)) : null,
    browser:r ? {passed:r.passed, total:r.total, runtime:r.runtime, error:r.error || '', cases:r.cases.map(c => ({raw:c.raw, pass:c.pass, got:c.got, err:c.err}))} : null};
  a.subs[gate.id] = sub;
  const saved = await saveSubmission(sub);
  toast(`Part ${a.gi+1} submitted: ${r.error ? 'did not run' : r.passed + ' of ' + r.total + ' tests'}, ${fmtSec(sub.gateSec)}.`);
  if (saved && S.health){
    sub.pending = S.health.hasKey ? 'Grading in CPython, then Claude reviews it…' : 'Grading in CPython…';
    waitForEval(sub.id, full => {
      if (full.feedback){ sub.feedback = {...full.feedback, lang:q.lang}; sub.pending = ''; }
      if (full.status === 'review-failed'){ sub.reviewError = full.reviewError || 'unknown error'; sub.pending = ''; }
      else if (full.status === 'done' || (full.status === 'reviewing' && !S.health.hasKey)) sub.pending = full.feedback ? '' : '';
      else if (full.status === 'reviewing') sub.pending = 'Claude is reviewing it…';
      if (S.attempt === a && a.tab === 'feedback') renderPadLeft(q);
    });
  }
  if (S.attempt !== a) return;
  const passed = r && !r.error && r.passed === r.total;
  if (a.gi < q.gates.length - 1) a.reached = Math.max(a.reached, a.gi + 1);
  if (a.gi < q.gates.length - 1 && passed){
    advanceGate(q);
    toast(`Part ${a.gi} passed. Here is the follow-up; the review lands under Feedback.`);
  } else { a.tab = 'feedback'; render(); if (a.gi < q.gates.length - 1) toast('Not all tests pass. Fix and resubmit, or use "Next part" to move on the way an interviewer would.'); }
}
function finishAttempt(q){
  const a = S.attempt; const n = Object.keys(a.subs).length;
  if (!n && !confirm('Nothing was submitted in this attempt. Leave anyway?')) return;
  a.done = true; Draft.clear(); S.attempt = null; location.hash = a.gym ? '#/gym/' + a.gym.id : '#/q/' + q.id;
}

/* ---------- gym ---------- */
function gymSubs(g){ return S.subs.filter(s => s.attemptId === g.id); }
function gymStationSub(g, n){ const subs = gymSubs(g).filter(s => s.questionId === g.drillIds[n]); return subs[subs.length - 1] || null; }
function gymStation(g){ for (let i = 0; i < g.drillIds.length; i++) if (!gymStationSub(g, i)) return g.finishedAt ? -1 : i; return -1; }
function gymIsLast(ctx){ const g = S.gyms.find(x => x.id === ctx.id); return !g || ctx.n >= g.drillIds.length - 1; }
async function gymAdvance(q){
  const a = S.attempt, g = S.gyms.find(x => x.id === a.gym.id); if (!g) return;
  a.done = true; Draft.clear(); S.attempt = null;
  if (a.gym.n >= g.drillIds.length - 1){ g.finishedAt = new Date().toISOString(); try { await API.putGym(g); } catch(e){ toast(e.message); } location.hash = '#/gym/' + g.id; }
  else { const target = '#/gym/' + g.id + '/go'; if (location.hash === target) render(); else location.hash = target; }
}
function gymStats(g){
  const subs = g.drillIds.map((id, i) => ({q:S.questions.get(id), s:gymStationSub(g, i)}));
  const done = subs.filter(x => x.s), passed = done.filter(x => gateStatus(x.s) === 'pass');
  const time = done.reduce((t, x) => t + (x.s.gateSec || 0), 0);
  const ratios = done.map(x => x.q && x.q.gates[0].minutes ? (x.s.gateSec || 0) / (x.q.gates[0].minutes * 60) : null).filter(v => v != null);
  const fbs = done.map(x => x.s.feedback).filter(Boolean);
  const dims = Object.fromEntries(DIMS.map(([k]) => [k, fbs.length ? avg(fbs.map(f => f.scores[k] || f.overall)) : null]));
  return {subs, done, passed, time, budgetRatio:ratios.length ? median(ratios.map(r => Math.round(r*100))) : null, cpm:done.some(x => x.s.cpm) ? median(done.filter(x => x.s.cpm).map(x => x.s.cpm)) : null, lines:done.some(x => x.s.lines) ? Math.round(avg(done.filter(x => x.s.lines).map(x => x.s.lines))) : null, quality:fbs.length ? avg(fbs.map(f => f.overall)) : null, fbs, dims, nudges:done.reduce((n, x) => n + ((x.s.nudges || []).filter(r => r === 'stuck' || r === 'idle').length), 0)};
}
function gymFocusOptions(){
  const drills = [...S.questions.values()].filter(q => q.kind === 'drill');
  const fulls = [...S.questions.values()].filter(q => q.kind !== 'drill');
  const have = new Map(); for (const d of drills) for (const k of (d.skills || '').split(/[;,]/).map(x => x.trim()).filter(Boolean)) have.set(k, (have.get(k) || 0) + 1);
  const opts = [['mixed', 'Mixed (unattempted drills, hardest gaps first)']];
  for (const [k,[n]] of Object.entries(SKILLS)) opts.push(['skill:' + k, n + (have.has(n) ? ` (${have.get(n)} drill${have.get(n)===1?'':'s'})` : '')]);
  for (const tp of [...new Set([...fulls.map(q => q.topic), ...drills.map(q => q.topic)].filter(Boolean))]) opts.push(['topic:' + tp, tp]);
  return opts;
}
function drillMatches(q, focus){
  if (focus === 'mixed') return true;
  if (focus.startsWith('topic:')) return (q.topic || '') === focus.slice(6);
  const name = SKILLS[focus.slice(6)] ? SKILLS[focus.slice(6)][0].toLowerCase() : focus.slice(6).toLowerCase();
  return (q.skills || '').toLowerCase().includes(name) || (q.title || '').toLowerCase().includes(name);
}
function renderGym(gid){
  if (gid){ const g = S.gyms.find(x => x.id === gid); if (!g){ app.append(h('p',{class:'none', text:'That session is not on record.'})); return; } return renderGymSession(g); }
  const drills = [...S.questions.values()].filter(q => q.kind === 'drill');
  app.append(h('div',{class:'page-head'}, h('div',null, h('h2',{text:'Gym'}), h('p',{text:'A set of drills in a row, one unlocking the next, against the clock. Each session gets its own debrief and feeds the drill analytics.'})), h('a',{class:'btn', href:'#/analytics#drills', text:'Drill analytics'})));
  const opts = gymFocusOptions();
  const start = h('details',{class:'draftbox', open:true}, h('summary',null, h('strong',{text:'Start a session'})),
    h('div',{class:'row', style:'margin-top:8px'},
      h('label',{class:'field', style:'flex:1;min-width:220px'}, h('span',{text:'Focus'}), h('select',{id:'gyFocus'}, opts.map(([v,l]) => h('option',{value:v, text:l})))),
      h('label',{class:'field', style:'width:110px'}, h('span',{text:'Drills'}), h('select',{id:'gyCount'}, [3,4,5,6].map(n => h('option',{value:String(n), text:String(n), selected:n === 4})))),
      h('label',{class:'field', style:'width:120px'}, h('span',{text:'Minutes each'}), h('input',{type:'number', id:'gyMin', value:'12', min:'5', max:'30'}))),
    h('p',{class:'hist', style:'margin-top:8px', text:'Unattempted drills that match the focus are used first; if there are not enough, Claude writes the rest (one to three minutes each) before the session starts.'}),
    h('div',{class:'row', style:'margin-top:8px'}, h('button',{class:'btn primary', id:'gyStart', text:'Start', onclick:e => startGym(e.target)}), h('span',{class:'hist', id:'gyNote'})));
  app.append(start);
  const sessions = S.gyms.slice().reverse();
  const sec = h('div',{class:'section'}, h('h3',{text:'Sessions'}));
  if (!sessions.length) sec.append(h('p',{class:'none', text:'No sessions yet.'}));
  else sec.append(h('table',null, h('thead',null, h('tr',null, h('th',{text:'When'}), h('th',{text:'Focus'}), h('th',{class:'num', text:'Drills'}), h('th',{class:'num', text:'Passed'}), h('th',{class:'num', text:'Time'}), h('th',{class:'num', text:'Quality'}), h('th',{text:''}))),
    h('tbody',null, sessions.map(g => { const st = gymStats(g); const open = gymStation(g) >= 0; return h('tr',null, h('td',{text:fmtDateTime(g.startedAt)}), h('td',{text:g.focusLabel || g.focus}), h('td',{class:'num', text:`${st.done.length}/${g.drillIds.length}`}), h('td',{class:'num ' + (st.passed.length === g.drillIds.length ? 'ok' : ''), text:String(st.passed.length)}), h('td',{class:'num', text:fmtSec(st.time)}), h('td',{class:'num', text:st.quality != null ? st.quality.toFixed(1) : '–'}), h('td',null, h('a',{class:'btn small' + (open ? ' primary' : ''), href:'#/gym/' + g.id, text:open ? 'Continue' : 'Debrief'}))); }))));
  app.append(sec);
  if (drills.length) app.append(h('p',{class:'hist', style:'margin-top:18px'}, `${drills.length} drill${drills.length===1?'':'s'} in the library. `, h('a',{href:'#/drills', text:'Manage drills'})));
}
async function startGym(btn){
  const focus = $('#gyFocus').value, count = Number($('#gyCount').value), minutes = Number($('#gyMin').value), note = $('#gyNote');
  const focusLabel = $('#gyFocus').selectedOptions[0].textContent.replace(/ \(.*\)$/, '');
  const attempted = new Set(S.subs.map(s => s.questionId));
  const drills = [...S.questions.values()].filter(q => q.kind === 'drill' && drillMatches(q, focus));
  const gapCount = new Map(); for (const s of S.subs) if (s.feedback) for (const g of s.feedback.gaps || []) gapCount.set(g, (gapCount.get(g) || 0) + 1);
  const score = q => (attempted.has(q.id) ? 0 : 100) + [...gapCount.entries()].reduce((x,[g,n]) => x + ((q.skills || '').toLowerCase().includes(SKILLS[g] ? SKILLS[g][0].toLowerCase() : g) ? n : 0), 0) + Math.random();
  let pick = drills.sort((a,b) => score(b) - score(a)).slice(0, count);
  btn.disabled = true;
  if (pick.length < count){
    if (!(S.health && S.health.hasKey)){ note.textContent = `Only ${pick.length} matching drill${pick.length===1?'':'s'}; Claude is needed to write more (see Settings).`; if (!pick.length){ btn.disabled = false; return; } }
    else {
      const need = count - pick.length; note.textContent = `Claude is writing ${need} drill${need===1?'':'s'} (one to three minutes each)…`;
      const fulls = [...S.questions.values()].filter(q => q.kind !== 'drill');
      const focusText = focus === 'mixed' ? 'a mix: ' + ([...gapCount.entries()].sort((a,b) => b[1]-a[1]).slice(0,2).map(([g]) => (SKILLS[g] || [g])[0]).join(', ') || 'core data structures and simulation') : focus.startsWith('skill:') ? SKILLS[focus.slice(6)][0] + ': ' + SKILLS[focus.slice(6)][1] : focus.slice(6);
      try { const r = await API.call('POST', '/api/drills/generate', {focus:focusText, count:need, minutes, examples:fulls.slice(0,2).map(q => q.id)}); await loadIndex(); pick = pick.map(q => S.questions.get(q.id) || q).concat(r.made.map(m => S.questions.get(m.question.id)).filter(Boolean)).slice(0, count); }
      catch(err){ note.textContent = 'Could not write drills: ' + err.message; if (!pick.length){ btn.disabled = false; return; } }
    }
  }
  const g = {id:'gym-' + tsId(), focus, focusLabel, minutes, startedAt:new Date().toISOString(), finishedAt:null, drillIds:pick.map(q => q.id)};
  try { await API.putGym(g); } catch(e){ toast('Could not save the session: ' + e.message); btn.disabled = false; return; }
  S.gyms.push(g); location.hash = '#/gym/' + g.id + '/go';
}
function renderGymSession(g){
  const st = gymStats(g), cur = gymStation(g), open = cur >= 0;
  app.append(h('div',{class:'page-head'}, h('div',null, h('a',{class:'btn quiet small', href:'#/gym', text:'All sessions'}), h('h2',{style:'margin-top:8px', text:`Gym: ${g.focusLabel || g.focus}`}), h('p',{text:`${fmtDateTime(g.startedAt)} · ${g.drillIds.length} drills, ${g.minutes || '?'} min each` + (g.finishedAt ? ' · finished' : '')})),
    h('div',{class:'row'}, open && h('a',{class:'btn primary', href:'#/gym/' + g.id + '/go', text:cur === 0 && !st.done.length ? 'Start drill 1' : `Continue with drill ${cur + 1}`}), open && st.done.length > 0 && h('button',{class:'btn', text:'End session here', onclick:async () => { g.finishedAt = new Date().toISOString(); try { await API.putGym(g); } catch(e){ toast(e.message); } render(); }}))));
  // track
  const track = h('div',{class:'track'});
  g.drillIds.forEach((id, i) => { const q = S.questions.get(id), s = st.subs[i].s; const state = s ? gateStatus(s) : i === cur ? 'current' : 'locked';
    track.append(h('div',{class:'station ' + state}, h('div',{class:'st-n', text:String(i + 1)}), h('div',{class:'st-body'}, h('b',{text:state === 'locked' ? 'Locked' : q ? q.title : id}), h('span',{class:'hist', text:s ? `${gateStatus(s) === 'pass' ? 'passed' : 'failed'} · ${fmtSec(s.gateSec)}${q && q.gates[0].minutes ? ' of ' + q.gates[0].minutes + ' min' : ''}${s.feedback ? ' · ' + s.feedback.overall + '/5' : ''}` : state === 'current' ? 'up next' : `unlocks after drill ${i}`})),
      s && q && h('button',{class:'link', text:'Open', onclick:() => openSubmission(q, q.gates[0], 0, s)}))); });
  app.append(track);
  if (!st.done.length) return;
  // debrief
  const prev = S.gyms.filter(x => x.id !== g.id && x.startedAt < g.startedAt && gymStats(x).fbs.length);
  const prevStats = prev.slice(-3).map(gymStats);
  const prevDim = prevStats.length ? Object.fromEntries(DIMS.map(([k]) => [k, avg(prevStats.map(p => p.dims[k]).filter(v => v != null))])) : null;
  const prevPass = prevStats.length ? avg(prevStats.map(p => p.passed.length / Math.max(1, p.done.length))) : null;
  const tiles = h('div',{class:'tiles', style:'margin-top:26px'},
    h('div',{class:'tile'}, h('b',{text:`${st.passed.length}/${st.done.length}`}), h('span',{text:'drills passed' + (g.drillIds.length > st.done.length ? ` (${g.drillIds.length - st.done.length} not reached)` : '')})),
    h('div',{class:'tile'}, h('b',{text:fmtSec(st.time)}), h('span',{text:'total time on the clock'})),
    h('div',{class:'tile'}, h('b',{text:st.budgetRatio != null ? st.budgetRatio + '%' : '–'}), h('span',{text:'of budget used, median drill'})),
    h('div',{class:'tile'}, h('b',{text:st.cpm != null ? String(st.cpm) : '–'}), h('span',{text:'chars per active minute'})),
    h('div',{class:'tile'}, h('b',{text:st.lines != null ? String(st.lines) : '–'}), h('span',{text:'lines per drill'})),
    h('div',{class:'tile'}, h('b',{text:st.quality != null ? st.quality.toFixed(1) : '–'}), h('span',{text:st.fbs.length ? `review quality, ${st.fbs.length} of ${st.done.length} reviewed` : 'no reviews yet'})));
  app.append(tiles);
  const pending = st.done.filter(x => !x.s.feedback && (x.s.status === 'grading' || x.s.status === 'reviewing')).length;
  if (pending) app.append(h('div',{class:'thinking', style:'margin-bottom:16px'}, h('span',{class:'dot'}), `${pending} review${pending===1?'':'s'} still running; the debrief fills in when they land.`));
  const grid = h('div',{class:'ins'});
  // improvements
  const imp = [];
  if (prevPass != null){ const now = st.passed.length / st.done.length; if (now - prevPass >= 0.15) imp.push(`Pass rate ${Math.round(now*100)}%, up from ${Math.round(prevPass*100)}% over the last ${prevStats.length} session${prevStats.length===1?'':'s'}.`); }
  if (prevDim) for (const [k,label] of DIMS){ const d = st.dims[k]; if (d != null && prevDim[k] != null && d - prevDim[k] >= 0.5) imp.push(`${label} ${d.toFixed(1)}, up ${(d - prevDim[k]).toFixed(1)}.`); }
  const prevRatio = prevStats.map(p => p.budgetRatio).filter(v => v != null);
  if (st.budgetRatio != null && prevRatio.length && median(prevRatio) - st.budgetRatio >= 15) imp.push(`Faster: ${st.budgetRatio}% of budget against ${median(prevRatio)}% before.`);
  const prevGaps = new Set(prevStats.flatMap(p => p.fbs.flatMap(f => f.gaps || []))), nowGaps = new Set(st.fbs.flatMap(f => f.gaps || []));
  for (const gp of prevGaps) if (!nowGaps.has(gp) && SKILLS[gp]) imp.push(`${SKILLS[gp][0]} was flagged in earlier sessions and not this time.`);
  const strengths = new Map(); for (const f of st.fbs) for (const s of f.strengths || []) strengths.set(s, (strengths.get(s) || 0) + 1);
  for (const [s, n] of [...strengths.entries()].sort((a,b) => b[1]-a[1]).slice(0, 2)) imp.push(n > 1 ? `${s} (noted in ${n} reviews).` : s + '.');
  if (st.nudges === 0 && st.done.length >= 2 && st.fbs.length) imp.push('No stuck or idle nudges were needed.');
  const isec = h('section',null, h('h3',{text:'Key improvements'}), h('p',{class:'sub', text:prevStats.length ? `Against your last ${prevStats.length} session${prevStats.length===1?'':'s'}.` : 'First session with reviews; later sessions are compared against this one.'}));
  isec.append(imp.length ? h('ul',{class:'debrief'}, imp.slice(0, 6).map(x => h('li',{text:x}))) : h('p',{class:'none', text:st.fbs.length ? 'Nothing moved by a clear margin yet.' : 'Waiting on reviews.'}));
  grid.append(isec);
  // progress needed
  const need = [];
  const failed = st.done.filter(x => gateStatus(x.s) !== 'pass');
  if (failed.length) need.push({text:`${failed.length} of ${st.done.length} did not pass: ${failed.map(x => x.q ? x.q.title : x.s.questionId).join(', ')}. Redo each from your last code until it is clean.`, focus:null});
  const over = st.done.filter(x => x.q && x.q.gates[0].minutes && (x.s.gateSec || 0) > x.q.gates[0].minutes * 60 * 1.1);
  if (over.length) need.push({text:`Over budget on ${over.length}: ${over.map(x => `${x.q.title} (${Math.round((x.s.gateSec || 0) / (x.q.gates[0].minutes * 60) * 100)}%)`).join(', ')}. Decide the approach out loud in the first minute and write the obvious version first.`, focus:null});
  const low = DIMS.map(([k,label]) => ({k, label, v:st.dims[k]})).filter(x => x.v != null && x.v < 3.5).sort((a,b) => a.v - b.v).slice(0, 2);
  for (const x of low) need.push({text:`${x.label} averaged ${x.v.toFixed(1)} of 5 this session.`, focus:DIM_SKILL[x.k]});
  const gapN = new Map(); for (const f of st.fbs) for (const gp of f.gaps || []) gapN.set(gp, (gapN.get(gp) || 0) + 1);
  for (const [gp, n] of [...gapN.entries()].sort((a,b) => b[1]-a[1]).slice(0, 2)) if (SKILLS[gp]) need.push({text:`${SKILLS[gp][0]} flagged in ${n} of ${st.fbs.length} reviews: ${SKILLS[gp][1]}.`, focus:gp});
  if (st.nudges) need.push({text:`The interviewer had to nudge ${st.nudges} time${st.nudges===1?'':'s'} (stuck or idle). Narrate before you stall; walk one example by hand when stuck.`, focus:'independence'});
  const nsec = h('section',null, h('h3',{text:'Progress needed'}), h('p',{class:'sub', text:'What this session says to work on next; each line that maps to a skill has a drill button.'}));
  nsec.append(need.length ? h('ul',{class:'debrief'}, need.slice(0, 6).map(x => h('li',null, x.text, ' ', x.focus && S.health && S.health.hasKey && drillBtn(x.focus, 'Drill')))) : h('p',{class:'none', text:st.fbs.length ? 'Clean session: everything passed inside budget with no low scores.' : 'Waiting on reviews.'}));
  grid.append(nsec);
  if (st.fbs.length) grid.append(h('section',null, h('h3',{text:'Scores this session'}), barChart(DIMS.map(([k,label]) => ({name:label, v:st.dims[k] || 0, delta:prevDim && prevDim[k] != null ? st.dims[k] - prevDim[k] : null, tip:`${label}: ${(st.dims[k] || 0).toFixed(1)}`})), {label:'Review dimensions', colorOf:it => it.v < 2.5 ? 'var(--bad)' : it.v < 3.5 ? 'var(--warn)' : 'var(--good)'})));
  const tbl = h('section',{class:'wide'}, h('h3',{text:'Drill by drill'}), h('table',null, h('thead',null, h('tr',null, h('th',{text:'#'}), h('th',{text:'Drill'}), h('th',{class:'num', text:'Time'}), h('th',{class:'num', text:'Budget'}), h('th',{class:'num', text:'Tests'}), h('th',{class:'num', text:'Lines'}), h('th',{class:'num', text:'cpm'}), h('th',{class:'num', text:'Quality'}), h('th',{text:'Gaps'}))),
    h('tbody',null, st.subs.map((x, i) => x.s && h('tr',null, h('td',{text:String(i + 1)}), h('td',null, h('a',{href:'#/q/' + (x.q ? x.q.id : ''), text:x.q ? x.q.title : x.s.questionId})), h('td',{class:'num', text:fmtSec(x.s.gateSec)}), h('td',{class:'num', text:x.q && x.q.gates[0].minutes ? Math.round((x.s.gateSec || 0) / (x.q.gates[0].minutes * 60) * 100) + '%' : '–'}), h('td',{class:'num ' + (gateStatus(x.s) === 'pass' ? 'ok' : 'fail'), text:x.s.total ? `${x.s.passed}/${x.s.total}` : '–'}), h('td',{class:'num', text:x.s.lines ? String(x.s.lines) : '–'}), h('td',{class:'num', text:x.s.cpm ? String(x.s.cpm) : '–'}), h('td',{class:'num', text:x.s.feedback ? x.s.feedback.overall + '/5' : x.s.status === 'grading' || x.s.status === 'reviewing' ? 'pending' : '–'}), h('td',{text:x.s.feedback ? x.s.feedback.gaps.map(k => (SKILLS[k] || [k])[0]).join(', ') : ''}))))));
  grid.append(tbl);
  app.append(grid);
  if (pending){ const ids = st.done.filter(x => !x.s.feedback && (x.s.status === 'grading' || x.s.status === 'reviewing')).map(x => x.s.id); for (const id of ids) waitForEval(id, () => { if (S.view === 'gym') render(); }); }
}

/* ---------- edit / new ---------- */
function renderDraftReport(d){
  const rep = d.report;
  return h('div',{class:'col', style:'gap:8px'}, h('div',{class:'run-out'}, h('div',{class:'run-head'}, h('span',{class:rep.ok ? 'ok' : 'fail', text:rep.ok ? 'Reference solution passes every test' : 'Some tests and the reference solution disagree; check them below'}), h('span',{class:'spacer'}), h('span',{class:'hist', text:`${rep.rounds} pass${rep.rounds > 1 ? 'es' : ''}`})),
    rep.parts.map(p => h('div',{class:'case ' + (p.total && p.passed === p.total ? 'pass' : 'fail')}, h('span',{class:'st ' + (p.total && p.passed === p.total ? 'ok' : 'fail'), text:p.total && p.passed === p.total ? '✓' : '✗'}), h('pre',{text:`${p.title}: ${p.error || p.passed + '/' + p.total + ' tests'}` + (p.failed && p.failed.length ? '\n' + p.failed.map(f => '  ' + f.raw + '  ->  got ' + f.got).join('\n') : '')}))),
    d.notes && h('pre',{class:'stdout', text:'Notes: ' + d.notes})),
    h('details',null, h('summary',{class:'label', style:'cursor:pointer', text:'Reference solution (saved next to the question as <id>.solution.py when you save)'}), h('pre',{class:'stdout', style:'max-height:360px', text:d.solution})));
}
async function renderEdit(qid){
  let q = qid ? await fetchQuestion(qid) : null;
  if (S.view !== 'edit') return;
  const isNew = !q;
  const draftInfo = (isNew || S.draftFor === qid) ? S.draftInfo : null; S.draftInfo = null;
  if (S.draftQ && (isNew || S.draftFor === qid)){ q = S.draftQ; S.draftQ = null; S.draftFor = null; } else q = q ? clone(q) : {id:'', title:'', topic:'', difficulty:'medium', lang:'python', source:'', url:'', overview:'', gates:[{id:'g1', title:'Part 1', entry:'', minutes:15, prompt:'', tests:''}], createdAt:new Date().toISOString()};
  const opt = (v,t,cur) => h('option',{value:v, text:t, selected:v===cur});
  const gatesHost = h('div',{class:'col'});
  const drawGates = () => {
    gatesHost.replaceChildren();
    q.gates.forEach((g, i) => gatesHost.append(h('div',{class:'gate-ed'},
      h('div',{class:'meta'},
        h('label',{class:'field'}, h('span',{text:`Part ${i+1} title`}), h('input',{type:'text', value:g.title, oninput:e => { g.title = e.target.value; }})),
        h('label',{class:'field'}, h('span',{text:'Entry function'}), h('input',{type:'text', value:g.entry, placeholder:'solve', oninput:e => { g.entry = e.target.value.trim(); }})),
        h('label',{class:'field'}, h('span',{text:'Minutes'}), h('input',{type:'number', min:'1', value:g.minutes, oninput:e => { g.minutes = Number(e.target.value) || 0; }})),
        h('div',{class:'row'}, i > 0 && h('button',{class:'btn quiet small', text:'Up', onclick:() => { [q.gates[i-1], q.gates[i]] = [q.gates[i], q.gates[i-1]]; drawGates(); }}), q.gates.length > 1 && h('button',{class:'btn quiet small', text:'Remove', onclick:() => { q.gates.splice(i,1); drawGates(); }}))),
      h('label',{class:'field'}, h('span',{text:'Prompt, as the interviewer would say it'}), h('textarea',{rows:'5', value:g.prompt, placeholder:'Brief and conversational; leave the fine rules for the candidate to ask about.', oninput:e => { g.prompt = e.target.value; }})),
      h('label',{class:'field'}, h('span',{text:'Interviewer spec (hidden; the answer key for clarifying questions and the rules the tests follow)'}), h('textarea',{rows:'4', value:g.spec || '', placeholder:'Input format and ranges; what to return for empty input; tie-breaks; ordering…', oninput:e => { g.spec = e.target.value; }})),
      h('label',{class:'field'}, h('span',{text:'Test cases, one per line: JSON args => expected'}), h('textarea',{class:'mono', rows:'4', spellcheck:'false', value:g.tests, placeholder:'[[2,7,11,15], 9] => [0,1]', oninput:e => { g.tests = e.target.value; }})))));
    gatesHost.append(h('button',{class:'btn small', style:'align-self:flex-start', text:'Add a part', onclick:() => { q.gates.push({id:'g' + (q.gates.length+1), title:`Part ${q.gates.length+1}`, entry:'', minutes:10, prompt:'', tests:''}); drawGates(); }}));
  };
  drawGates();
  const draftOut = h('div');
  const draftBox = isNew && h('details',{class:'draftbox', open:!q.title},
    h('summary',null, h('strong',{text:'Step 1: paste the question as you found it'})),
    h('p',{class:'hist', text:'Paste the whole description from 1point3acres or your notes, follow-ups and all. Claude splits it into parts in interview order (the base task, then each follow-up), writes entry functions and test cases, and a reference solution that the server runs against every test before you see it. Step 2 is to glance over the parts below and save. During an attempt, only the current part is visible; each follow-up is revealed when you submit the one before it.'}),
    h('textarea',{id:'draftText', rows:'8', placeholder:'Paste the question here…'}),
    h('div',{class:'row'}, h('input',{type:'text', id:'draftHint', placeholder:'Optional guidance: language, how many parts, what to emphasise', style:'flex:1;min-width:220px'}),
      h('button',{class:'btn primary', id:'draftBtn', disabled:!(S.health && S.health.hasKey), text:'Draft with Claude', onclick:async e => {
        const text = $('#draftText').value; if (text.trim().length < 40){ toast('Paste the question first.'); return; }
        e.target.disabled = true; draftOut.replaceChildren(h('div',{class:'thinking'}, h('span',{class:'dot'}), 'Claude is writing the parts and tests, then the server runs the reference solution against them. One to three minutes.'));
        try {
          const d = await API.call('POST', '/api/questions/draft', {text, hint:$('#draftHint').value});
          Object.assign(q, d.question); q.createdAt = q.createdAt || new Date().toISOString();
          q.solution = d.solution; S.draftQ = q; S.draftInfo = d;
          render(); toast('Drafted. Review the parts below, then save.');
        } catch(err){ draftOut.replaceChildren(h('p',{class:'fail', text:err.message})); }
        e.target.disabled = false;
      }})),
    !(S.health && S.health.hasKey) && h('p',{class:'hist', text:'Drafting needs Claude on the server: see Settings.'}),
    draftOut);
  const reviseBox = !isNew && S.health && S.health.hasKey && h('details',{class:'draftbox', open:false},
    h('summary',null, h('strong',{text:'Ask Claude to change this question'})),
    h('p',{class:'hist', text:'Say what to change in plain words: “make part 3 about weighted edges”, “add a test for an empty graph”, “tighten the budgets to 45 minutes total”. Claude revises the parts, spec, tests and reference solution together, re-verifies, and fills the form below for you to check and save.'}),
    h('div',{class:'row'}, h('input',{type:'text', id:'reviseText', placeholder:'What should change?', style:'flex:1;min-width:260px', onkeydown:e => { if (e.key === 'Enter') $('#reviseBtn').click(); }}),
      h('button',{class:'btn primary', id:'reviseBtn', text:'Revise with Claude', onclick:async e => {
        const instruction = $('#reviseText').value.trim(); if (instruction.length < 5){ toast('Say what to change.'); return; }
        e.target.disabled = true; e.target.textContent = 'Revising (1–3 min)…';
        try { const d = await API.call('POST', '/api/questions/' + encodeURIComponent(q.id) + '/revise', {instruction}); Object.assign(q, d.question); q.solution = d.solution; S.draftQ = q; S.draftInfo = d; S.draftFor = q.id; render(); toast('Revised. Check the parts below, then save.'); }
        catch(err){ toast(err.message); e.target.disabled = false; e.target.textContent = 'Revise with Claude'; }
      }})));
  const form = h('div',{class:'form'},
    h('h2',{text:isNew ? 'Add a question' : 'Edit question'}),
    draftBox, reviseBox,
    draftInfo && renderDraftReport(draftInfo),
    h('label',{class:'field'}, h('span',{text:'Title'}), h('input',{type:'text', id:'qTitle', value:q.title, oninput:e => { q.title = e.target.value; }})),
    h('div',{class:'meta'},
      h('label',{class:'field'}, h('span',{text:'Topic'}), h('input',{type:'text', value:q.topic, placeholder:'Graphs, DP, Design…', oninput:e => { q.topic = e.target.value.trim(); }})),
      h('label',{class:'field'}, h('span',{text:'Difficulty'}), h('select',{onchange:e => { q.difficulty = e.target.value; }}, opt('easy','Easy',q.difficulty), opt('medium','Medium',q.difficulty), opt('hard','Hard',q.difficulty))),
      h('label',{class:'field'}, h('span',{text:'Language'}), h('select',{onchange:e => { q.lang = e.target.value; }}, opt('python','Python',q.lang), opt('javascript','JavaScript',q.lang))),
      h('label',{class:'field'}, h('span',{text:'Source'}), h('input',{type:'text', value:q.source, placeholder:'Company, round', oninput:e => { q.source = e.target.value; }}))),
    h('label',{class:'field'}, h('span',{text:'Link'}), h('input',{type:'url', value:q.url, placeholder:'https://', oninput:e => { q.url = e.target.value.trim(); }})),
    h('label',{class:'field'}, h('span',{text:'Overview (shown before part 1)'}), h('textarea',{rows:'4', value:q.overview, oninput:e => { q.overview = e.target.value; }})),
    h('h3',{text:'Parts'}), h('p',{class:'hist', text:'Each part is a gate: its own prompt, entry function and tests. Code carries over from part to part.'}),
    gatesHost,
    h('div',{class:'row'}, h('button',{class:'btn primary', text:isNew ? 'Save question' : 'Save changes', onclick:async e => {
      if (!q.title.trim()){ toast('Give it a title.'); return; }
      const bad = q.gates.map((g,i) => parseTests(g.tests).errors.map(x => `Part ${i+1}, ${x}`)).flat(); if (bad.length){ toast(bad[0]); return; }
      if (isNew){ q.id = slug(q.title); let n = 2; while (S.questions.has(q.id)) q.id = slug(q.title) + '-' + n++; }
      q.gates.forEach((g,i) => { g.id = g.id || 'g' + (i+1); });
      e.target.disabled = true; const ok = await saveQuestion(q); e.target.disabled = false;
      if (ok) location.hash = '#/q/' + q.id;
    }}), h('a',{class:'btn quiet', href:isNew ? '#/' : '#/q/' + q.id, text:'Cancel'})));
  app.append(form);
}

/* ---------- charts (inline SVG) ---------- */
const CAT = ['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#4a3aa7','#008300','#e34948'];
const svg = (tag, attrs) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
function lineChart(points, {w=420, h=150, min=0, max=5, fmt=v => v.toFixed(1), label=''} = {}){
  // points: [{x:label, y:number, tip}]
  const pad = {l:40, r:12, t:10, b:22}, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const root = svg('svg', {viewBox:`0 0 ${w} ${h}`, class:'chart', role:'img', 'aria-label':label});
  const X = i => pad.l + (points.length > 1 ? i/(points.length-1) : .5) * iw, Y = v => pad.t + (1 - (v-min)/(max-min)) * ih;
  for (const g of [min, (min+max)/2, max]){ root.append(svg('line', {x1:pad.l, x2:w-pad.r, y1:Y(g), y2:Y(g), class:'grid'})); const tx = svg('text', {x:pad.l-6, y:Y(g)+4, class:'tick', 'text-anchor':'end'}); tx.textContent = fmt(g); root.append(tx); }
  if (points.length > 1){ root.append(svg('path', {d:points.map((p,i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' '), class:'series'})); }
  points.forEach((p,i) => { const c = svg('circle', {cx:X(i), cy:Y(p.y), r:4, class:'dot-pt'}); const tt = svg('title'); tt.textContent = p.tip || `${p.x}: ${fmt(p.y)}`; c.append(tt); root.append(c); });
  const step = Math.max(1, Math.ceil(points.length/6));
  points.forEach((p,i) => { if (i % step === 0 || i === points.length-1){ const tx = svg('text', {x:X(i), y:h-6, class:'tick', 'text-anchor':'middle'}); tx.textContent = p.x; root.append(tx); } });
  return root;
}
function barChart(items, {w=640, h=190, max=5, fmt=v => v.toFixed(1), label='', colorOf} = {}){
  // items: [{name, v, tip, delta}]
  const pad = {l:8, r:8, t:18, b:40}, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, bw = iw / items.length;
  const root = svg('svg', {viewBox:`0 0 ${w} ${h}`, class:'chart', role:'img', 'aria-label':label});
  items.forEach((it, i) => {
    const x = pad.l + i*bw + bw*0.18, width = bw*0.64, y = pad.t + (1 - it.v/max) * ih, hh = (it.v/max) * ih;
    const r = svg('rect', {x, y, width, height:Math.max(2, hh), rx:3, fill:colorOf ? colorOf(it) : 'var(--pen)'}); const tt = svg('title'); tt.textContent = it.tip || `${it.name}: ${fmt(it.v)}`; r.append(tt); root.append(r);
    const v = svg('text', {x:x+width/2, y:y-4, class:'val-txt', 'text-anchor':'middle'}); v.textContent = fmt(it.v) + (it.delta != null && Math.abs(it.delta) >= .05 ? (it.delta > 0 ? ' ▲' : ' ▼') : ''); root.append(v);
    const n = svg('text', {x:x+width/2, y:h-24, class:'tick', 'text-anchor':'middle'}); n.textContent = it.name.length > 12 ? it.name.slice(0,11) + '…' : it.name; root.append(n);
    if (it.sub){ const s = svg('text', {x:x+width/2, y:h-10, class:'tick', 'text-anchor':'middle'}); s.textContent = it.sub; root.append(s); }
  });
  return root;
}
function donut(segs, {size=170, label=''} = {}){
  // segs: [{name, v, color}]
  const total = segs.reduce((s,x) => s + x.v, 0) || 1, r = size/2 - 6, R = size/2, inner = r*0.58;
  const root = svg('svg', {viewBox:`0 0 ${size} ${size}`, class:'chart donut', role:'img', 'aria-label':label});
  let a0 = -Math.PI/2;
  for (const s of segs){ if (!s.v) continue; const a1 = a0 + s.v/total * 2*Math.PI, big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${(R + rad*Math.cos(ang)).toFixed(2)} ${(R + rad*Math.sin(ang)).toFixed(2)}`;
    const d = `M ${p(a0, r)} A ${r} ${r} 0 ${big} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${big} 0 ${p(a0, inner)} Z`;
    const path = svg('path', {d, fill:s.color, stroke:'var(--surface)', 'stroke-width':2}); const tt = svg('title'); tt.textContent = `${s.name}: ${s.v} (${Math.round(s.v/total*100)}%)`; path.append(tt); root.append(path);
    if (s.v/total >= .08){ const mid = (a0+a1)/2, lx = R + (r+inner)/2*Math.cos(mid), ly = R + (r+inner)/2*Math.sin(mid); const tx = svg('text', {x:lx, y:ly+4, class:'donut-lbl', 'text-anchor':'middle'}); tx.textContent = s.short || s.name; root.append(tx); }
    a0 = a1; }
  return root;
}
function legend(segs){ return h('div',{class:'legend'}, segs.map(s => h('span',null, h('i',{style:`background:${s.color}`}), `${s.name} (${s.v})`))); }

/* ---------- analytics ---------- */
const DIM_SKILL = {clarifying:'clarifying', communication:'communication', independence:'independence', approach:'algo-choice', correctness:'correctness', efficiency:'complexity', edgeCases:'edge-cases', testing:'testing', clarity:'clarity', extensibility:'extensibility'};
function bar(frac, cls, marker){
  const b = h('div',{class:'bar'}, h('i',{class:cls || '', style:`width:${Math.max(0, Math.min(100, frac*100)).toFixed(1)}%`}));
  if (marker != null) b.append(h('s',{style:`left:${Math.max(0, Math.min(100, marker*100)).toFixed(1)}%`, title:'budget'}));
  return b;
}
function drillBtn(focus, label){
  return h('button',{class:'btn small', text:label || 'Drill this', title:'Claude writes three short exercises on this and puts them under Drills', onclick:() => { S.drillFocus = focus; location.hash = '#/drills'; }});
}
function renderAnalytics(qidFilter){
  const qs = [...S.questions.values()].filter(q => !qidFilter || q.id === qidFilter);
  const q0 = qidFilter && S.questions.get(qidFilter);
  app.append(h('div',{class:'page-head'}, h('div',null, h('h2',{text:q0 ? 'Analytics: ' + q0.title : 'Analytics'}), h('p',{text:'What to fix next, and whether it is moving. Built from every submission and review; drills count too.'})),
    q0 && h('a',{class:'btn small', href:'#/analytics', text:'All questions'})));
  const rows = [], allAtts = [];
  for (const q of qs){ const atts = attemptsOf(q.id); allAtts.push(...atts.map(a => ({...a, q}))); if (atts.length) rows.push({q, a:atts[atts.length-1], atts}); }
  const subs = S.subs.filter(s => !qidFilter || s.questionId === qidFilter);
  const fbs = subs.filter(s => s.feedback).map(s => ({...s.feedback, at:s.at, sub:s}));
  if (!subs.length){ app.append(h('p',{class:'none', text:'Nothing to show yet. Submit a part of a question and the numbers appear here.'})); return; }
  allAtts.sort((x,y) => x.at.localeCompare(y.at));
  const fullAtts = allAtts.filter(a => a.q.kind !== 'drill');

  // ---- headline tiles
  const recent = fbs.slice(-5), earlier = fbs.slice(0, -5);
  const dimAvg = list => Object.fromEntries(DIMS.map(([k]) => [k, avg(list.map(f => f.scores[k] || f.overall))]));
  const dNow = dimAvg(fbs), dRecent = dimAvg(recent), dEarlier = earlier.length ? dimAvg(earlier) : null;
  const gatesTotal = rows.reduce((s,r) => s + r.q.gates.length, 0), gatesPassed = rows.reduce((s,r) => s + r.a.passed, 0);

  // ---- hire estimate
  const est = hireEstimate(fullAtts, fbs);
  app.append(h('div',{class:'hire ' + est.cls},
    h('div',{class:'hire-verdict'}, h('div',{class:'label', text:'Estimated outcome, OpenAI-style coding bar'}), h('div',{class:'big', text:est.verdict}), h('div',{class:'hist', text:`${est.score}/100 · ${est.confidence} confidence`})),
    h('div',{class:'hire-body'},
      h('p',{text:est.summary}),
      h('div',{class:'hire-parts'}, est.parts.map(p => h('div',{class:'hbar'}, h('div',null, p.name, h('span',{class:'n', text:p.note})), bar(p.v/100, p.v >= 70 ? 'good' : p.v >= 45 ? 'warn' : 'bad'), h('span',{class:'val', text:p.v == null ? '–' : Math.round(p.v) + '%'})))),
      h('p',{class:'hist', text:'How it is computed: coding readiness is 35% clean first-three parts, 15% inside budget, 25% review quality, 10% clarifying and testing, 15% independence (how many stuck/idle nudges the interviewer had to give, and the thinking-aloud and independence scores from reviews), over your last five full attempts. Design readiness is not measured yet (no design rounds in Whetstone), so the overall is coding only and the verdict is capped at Hire until it is. Interviewers in the write-ups pass three clean parts with sensible questions asked; this estimate follows that bar, not a formal rubric.'}))));
  app.append(h('div',{class:'tiles'},
    h('div',{class:'tile'}, h('b',{text:fbs.length ? avg(recent.map(f => f.overall)).toFixed(1) : '–'}), h('span',{text:fbs.length ? `quality, last ${recent.length} review${recent.length===1?'':'s'}` + (earlier.length ? ` (was ${avg(earlier.map(f => f.overall)).toFixed(1)})` : '') : 'no reviews yet'})),
    h('div',{class:'tile'}, h('b',{text:gatesTotal ? Math.round(gatesPassed/gatesTotal*100) + '%' : '–'}), h('span',{text:'parts passed, latest attempts'})),
    h('div',{class:'tile'}, h('b',{text:String(fullAtts.length)}), h('span',{text:`full attempt${fullAtts.length===1?'':'s'}, ${allAtts.length - fullAtts.length} drill${allAtts.length - fullAtts.length===1?'':'s'}`})),
    h('div',{class:'tile'}, h('b',{text:fmtSec(avg(fullAtts.map(a => a.totalSec)))}), h('span',{text:'average full attempt'})),
    h('div',{class:'tile'}, h('b',{text:subs.some(s => s.lines) ? Math.round(avg(subs.filter(s => s.lines).map(s => s.lines))) : '–'}), h('span',{text:'lines of code per submitted part'})),
    h('div',{class:'tile'}, h('b',{text:subs.some(s => s.cpm) ? median(subs.filter(s => s.cpm).map(s => s.cpm)) : '–'}), h('span',{text:'typing speed, chars per active minute (median)'}))));

  // ---- fix next
  const fixes = [];
  if (fbs.length){
    const worst = DIMS.map(([k,label]) => ({k, label, v:dRecent[k]})).sort((x,y) => x.v-y.v)[0];
    if (worst.v < 4) fixes.push({title:`${worst.label}: ${worst.v.toFixed(1)} of 5 lately`, why:{clarifying:'You are coding on assumptions. Ask two or three questions on the Ask the interviewer tab before writing code; it is graded.', communication:'You go quiet. Hit Talk and say the approach before you code, name each trade-off as you make it, and say what you would do with more time.', independence:'The interviewer had to step in. Before you stall, walk one example through by hand; when the time check comes, cut scope out loud instead of pushing on.', approach:'The algorithm or data model is not the right fit often enough. Say the approach out loud (in the chat) before coding and sanity-check its complexity.', correctness:'Logic bugs are slipping through. Walk one example through the code by hand before submitting.', efficiency:'A faster approach existed. Before coding, name the complexity you are aiming for and whether the input size allows it.', edgeCases:'Empty, single and degenerate inputs are missed. Write those three tests first, every time.', testing:'Your own tests are thin. A main block with four asserts (normal, empty, single, tricky) is the habit to build.', clarity:'Reviewers find the code hard to follow. Name helpers after what they return; keep one idea per function.', extensibility:'Part N+1 forces rewrites. Keep per-entity state in one structure so a new rule is one more field.'}[worst.k], focus:DIM_SKILL[worst.k], kind:'dim'});
  }
  const gapCount = new Map();
  for (const f of fbs) for (const g of f.gaps || []) gapCount.set(g, (gapCount.get(g)||0) + 1);
  const topGap = [...gapCount.entries()].sort((x,y) => y[1]-x[1])[0];
  if (topGap && topGap[1] >= 2 && !fixes.some(f => f.focus === topGap[0])) fixes.push({title:`${SKILLS[topGap[0]][0]} flagged in ${topGap[1]} of ${fbs.length} reviews`, why:SKILLS[topGap[0]][1] + '.', focus:topGap[0], kind:'gap'});
  const over = [];
  for (const {q, a} of rows) q.gates.forEach((g,i) => { const s = a.gates.get(g.id); if (s && g.minutes && s.gateSec > g.minutes*60*1.15) over.push({q, g, i, ratio:s.gateSec/(g.minutes*60)}); });
  over.sort((x,y) => y.ratio-x.ratio);
  if (over[0]) fixes.push({title:`${Math.round(over[0].ratio*100)}% of budget on “${over[0].q.title}”, part ${over[0].i+1}`, why:'Pace is the other half of passing. Redo this part from your last code with the clock running and aim to finish inside the budget.', link:{href:'#/q/' + over[0].q.id, text:'Open the question'}, kind:'time'});
  const stall = new Map();
  for (const a of fullAtts){ const K = a.q.gates.length; let end = 0; for (let i = 0; i < K; i++){ const s = a.gates.get(a.q.gates[i].id); if (s && gateStatus(s) === 'pass') end = i+1; else break; } stall.set(end, (stall.get(end)||0) + 1); }
  const stallTop = [...stall.entries()].filter(([k]) => k < 5).sort((x,y) => y[1]-x[1])[0];
  if (stallTop && fullAtts.length >= 2 && stallTop[0] <= 2) fixes.push({title:`${stallTop[1]} of ${fullAtts.length} full attempts end before part ${stallTop[0]+1}`, why:'Interviewers pass three clean parts. Drill the kind of problem you meet in part ' + (stallTop[0]+1) + ' until it is routine, then run full rounds again.', focus:'algo-choice', kind:'stall'});
  const fx = h('section',{class:'wide'}, h('h3',{text:'Fix next'}));
  if (!fixes.length) fx.append(h('p',{class:'none', text:'Nothing stands out yet. Keep going; this fills in after a few reviews.'}));
  fx.append(h('div',{class:'fixes'}, fixes.slice(0,3).map((f,i) => h('div',{class:'fix'}, h('div',{class:'fix-n', text:String(i+1)}), h('div',null, h('strong',{text:f.title}), h('p',{text:f.why}), h('div',{class:'row', style:'margin-top:8px'}, f.focus && S.health && S.health.hasKey && drillBtn(f.focus, 'Make 3 drills for this'), f.link && h('a',{class:'btn small', href:f.link.href, text:f.link.text})))))));
  app.append(fx);

  const grid = h('div',{class:'ins'});
  // ---- trend: quality over reviews
  const tsec = h('section',null, h('h3',{text:'Is it improving?'}), h('p',{class:'sub', text:'Average review score per attempt, in order. Hover a point for the question.'}));
  const perAtt = allAtts.filter(a => a.quality != null).map(a => ({x:fmtDate(a.at), y:a.quality, tip:`${a.q.title}: ${a.quality.toFixed(1)} of 5, ${a.passed}/${a.q.gates.length} parts, ${fmtSec(a.totalSec)}`}));
  tsec.append(perAtt.length >= 2 ? lineChart(perAtt, {label:'Quality per attempt'}) : h('p',{class:'none', text:'Needs two attempts with reviews.'}));
  const passPts = fullAtts.map(a => ({x:fmtDate(a.at), y:a.passed/a.q.gates.length*100, tip:`${a.q.title}: ${a.passed}/${a.q.gates.length} parts`}));
  if (passPts.length >= 2){ tsec.append(h('p',{class:'sub', style:'margin-top:10px', text:'Share of parts passed per full attempt.'}), lineChart(passPts, {max:100, fmt:v => Math.round(v) + '%', label:'Parts passed per attempt'})); }
  grid.append(tsec);

  // ---- dimensions bar chart
  const dsec = h('section',null, h('h3',{text:'Where the points go'}), h('p',{class:'sub', text:fbs.length ? `Average per dimension over the last ${recent.length} review${recent.length===1?'':'s'}; ▲▼ against the reviews before them.` : 'Appears once submissions have been reviewed.'}));
  if (fbs.length) dsec.append(barChart(DIMS.map(([k,label]) => ({name:label, v:dRecent[k], delta:dEarlier ? dRecent[k]-dEarlier[k] : null, tip:`${label}: ${dRecent[k].toFixed(1)}${dEarlier ? ' (earlier ' + dEarlier[k].toFixed(1) + ')' : ''}`})), {label:'Review dimensions', colorOf:it => it.v < 2.5 ? 'var(--bad)' : it.v < 3.5 ? 'var(--warn)' : 'var(--good)'}));
  grid.append(dsec);

  // ---- stall donut
  if (fullAtts.length){
    const K = Math.max(...fullAtts.map(a => a.q.gates.length));
    const segs = []; for (let i = 0; i <= K; i++){ const n = stall.get(i) || 0; if (n) segs.push({name:i === 0 ? 'Stuck on part 1' : i >= K ? 'Finished all' : `Stopped after part ${i}`, short:i === 0 ? 'P1' : i >= K ? 'All' : `P${i}`, v:n, color:i >= K ? CAT[2] : CAT[[1,3,0,4,5,7][i] % CAT.length]}); }
    const ssec = h('section',null, h('h3',{text:'Where full attempts end'}), h('p',{class:'sub', text:'Last part passed cleanly before the attempt stopped. The pass bar is three.'}), h('div',{class:'row'}, donut(segs, {label:'Where attempts end'}), legend(segs)));
    grid.append(ssec);
  }

  // ---- time vs budget
  const fun = h('section',null, h('h3',{text:'Pace against budget'}), h('p',{class:'sub', text:'Latest attempt per question. Bar is time spent; tick is the budget. Colour: tests passed, partial, failed.'}));
  for (const {q, a} of rows.filter(r => r.q.kind !== 'drill').slice(0, 8)){
    fun.append(h('h4',{style:'margin-top:8px'}, h('a',{href:'#/q/' + q.id, text:q.title, style:'color:inherit;text-decoration:none'})));
    const maxSec = Math.max(...q.gates.map(g => (g.minutes||0)*60), ...[...a.gates.values()].map(s => s.gateSec||0), 60);
    q.gates.forEach((g,i) => { const s = a.gates.get(g.id); const st = gateStatus(s);
      fun.append(h('div',{class:'hbar'}, h('div',null, `${i+1}. ${g.title}`, h('span',{class:'n', text:s ? (s.total ? `${s.passed}/${s.total} tests` : 'not run') : 'not reached'})), bar(s ? (s.gateSec||0)/maxSec : 0, st === 'pass' ? 'good' : st === 'part' ? 'warn' : st === 'fail' ? 'bad' : '', g.minutes ? g.minutes*60/maxSec : null), h('span',{class:'val', text:s ? fmtSec(s.gateSec) : '–'}))); });
  }
  if (!rows.some(r => r.q.kind !== 'drill')) fun.append(h('p',{class:'none', text:'No full attempts yet.'}));
  grid.append(fun);

  // ---- gaps
  const gsec = h('section',null, h('h3',{text:'Gaps that keep coming up'}), h('p',{class:'sub', text:'How many reviews flagged each skill. Each has a drill button.'}));
  const gaps = new Map();
  for (const s of subs) if (s.feedback) for (const g of s.feedback.gaps || []){ let x = gaps.get(g); if (!x){ x = {skill:g, count:0, items:[]}; gaps.set(g, x); } x.count++; const q = S.questions.get(s.questionId); const gate = q && q.gates.find(z => z.id === s.gateId); const note = (s.feedback.issues || []).find(i => i.skill === g); x.items.push({q, gate, s, note:note ? note.note : s.feedback.summary}); }
  if (!gaps.size) gsec.append(h('p',{class:'none', text:'No recurring gaps flagged yet.'}));
  for (const g of [...gaps.values()].sort((a,b) => b.count-a.count)) gsec.append(h('details',{class:'gap'},
    h('summary',null, h('span',null, h('strong',{text:SKILLS[g.skill][0]}), h('span',{class:'desc', text:SKILLS[g.skill][1]})), bar(g.count/fbs.length, 'warn'), h('span',{class:'val', text:`${g.count} of ${fbs.length}`})),
    h('div',{class:'gap-items'}, S.health && S.health.hasKey && drillBtn(g.skill), g.items.slice(-4).map(it => h('div',null, h('a',{href:'#/q/' + (it.q ? it.q.id : ''), text:(it.q ? it.q.title : it.s.questionId) + (it.gate ? ', ' + it.gate.title : '')}), h('div',{text:it.note}))))));
  grid.append(gsec);

  // ---- drills and gym
  if (!qidFilter){
    const dsubs = subs.filter(s => (S.questions.get(s.questionId) || {}).kind === 'drill');
    const drsec = h('section',{class:'wide', id:'drills'}, h('h3',{text:'Drills and gym'}), h('p',{class:'sub', text:'Every drill submission, in or out of a gym session. Pass rate and pace per skill; quality and pass rate per gym session.'}));
    if (!dsubs.length) drsec.append(h('p',{class:'none', text:'No drills done yet.'}), h('div',{class:'row'}, h('a',{class:'btn small', href:'#/gym', text:'Open the gym'})));
    else {
      const dp = dsubs.filter(s => gateStatus(s) === 'pass').length;
      const dr = dsubs.map(s => { const q = S.questions.get(s.questionId); return q && q.gates[0].minutes ? (s.gateSec || 0) / (q.gates[0].minutes * 60) : null; }).filter(v => v != null);
      const dfb = dsubs.filter(s => s.feedback);
      drsec.append(h('div',{class:'tiles'},
        h('div',{class:'tile'}, h('b',{text:String(dsubs.length)}), h('span',{text:`drill submission${dsubs.length===1?'':'s'}, ${S.gyms.length} gym session${S.gyms.length===1?'':'s'}`})),
        h('div',{class:'tile'}, h('b',{text:Math.round(dp / dsubs.length * 100) + '%'}), h('span',{text:'drills passed'})),
        h('div',{class:'tile'}, h('b',{text:dr.length ? Math.round(median(dr.map(r => r*100))) + '%' : '–'}), h('span',{text:'of budget used, median'})),
        h('div',{class:'tile'}, h('b',{text:dsubs.some(s => s.cpm) ? String(median(dsubs.filter(s => s.cpm).map(s => s.cpm))) : '–'}), h('span',{text:'chars per active minute, drills'})),
        h('div',{class:'tile'}, h('b',{text:dfb.length ? avg(dfb.map(s => s.feedback.overall)).toFixed(1) : '–'}), h('span',{text:'drill review quality'}))));
      const bySkill = new Map();
      for (const s of dsubs){ const q = S.questions.get(s.questionId); const keys = (q && q.skills ? q.skills.split(/[;,]/).map(x => x.trim()).filter(Boolean) : [q && q.topic || 'untagged']); for (const k of keys){ let x = bySkill.get(k); if (!x){ x = {k, n:0, pass:0, ratios:[]}; bySkill.set(k, x); } x.n++; if (gateStatus(s) === 'pass') x.pass++; if (q && q.gates[0].minutes) x.ratios.push((s.gateSec || 0) / (q.gates[0].minutes * 60)); } }
      const two = h('div',{class:'ins', style:'margin-top:8px'});
      const sk = h('section',null, h('h4',{text:'By skill'}), h('p',{class:'sub', text:'Bar: share passed. Tick at 100%.'}));
      for (const x of [...bySkill.values()].sort((a,b) => a.pass/a.n - b.pass/b.n || b.n - a.n).slice(0, 10)) sk.append(h('div',{class:'hbar'}, h('div',null, x.k, h('span',{class:'n', text:`${x.n} drill${x.n===1?'':'s'}` + (x.ratios.length ? `, ${Math.round(median(x.ratios.map(r => r*100)))}% of budget` : '')})), bar(x.pass / x.n, x.pass / x.n >= .8 ? 'good' : x.pass / x.n >= .5 ? 'warn' : 'bad'), h('span',{class:'val', text:`${x.pass}/${x.n}`})));
      two.append(sk);
      const gs = S.gyms.map(g => ({g, st:gymStats(g)})).filter(x => x.st.done.length);
      const gsec2 = h('section',null, h('h4',{text:'Gym sessions'}), h('p',{class:'sub', text:'Share of drills passed per session, in order; hover for the focus.'}));
      if (gs.length >= 2) gsec2.append(lineChart(gs.map(x => ({x:fmtDate(x.g.startedAt), y:x.st.passed.length / x.st.done.length * 100, tip:`${x.g.focusLabel || x.g.focus}: ${x.st.passed.length}/${x.st.done.length} passed, ${fmtSec(x.st.time)}` + (x.st.quality != null ? `, quality ${x.st.quality.toFixed(1)}` : '')})), {max:100, fmt:v => Math.round(v) + '%', label:'Drills passed per gym session'}));
      if (gs.filter(x => x.st.quality != null).length >= 2) gsec2.append(h('p',{class:'sub', style:'margin-top:10px', text:'Review quality per session.'}), lineChart(gs.filter(x => x.st.quality != null).map(x => ({x:fmtDate(x.g.startedAt), y:x.st.quality, tip:`${x.g.focusLabel || x.g.focus}: ${x.st.quality.toFixed(1)} of 5`})), {label:'Quality per gym session'}));
      if (gs.length < 2) gsec2.append(h('p',{class:'none', text:'Needs two sessions.'}));
      gsec2.append(h('div',{class:'row', style:'margin-top:8px'}, h('a',{class:'btn small', href:'#/gym', text:'Open the gym'})));
      two.append(gsec2);
      drsec.append(two);
    }
    grid.append(drsec);
  }

  // ---- table
  const tsec2 = h('section',{class:'wide'}, h('h3',{text:'All submissions'}));
  tsec2.append(h('table',null, h('thead',null, h('tr',null, h('th',{text:'When'}), h('th',{text:'Question'}), h('th',{text:'Part'}), h('th',{class:'num', text:'Part time'}), h('th',{class:'num', text:'Tests'}), h('th',{class:'num', text:'Lines'}), h('th',{class:'num', text:'cpm'}), h('th',{class:'num', text:'Asked'}), h('th',{class:'num', text:'Quality'}), h('th',{text:'Gaps'}))),
    h('tbody',null, subs.slice().reverse().slice(0,200).map(s => { const q = S.questions.get(s.questionId); const gi = q ? q.gates.findIndex(g => g.id === s.gateId) : -1;
      return h('tr',null, h('td',{text:fmtDateTime(s.at)}), h('td',null, h('a',{href:'#/q/' + s.questionId, text:q ? q.title : s.questionId})), h('td',{text:gi >= 0 ? `${gi+1}. ${q.gates[gi].title}` : s.gateId}),
        h('td',{class:'num', text:fmtSec(s.gateSec)}), h('td',{class:'num ' + (gateStatus(s) === 'pass' ? 'ok' : 'fail'), text:s.total ? `${s.passed}/${s.total}` : '–'}), h('td',{class:'num', text:s.lines ? String(s.lines) : '–'}), h('td',{class:'num', text:s.cpm ? String(s.cpm) : '–'}), h('td',{class:'num', text:String(s.questionsAsked || 0)}), h('td',{class:'num', text:s.feedback ? s.feedback.overall + '/5' : '–'}), h('td',{text:s.feedback ? s.feedback.gaps.map(x => (SKILLS[x]||[x])[0]).join(', ') : ''})); }))));
  grid.append(tsec2);
  app.append(grid);
}

/* ---------- drills ---------- */
function renderDrills(){
  const drills = [...S.questions.values()].filter(q => q.kind === 'drill').sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  const fulls = [...S.questions.values()].filter(q => q.kind !== 'drill');
  app.append(h('div',{class:'page-head'}, h('div',null, h('h2',{text:'Drills'}), h('p',{text:'Short single-part exercises, 10–15 minutes each, for when you want reps rather than a full round. Claude writes them around a skill or topic, in the style of your own questions, and verifies the tests before saving.'})), h('div',{class:'row'}, h('a',{class:'btn primary', href:'#/gym', text:'Go to the gym'}), h('a',{class:'btn', href:'#/analytics#drills', text:'Drill analytics'}))));
  const focusOpts = [...Object.entries(SKILLS).map(([k,[n]]) => ['skill:' + k, n + ' (skill)']), ...[...new Set(fulls.map(q => q.topic).filter(Boolean))].map(t => ['topic:' + t, t + ' (topic)'])];
  const pre = S.drillFocus ? 'skill:' + S.drillFocus : focusOpts[0] && focusOpts[0][0]; S.drillFocus = null;
  const out = h('div');
  const gen = h('details',{class:'draftbox', open:true},
    h('summary',null, h('strong',{text:'Make new drills'})),
    h('div',{class:'row', style:'margin-top:8px'},
      h('label',{class:'field', style:'flex:1;min-width:220px'}, h('span',{text:'Focus'}), h('select',{id:'drFocus'}, focusOpts.map(([v,l]) => h('option',{value:v, text:l, selected:v === pre})), h('option',{value:'custom', text:'Something else…'}))),
      h('label',{class:'field', style:'width:110px'}, h('span',{text:'How many'}), h('select',{id:'drCount'}, [1,2,3,4,5].map(n => h('option',{value:String(n), text:String(n), selected:n === 3})))),
      h('label',{class:'field', style:'width:120px'}, h('span',{text:'Minutes each'}), h('input',{type:'number', id:'drMin', value:'12', min:'5', max:'30'}))),
    h('label',{class:'field', style:'margin-top:8px'}, h('span',{text:'Anything specific (optional)'}), h('input',{type:'text', id:'drHint', placeholder:'e.g. grid simulations with simultaneous updates; or a custom focus if you picked “Something else”'})),
    h('div',{class:'row', style:'margin-top:8px'}, h('button',{class:'btn primary', id:'drBtn', disabled:!(S.health && S.health.hasKey), text:'Write drills with Claude', onclick:async e => {
      const sel = $('#drFocus').value, hint = $('#drHint').value.trim();
      const focus = sel === 'custom' ? (hint || 'general problem solving') : sel.startsWith('skill:') ? SKILLS[sel.slice(6)][0] + ': ' + SKILLS[sel.slice(6)][1] : sel.slice(6);
      e.target.disabled = true; out.replaceChildren(h('div',{class:'thinking'}, h('span',{class:'dot'}), `Claude is writing ${$('#drCount').value} drill(s) and the server is verifying each one. Two to five minutes.`));
      try { const r = await API.call('POST', '/api/drills/generate', {focus, count:Number($('#drCount').value), minutes:Number($('#drMin').value), hint, examples:fulls.slice(0,2).map(q => q.id)});
        await loadIndex(); out.replaceChildren(); toast(`${r.made.length} drill${r.made.length===1?'':'s'} ready` + (r.errors.length ? `, ${r.errors.length} failed` : '') + '.'); render(); }
      catch(err){ out.replaceChildren(h('p',{class:'fail', text:err.message})); e.target.disabled = false; }
    }}), !(S.health && S.health.hasKey) && h('span',{class:'hist', text:'Needs Claude on the server: see Settings.'})),
    out);
  app.append(gen);
  if (!drills.length){ app.append(h('p',{class:'none', text:'No drills yet.'})); return; }
  const grid = h('div',{class:'qgrid', style:'margin-top:18px'});
  for (const q of drills){
    const atts = attemptsOf(q.id), last = atts[atts.length-1]; const s = last && last.gates.get(q.gates[0].id);
    grid.append(h('article',{class:'qcard'},
      h('h3',null, h('a',{href:'#/q/' + q.id, text:q.title})),
      h('div',{class:'qmeta'}, h('span',{class:'diff d-' + q.difficulty, text:q.difficulty[0].toUpperCase() + q.difficulty.slice(1)}), q.topic && h('span',{text:q.topic}), q.skills && h('span',{text:q.skills}), h('span',{text:(q.gates[0].minutes || '?') + ' min'})),
      h('div',{class:'stats'},
        h('div',{class:'stat'}, h('b',{text:s ? (gateStatus(s) === 'pass' ? 'Passed' : 'Failed') : '–'}), h('span',{text:s ? 'last attempt' : 'not attempted'})),
        h('div',{class:'stat'}, h('b',{text:s ? fmtSec(s.gateSec) : '–'}), h('span',{text:'time'})),
        h('div',{class:'stat'}, h('b',{text:s && s.feedback ? s.feedback.overall + '/5' : '–'}), h('span',{text:'quality'}))),
      h('div',{class:'row'}, h('a',{class:'btn primary small', href:'#/q/' + q.id + '/try', text:atts.length ? 'Again' : 'Start'}), h('a',{class:'btn small', href:'#/q/' + q.id, text:'History'}),
        h('button',{class:'btn quiet small', text:'Delete', onclick:async () => { if (!confirm('Delete this drill?')) return; await API.deleteQuestion(q.id); await loadIndex(); render(); }}))));
  }
  app.append(grid);
}

/* ---------- settings ---------- */
function renderSettings(){
  const hl = S.health;
  const box = h('div',{class:'settings'},
    h('h2',{text:'Settings'}),
    h('section',null, h('h3',{text:'Local backend'}),
      h('p',null, 'All questions, code and feedback live in a SQLite file on your own machine, served by ', h('code',{text:'server.py'}), '. This page only talks to that server; nothing is stored on GitHub.'),
      h('p',{class:hl ? 'ok' : 'fail', text:hl ? `Connected to ${Cfg.backend()} (data in ${hl.dataDir}; reviews ${hl.hasKey ? 'on via ' + (hl.reviewer === 'claude-code' ? 'Claude Code' : 'the API') : 'off'})` : `Not reachable at ${Cfg.backend()}. In the repo folder run: python server.py`}),
      h('label',{class:'field'}, h('span',{text:'Backend URL'}), h('input',{type:'url', id:'backendUrl', value:Cfg.get('backend'), placeholder:'http://localhost:8787'})),
      h('div',{class:'row'}, h('button',{class:'btn primary', text:'Save and reconnect', onclick:async () => { Cfg.set('backend', $('#backendUrl').value.trim()); await boot(); }}))),
    h('section',null, h('h3',{text:'Claude reviews'}),
      h('p',{text:hl ? (hl.reviewer === 'claude-code' ? `Reviews run through Claude Code on this machine, on your Claude plan (model ${hl.model}).` : hl.reviewer === 'api' ? `Reviews run through the Anthropic API (model ${hl.model}).` : 'Reviews are off.') : ''}),
      h('p',null, 'Two ways to turn them on. With a Claude Pro or Max plan: install Claude Code, run ', h('code',{text:'claude'}), ' once to sign in, then restart the server; it finds the ', h('code',{text:'claude'}), ' command and uses your plan, no API key needed. Or put an API key in ', h('code',{text:'config.json'}), ' in the data folder (', h('code',{text:'{"anthropicApiKey": "sk-ant-…"}'}), '), which is billed separately. Nothing about your account reaches this page.')),
    h('section',null, h('h3',{text:'Files, no clicks needed'}),
      h('p',null, 'Every question is a Markdown file in ', h('code',{text:hl ? hl.questionsDir : '~/.whetstone/questions'}), '; edit or add one there and the server picks it up within seconds, and edits made here are written back. Drop any question or backup file into ', h('code',{text:hl ? hl.inboxDir : '~/.whetstone/inbox'}), ' to import it. ', h('code',{text:hl ? hl.backupDir + '/latest.json' : '~/.whetstone/backup/latest.json'}), ' is a full export rewritten after every change, with daily snapshots beside it; if the database is ever empty the server restores from it on its own.')),
    h('section',null, h('h3',{text:'Interview dates'}),
      h('p',{text:'The countdown on the Questions page. A stage without a date shows TBD.'}),
      ((S.plan || DEFAULT_PLAN).stages || []).map((st, i) => h('label',{class:'field'}, h('span',{text:`${st.name}: ${(st.rounds || []).join(', ')}`}), h('input',{type:'datetime-local', value:st.date || '', 'data-stage':String(i)}))),
      h('div',{class:'row'}, h('button',{class:'btn primary', text:'Save dates', disabled:!hl, onclick:async () => { const plan = JSON.parse(JSON.stringify(S.plan || DEFAULT_PLAN)); for (const inp of document.querySelectorAll('input[data-stage]')) plan.stages[Number(inp.dataset.stage)].date = inp.value; try { S.plan = await API.putPlan(plan); toast('Dates saved.'); } catch(e){ toast(e.message); } }}))),
    h('section',null, h('h3',{text:'Backup and restore'}),
      h('p',{text:'Or from here: export everything as one JSON file, or import such a file to merge it in.'}),
      h('div',{class:'row'},
        h('button',{class:'btn', text:'Export JSON', disabled:!hl, onclick:async () => { try { const d = await API.export(); const blob = new Blob([JSON.stringify(d, null, 1)], {type:'application/json'}); const a = h('a',{href:URL.createObjectURL(blob), download:'whetstone-' + new Date().toISOString().slice(0,10) + '.json'}); document.body.append(a); a.click(); a.remove(); } catch(e){ toast(e.message); } }}),
        h('label',{class:'btn'}, 'Import JSON', h('input',{type:'file', accept:'application/json', hidden:true, disabled:!hl, onchange:async e => { const f = e.target.files[0]; if (!f) return; try { const r = await API.import(JSON.parse(await f.text())); toast(`Imported ${r.imported} record(s).`); await boot(); location.hash = '#/'; } catch(err){ toast('Import failed: ' + err.message); } }})))));
  app.append(box);
}

/* ---------- boot ---------- */
async function boot(){
  S.loading = true; render();
  await loadIndex();
  S.loading = false;
  const b = $('#banner');
  if (!S.health){ b.hidden = false; b.replaceChildren('The local backend is not running, so nothing can be loaded or saved. In the repo folder run ', h('code',{text:'python server.py'}), ', then reload. ', h('a',{href:'#/settings', text:'Settings'})); }
  else b.hidden = true;
  render();
}
boot();
})();
