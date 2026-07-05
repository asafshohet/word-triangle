'use strict';

// ---------- קבועים ----------

// מיקומי 9 העמדות על הלוח: 0-2 צלע ימין (מלמעלה למטה), 3-5 תחתית (מימין לשמאל), 6-8 שמאל (מלמטה למעלה)
const POSITIONS = [
  { x:352.5, y:180 }, { x:405, y:280 }, { x:457.5, y:380 },
  { x:405, y:480 },   { x:300, y:480 }, { x:195, y:480 },
  { x:142.5, y:380 }, { x:195, y:280 }, { x:247.5, y:180 },
];
const sideOfPos = i => Math.floor(i / 3);

const TO_FINAL = { 'מ':'ם', 'נ':'ן', 'צ':'ץ', 'פ':'ף', 'כ':'ך' };
const TO_BASE  = { 'ם':'מ', 'ן':'נ', 'ץ':'צ', 'ף':'פ', 'ך':'כ' };
const toBase = w => w.replace(/[םןץףך]/g, c => TO_BASE[c]);
function sofit(word){
  if(!word.length) return word;
  const last = word[word.length-1];
  return word.slice(0,-1) + (TO_FINAL[last] || last);
}

const DAY_MS = 86400000;

// ---------- מצב ----------

let puzzle = null;        // ‏{ id, sides, optimal, solution, words }
let dayNum = 1;           // מספר הפאזל שמוצג (יום)
let todayNum = 1;         // מספר הפאזל של היום
let letters = [];         // ‏[{ id, x, y, side }]
let letterIdx = new Map();// אות -> אינדקס עמדה
let wordSet = new Set();

let sessionPath = [];
let lastBoundaryPos = -1;
let coveredSet = new Set();
let usedWords = new Set();
let foundWords = [];
let won = false;
let everSolved = false; // נשאר true גם אחרי "שחקו שוב" — לצורך סימון בארכיון
let dragging = false;

// ---------- אחסון מקומי ----------

const stateKey = d => 'wt.day.' + d;

function saveState(){
  try{
    localStorage.setItem(stateKey(dayNum), JSON.stringify({ foundWords, solved: everSolved }));
  }catch(e){ /* מצב פרטי / אין אחסון */ }
}
function loadState(d){
  try{
    return JSON.parse(localStorage.getItem(stateKey(d)) || 'null');
  }catch(e){ return null; }
}
function loadStats(){
  try{
    return JSON.parse(localStorage.getItem('wt.stats') || 'null') || { streak: 0, lastDay: 0 };
  }catch(e){ return { streak: 0, lastDay: 0 }; }
}
function saveStats(stats){
  try{ localStorage.setItem('wt.stats', JSON.stringify(stats)); }catch(e){}
}

// רצף נשמר רק על פתרון הפאזל של היום עצמו
function recordWin(){
  if(dayNum !== todayNum) return loadStats();
  const stats = loadStats();
  if(stats.lastDay === todayNum) return stats;
  stats.streak = stats.lastDay === todayNum - 1 ? stats.streak + 1 : 1;
  stats.lastDay = todayNum;
  saveStats(stats);
  return stats;
}

// ---------- טעינת פאזל ----------

function dayNumberFor(epoch){
  const [y,m,d] = epoch.split('-').map(Number);
  const e = new Date(y, m-1, d);
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((t - e) / DAY_MS) + 1);
}

