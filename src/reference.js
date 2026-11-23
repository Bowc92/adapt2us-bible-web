// Reference parsing: typed, spelled-out and mildly misspelled references.
import {BOOKS} from './books.js';

const norm = s => String(s ?? '')
  .toLowerCase()
  .replace(/[–—]/g, '-')
  .replace(/\b(first|1st)\b/g, '1')
  .replace(/\b(second|2nd)\b/g, '2')
  .replace(/\b(third|3rd)\b/g, '3')
  .replace(/[^a-z0-9:\-\s.]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const key = s => norm(s).replace(/[\s.\-]/g, '');

// index every name/abbreviation/alias once
const INDEX = (() => {
  const map = new Map();
  for (const b of BOOKS) {
    for (const candidate of [b.name, b.abbrev, b.slug, ...b.aliases]) {
      const k = key(candidate);
      if (k && !map.has(k)) map.set(k, b);
    }
  }
  return map;
})();

const MAX_ALIAS = Math.max(...[...INDEX.keys()].map(k => k.length));

/** Damerau-Levenshtein (optimal string alignment): transposed letters cost 1, as typists expect. */
export function distance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  const d = Array.from({length: m + 1}, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Resolve a book from free text. Exact names/abbreviations win; near misses are tolerated. */
export function resolveBook(input) {
  const k = key(input);
  if (!k) return null;
  if (INDEX.has(k)) return {book: INDEX.get(k), exact: true};
  const tolerance = k.length <= 8 ? 1 : 2;
  let best = null;
  for (const [candidate, book] of INDEX) {
    if (Math.abs(candidate.length - k.length) > tolerance) continue;
    const d = distance(k, candidate);
    // nearest wins; on a tie the longer (more specific) name wins, so "jhon" lands on John, not Jon
    if (d <= tolerance && (!best || d < best.d || (d === best.d && candidate.length > best.candidate.length))) {
      best = {book, d, candidate};
    }
  }
  return best ? {book: best.book, exact: false} : null;
}

/**
 * Parse "john 3:16", "1jn 4:8", "first john 4:8", "psalm 23", "romans 8:28-30", "jn 3 16".
 * Returns {slug, chapter, verse, verseEnd, exact, label} or null.
 */
export function parseReference(input) {
  const s = norm(input);
  if (!s) return null;
  const m = s.match(/^((?:[1-3]\s*)?[a-z][a-z\s.]*?)\s*(\d+(?:\s*[:\-.\s]\s*\d+)*)?$/);
  if (!m) return null;
  const bookText = m[1].trim();
  const numbers = (m[2] ?? '').split(/[^0-9]+/).filter(Boolean).map(Number);
  if (numbers.length > 3) return null;
  const found = resolveBook(bookText);
  if (!found) return null;
  const [chapter = 1, verse = null, verseEnd = null] = numbers;
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  if (verse !== null && (!Number.isInteger(verse) || verse < 1)) return null;
  if (verseEnd !== null && (!Number.isInteger(verseEnd) || verseEnd < verse)) return null;
  return {slug: found.book.slug, book: found.book.name, chapter, verse, verseEnd, exact: found.exact,
    label: formatReference({slug: found.book.slug, chapter, verse, verseEnd})};
}

export function formatReference({slug, chapter, verse, verseEnd}) {
  const book = BOOKS.find(b => b.slug === slug);
  const name = book?.name ?? slug;
  if (!chapter) return name;
  if (!verse) return `${name} ${chapter}`;
  return `${name} ${chapter}:${verse}${verseEnd && verseEnd !== verse ? `-${verseEnd}` : ''}`;
}

export const verseKey = (slug, chapter, verse) => `${slug}.${chapter}.${verse}`;
