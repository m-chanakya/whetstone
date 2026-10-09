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
};
const DIMS = [['correctness','Correctness'],['efficiency','Efficiency'],['edgeCases','Edge cases'],['clarity','Clarity'],['extensibility','Extensibility']];
const VERDICT = ['','Not there yet','Shaky','Borderline','Solid','Strong'];
const LANGS = {python:'Python', javascript:'JavaScript'};

/* ---------- state ---------- */
const S = { loading:true, index:null, questions:new Map(), subs:[], view:null, attempt:null, busy:null, dirty:false };
const $ = s => document.querySelector(s);
const app = $('#app');
let curEditor = null, timerInt = null;

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
const str = (v,max) => (typeof v === 'string' ? v : '').trim().slice(0,max);
const clampInt = (v,lo,hi,d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi,Math.max(lo,n)) : d; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'question';
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const fmtDateTime = iso => new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function fmtSec(s){ s = Math.max(0, Math.round(s||0)); const m = Math.floor(s/60); return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}:${String(s%60).padStart(2,'0')}`; }
const avg = xs => xs.length ? xs.reduce((a,b) => a+b, 0)/xs.length : 0;
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
};

/* ---------- data ---------- */
async function loadIndex(){
  S.health = null;
  try { S.health = await API.health(); } catch(e){ S.health = null; }
  let idx = {questions:[], submissions:[]};
  if (S.health){ try { idx = await API.index(); } catch(e){ toast('The backend answered but the index failed: ' + e.message); } }
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
const summarizeS = s => ({id:s.id, questionId:s.questionId, gateId:s.gateId, attemptId:s.attemptId, at:s.at, elapsedSec:s.elapsedSec, gateSec:s.gateSec, lines:s.lines, passed:runOf(s).passed ?? null, total:runOf(s).total ?? null, runtime:runOf(s).runtime || null, status:s.status || 'grading', feedback:s.feedback || null});

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
  try { py.globals.set('__tests', JSON.stringify(tests.map(t => t.args))); py.globals.set('__entry', entry || ''); py.runPython(code); }
  catch(err){ error = String(err && err.message || err).split('\\n').filter(l => !/pyodide|_pyodide|<exec>/.test(l) || /Error/.test(l)).slice(-12).join('\\n'); }
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
function makeEditor(host, {value='', lang='python', onChange, placeholder='', readOnly=false, onRun, onSubmit, theme='default'}){
  if (window.CodeMirror){
    let silent = false;
    const cm = window.CodeMirror(host, {
      value, mode:lang === 'python' ? 'python' : 'javascript', lineNumbers:true, indentUnit:lang === 'python' ? 4 : 2, tabSize:4, indentWithTabs:false,
      matchBrackets:true, autoCloseBrackets:!readOnly, placeholder, readOnly, theme, lineWrapping:readOnly,
      extraKeys:{
        Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection(' '.repeat(c.getOption('indentUnit')),'end'),
        'Shift-Tab': c => c.indentSelection('subtract'), Esc: c => c.getInputField().blur(),
        'Cmd-Enter': () => onRun && onRun(), 'Ctrl-Enter': () => onRun && onRun(),
        'Shift-Cmd-Enter': () => onSubmit && onSubmit(), 'Shift-Ctrl-Enter': () => onSubmit && onSubmit(),
      },
    });
    cm.getInputField().setAttribute('aria-label', readOnly ? 'Code' : 'Code editor. Press Escape to leave the editor.');
    cm.on('change', () => { if (!silent && onChange) onChange(cm.getValue()); });
    requestAnimationFrame(() => cm.refresh());
    return {get:() => cm.getValue(), set:v => { silent = true; cm.setValue(v); silent = false; }, focus:() => cm.focus()};
  }
  const ta = h('textarea',{class:'plain', spellcheck:'false', placeholder, 'aria-label':'Code editor', value, readonly:readOnly,
    oninput:() => onChange && onChange(ta.value),
    onkeydown:e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onRun){ e.preventDefault(); onRun(); } }});
  host.append(ta);
  return {get:() => ta.value, set:v => { ta.value = v; }, focus:() => ta.focus()};
}

/* ---------- feedback ---------- */
function renderReview(fb){
  const dims = h('div',{class:'dims'}, DIMS.map(([k,label]) => h('div',{class:'dim'}, h('span',{text:label}), pips(fb.scores[k] || fb.overall))));
  const body = h('div',{class:'r-body'}, h('p',{class:'summary', text:fb.summary}));
  if (fb.issues && fb.issues.length) body.append(h('div',{class:'issues'}, fb.issues.map(i => h('div',{class:'issue sev-'+i.severity}, h('p',null, h('span',{class:'chip', text:(SKILLS[i.skill]||[i.skill])[0]}), i.note), i.fix && h('p',{class:'fix', text:i.fix})))));
  if (fb.strengths && fb.strengths.length) body.append(h('div',null, h('div',{class:'label', text:'What worked'}), h('ul',null, fb.strengths.map(s => h('li',{text:s})))));
  if (fb.gaps && fb.gaps.length) body.append(h('div',{class:'gaps'}, h('span',{class:'label', text:'Counted toward your weak areas:'}), fb.gaps.map(g => h('span',{class:'mark', text:(SKILLS[g]||[g])[0]}))));
  if (fb.nextStep) body.append(h('p',{class:'next'}, h('strong',{text:'Practise next: '}), fb.nextStep));
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
  const hash = location.hash.replace(/^#\/?/, '');
  const [p0, p1, p2] = hash.split('/');
  if (!p0) return {view:'questions'};
  if (p0 === 'analytics') return {view:'analytics', qid:p1};
  if (p0 === 'settings') return {view:'settings'};
  if (p0 === 'new') return {view:'edit'};
  if (p0 === 'q' && p1) return {view:p2 === 'edit' ? 'edit' : p2 === 'try' ? 'try' : 'question', qid:p1};
  return {view:'questions'};
}
window.addEventListener('hashchange', () => { if (S.attempt && !S.attempt.done && route().view !== 'try' && !confirm('Leave this attempt? Unsubmitted code is kept in the editor only until you leave.')){ location.hash = '#/q/' + S.attempt.qid + '/try'; return; } render(); });
function render(){
  const r = route(); S.view = r.view;
  for (const a of document.querySelectorAll('.tab')) a.toggleAttribute('aria-current', false), (a.dataset.view === r.view || (a.dataset.view === 'questions' && ['question','try','edit'].includes(r.view))) && a.setAttribute('aria-current','page');
  if (timerInt){ clearInterval(timerInt); timerInt = null; }
  curEditor = null; app.replaceChildren();
  if (S.loading){ app.append(h('div',{class:'loading', text:'Opening your notebook…'})); return; }
  if (r.view !== 'try'){ S.attempt = null; document.body.classList.remove('in-pad'); }
  if (r.view === 'questions') renderQuestions();
  else if (r.view === 'question') renderQuestion(r.qid);
  else if (r.view === 'try') renderTry(r.qid);
  else if (r.view === 'edit') renderEdit(r.qid);
  else if (r.view === 'analytics') renderAnalytics(r.qid);
  else renderSettings();
  window.scrollTo(0,0);
}

/* ---------- questions list ---------- */
function renderQuestions(){
  const qs = [...S.questions.values()].sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
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
      h('div',{class:'qmeta'}, h('span',{class:'diff d-' + q.difficulty, text:q.difficulty[0].toUpperCase() + q.difficulty.slice(1)}), q.topic && h('span',{text:q.topic}), h('span',{text:`${q.gates.length} part${q.gates.length===1?'':'s'}`}), h('span',{text:LANGS[q.lang] || q.lang}), null),
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

/* ---------- question detail / history ---------- */
async function renderQuestion(qid){
  const q = await fetchQuestion(qid); if (!q){ app.append(h('p',{class:'none', text:'That question is not in the index.'})); return; }
  if (S.view !== 'question') return;
  const atts = attemptsOf(qid).reverse();
  app.append(h('div',{class:'page-head'},
    h('div',null, h('a',{class:'btn quiet small', href:'#/', text:'All questions'}), h('h2',{style:'margin-top:8px', text:q.title}),
      h('p',{text:[q.topic, q.difficulty, q.source].filter(Boolean).join(', ')}), q.url && h('p',null, h('a',{href:q.url, target:'_blank', rel:'noopener', text:'Source'}))),
    h('div',{class:'row'}, h('a',{class:'btn primary', href:'#/q/' + qid + '/try', text:'Start an attempt'}), h('a',{class:'btn', href:'#/q/' + qid + '/edit', text:'Edit'}), h('a',{class:'btn', href:'#/analytics/' + qid, text:'Analytics'}),
      h('button',{class:'btn quiet', text:'Delete', onclick:async () => { if (!confirm('Delete this question and every submission for it?')) return; try { await API.deleteQuestion(qid); await boot(); location.hash = '#/'; } catch(e){ toast(e.message); } }}))));
  if (q.overview) app.append(h('div',{class:'prompt', style:'max-width:80ch;margin-bottom:18px', text:q.overview}));
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
    sec.append(h('h4',{style:'margin-top:8px', text:`${fmtDateTime(a.at)}: ${a.passed}/${q.gates.length} parts, ${fmtSec(a.totalSec)}${a.quality != null ? ', quality ' + a.quality.toFixed(1) : ''}`}), tbl);
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
async function renderTry(qid){
  const q = await fetchQuestion(qid); if (!q){ app.append(h('p',{class:'none', text:'That question is not in the index.'})); return; }
  if (S.view !== 'try') return;
  if (!S.attempt || S.attempt.qid !== qid){
    const prev = attemptsOf(qid); const lastSub = prev.length ? prev[prev.length-1].subs.slice(-1)[0] : null;
    S.attempt = {qid, id:tsId(), startedAt:Date.now(), gi:0, gateStartedAt:Date.now(), gateAcc:{}, code:'', results:{}, subs:{}, lastSub, done:false, pausedAt:0, pausedTotal:0, tab:'question', console:[], reached:0};
    if (q.lang === 'python') Runner.warm(m => { const el = $('#pyStatus'); if (el) el.textContent = m; });
  }
  document.body.classList.add('in-pad');
  const a = S.attempt, gate = q.gates[a.gi];
  const now = () => (a.pausedAt || Date.now()) - a.pausedTotal;
  const tAll = h('span',{class:'timer'}), tGate = h('span',{class:'timer'});
  const tick = () => {
    const all = (now() - a.startedAt)/1000, g = (a.gateAcc[a.gi] || 0) + (now() - a.gateStartedAt)/1000;
    tAll.textContent = fmtSec(all); tGate.textContent = fmtSec(g);
    tGate.classList.toggle('over', !!gate.minutes && g > gate.minutes*60);
    const budget = q.gates.reduce((s,x) => s + (x.minutes||0), 0); tAll.classList.toggle('over', !!budget && all > budget*60);
  };
  tick(); timerInt = setInterval(tick, 1000);
  const gatesNav = h('div',{class:'gates', role:'tablist'}, q.gates.map((g,i) => { const locked = i > a.reached; return h('button',{class:'gate' + (locked ? ' locked' : ''), role:'tab', disabled:locked, 'aria-current':i === a.gi ? 'true' : null, title:locked ? `Part ${i+1} is revealed when you submit part ${i}` : g.title, onclick:() => switchGate(q, i)}, h('span',{class:'pip ' + gateStatus(a.subs[g.id])}), locked ? `${i+1} 🔒` : `${i+1}`); }));
  const hasNext = a.gi < q.gates.length - 1, submittedHere = !!a.subs[gate.id];
  const topbar = h('div',{class:'padbar'},
    h('a',{class:'btn quiet small', href:'#/q/' + qid, text:'← ' + (q.title.length > 38 ? q.title.slice(0,36) + '…' : q.title)}),
    gatesNav,
    h('span',{class:'spacer'}),
    h('div',{class:'timers'}, h('div',null, tGate, h('small',{text:`part ${a.gi+1}${gate.minutes ? ' / ' + gate.minutes + ' min' : ''}`})), h('div',null, tAll, h('small',{text:'total'}))),
    h('button',{class:'btn quiet small', id:'pauseBtn', text:a.pausedAt ? 'Resume' : 'Pause', onclick:() => { if (a.pausedAt){ a.pausedTotal += Date.now() - a.pausedAt; a.pausedAt = 0; } else a.pausedAt = Date.now(); $('#pauseBtn').textContent = a.pausedAt ? 'Resume' : 'Pause'; tick(); }}),
    hasNext && submittedHere && h('button',{class:'btn small', text:'Next part →', title:'Move on like an interviewer would, even if tests still fail', onclick:() => advanceGate(q)}),
    h('button',{class:'btn quiet small', text:'Finish', onclick:() => finishAttempt(q)}));
  const tabs = h('div',{class:'ptabs'},
    h('button',{class:'ptab', 'aria-current':a.tab === 'question' ? 'true' : null, text:'Question', onclick:() => { a.tab = 'question'; render(); }}),
    h('button',{class:'ptab', 'aria-current':a.tab === 'feedback' ? 'true' : null, onclick:() => { a.tab = 'feedback'; render(); }}, 'Feedback', Object.keys(a.subs).length ? h('span',{class:'count', text:String(Object.keys(a.subs).length)}) : null));
  const left = h('aside',{class:'padleft'}, tabs, h('div',{class:'padscroll', id:'padleft'}));
  const edHost = h('div',{class:'editor pad-ed'});
  const console_ = h('div',{class:'console', id:'console'});
  const right = h('section',{class:'padright'},
    h('div',{class:'edbar'}, h('span',{class:'lang', text:LANGS[q.lang] || q.lang}), h('span',{class:'hist', id:'pyStatus'}), h('span',{class:'spacer'}),
      a.lastSub && !a.code && h('button',{class:'btn quiet small', text:'Load my last submission', onclick:async () => { const f = await fetchSubmission(a.lastSub); if (f.code){ a.code = f.code; curEditor.set(f.code); } }}),
      h('button',{class:'btn run', id:'runBtn', onclick:() => runCurrent(q)}, '▶ Run ', h('kbd',{text:'⌘↵'})),
      h('button',{class:'btn primary', id:'submitBtn', onclick:() => submitCurrent(q)}, `Submit part ${a.gi+1} `, h('kbd',{text:'⇧⌘↵'}))),
    edHost, console_);
  app.append(topbar, h('div',{class:'pad'}, left, right));
  renderPadLeft(q);
  curEditor = makeEditor(edHost, {value:a.code, lang:q.lang, theme:'pad', placeholder:'# Build on the same file as you move through the parts.', onChange:v => { a.code = v; }, onRun:() => runCurrent(q), onSubmit:() => submitCurrent(q)});
  renderConsole();
  curEditor.focus();
}
function renderPadLeft(q){
  const a = S.attempt, host = $('#padleft'); if (!a || !host) return;
  const gate = q.gates[a.gi];
  host.replaceChildren();
  if (a.tab === 'question'){
    host.append(h('h3',{text:`Part ${a.gi+1} of ${q.gates.length}: ${gate.title}`}), a.gi > 0 && h('p',{class:'hist', text:'Follow-up. Build on your current code; earlier parts should keep working.'}), h('div',{class:'prompt', text:gate.prompt}));
    if (a.gi < q.gates.length - 1) host.append(h('p',{class:'hist', text:`${q.gates.length - a.gi - 1} more part${q.gates.length - a.gi - 1 === 1 ? '' : 's'} follow; each is revealed when you submit the one before it.`}));
    host.append(h('p',{class:'hist', text:gate.entry ? `Tests call ${gate.entry}(...)` : 'No entry function set on this part.'}));
    if (a.gi > 0) host.append(h('details',{class:'earlier'}, h('summary',{text:'Earlier parts'}), q.gates.slice(0, a.gi).map((g,i) => h('div',null, h('h4',{text:`Part ${i+1}: ${g.title}`}), h('div',{class:'prompt small', text:g.prompt})))));
    if (q.overview) host.append(h('details',{class:'earlier', open:a.gi === 0}, h('summary',{text:'Overview'}), h('div',{class:'prompt small', text:q.overview})));
  } else {
    const ids = q.gates.map(g => g.id).filter(id => a.subs[id]);
    if (!ids.length) host.append(h('p',{class:'none', text:'Submit a part and its review shows here.'}));
    for (const id of ids.reverse()){
      const sub = a.subs[id], gi = q.gates.findIndex(g => g.id === id);
      host.append(h('h3',{text:`Part ${gi+1}: ${q.gates[gi].title}`}), h('p',{class:'hist', text:`${fmtSec(sub.gateSec)}, ${sub.browser && sub.browser.total ? sub.browser.passed + '/' + sub.browser.total + ' tests' : 'not run'}`}));
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
  if (!a.console.length){ c.append(h('div',{class:'cline muted', text:'Run tests to see output here. ⌘↵ runs, ⇧⌘↵ submits the part.'})); return; }
  for (const item of a.console.slice(-6)){
    if (item.kind === 'busy'){ c.append(h('div',{class:'cline'}, h('span',{class:'dot'}), ' ' + item.text)); continue; }
    const r = item.r;
    c.append(h('div',{class:'cline head'}, h('span',{class:'muted', text:item.when + '  '}), r.error ? h('span',{class:'fail', text:'Error'}) : h('span',{class:r.passed === r.total ? 'ok' : 'fail', text:`${r.passed} of ${r.total} passed`}), h('span',{class:'muted', text:'   ' + [r.runtime, r.ms != null ? r.ms + ' ms' : ''].filter(Boolean).join(', ')})));
    if (r.error) c.append(h('pre',{class:'cpre fail', text:r.error}));
    for (const g of r.cases || []) c.append(h('div',{class:'cline ' + (g.pass ? 'ok' : 'fail')}, (g.pass ? '✓ ' : '✗ ') + g.raw, !g.pass && h('span',{class:'got', text:'   ' + (g.err ? 'threw: ' : 'got: ') + g.got})));
    if (r.stdout) c.append(h('pre',{class:'cpre', text:r.stdout}));
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
async function runCurrent(q){
  const a = S.attempt, gate = q.gates[a.gi], btn = $('#runBtn'); if (!$('#console') || a.busy) return null;
  a.code = curEditor.get(); a.busy = true; btn.disabled = true;
  a.console.push({kind:'busy', text:'Running…'}); renderConsole();
  const r = await runGate(q, gate, a.code, m => { const last = a.console[a.console.length-1]; if (last && last.kind === 'busy'){ last.text = m; renderConsole(); } });
  a.busy = false; a.results[gate.id] = r;
  a.console = a.console.filter(x => x.kind !== 'busy'); a.console.push({kind:'run', r, when:new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'})});
  if (S.attempt === a && $('#console')){ renderConsole(); $('#runBtn').disabled = false; }
  return r;
}
async function submitCurrent(q){
  const a = S.attempt, gate = q.gates[a.gi]; if (a.busy) return;
  a.code = curEditor.get();
  if (a.code.trim().length < 10){ toast('Write something first.'); return; }
  const sb = $('#submitBtn'); sb.disabled = true;
  const r = await runCurrent(q);
  const nowMs = (a.pausedAt || Date.now()) - a.pausedTotal;
  const sub = {id:tsId() + '-' + gate.id, questionId:q.id, gateId:gate.id, attemptId:a.id, at:new Date().toISOString(), lang:q.lang, code:a.code, lines:a.code.split('\n').length,
    elapsedSec:Math.round((nowMs - a.startedAt)/1000), gateSec:Math.round((a.gateAcc[a.gi] || 0) + (nowMs - a.gateStartedAt)/1000),
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
  a.done = true; S.attempt = null; location.hash = '#/q/' + q.id;
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
  const draftInfo = isNew ? S.draftInfo : null; S.draftInfo = null;
  if (isNew && S.draftQ){ q = S.draftQ; S.draftQ = null; } else q = q ? clone(q) : {id:'', title:'', topic:'', difficulty:'medium', lang:'python', source:'', url:'', overview:'', gates:[{id:'g1', title:'Part 1', entry:'', minutes:15, prompt:'', tests:''}], createdAt:new Date().toISOString()};
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
      h('label',{class:'field'}, h('span',{text:'Prompt for this part'}), h('textarea',{rows:'6', value:g.prompt, placeholder:'What changes or is added in this part, and what the function must return.', oninput:e => { g.prompt = e.target.value; }})),
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
  const form = h('div',{class:'form'},
    h('h2',{text:isNew ? 'Add a question' : 'Edit question'}),
    draftBox,
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

/* ---------- analytics ---------- */
function bar(frac, cls, marker){
  const b = h('div',{class:'bar'}, h('i',{class:cls || '', style:`width:${Math.max(0, Math.min(100, frac*100)).toFixed(1)}%`}));
  if (marker != null) b.append(h('s',{style:`left:${Math.max(0, Math.min(100, marker*100)).toFixed(1)}%`, title:'budget'}));
  return b;
}
function renderAnalytics(qidFilter){
  const qs = [...S.questions.values()].filter(q => !qidFilter || q.id === qidFilter);
  const q0 = qidFilter && S.questions.get(qidFilter);
  app.append(h('div',{class:'page-head'}, h('div',null, h('h2',{text:q0 ? 'Analytics: ' + q0.title : 'Analytics'}), h('p',{text:'Gates reached, time spent against budget, and what the feedback keeps flagging. Latest attempt per question unless stated.'})),
    q0 && h('a',{class:'btn small', href:'#/analytics', text:'All questions'})));
  const rows = []; // one per question: latest attempt
  const allAtts = [];
  for (const q of qs){ const atts = attemptsOf(q.id); allAtts.push(...atts.map(a => ({...a, q}))); if (atts.length) rows.push({q, a:atts[atts.length-1], atts}); }
  const subs = S.subs.filter(s => !qidFilter || s.questionId === qidFilter);
  const fbs = subs.map(s => s.feedback).filter(Boolean);
  if (!subs.length){ app.append(h('p',{class:'none', text:'Nothing to show yet. Submit a part of a question and the numbers appear here.'})); return; }
  const gatesTotal = rows.reduce((s,r) => s + r.q.gates.length, 0), gatesPassed = rows.reduce((s,r) => s + r.a.passed, 0);
  app.append(h('div',{class:'tiles'},
    h('div',{class:'tile'}, h('b',{text:String(rows.length)}), h('span',{text:'questions attempted'})),
    h('div',{class:'tile'}, h('b',{text:String(allAtts.length)}), h('span',{text:'attempts'})),
    h('div',{class:'tile'}, h('b',{text:gatesTotal ? Math.round(gatesPassed/gatesTotal*100) + '%' : '–'}), h('span',{text:'parts passed, latest attempts'})),
    h('div',{class:'tile'}, h('b',{text:fbs.length ? avg(fbs.map(f => f.overall)).toFixed(1) : '–'}), h('span',{text:fbs.length ? `code quality, ${fbs.length} reviews` : 'no reviews yet'})),
    h('div',{class:'tile'}, h('b',{text:fmtSec(avg(allAtts.map(a => a.totalSec)))}), h('span',{text:'average attempt length'}))));
  const grid = h('div',{class:'ins'});

  // Interview readiness: the usual bar is three clean parts inside the budget
  const ready = h('section',{class:'wide'}, h('h3',{text:'Interview readiness'}), h('p',{class:'sub', text:'Interviewers usually pass a candidate who clears the first three parts cleanly and in time. Every attempt counts here, not only the latest.'}));
  const K = 3, eligible = allAtts.filter(a => a.q.gates.length >= K);
  if (!eligible.length) ready.append(h('p',{class:'none', text:'Needs questions with at least three parts.'}));
  else {
    const first = a => a.q.gates.slice(0, K).map(g => a.gates.get(g.id));
    const clean = eligible.filter(a => first(a).every(s => s && gateStatus(s) === 'pass'));
    const inTime = clean.filter(a => { const gs = a.q.gates.slice(0, K); const budget = gs.reduce((x,g) => x + (g.minutes||0)*60, 0); return !budget || first(a).reduce((x,s) => x + (s.gateSec||0), 0) <= budget; });
    const strong = inTime.filter(a => { const f = first(a).map(s => s.feedback && s.feedback.overall).filter(Boolean); return f.length === K && avg(f) >= 4; });
    const line = (label, n, note) => ready.append(h('div',{class:'hbar'}, h('div',null, label, h('span',{class:'n', text:note})), bar(n/eligible.length, n/eligible.length >= .7 ? 'good' : n/eligible.length >= .4 ? 'warn' : 'bad'), h('span',{class:'val', text:`${n} of ${eligible.length}`})));
    line('Parts 1–3 all tests passing', clean.length, 'correctness bar');
    line('…and inside the time budget', inTime.length, 'pace bar');
    line('…with code quality 4+ on each', strong.length, 'what a strong hire looks like');
    const stall = new Map(); for (const a of eligible) for (let i = 0; i < K; i++){ const s = a.gates.get(a.q.gates[i].id); if (!s || gateStatus(s) !== 'pass'){ stall.set(i, (stall.get(i)||0) + 1); break; } }
    if (stall.size) ready.append(h('p',{class:'sub', style:'margin-top:8px', text:'Where the first three parts break down: ' + [...stall.entries()].sort((x,y) => y[1]-x[1]).map(([i,n]) => `part ${i+1} (${n})`).join(', ') + '.'}));
  }
  grid.append(ready);

  // Per-question gate funnel: time per part vs budget
  const fun = h('section',{class:'wide'}, h('h3',{text:'Time per part against budget'}), h('p',{class:'sub', text:'Latest attempt. Bar is time spent; the tick is the part budget. Red: tests failed; amber: partial; green: passed.'}));
  for (const {q, a} of rows){
    fun.append(h('h4',{style:'margin-top:8px'}, h('a',{href:'#/q/' + q.id, text:q.title, style:'color:inherit;text-decoration:none'})));
    const maxSec = Math.max(...q.gates.map(g => (g.minutes||0)*60), ...[...a.gates.values()].map(s => s.gateSec||0), 60);
    q.gates.forEach((g,i) => { const s = a.gates.get(g.id); const st = gateStatus(s);
      fun.append(h('div',{class:'hbar'}, h('div',null, `${i+1}. ${g.title}`, h('span',{class:'n', text:s ? (s.total ? `${s.passed}/${s.total} tests` : 'not run') : 'not reached'})),
        bar(s ? (s.gateSec||0)/maxSec : 0, st === 'pass' ? 'good' : st === 'part' ? 'warn' : st === 'fail' ? 'bad' : '', g.minutes ? g.minutes*60/maxSec : null),
        h('span',{class:'val', text:s ? fmtSec(s.gateSec) : '–'}))); });
  }
  grid.append(fun);

  // Across questions: pass rate and time ratio by part position
  if (!qidFilter && rows.length > 1){
    const byPos = new Map();
    for (const {q, a} of rows) q.gates.forEach((g,i) => { const s = a.gates.get(g.id); let p = byPos.get(i); if (!p){ p = {n:0, reached:0, passed:0, ratios:[]}; byPos.set(i, p); } p.n++; if (s){ p.reached++; if (gateStatus(s) === 'pass') p.passed++; if (g.minutes) p.ratios.push((s.gateSec||0)/(g.minutes*60)); } });
    const sec = h('section',null, h('h3',{text:'Where attempts stall'}), h('p',{class:'sub', text:'By part position, across questions: how often each part is reached and passed, and time taken as a share of its budget.'}));
    for (const [i,p] of [...byPos.entries()].sort((x,y) => x[0]-y[0])){
      sec.append(h('div',{class:'hbar'}, h('div',null, `Part ${i+1}`, h('span',{class:'n', text:`reached ${p.reached}/${p.n}, passed ${p.passed}/${p.n}`})), bar(p.n ? p.passed/p.n : 0, 'good'), h('span',{class:'val', text:p.n ? Math.round(p.passed/p.n*100) + '%' : '–'})));
      if (p.ratios.length) sec.append(h('div',{class:'hbar'}, h('div',null, h('span',{class:'n', text:'time vs budget'})), bar(Math.min(avg(p.ratios), 2)/2, avg(p.ratios) > 1 ? 'bad' : 'warn', 0.5), h('span',{class:'val', text:Math.round(avg(p.ratios)*100) + '%'})));
    }
    grid.append(sec);
  }

  // Code quality dimensions
  const dsec = h('section',null, h('h3',{text:'Code quality'}), h('p',{class:'sub', text:fbs.length ? `Average of ${fbs.length} reviews, lowest first.` : 'Appears once submissions have been reviewed.'}));
  if (fbs.length){
    const dims = DIMS.map(([k,label]) => ({label, v:avg(fbs.map(f => f.scores[k] || f.overall))})).sort((a,b) => a.v-b.v);
    for (const d of dims) dsec.append(h('div',{class:'hbar'}, h('div',null, d.v < 3 ? h('span',{class:'mark', text:d.label}) : h('span',{style:'font-weight:600', text:d.label})), bar((d.v-1)/4, d.v < 2.5 ? 'bad' : d.v < 3.5 ? 'warn' : 'good'), h('span',{class:'val', text:d.v.toFixed(1)})));
    const byTopic = new Map();
    for (const s of subs) if (s.feedback){ const q = S.questions.get(s.questionId); const t = (q && q.topic) || 'No topic'; if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t).push(s.feedback.overall); }
    if (byTopic.size > 1){ dsec.append(h('p',{class:'sub', style:'margin-top:10px', text:'By topic'})); for (const [t,xs] of [...byTopic.entries()].sort((a,b) => avg(a[1])-avg(b[1]))) dsec.append(h('div',{class:'hbar'}, h('div',null, t, h('span',{class:'n', text:`${xs.length} review${xs.length===1?'':'s'}`})), bar((avg(xs)-1)/4, avg(xs) < 2.5 ? 'bad' : avg(xs) < 3.5 ? 'warn' : 'good'), h('span',{class:'val', text:avg(xs).toFixed(1)}))); }
  }
  grid.append(dsec);

  // Recurring gaps
  const gsec = h('section',null, h('h3',{text:'Gaps that keep coming up'}));
  const gaps = new Map();
  for (const s of subs) if (s.feedback) for (const g of s.feedback.gaps || []){ let x = gaps.get(g); if (!x){ x = {skill:g, count:0, items:[]}; gaps.set(g, x); } x.count++; const q = S.questions.get(s.questionId); const gate = q && q.gates.find(z => z.id === s.gateId); const note = (s.feedback.issues || []).find(i => i.skill === g); x.items.push({q, gate, s, note:note ? note.note : s.feedback.summary}); }
  if (!gaps.size) gsec.append(h('p',{class:'none', text:'No recurring gaps flagged yet.'}));
  for (const g of [...gaps.values()].sort((a,b) => b.count-a.count)) gsec.append(h('details',{class:'gap'},
    h('summary',null, h('span',null, h('strong',{text:SKILLS[g.skill][0]}), h('span',{class:'desc', text:SKILLS[g.skill][1]})), bar(g.count/fbs.length, 'warn'), h('span',{class:'val', text:`${g.count} of ${fbs.length}`})),
    h('div',{class:'gap-items'}, g.items.map(it => h('div',null, h('a',{href:'#/q/' + (it.q ? it.q.id : ''), text:(it.q ? it.q.title : it.s.questionId) + (it.gate ? ', ' + it.gate.title : '')}), h('div',{text:it.note}))))));
  grid.append(gsec);

  // Progress over attempts
  const psec = h('section',null, h('h3',{text:'Progress over attempts'}), h('p',{class:'sub', text:'Each bar is one attempt: height is parts passed, hover for time.'}));
  for (const {q, atts} of rows){ if (atts.length < 2 && !qidFilter) continue;
    psec.append(h('div',{style:'margin-bottom:12px'}, h('div',{class:'hist', text:q.title}), h('div',{class:'spark'}, atts.map(a => h('i',{class:a.passed ? '' : 'fail', style:`height:${Math.max(8, a.passed/q.gates.length*100)}%`, 'data-t':`${fmtDate(a.at)}: ${a.passed}/${q.gates.length} parts, ${fmtSec(a.totalSec)}`})))));
  }
  if (!psec.querySelector('.spark')) psec.append(h('p',{class:'none', text:'Shows once a question has more than one attempt.'}));
  grid.append(psec);

  // Table for the record
  const tsec = h('section',{class:'wide'}, h('h3',{text:'All submissions'}));
  tsec.append(h('table',null, h('thead',null, h('tr',null, h('th',{text:'When'}), h('th',{text:'Question'}), h('th',{text:'Part'}), h('th',{class:'num', text:'Part time'}), h('th',{class:'num', text:'Tests'}), h('th',{class:'num', text:'Quality'}), h('th',{text:'Gaps'}))),
    h('tbody',null, subs.slice().reverse().slice(0,200).map(s => { const q = S.questions.get(s.questionId); const gi = q ? q.gates.findIndex(g => g.id === s.gateId) : -1;
      return h('tr',null, h('td',{text:fmtDateTime(s.at)}), h('td',null, h('a',{href:'#/q/' + s.questionId, text:q ? q.title : s.questionId})), h('td',{text:gi >= 0 ? `${gi+1}. ${q.gates[gi].title}` : s.gateId}),
        h('td',{class:'num', text:fmtSec(s.gateSec)}), h('td',{class:'num ' + (gateStatus(s) === 'pass' ? 'ok' : 'fail'), text:s.total ? `${s.passed}/${s.total}` : '–'}), h('td',{class:'num', text:s.feedback ? s.feedback.overall + '/5' : '–'}), h('td',{text:s.feedback ? s.feedback.gaps.map(x => (SKILLS[x]||[x])[0]).join(', ') : ''})); }))));
  grid.append(tsec);
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