async function init(){
  let manifest;
  try{
    manifest = await fetch('data/puzzles/manifest.json').then(r => r.json());
  }catch(e){
    showMsg('שגיאה בטעינת הפאזל — יש לטעון את הדף משרת (לא כקובץ מקומי)');
    return;
  }
  todayNum = dayNumberFor(manifest.epoch);

  const p = parseInt(new URLSearchParams(location.search).get('p'), 10);
  dayNum = (p >= 1 && p <= todayNum) ? p : todayNum;

  const fileId = ((dayNum - 1) % manifest.count) + 1;
  puzzle = await fetch('data/puzzles/' + fileId + '.json').then(r => r.json());

  const flat = puzzle.sides.flat();
  letters = flat.map((ch, i) => ({ id: ch, x: POSITIONS[i].x, y: POSITIONS[i].y, side: sideOfPos(i) }));
  letterIdx = new Map(flat.map((ch, i) => [ch, i]));
  wordSet = new Set(puzzle.words);

  document.getElementById('puzzle-badge').textContent = 'פאזל #' + dayNum;
  document.getElementById('optimal-note').textContent =
    'המטרה: לכסות את כל תשע האותיות. הפתרון האופטימלי לפאזל הזה: ' + puzzle.optimal + ' מילים.';
  document.getElementById('solution-reveal').textContent = puzzle.solution.join(' ← ');

  renderBoard(); renderPath(); renderCurrentWord(); renderProgress(); renderFoundWords();
  bindPointer();

  const saved = loadState(dayNum);
  if(saved) everSolved = !!saved.solved;
  if(saved && saved.foundWords && saved.foundWords.length) restoreState(saved);
}

function restoreState(saved){
  for(const w of saved.foundWords){
    const base = toBase(w);
    if([...base].some(ch => !letterIdx.has(ch))) continue; // מצב ישן שלא תואם ללוח
    const start = sessionPath.length ? 1 : 0;
    for(let i = start; i < base.length; i++) sessionPath.push(letterIdx.get(base[i]));
    commitWord(w);
  }
  renderAll();
  if(coveredSet.size === 9){
    won = true;
    showSolvedBanner();
    updateDotStates(); // אחרי won כדי לצבוע הכל
    renderCurrentWord();
  }
}

// ---------- לוגיקת משחק ----------

function currentSlice(){
  return lastBoundaryPos === -1 ? sessionPath.slice() : sessionPath.slice(lastBoundaryPos);
}

function commitWord(word){
  usedWords.add(word);
  foundWords.push(word);
  for(const ch of toBase(word)) coveredSet.add(letterIdx.get(ch));
  lastBoundaryPos = sessionPath.length - 1;
}

function tryAddLetter(idx, fromDrag){
  if(won) return;
  if(sessionPath.length === 0){
    sessionPath.push(idx);
  } else {
    const last = sessionPath[sessionPath.length-1];
    if(idx === last) return;
    if(letters[idx].side === letters[last].side){
      if(!fromDrag){
        showMsg('לא ניתן לעבור פעמיים ברצף על אותה צלע');
        shakeBoard();
      }
      return;
    }
    sessionPath.push(idx);
  }
  showMsg('');
  renderPath(); updateDotStates(); renderCurrentWord();
}

function doBackspace(){
  if(won) return;
  const floor = lastBoundaryPos === -1 ? 0 : lastBoundaryPos + 1;
  if(sessionPath.length > floor){
    sessionPath.pop();
    renderPath(); updateDotStates(); renderCurrentWord();
    showMsg('');
  }
}

function doRestart(){
  if(won) return;
  if(!foundWords.length && !sessionPath.length) return;
  if(foundWords.length && !confirm('להתחיל את הפאזל מההתחלה? המילים שנמצאו יימחקו.')) return;
  sessionPath = [];
  lastBoundaryPos = -1;
  coveredSet = new Set();
  usedWords = new Set();
  foundWords = [];
  saveState();
  renderAll();
  showMsg('');
}

