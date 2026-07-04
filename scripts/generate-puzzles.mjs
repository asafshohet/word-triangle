#!/usr/bin/env node
// גנרטור פאזלים למשולש המילים.
//
// שימוש:
//   node scripts/generate-puzzles.mjs --count 60          יצירת 60 פאזלים חדשים (מתווספים לבנק)
//   node scripts/generate-puzzles.mjs --letters "מ,ר,א|ה,ב,ל|ו,ת,י" [--save]
//                                                          פתרון/אימות סט אותיות נתון
//   node scripts/generate-puzzles.mjs --regen              חישוב מחדש של כל הבנק מהמילון הנוכחי
//   node scripts/generate-puzzles.mjs --verify             בדיקה עצמית של כל הבנק
//
// פאזל תקין: לפחות MIN_WORDS מילים משחקיות, ופתרון של 2-3 מילים המורכב כולו
// ממילים בתוך COMMON_CUTOFF המילים הנפוצות. ה"אופטימלי" המוצג לשחקן מבוסס על
// מילים נפוצות בלבד (כמו "פר" בגולף) — שחקן שמנצח אותו בעזרת מילה נדירה פשוט ניצח את הפר.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_FILE = path.join(ROOT, 'data', 'dictionary.txt');
const PUZZLES_DIR = path.join(ROOT, 'data', 'puzzles');
const MANIFEST_FILE = path.join(PUZZLES_DIR, 'manifest.json');

const EPOCH = '2026-07-04'; // היום שבו פאזל #1 עולה לאוויר
const MIN_WORDS = 80;       // מינימום מילים משחקיות בפאזל
const COMMON_CUTOFF = 8000; // מילות הפתרון לדוגמה חייבות להיות בטווח הזה
const PARTITIONS_PER_SET = 6; // כמה חלוקות-לצלעות לנסות לכל סט אותיות

const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
const toBoard = w => w.replace(/[םןץףך]/g, c => FINALS[c]);

// ---------- מילון ----------

async function loadDictionary() {
  const words = (await readFile(DICT_FILE, 'utf8')).split(/\r?\n/).filter(Boolean);
  return words.map((word, rank) => ({ word, base: toBoard(word), rank }));
}

// ---------- בדיקת משחקיות ופתרון ----------

// sideOf: Map אות->צלע. מילה משחקית אם כל אותיותיה על הלוח ואין שתי אותיות עוקבות באותה צלע.
function isPlayable(base, sideOf) {
  let prev = -1;
  for (const ch of base) {
    const s = sideOf.get(ch);
    if (s === undefined || s === prev) return false;
    prev = s;
  }
  return true;
}

// פותר כיסוי מינימלי: BFS על מצבים (מסכת אותיות מכוסות, אות אחרונה).
// entries: [{word, base, rank}] משחקיות בלבד, בסדר תדירות.
// מחזיר { min, solution } או null אם אין כיסוי מלא.
function solve(entries, letterIndex) {
  const FULL = 511;
  const enc = e => {
    let mask = 0;
    for (const ch of e.base) mask |= 1 << letterIndex.get(ch);
    return { mask, endIdx: letterIndex.get(e.base[e.base.length - 1]), entry: e };
  };
  const words = entries.map(enc);

  // אינדקס מילים לפי אות פותחת
  const byStart = new Map();
  for (const w of words) {
    const startIdx = letterIndex.get(w.entry.base[0]);
    if (!byStart.has(startIdx)) byStart.set(startIdx, []);
    byStart.get(startIdx).push(w);
  }

  const key = (mask, endIdx) => mask * 9 + endIdx;
  const visited = new Map(); // key -> { parentKey, entry }
  let queue = [];

  for (const w of words) {
    const k = key(w.mask, w.endIdx);
    if (!visited.has(k)) {
      visited.set(k, { parentKey: -1, entry: w.entry });
      queue.push(k);
    }
  }

  const reconstruct = k => {
    const sol = [];
    while (k !== -1) {
      const node = visited.get(k);
      sol.unshift(node.entry.word);
      k = node.parentKey;
    }
    return sol;
  };

  for (let depth = 1; depth <= 5 && queue.length; depth++) {
    for (const k of queue) {
      if (Math.floor(k / 9) === FULL) return { min: depth, solution: reconstruct(k) };
    }
    const next = [];
    for (const k of queue) {
      const mask = Math.floor(k / 9), endIdx = k % 9;
      for (const w of byStart.get(endIdx) || []) {
        const nk = key(mask | w.mask, w.endIdx);
        if (!visited.has(nk)) {
          visited.set(nk, { parentKey: k, entry: w.entry });
          next.push(nk);
        }
      }
    }
    queue = next;
  }
  return null;
}

