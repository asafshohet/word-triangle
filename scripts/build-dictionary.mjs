#!/usr/bin/env node
// בונה את data/dictionary.txt מרשימות המילים של eyaler/hebrew_wordlists (נגזרות HSpell, רישיון AGPL-3.0).
// המקור: מילות HSpell בחיתוך עם ספירות תדירות מקורפוס CC100 — כלומר מילים תקניות ממוינות לפי שכיחות אמיתית.
// ברירת המחדל: כל המילים התקינות (~187 אלף) — המשחק מקבל כל מילה תקינה,
// והגנרטור משתמש בסדר התדירות כדי לבחור פתרונות ממילים נפוצות בלבד.
// הרצה: node scripts/build-dictionary.mjs [--size N]   (‏--size 0 = הכל)

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_FILE = path.join(ROOT, 'data', 'dictionary.txt');
const BLOCKLIST_FILE = path.join(ROOT, 'data', 'blocklist.txt');
const ALLOWLIST_FILE = path.join(ROOT, 'data', 'allowlist.txt');

const SOURCES = {
  'cc100_intersect_no_fatverb.csv':
    'https://raw.githubusercontent.com/eyaler/hebrew_wordlists/main/cc100_intersect_no_fatverb.csv',
};

const SIZE = (() => {
  const i = process.argv.indexOf('--size');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : 0; // 0 = ללא הגבלה
})();

async function download(name, url) {
  const dest = path.join(RAW_DIR, name);
  try {
    await access(dest);
    return dest; // כבר הורד
  } catch { /* להוריד */ }
  console.log(`מוריד ${name}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status}): ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function readLines(file) {
  return (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean);
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const [csvFile] = await Promise.all(
    Object.entries(SOURCES).map(([name, url]) => download(name, url))
  );

  let blocklist = new Set();
  try {
    blocklist = new Set(
      (await readLines(BLOCKLIST_FILE)).filter(l => !l.startsWith('#')).map(l => l.trim())
    );
  } catch { /* אין blocklist — בסדר */ }

  let allowlist = new Set();
  try {
    allowlist = new Set(
      (await readLines(ALLOWLIST_FILE)).filter(l => !l.startsWith('#')).map(l => l.trim())
    );
  } catch { /* אין allowlist — בסדר */ }

  const HEBREW_WORD = /^[א-ת]{2,}$/;
  const words = [];
  const seen = new Set();
  let totalRows = 0;

  for (const line of await readLines(csvFile)) {
    totalRows++;
    const comma = line.lastIndexOf(',');
    const word = comma === -1 ? line : line.slice(0, comma);
    if (!HEBREW_WORD.test(word)) continue;
    if (blocklist.has(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (SIZE > 0 && words.length >= SIZE) break;
  }

  // מילות allowlist שלא הופיעו במקור כלל (חסרות ב-HSpell) — נוספות בסוף, בעדיפות נמוכה
  for (const word of allowlist) {
    if (seen.has(word) || !HEBREW_WORD.test(word)) continue;
    seen.add(word);
    words.push(word);
  }

  await writeFile(OUT_FILE, words.join('\n') + '\n', 'utf8');

  console.log(`נסרקו ${totalRows} שורות מהמקור`);
  console.log(`נכתבו ${words.length} מילים ל-${path.relative(ROOT, OUT_FILE)}`);
  console.log('\n20 המילים הנפוצות ביותר:');
  console.log('  ' + words.slice(0, 20).join(' '));
  console.log('\nמדגם אקראי (30):');
  const sample = [];
  for (let i = 0; i < 30; i++) sample.push(words[Math.floor(Math.random() * words.length)]);
  console.log('  ' + sample.join(' '));
}

main().catch(err => { console.error(err); process.exit(1); });