function doConfirm(){
  if(won) return;
  const slice = currentSlice();
  if(slice.length < 2){
    showMsg('מילה קצרה מדי — לפחות 2 אותיות'); shakeBoard(); return;
  }
  const raw = slice.map(i => letters[i].id).join('');
  const withFinal = sofit(raw);
  // מילים לועזיות עשויות להסתיים באות לא-סופית (למשל "טיפ"), לכן בודקים את שתי הצורות
  const word = wordSet.has(withFinal) ? withFinal : (wordSet.has(raw) ? raw : null);
  if(!word){
    showMsg('לא מוכר במילון הפאזל'); shakeBoard(); return;
  }
  if(usedWords.has(word)){
    showMsg('המילה הזו כבר נוצרה'); shakeBoard(); return;
  }
  commitWord(word);
  showMsg('מילה התקבלה: ' + word, true);
  renderFoundWords(); renderProgress(); updateDotStates(); renderCurrentWord();

  if(coveredSet.size === 9) winGame();
  saveState();
}

function winGame(){
  won = true;
  everSolved = true;
  saveState();
  const stats = recordWin();
  const n = foundWords.length;
  document.getElementById('win-text').textContent =
    n < puzzle.optimal
      ? 'מרשים! ניצחתם את הפתרון האופטימלי (' + puzzle.optimal + ') עם ' + n + ' מילים בלבד.'
      : n === puzzle.optimal
        ? 'פתרתם בדיוק כמו הפתרון האופטימלי — ' + n + ' מילים.'
        : 'כיסיתם את כל תשע האותיות ב-' + n + ' מילים. הפתרון האופטימלי הוא ' + puzzle.optimal + '.';
  document.getElementById('win-words').textContent = foundWords.join(' ← ');
  document.getElementById('win-streak').textContent =
    dayNum === todayNum && stats.streak > 1 ? '🔥 רצף של ' + stats.streak + ' ימים' : '';
  document.getElementById('win-overlay').classList.add('show');
  showSolvedBanner();
  renderCurrentWord();
}

function showSolvedBanner(){
  const n = foundWords.length;
  document.getElementById('solved-text').textContent =
    '✓ פתרתם את הפאזל הזה ב-' + n + ' מילים' + (n <= puzzle.optimal ? ' — אופטימלי!' : '');
  document.getElementById('solved-banner').classList.add('show');
  document.getElementById('controls').style.display = 'none';
}

function closeWinOverlay(){
  document.getElementById('win-overlay').classList.remove('show');
}

function playAgain(){
  sessionPath = [];
  lastBoundaryPos = -1;
  coveredSet = new Set();
  usedWords = new Set();
  foundWords = [];
  won = false;
  closeWinOverlay();
  document.getElementById('solved-banner').classList.remove('show');
  document.getElementById('controls').style.display = '';
  showMsg('');
  renderAll();
  saveState();
}

function revealSolution(){
  document.getElementById('solution-reveal').classList.add('show');
}

// ---------- שיתוף ----------

function shareResult(){
  const n = foundWords.length;
  const opt = n <= puzzle.optimal ? ' (אופטימלי!)' : '';
  const url = location.origin + location.pathname + (dayNum !== todayNum ? '?p=' + dayNum : '');
  const text = '🔺 משולש המילים #' + dayNum + ' — פתרתי ב-' + n + ' מילים' + opt + '\n' + url;
  if(navigator.share){
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(
      () => showMsg('התוצאה הועתקה — הדביקו איפה שרוצים', true),
      () => showMsg('ההעתקה נכשלה')
    );
  }
}

// ---------- ארכיון ----------

function toggleArchive(open){
  const panel = document.getElementById('archive-panel');
  if(!open){ panel.classList.remove('show'); return; }
  const list = document.getElementById('archive-list');
  let html = '';
  for(let d = todayNum; d >= 1; d--){
    const st = loadState(d);
    const solved = st && st.solved;
    html += '<a class="archive-item' + (d === todayNum ? ' today' : '') + '" href="?p=' + d + '">' +
      '<span>פאזל #' + d + (d === todayNum ? ' — היום' : '') + '</span>' +
      (solved ? '<span class="ai-solved">✓ נפתר</span>' : '<span class="ai-unsolved">—</span>') +
      '</a>';
  }
  list.innerHTML = html;
  panel.classList.add('show');
}