// מנתח לוח נתון: מילים משחקיות + פתרון מלא + פתרון ממילים נפוצות בלבד.
function analyzeBoard(sides, dict) {
  const sideOf = new Map();
  sides.forEach((side, si) => side.forEach(ch => sideOf.set(ch, si)));
  const flat = sides.flat();
  const letterIndex = new Map(flat.map((ch, i) => [ch, i]));

  const playable = dict.filter(e => isPlayable(e.base, sideOf));
  if (playable.length < 2) return { playable, full: null, common: null };

  const full = solve(playable, letterIndex);
  const common = solve(playable.filter(e => e.rank < COMMON_CUTOFF), letterIndex);
  return { playable, full, common };
}

// ---------- דגימת סטים ----------

function letterFrequencies(dict) {
  const freq = new Map();
  for (const e of dict) for (const ch of e.base) freq.set(ch, (freq.get(ch) || 0) + 1);
  return freq;
}

function sampleLetters(freq, rand) {
  const pool = [...freq.entries()];
  const picked = [];
  for (let n = 0; n < 9; n++) {
    const total = pool.reduce((s, [, c]) => s + c, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx][1];
      if (r <= 0) break;
    }
    picked.push(pool[idx][0]);
    pool.splice(idx, 1);
  }
  return picked;
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- בנק פאזלים ----------

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
  } catch {
    return { epoch: EPOCH, count: 0 };
  }
}

async function existingSignatures() {
  const sigs = new Set();
  let files = [];
  try { files = await readdir(PUZZLES_DIR); } catch { return sigs; }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    const p = JSON.parse(await readFile(path.join(PUZZLES_DIR, f), 'utf8'));
    sigs.add(p.sides.flat().slice().sort().join(''));
  }
  return sigs;
}

function toPuzzle(id, sides, analysis) {
  return {
    id,
    sides,
    optimal: analysis.common.min,
    solution: analysis.common.solution,
    words: analysis.playable.map(e => e.word),
  };
}

async function savePuzzle(puzzle) {
  await writeFile(
    path.join(PUZZLES_DIR, `${puzzle.id}.json`),
    JSON.stringify(puzzle), 'utf8'
  );
}

function acceptable(analysis) {
  return analysis.playable.length >= MIN_WORDS
    && analysis.common && analysis.common.min >= 2 && analysis.common.min <= 3;
}

function report(sides, analysis) {
  console.log(`צלעות: ${sides.map(s => s.join(',')).join(' | ')}`);
  console.log(`מילים משחקיות: ${analysis.playable.length}`);
  if (!analysis.full) { console.log('אין כיסוי מלא — הפאזל לא פתיר'); return; }
  console.log(`כיסוי מינימלי: ${analysis.full.min} מילים (${analysis.full.solution.join(' ← ')})`);
  if (analysis.common) {
    console.log(`פתרון ממילים נפוצות: ${analysis.common.min} מילים (${analysis.common.solution.join(' ← ')})`);
  } else {
    console.log(`אין פתרון ממילים נפוצות (בטווח ${COMMON_CUTOFF})`);
  }
  console.log(acceptable(analysis) ? 'הפאזל עומד בקריטריונים ✓' : 'הפאזל לא עומד בקריטריונים ✗');
}

// ---------- פקודות ----------

async function cmdCount(n, dict) {
  await mkdir(PUZZLES_DIR, { recursive: true });
  const manifest = await loadManifest();
  const sigs = await existingSignatures();
  const freq = letterFrequencies(dict);
  const rand = Math.random;

  let made = 0, attempts = 0;
  const MAX_ATTEMPTS = 50000;

  while (made < n && attempts < MAX_ATTEMPTS) {
    attempts++;
    const letters = sampleLetters(freq, rand);
    const sig = letters.slice().sort().join('');
    if (sigs.has(sig)) continue;

    for (let t = 0; t < PARTITIONS_PER_SET; t++) {
      const sh = shuffle(letters, rand);
      const sides = [sh.slice(0, 3), sh.slice(3, 6), sh.slice(6, 9)];
      const analysis = analyzeBoard(sides, dict);
      if (!acceptable(analysis)) continue;

      sigs.add(sig);
      made++;
      const id = manifest.count + made;
      await savePuzzle(toPuzzle(id, sides, analysis));
      console.log(
        `#${id}: ${sides.map(s => s.join('')).join('|')} — ` +
        `${analysis.playable.length} מילים, אופטימלי ${analysis.common.min} ` +
        `(${analysis.common.solution.join(' ← ')})`
      );
      break;
    }
  }

  manifest.count += made;
  manifest.epoch = manifest.epoch || EPOCH;
  await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nנוצרו ${made} פאזלים (מתוך ${attempts} ניסיונות). סה"כ בבנק: ${manifest.count}`);
  if (made < n) console.log('אזהרה: לא הושלמה המכסה — כדאי להריץ שוב או להקל קריטריונים');
}

