// Scripture access: index of 66 books plus on-demand chapter loading from the offline corpus.
// When globalThis.__A2U_BUNDLE__ is set, everything comes from one prebuilt JSON bundle instead
// of per-book files (used by single-file and preview builds).
let indexPromise = null;
let bundlePromise = null;
const bookCache = new Map();

const bundleUrl = () => globalThis.__A2U_BUNDLE__ || null;
const loadBundle = () => {
  bundlePromise ??= fetch(bundleUrl()).then(r => {
    if (!r.ok) throw new Error(`Scripture bundle unavailable (${r.status})`);
    return r.json();
  });
  return bundlePromise;
};

export function loadIndex() {
  if (bundleUrl()) {
    indexPromise ??= loadBundle().then(b => b.index);
    return indexPromise;
  }
  indexPromise ??= fetch('data/corpus/index.json').then(r => {
    if (!r.ok) throw new Error(`Corpus index unavailable (${r.status})`);
    return r.json();
  });
  return indexPromise;
}

export async function loadBook(slug) {
  if (bookCache.has(slug)) return bookCache.get(slug);
  if (bundleUrl()) {
    const promise = loadBundle().then(b => {
      const book = b.books[slug];
      if (!book) throw new Error(`Book ${slug} missing from bundle`);
      return book;
    });
    bookCache.set(slug, promise);
    return promise;
  }
  const promise = fetch(`data/corpus/web/${slug}.json`).then(r => {
    if (!r.ok) throw new Error(`Book ${slug} unavailable (${r.status})`);
    return r.json();
  });
  bookCache.set(slug, promise);
  return promise;
}

export async function loadChapter(slug, chapter) {
  const book = await loadBook(slug);
  const verses = book.chapters[chapter - 1];
  if (!verses) throw new Error(`No ${book.name} chapter ${chapter}`);
  return {book, chapter, verses};
}

/** Loads every book once, for whole-Scripture search. Reports progress 0..1. */
export async function loadAll(onProgress = () => {}) {
  const index = await loadIndex();
  const out = [];
  let done = 0;
  for (const b of index.books) {
    out.push(await loadBook(b.slug));
    onProgress(++done / index.books.length);
  }
  return out;
}

/** Plain substring search over the whole corpus. `books` comes from loadAll(). */
export function searchCorpus(books, query, limit = 60) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(w => w.length > 1);
  const results = [];
  for (const book of books) {
    for (let c = 0; c < book.chapters.length; c++) {
      const chapter = book.chapters[c];
      for (let v = 0; v < chapter.length; v++) {
        const text = chapter[v];
        if (text === null) continue; // verse omitted in the critical text
        const lower = text.toLowerCase();
        if (!lower.includes(words[0])) continue;
        if (words.length > 1 && !words.every(w => lower.includes(w))) continue;
        results.push({slug: book.slug, book: book.name, chapter: c + 1, verse: v + 1, text});
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}