// ---------- רינדור ----------

function letterEl(idx){ return document.getElementById('dot-'+idx); }

function renderBoard(){
  const layer = document.getElementById('letters-layer');
  layer.innerHTML = '';
  letters.forEach((L, idx) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','letter-dot');
    g.setAttribute('id','dot-'+idx);
    g.dataset.idx = idx;
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx', L.x); c.setAttribute('cy', L.y); c.setAttribute('r', 31);
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', L.x); t.setAttribute('y', L.y+2);
    t.textContent = L.id;
    g.appendChild(c); g.appendChild(t);
    layer.appendChild(g);
  });
  updateDotStates();
}

function updateDotStates(){
  letters.forEach((L, idx) => {
    const el = letterEl(idx);
    if(!el) return;
    el.classList.remove('active','covered','current');
    if(coveredSet.has(idx)) el.classList.add('covered');
    if(!won && sessionPath.length && sessionPath[sessionPath.length-1] === idx) el.classList.add('current');
    else if(sessionPath.includes(idx) && !coveredSet.has(idx)) el.classList.add('active');
  });
}

function renderPath(){
  const pts = sessionPath.map(i => letters[i].x + ',' + letters[i].y).join(' L ');
  const d = sessionPath.length ? 'M ' + pts : '';
  document.getElementById('path-line').setAttribute('d', d);
}

function renderCurrentWord(){
  const slice = currentSlice();
  const el = document.getElementById('current-word');
  if(!slice.length || won){
    el.classList.remove('typing');
    el.innerHTML = won ? '' : '<span class="ph">לחצו על אות או גררו בין אותיות כדי להתחיל</span>';
    return;
  }
  el.textContent = slice.map(i => letters[i].id).join('');
  el.classList.add('typing');
}

function renderProgress(){
  document.getElementById('word-count').textContent = foundWords.length;
  document.getElementById('covered-count').textContent = coveredSet.size;
}

function renderFoundWords(){
  const list = document.getElementById('fw-list');
  if(!foundWords.length){
    list.innerHTML = '<span class="fw-empty">עדיין אין מילים</span>';
    return;
  }
  list.innerHTML = foundWords.map((w, i) =>
    '<span class="fw-chip"><span class="fw-n">'+(i+1)+'</span>'+w+'</span>'
  ).join('');
}

function renderAll(){
  renderPath(); updateDotStates(); renderCurrentWord(); renderProgress(); renderFoundWords();
}

function showMsg(text, ok){
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'msg' + (ok ? ' ok' : '');
}

function shakeBoard(){
  const stage = document.querySelector('.board-stage');
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
}

// ---------- קלט מגע/עכבר (לחיצה + גרירה) ----------

function svgPoint(svg, clientX, clientY){
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function hitLetter(svg, e, radius){
  const p = svgPoint(svg, e.clientX, e.clientY);
  for(let i = 0; i < letters.length; i++){
    const dx = p.x - letters[i].x, dy = p.y - letters[i].y;
    if(dx*dx + dy*dy <= radius*radius) return i;
  }
  return -1;
}

function bindPointer(){
  const svg = document.getElementById('board-svg');
  svg.addEventListener('pointerdown', e => {
    const idx = hitLetter(svg, e, 34);
    if(idx === -1) return;
    e.preventDefault();
    dragging = true;
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    tryAddLetter(idx, false);
  });
  svg.addEventListener('pointermove', e => {
    if(!dragging) return;
    // בגרירה נדרש מגע קרוב יותר למרכז האות, כדי שמעבר-אגב לא יוסיף אות בטעות
    const idx = hitLetter(svg, e, 28);
    if(idx === -1) return;
    if(sessionPath.length && sessionPath[sessionPath.length-1] === idx) return;
    tryAddLetter(idx, true);
  });
  const endDrag = () => { dragging = false; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}

// ---------- אתחול ----------

init();