async function cmdLetters(spec, save, dict) {
  const sides = spec.split('|').map(s => s.split(',').map(x => x.trim()).filter(Boolean));
  if (sides.length !== 3 || sides.some(s => s.length !== 3)) {
    throw new Error('פורמט צלעות: "א,ב,ג|ד,ה,ו|ז,ח,ט"');
  }
  const flat = sides.flat();
  if (new Set(flat).size !== 9) throw new Error('נדרשות 9 אותיות שונות');
  if (flat.some(ch => FINALS[ch])) throw new Error('אותיות סופיות אינן מותרות על הלוח — השתמשו בצורת הבסיס');

  const analysis = analyzeBoard(sides, dict);
  report(sides, analysis);

  if (save) {
    if (!analysis.full || !analysis.common) throw new Error('לא ניתן לשמור — אין פתרון');
    await mkdir(PUZZLES_DIR, { recursive: true });
    const manifest = await loadManifest();
    const id = manifest.count + 1;
    await savePuzzle(toPuzzle(id, sides, analysis));
    manifest.count = id;
    manifest.epoch = manifest.epoch || EPOCH;
    await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`נשמר כפאזל #${id}`);
  }
}

async function cmdRegen(dict) {
  const manifest = await loadManifest();
  const sigs = await existingSignatures();
  const freq = letterFrequencies(dict);

  for (let id = 1; id <= manifest.count; id++) {
    const file = path.join(PUZZLES_DIR, `${id}.json`);
    const old = JSON.parse(await readFile(file, 'utf8'));
    const analysis = analyzeBoard(old.sides, dict);

    if (acceptable(analysis)) {
      await savePuzzle(toPuzzle(id, old.sides, analysis));
      console.log(`#${id}: עודכן (${analysis.playable.length} מילים, אופטימלי ${analysis.common.min})`);
      continue;
    }

    // הלוח כבר לא עומד בקריטריונים עם המילון הנוכחי — מגרילים לוח חדש באותו מזהה
    sigs.delete(old.sides.flat().slice().sort().join(''));
    let replaced = false;
    for (let attempts = 0; attempts < 5000 && !replaced; attempts++) {
      const letters = sampleLetters(freq, Math.random);
      const sig = letters.slice().sort().join('');
      if (sigs.has(sig)) continue;
      for (let t = 0; t < PARTITIONS_PER_SET; t++) {
        const sh = shuffle(letters, Math.random);
        const sides = [sh.slice(0, 3), sh.slice(3, 6), sh.slice(6, 9)];
        const a = analyzeBoard(sides, dict);
        if (!acceptable(a)) continue;
        sigs.add(sig);
        await savePuzzle(toPuzzle(id, sides, a));
        console.log(`#${id}: הוחלף בלוח חדש ${sides.map(s => s.join('')).join('|')} (${a.playable.length} מילים, אופטימלי ${a.common.min})`);
        replaced = true;
        break;
      }
    }
    if (!replaced) console.log(`#${id}: אזהרה — לא נמצא לוח חלופי, נשאר ישן`);
  }
}

async function cmdVerify(dict) {
  const manifest = await loadManifest();
  let ok = 0, bad = 0;
  for (let id = 1; id <= manifest.count; id++) {
    const p = JSON.parse(await readFile(path.join(PUZZLES_DIR, `${id}.json`), 'utf8'));
    const sideOf = new Map();
    p.sides.forEach((side, si) => side.forEach(ch => sideOf.set(ch, si)));
    const errors = [];

    for (const w of p.words) if (!isPlayable(toBoard(w), sideOf)) errors.push(`מילה לא משחקית: ${w}`);
    const wordSet = new Set(p.words);
    for (const w of p.solution) if (!wordSet.has(w)) errors.push(`מילת פתרון לא ברשימה: ${w}`);
    if (p.solution.length !== p.optimal) errors.push(`אורך פתרון ${p.solution.length} ≠ אופטימלי ${p.optimal}`);

    const covered = new Set(p.solution.flatMap(w => [...toBoard(w)]));
    if (covered.size !== 9) errors.push(`הפתרון מכסה ${covered.size}/9 אותיות`);

    const analysis = analyzeBoard(p.sides, dict);
    if (!analysis.common || analysis.common.min !== p.optimal) {
      errors.push(`אופטימלי מחושב ${analysis.common?.min} ≠ שמור ${p.optimal}`);
    }

    if (errors.length) { bad++; console.log(`#${id} ✗\n  ` + errors.join('\n  ')); }
    else ok++;
  }
  console.log(`\nתקינים: ${ok}, שגויים: ${bad} (מתוך ${manifest.count})`);
  if (bad) process.exit(1);
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : null; };
  const dict = await loadDictionary();

  if (args.includes('--verify')) return cmdVerify(dict);
  if (args.includes('--regen')) return cmdRegen(dict);
  const letters = get('--letters');
  if (letters) return cmdLetters(letters, args.includes('--save'), dict);
  const count = parseInt(get('--count') || '0', 10);
  if (count > 0) return cmdCount(count, dict);

  console.log('שימוש: --count N | --letters "א,ב,ג|ד,ה,ו|ז,ח,ט" [--save] | --regen | --verify');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
