import {BOOKS, BOOK_BY_SLUG, bookName} from './books.js';
import {parseReference, formatReference, verseKey} from './reference.js';
import {
  load, save, initial, normalize, cryptoId, toggleHighlight, isBookmarked, toggleBookmark,
  notesForVerse, addPrayer, togglePrayer, backupBlob, HIGHLIGHT_COLORS, THEMES, STORAGE_KEY,
} from './store.js';
import {loadIndex, loadChapter, loadAll, searchCorpus} from './corpus.js';

const $ = sel => document.querySelector(sel);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

let state;
let corpusIndex = null;
let current = {slug: null, chapter: null, verses: []};
let searchState = {query: '', results: [], loading: false};
let speaking = null;

/* ---------------------------------------------------------------- boot */

const loaded = load();
state = loaded.state;
applyPrefs();

// Offline install only works where the app is served from its own origin (the PWA build).
// Single-file previews load Scripture from a public bundle and skip the service worker.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !globalThis.__A2U_BUNDLE__) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.addEventListener('hashchange', route);
if (loaded.warning) toast(loaded.warning, 6000);

function persist() {
  const res = save(state);
  if (!res.ok) toast(res.error, 6000);
}

function applyPrefs() {
  const {theme, font, size, lineHeight} = state.prefs;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.font = font;
  document.documentElement.style.setProperty('--reading-size', `${size}px`);
  document.documentElement.style.setProperty('--reading-line', String(lineHeight));
  document.querySelector('meta[name="theme-color"]').setAttribute('content',
    theme === 'day' ? '#f7f9fc' : theme === 'sepia' ? '#f5ecdb' : '#071634');
}

let toastTimer;
function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------------------------------------------------------- routing */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, queryString] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(queryString ?? ''));
  return {name: parts[0] ?? 'home', parts: parts.slice(1), query};
}

const TAB_FOR = {home: 'home', read: 'read', library: 'read', search: 'read', understand: 'read', journal: 'journal', pray: 'pray', more: 'more', settings: 'more', customize: 'more', saved: 'more', bookmarks: 'more', about: 'more'};

async function route() {
  const r = parseHash();
  stopSpeaking();
  const tab = TAB_FOR[r.name] ?? 'home';
  document.querySelectorAll('.tabbar a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  view.className = '';
  try {
    if (r.name === 'home') await renderHome();
    else if (r.name === 'read') await renderReader(r);
    else if (r.name === 'library') await renderLibrary(r);
    else if (r.name === 'search') renderSearch(r);
    else if (r.name === 'journal') renderJournal(r);
    else if (r.name === 'pray') renderPray();
    else if (r.name === 'more') renderMore();
    else if (r.name === 'understand') await renderUnderstand(r);
    else if (r.name === 'customize') renderCustomize();
    else if (r.name === 'saved') await renderSaved(r);
    else if (r.name === 'settings') renderSettings();
    else if (r.name === 'bookmarks') await renderBookmarks();
    else if (r.name === 'about') renderAbout();
    else view.innerHTML = notFound();
  } catch (err) {
    view.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(err.message)}</p>
      <a class="btn" href="#/home">Back home</a>`;
  }
  window.scrollTo({top: 0});
}

const notFound = () => `<h1>Not found</h1><p class="muted">That page does not exist.</p><a class="btn" href="#/home">Back home</a>`;

/* ---------------------------------------------------------------- home */

const icon = {
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3-1 5.5-.8 8 .8 2.5-1.6 5-1.8 8-.8v13c-3-1-5.5-.8-8 .8-2.5-1.6-5-1.8-8-.8z"/><path d="M12 6.3v13"/></svg>',
  listen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="4.5" height="7" rx="2"/><rect x="17" y="13" width="4.5" height="7" rx="2"/></svg>',
  pray: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v17M7.5 8h9"/><path d="M6 20.5h12"/></svg>',
  journal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l4 4V20.5H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
};

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still awake';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function renderHome() {
  const last = state.lastRead;
  const continueCard = last
    ? `<a class="card" href="#/read/${last.slug}/${last.chapter}" style="display:block;text-decoration:none;color:inherit">
        <p class="eyebrow">Continue reading</p>
        <h2 style="margin:0">${esc(bookName(last.slug))} ${last.chapter}</h2>
        <p class="muted small" style="margin:6px 0 0">${last.verse ? `Last at verse ${last.verse}` : 'Pick up where you left off'}</p>
      </a>`
    : `<div class="card"><p class="eyebrow">Start here</p><h2 style="margin:0">The Gospel of John</h2>
        <p class="muted small" style="margin:6px 0 14px">A good place to begin reading.</p>
        <a class="btn primary" href="#/read/john/1">Open John 1</a></div>`;

  view.className = 'grid';
  view.innerHTML = `
    <section>
      <p class="eyebrow">${greeting()} · Personal edition</p>
      <h1>Read. Understand. Reflect. Pray.</h1>
      <p class="lede">Scripture unchanged. The reading experience adapts to you, on your own device, with or without a signal.</p>
      <div class="stack" style="margin:0 0 16px">${continueCard}</div>
      <div class="tiles">
        <a class="tile" href="#/read">
          <span class="chip live"><span class="dot"></span>Offline</span>
          <span class="tile-icon">${icon.read}</span>
          <strong>Read the Bible</strong>
          <small>All 66 books, every chapter</small>
        </a>
        <a class="tile" href="#/read?listen=1">
          <span class="chip">Audio</span>
          <span class="tile-icon">${icon.listen}</span>
          <strong>Listen</strong>
          <small>Hear the passage read aloud</small>
        </a>
        <a class="tile" href="#/pray">
          <span class="chip">${state.prayers.filter(p => !p.answered).length} open</span>
          <span class="tile-icon">${icon.pray}</span>
          <strong>Pray</strong>
          <small>Your prayer list</small>
        </a>
        <a class="tile" href="#/journal">
          <span class="chip">${state.notes.length} saved</span>
          <span class="tile-icon">${icon.journal}</span>
          <strong>My Journal</strong>
          <small>Notes tied to verses</small>
        </a>
      </div>
    </section>
    <aside class="aside">
      <div class="panel" id="votd">
        <p class="eyebrow">Verse of the day</p>
        <p class="muted small" style="margin:0">Loading…</p>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Your reading</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Highlights</span><strong>${Object.keys(state.highlights).length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Notes</span><strong>${state.notes.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Bookmarks</span><strong>${(state.bookmarks ?? []).length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Prayers</span><strong>${state.prayers.filter(p => !p.answered).length} open</strong></div>
        </div>
      </div>
    </aside>`;

  try {
    corpusIndex ??= await loadIndex();
    const {slug, chapter, verse} = verseOfTheDay(corpusIndex);
    const {verses} = await loadChapter(slug, chapter);
    const el = document.getElementById('votd');
    if (!el) return;
    el.innerHTML = `<p class="eyebrow">Verse of the day</p>
      <p class="passage" style="font-size:calc(var(--reading-size) * 0.92);margin:0 0 12px">${esc(verses[verse - 1])}</p>
      <div class="row" style="justify-content:space-between">
        <a class="ref-line" href="#/read/${slug}/${chapter}">${esc(formatReference({slug, chapter, verse}))}</a>
        <span class="chip live">Web</span>
      </div>`;
  } catch { /* keep the placeholder */ }
}

function verseOfTheDay(index) {
  const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const book = index.books[(day * 7) % index.books.length];
  const chapter = (day % book.chapters) + 1;
  const verseCount = book.verseCounts[chapter - 1];
  const verse = ((day * 3) % verseCount) + 1;
  return {slug: book.slug, chapter, verse};
}

/* ---------------------------------------------------------------- reader */

async function renderReader(r) {
  let slug = r.parts[0];
  let chapter = Number(r.parts[1]);
  if (!slug) {
    slug = state.lastRead?.slug ?? 'john';
    chapter = state.lastRead?.chapter ?? 1;
  }
  if (!BOOK_BY_SLUG.has(slug) || !Number.isInteger(chapter) || chapter < 1) throw new Error('Unknown passage');

  view.innerHTML = `<p class="muted">Loading ${esc(bookName(slug))} ${chapter}…</p>`;
  const {book, verses} = await loadChapter(slug, chapter);
  current = {slug, chapter, verses};

  state.lastRead = {slug, chapter, verse: state.lastRead?.slug === slug && state.lastRead?.chapter === chapter ? state.lastRead.verse : null};
  persist();

  const total = book.chapters.length;
  const body = verses.map((text, i) => {
    const v = i + 1;
    if (text === null) return ''; // omitted in the critical text; keep numbering aligned
    const k = verseKey(slug, chapter, v);
    const mark = state.highlights[k];
    const bm = isBookmarked(state, slug, chapter, v);
    const notes = notesForVerse(state, slug, chapter, v).length;
    return `<span class="v" role="button" tabindex="0" data-v="${v}"${mark ? ` data-mark="${esc(mark)}"` : ''}${bm ? ' data-bookmarked' : ''}${notes ? ' data-noted' : ''}><sup class="vn">${v}</sup>${esc(text)} </span>`;
  }).join('');

  const chapterMarks = verses.reduce((n, _t, i) => n + (state.highlights[verseKey(slug, chapter, i + 1)] ? 1 : 0), 0);
  const chapterNotes = verses.reduce((n, _t, i) => n + (notesForVerse(state, slug, chapter, i + 1).length ? 1 : 0), 0);

  view.className = 'grid';
  view.innerHTML = `
    <section>
    <div class="reader-head">
      <div>
        <p class="eyebrow">World English Bible</p>
        <h1 style="margin:0">${esc(book.name)} ${chapter}</h1>
      </div>
      <div class="reader-nav">
        <a class="btn ghost" href="#/library/${slug}" aria-label="Choose chapter">Chapters</a>
      </div>
    </div>
    <p class="ref-line" style="margin:8px 0 18px">${chapter} of ${total}</p>
    <article class="passage" id="passage">${body}</article>
    <div class="verse-tools">
      ${chapter > 1 ? `<a class="btn" href="#/read/${slug}/${chapter - 1}">← Previous</a>` : ''}
      <button class="btn primary" id="listen-chapter">Listen</button>
      ${chapter < total ? `<a class="btn" href="#/read/${slug}/${chapter + 1}">Next →</a>` : ''}
    </div>
    <p class="muted small" style="margin-top:20px">Tap any verse to highlight, bookmark or write a note. Scripture text: World English Bible, public domain.</p>
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">This chapter</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Book</span><strong>${esc(book.name)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Chapter</span><strong>${chapter} of ${total}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Verses</span><strong>${verses.filter(v => v !== null).length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Highlights</span><strong>${chapterMarks}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Notes</span><strong>${chapterNotes}</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Keep reading</p>
        <div class="stack">
          <a class="btn wide ghost" href="#/library/${slug}">All chapters</a>
          ${chapter < total ? `<a class="btn wide" href="#/read/${slug}/${chapter + 1}">Next chapter →</a>` : `<span class="chip">Last chapter</span>`}
        </div>
      </div>
    </aside>`;

  document.getElementById('passage').addEventListener('click', ev => {
    const v = ev.target.closest('.v');
    if (v) openVerseSheet(Number(v.dataset.v));
  });
  document.getElementById('passage').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const v = ev.target.closest('.v');
    if (v) { ev.preventDefault(); openVerseSheet(Number(v.dataset.v)); }
  });
  document.getElementById('listen-chapter').addEventListener('click', () => speakChapter(0));

  if (r.query.listen === '1') speakChapter(0);
  if (state.lastRead?.verse) {
    const target = document.querySelector(`.v[data-v="${state.lastRead.verse}"]`);
    target?.scrollIntoView({block: 'center'});
  }
}

function openVerseSheet(verse) {
  const {slug, chapter, verses} = current;
  const text = verses[verse - 1] ?? '';
  const k = verseKey(slug, chapter, verse);
  const marked = state.highlights[k];
  const bookmarked = isBookmarked(state, slug, chapter, verse);
  const notes = notesForVerse(state, slug, chapter, verse);

  const sheet = $('#sheet');
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-card" role="dialog" aria-modal="true" aria-label="Verse actions">
      <div class="sheet-head">
        <h2>${esc(formatReference({slug, chapter, verse}))}</h2>
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <p class="passage" style="font-size:17px;margin:0 0 14px">${esc(text)}</p>
      <p class="eyebrow">Highlight</p>
      <div class="swatches">
        ${HIGHLIGHT_COLORS.map(c => `<button class="swatch" data-color="${c.id}" aria-pressed="${marked === c.id}" aria-label="${c.label}" style="background:${c.value}"></button>`).join('')}
        <button class="swatch none" data-color="" aria-pressed="${!marked}" aria-label="No highlight">None</button>
      </div>
      <div class="stack">
        <button class="btn wide" data-action="bookmark">${bookmarked ? 'Remove bookmark' : 'Bookmark verse'}</button>
        <a class="btn wide" href="#/journal/new/${slug}/${chapter}/${verse}">Write a note</a>
        <a class="btn wide" href="#/understand/${slug}/${chapter}/${verse}">Explain this verse</a>
        <button class="btn wide" data-action="listen">Listen to verse</button>
        <button class="btn wide ghost" data-action="copy">Copy verse</button>
      </div>
      ${notes.length ? `<div class="stack" style="margin-top:16px">
        <p class="eyebrow">Your notes</p>
        ${notes.map(n => `<div class="item"><div class="item-top"><h3>${esc(n.title || 'Note')}</h3></div><p>${esc(n.body)}</p></div>`).join('')}
      </div>` : ''}
    </div>`;

  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; };
  sheet.addEventListener('click', ev => {
    if (ev.target === sheet || ev.target.closest('[data-close]')) return close();
    const swatch = ev.target.closest('[data-color]');
    if (swatch) {
      toggleHighlight(state, k, swatch.dataset.color || '__none__');
      if (!swatch.dataset.color) delete state.highlights[k];
      persist();
      close();
      toast(swatch.dataset.color ? 'Highlight saved' : 'Highlight removed');
      return route();
    }
    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'bookmark') { toggleBookmark(state, slug, chapter, verse); persist(); close(); toast(bookmarked ? 'Bookmark removed' : 'Bookmarked'); route(); }
    if (action === 'listen') { close(); speakText(text); }
    if (action === 'copy') {
      navigator.clipboard?.writeText(`${text} (${formatReference({slug, chapter, verse})} WEB)`)
        .then(() => { toast('Verse copied'); close(); })
        .catch(() => toast('Copy not available'));
    }
  });
  sheet.querySelector('[data-close]')?.focus();
}

/* ---------------------------------------------------------------- audio */

function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  document.querySelectorAll('.v.reading').forEach(el => el.classList.remove('reading'));
  speaking = null;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return toast('Audio is not supported on this device.');
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.onerror = () => toast('Audio unavailable or interrupted.');
  speechSynthesis.speak(u);
  speaking = u;
}

function speakChapter(from = 0) {
  if (!('speechSynthesis' in window)) return toast('Audio is not supported on this device.');
  stopSpeaking();
  const {verses, slug, chapter} = current;
  const queue = verses.slice(from);
  toast(`Reading ${bookName(slug)} ${chapter}`);
  queue.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onstart = () => {
      document.querySelectorAll('.v.reading').forEach(el => el.classList.remove('reading'));
      document.querySelector(`.v[data-v="${from + i + 1}"]`)?.classList.add('reading');
    };
    u.onerror = () => toast('Audio unavailable or interrupted.');
    speechSynthesis.speak(u);
  });
}

/* ---------------------------------------------------------------- library */

async function renderLibrary(r) {
  corpusIndex ??= await loadIndex();
  const slug = r.parts[0];
  if (slug && BOOK_BY_SLUG.has(slug)) {
    const book = BOOK_BY_SLUG.get(slug);
    const counts = corpusIndex.books.find(b => b.slug === slug)?.verseCounts ?? [];
    view.className = 'grid';
    view.innerHTML = `
      <section>
      <a class="ref-line" href="#/library">← All books</a>
      <h1 style="margin-top:10px">${esc(book.name)}</h1>
      <p class="muted small">${counts.length} chapters · ${counts.reduce((a, b) => a + b, 0)} verses</p>
      <div class="chapter-grid" style="margin-top:16px">
        ${counts.map((_, i) => `<button data-chapter="${i + 1}"${state.lastRead?.slug === slug && state.lastRead?.chapter === i + 1 ? ' aria-current="true"' : ''}>${i + 1}</button>`).join('')}
      </div>
      </section>
      <aside class="aside">
        <div class="panel">
          <p class="eyebrow">This book</p>
          <div class="stack" style="gap:8px">
            <div class="row" style="justify-content:space-between"><span class="muted small">Testament</span><strong>${book.testament === 'OT' ? 'Old' : 'New'}</strong></div>
            <div class="row" style="justify-content:space-between"><span class="muted small">Chapters</span><strong>${counts.length}</strong></div>
            <div class="row" style="justify-content:space-between"><span class="muted small">Verses</span><strong>${counts.reduce((a, b) => a + b, 0)}</strong></div>
          </div>
        </div>
        <div class="panel panel-quiet">
          <p class="eyebrow">Start here</p>
          <div class="stack">
            <a class="btn wide primary" href="#/read/${slug}/1">Open chapter 1</a>
            <a class="btn wide ghost" href="#/library">All books</a>
          </div>
        </div>
      </aside>`;
    view.querySelector('.chapter-grid').addEventListener('click', ev => {
      const b = ev.target.closest('[data-chapter]');
      if (b) location.hash = `#/read/${slug}/${b.dataset.chapter}`;
    });
    return;
  }

  const testament = r.query.t ?? 'OT';
  view.className = 'grid';
  view.innerHTML = `
    <section>
    <p class="eyebrow">World English Bible</p>
    <h1>Choose a book</h1>
    <div class="seg" role="tablist">
      <button role="tab" data-t="OT" aria-selected="${testament === 'OT'}">Old Testament</button>
      <button role="tab" data-t="NT" aria-selected="${testament === 'NT'}">New Testament</button>
    </div>
    <div class="book-grid">
      ${BOOKS.filter(b => b.testament === testament).map(b => {
        const meta = corpusIndex.books.find(x => x.slug === b.slug);
        return `<button data-book="${b.slug}">${esc(b.name)}<small>${meta?.chapters ?? ''} chapters</small></button>`;
      }).join('')}
    </div>
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">Library</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Books</span><strong>66</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Verses</span><strong>31,098</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Translation</span><strong>WEB</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Available offline</p>
        <p class="muted small" style="margin:0">Each book is stored on your device the first time you open it, so it reads the same on a plane as it does here.</p>
      </div>
    </aside>`;
  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-t]');
    if (b) location.hash = `#/library?t=${b.dataset.t}`;
  });
  view.querySelector('.book-grid').addEventListener('click', ev => {
    const b = ev.target.closest('[data-book]');
    if (b) location.hash = `#/library/${b.dataset.book}`;
  });
}

/* ---------------------------------------------------------------- search */

function renderSearch(r) {
  view.innerHTML = `
    <h1>Search Scripture</h1>
    <form id="search-form" class="row" style="margin-bottom:8px">
      <input type="search" id="q" name="q" placeholder="Try “living water” or John 3:16" value="${esc(searchState.query)}" autocomplete="off" aria-label="Search words or a reference">
      <button class="btn primary" type="submit">Search</button>
      <button class="btn ghost" type="button" id="speak-search" aria-label="Speak a reference">🎙 Speak</button>
    </form>
    <p class="muted small">Type a word or phrase, or jump to a reference like <strong>first john 4:8</strong>.</p>
    <div id="results"></div>`;

  const input = document.getElementById('q');
  const form = document.getElementById('search-form');
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    runSearch(input.value);
  });
  document.getElementById('speak-search').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Speaking a search is not supported in this browser.');
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = ev => {
      const said = ev.results[0][0].transcript;
      input.value = said;
      toast(`Heard “${said}”`);
      runSearch(said, true);
    };
    rec.onerror = () => toast('Could not hear that. Type it instead.');
    rec.start();
    toast('Listening…');
  });
  // Search as you type, debounced so a full corpus scan does not run on every key.
  let searchTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value, true), 350);
  });
  if (searchState.query) runSearch(searchState.query, true);
  else if (r.query.q) { input.value = r.query.q; runSearch(r.query.q, true); }
  else input.focus();
}

async function runSearch(rawQuery, keep = false) {
  const query = String(rawQuery ?? '').trim();
  if (!query) return;
  searchState.query = query;
  const out = document.getElementById('results');
  if (!out) return;

  const ref = parseReference(query);
  const refHtml = ref
    ? `<a class="card" href="#/read/${ref.slug}/${ref.chapter}" style="display:block;text-decoration:none;color:inherit;margin-bottom:14px">
        <p class="eyebrow">Go to passage</p><h2 style="margin:0">${esc(ref.label)}</h2>
        ${ref.exact ? '' : '<p class="muted small" style="margin:6px 0 0">Closest match to what you typed.</p>'}
      </a>`
    : '';

  out.innerHTML = `${refHtml}<p class="muted small" id="search-status">${query.length < 2 ? 'Type at least two characters.' : 'Loading Scripture…'}</p>`;

  if (query.length < 2) return;
  try {
    const books = await loadAll(p => {
      const el = document.getElementById('search-status');
      if (el) el.textContent = `Loading Scripture… ${Math.round(p * 100)}%`;
    });
    const results = searchCorpus(books, query, 60);
    searchState.results = results;
    const status = document.getElementById('search-status');
    if (status) status.textContent = results.length ? `${results.length}${results.length === 60 ? '+' : ''} verses` : 'No verses matched.';
    out.insertAdjacentHTML('beforeend', `<div class="list">${results.map(res => `
      <button class="result" data-goto="${res.slug}/${res.chapter}/${res.verse}">
        <span class="ref-line">${esc(formatReference(res))}</span>
        <span class="snippet">${highlightMatch(res.text, query)}</span>
      </button>`).join('')}</div>`);
    out.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      const [slug, chapter, verse] = b.dataset.goto.split('/');
      location.hash = `#/read/${slug}/${chapter}`;
      state.lastRead = {slug, chapter: Number(chapter), verse: Number(verse)};
      persist();
    }));
  } catch (err) {
    const status = document.getElementById('search-status');
    if (status) status.textContent = `Search unavailable: ${err.message}`;
  }
}

function highlightMatch(text, query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let html = esc(text);
  for (const w of words.slice(0, 3)) {
    const safe = esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${safe})`, 'ig'), '<mark>$1</mark>');
  }
  return html;
}

/* ---------------------------------------------------------------- journal */

function renderJournal(r) {
  if (r.parts[0] === 'new' || r.parts[0] === 'edit') {
    const [, slug, chapter, verse] = r.parts;
    const editing = r.parts[0] === 'edit' ? state.notes.find(n => n.id === r.parts[1]) : null;
    const ref = editing?.ref ?? (slug ? {slug, chapter: Number(chapter), verse: verse ? Number(verse) : null,
      label: formatReference({slug, chapter: Number(chapter), verse: verse ? Number(verse) : null})} : null);
    view.innerHTML = `
      <a class="ref-line" href="#/journal">← Journal</a>
      <h1 style="margin-top:10px">${editing ? 'Edit entry' : 'New entry'}</h1>
      ${ref?.label ? `<p class="muted small">On ${esc(ref.label)}</p>` : ''}
      <form id="note-form" class="stack" style="margin-top:16px">
        <label class="field">Title
          <input type="text" name="title" value="${esc(editing?.title ?? '')}" placeholder="What is this about?" maxlength="200">
        </label>
        <label class="field">Passage
          <input type="text" name="reference" value="${esc(ref?.label ?? '')}" placeholder="e.g. Psalm 23:1" autocomplete="off">
        </label>
        <label class="field">Reflection
          <textarea name="body" required placeholder="What stood out? What will you do about it?">${esc(editing?.body ?? '')}</textarea>
        </label>
        <button class="btn primary wide" type="submit">${editing ? 'Save changes' : 'Save entry'}</button>
      </form>`;
    document.getElementById('note-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const data = new FormData(ev.target);
      const body = String(data.get('body') ?? '').trim();
      if (!body) return toast('Write something first.');
      const parsed = parseReference(data.get('reference'));
      const parsedRef = parsed ? {slug: parsed.slug, chapter: parsed.chapter, verse: parsed.verse, label: parsed.label} : null;
      const now = new Date().toISOString();
      if (editing) {
        Object.assign(editing, {title: String(data.get('title') ?? '').trim(), body, ref: parsedRef, updatedAt: now});
        toast('Entry updated');
      } else {
        state.notes.unshift({id: cryptoId(), title: String(data.get('title') ?? '').trim(), body, ref: parsedRef, createdAt: now, updatedAt: now});
        toast('Entry saved');
      }
      persist();
      location.hash = '#/journal';
    });
    return;
  }

  const linked = state.notes.filter(n => n.ref?.label).length;
  view.className = 'grid';
  view.innerHTML = `
    <section>
    <p class="eyebrow">Personal edition</p>
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <h1 style="margin:0">My Journal</h1>
      <a class="btn primary" href="#/journal/new">New entry</a>
    </div>
    <p class="muted small" style="margin-top:8px">${state.notes.length} ${state.notes.length === 1 ? 'entry' : 'entries'} saved on this device.</p>
    <div class="list" style="margin-top:16px">
      ${state.notes.length ? state.notes.map(n => `
        <article class="item">
          <div class="item-top">
            <h3>${esc(n.title || 'Untitled')}</h3>
            <span class="meta">${new Date(n.createdAt).toLocaleDateString()}</span>
          </div>
          ${n.ref?.label ? `<a class="ref-line" href="#/read/${n.ref.slug}/${n.ref.chapter}">${esc(n.ref.label)}</a>` : ''}
          <p>${esc(n.body.length > 240 ? n.body.slice(0, 240) + '…' : n.body)}</p>
          <div class="row tight">
            <a class="btn ghost" href="#/journal/edit/${n.id}">Edit</a>
            <button class="btn ghost danger" data-delete="${n.id}">Delete</button>
          </div>
        </article>`).join('') : `<div class="panel"><p class="muted" style="margin:0">No entries yet. Write your first reflection, or tap a verse while reading.</p></div>`}
    </div>
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">This journal</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Entries</span><strong>${state.notes.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Tied to a verse</span><strong>${linked}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Free-form</span><strong>${state.notes.length - linked}</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Where it lives</p>
        <p class="muted small" style="margin:0">Every entry stays on this device. Nothing is uploaded, and nothing leaves when you close the app.</p>
      </div>
    </aside>`;

  view.addEventListener('click', ev => {
    const del = ev.target.closest('[data-delete]');
    if (!del) return;
    if (!confirm('Delete this entry?')) return;
    state.notes = state.notes.filter(n => n.id !== del.dataset.delete);
    persist();
    toast('Entry deleted');
    renderJournal(r);
  }, {once: true});
}

/* ---------------------------------------------------------------- prayer */

function renderPray() {
  const open = state.prayers.filter(p => !p.answered);
  const answered = state.prayers.filter(p => p.answered);
  view.className = 'grid';
  view.innerHTML = `
    <section>
    <p class="eyebrow">Personal edition</p>
    <h1>Prayer</h1>
    <form id="prayer-form" class="row" style="margin:10px 0 20px">
      <input type="text" name="text" placeholder="What are you praying for?" aria-label="Prayer request" maxlength="2000">
      <button class="btn primary" type="submit">Add</button>
    </form>
    <p class="eyebrow">Praying for (${open.length})</p>
    <div class="list" style="margin-bottom:22px">
      ${open.length ? open.map(p => `
        <article class="item">
          <p style="color:var(--text)">${esc(p.text)}</p>
          <div class="row tight">
            <button class="btn ghost" data-answer="${p.id}">Mark answered</button>
            <button class="btn ghost danger" data-remove="${p.id}">Remove</button>
          </div>
        </article>`).join('') : `<div class="card"><p class="muted" style="margin:0">Nothing on your list yet.</p></div>`}
    </div>
    ${answered.length ? `<p class="eyebrow">Answered (${answered.length})</p>
      <div class="list">
        ${answered.map(p => `
          <article class="item">
            <p style="color:var(--text)">${esc(p.text)}</p>
            <div class="row tight">
              <span class="meta">Answered ${p.answeredAt ? new Date(p.answeredAt).toLocaleDateString() : ''}</span>
              <button class="btn ghost" data-answer="${p.id}">Move back</button>
            </div>
          </article>`).join('')}
      </div>` : ''}
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">Your list</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Praying for</span><strong>${open.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Answered</span><strong>${answered.length}</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">A quiet habit</p>
        <p class="muted small" style="margin:0">No streaks, no guilt. Add a request when it comes, and mark it answered when it does.</p>
      </div>
    </aside>`;

  document.getElementById('prayer-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const text = new FormData(ev.target).get('text');
    if (!addPrayer(state, text)) return toast('Write your request first.');
    persist();
    toast('Prayer added');
    renderPray();
  });
  view.addEventListener('click', ev => {
    const ans = ev.target.closest('[data-answer]');
    if (ans) { togglePrayer(state, ans.dataset.answer); persist(); renderPray(); return; }
    const rem = ev.target.closest('[data-remove]');
    if (rem && confirm('Remove this request?')) {
      state.prayers = state.prayers.filter(p => p.id !== rem.dataset.remove);
      persist(); renderPray();
    }
  }, {once: true});
}

/* ---------------------------------------------------------------- understand */

// Everything on this screen is computed from the verse itself and the corpus index.
// No commentary, no invented definitions: the passage is always shown unchanged.
function clauses(text) {
  return String(text).split(/(?<=[,;:])\s+/).filter(Boolean);
}

function wordsIn(text) {
  return String(text).toLowerCase().match(/[a-z']{4,}/g) ?? [];
}

const STOP = new Set(['that', 'which', 'with', 'have', 'shall', 'will', 'them', 'they', 'their', 'this', 'your', 'from', 'unto', 'into', 'were', 'been', 'also', 'then', 'than', 'when', 'what', 'because', 'therefore', 'would', 'could', 'should', 'every', 'there', 'these', 'those', 'about', 'after', 'before', 'through', 'himself', 'yourselves']);

async function renderUnderstand(r) {
  const slug = r.parts[0];
  const chapter = Number(r.parts[1]);
  const verse = Number(r.parts[2]);
  if (!BOOK_BY_SLUG.has(slug) || !Number.isInteger(chapter) || !Number.isInteger(verse)) throw new Error('Unknown passage');

  const {book, verses} = await loadChapter(slug, chapter);
  const text = verses[verse - 1];
  if (text == null) throw new Error('That verse is not in this chapter');

  const depth = ['simple', 'context', 'deeper'].includes(r.query.d) ? r.query.d : 'simple';
  const label = formatReference({slug, chapter, verse});
  const before = verses[verse - 2];
  const after = verses[verse];
  const counts = new Map();
  for (const w of wordsIn(text)) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);

  const tab = (id, name) => `<button data-depth="${id}" role="tab" aria-selected="${depth === id}">${name}</button>`;

  const body = depth === 'simple'
    ? `<div class="stack">
         <p class="passage" style="font-size:calc(var(--reading-size) * 1.05);margin:0">${esc(text)}</p>
         <p class="eyebrow" style="margin-top:6px">One clause at a time</p>
         <div class="list">
           ${clauses(text).map(c => `<div class="item"><p style="margin:0">${esc(c)}</p></div>`).join('')}
         </div>
         <p class="muted small" style="margin:0">This is the verse itself, split where the text breaks. Nothing has been reworded.</p>
       </div>`
    : depth === 'context'
    ? `<div class="stack">
         <p class="passage" style="margin:0">${esc(text)}</p>
         <p class="eyebrow" style="margin-top:6px">Around it</p>
         <div class="list">
           ${before ? `<div class="item"><span class="meta">${verse - 1}</span><p style="margin:4px 0 0">${esc(before)}</p></div>` : ''}
           <div class="item" style="border-color:var(--accent)"><span class="meta">${verse} · this verse</span><p style="margin:4px 0 0">${esc(text)}</p></div>
           ${after ? `<div class="item"><span class="meta">${verse + 1}</span><p style="margin:4px 0 0">${esc(after)}</p></div>` : ''}
         </div>
         <div class="panel panel-quiet">
           <p class="eyebrow">Where it sits</p>
           <p class="small muted" style="margin:0">${esc(book.name)}, chapter ${chapter} of ${book.chapters.length}, verse ${verse} of ${verses.filter(v => v !== null).length}. ${book.testament === 'OT' ? 'Old Testament' : 'New Testament'}, World English Bible.</p>
         </div>
       </div>`
    : `<div class="stack">
         <p class="passage" style="margin:0">${esc(text)}</p>
         <p class="eyebrow" style="margin-top:6px">Words in this verse</p>
         <div class="list">
           ${keywords.length ? keywords.map(([w, n]) => `
             <a class="item" href="#/search?q=${encodeURIComponent(w)}" style="text-decoration:none;color:inherit">
               <div class="item-top"><h3 style="margin:0">${esc(w)}</h3><span class="meta">${n}×</span></div>
               <span class="muted small">Find this word across Scripture</span>
             </a>`).join('') : '<p class="muted small" style="margin:0">This verse has no repeated keywords.</p>'}
         </div>
         <p class="muted small" style="margin:0">Counts come from the verse text itself. Word meanings need a licensed lexicon, which is not bundled yet.</p>
       </div>`;

  view.className = 'grid';
  view.innerHTML = `
    <section>
      <a class="ref-line" href="#/read/${slug}/${chapter}">← Back to ${esc(book.name)} ${chapter}</a>
      <p class="eyebrow" style="margin-top:12px">Let's understand it</p>
      <h1 style="margin-bottom:4px">${esc(label)}</h1>
      <p class="muted small">World English Bible</p>
      <div class="seg" role="tablist" aria-label="Depth" style="margin:14px 0 16px">
        ${tab('simple', 'Simple')}${tab('context', 'Context')}${tab('deeper', 'Deeper')}
      </div>
      ${body}
      <div class="tiles" style="margin-top:18px">
        <button class="tile" data-act="read"><span class="tile-icon">${icon.listen}</span><strong>Read aloud</strong><small>Hear this verse</small></button>
        <a class="tile" href="#/understand/${slug}/${chapter}/${verse}?d=simple"><span class="tile-icon">${icon.read}</span><strong>Make it simpler</strong><small>One clause at a time</small></a>
        <a class="tile" href="#/understand/${slug}/${chapter}/${verse}?d=context"><span class="tile-icon">${icon.read}</span><strong>Show more detail</strong><small>Verses around it</small></a>
        <a class="tile" href="#/journal/new/${slug}/${chapter}/${verse}"><span class="tile-icon">${icon.journal}</span><strong>Write a reflection</strong><small>Saved with this verse</small></a>
      </div>
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">This verse</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Book</span><strong>${esc(book.name)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Chapter</span><strong>${chapter}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Verse</span><strong>${verse}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Highlighted</span><strong>${state.highlights[verseKey(slug, chapter, verse)] ? 'Yes' : 'No'}</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Ground rules</p>
        <p class="small muted" style="margin:0">Scripture is shown exactly as published. Explanations here are structural: the text split, the verses around it, and word counts. Sourced commentary comes later.</p>
      </div>
    </aside>`;

  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-depth]');
    if (b) location.hash = `#/understand/${slug}/${chapter}/${verse}?d=${b.dataset.depth}`;
  });
  view.querySelector('[data-act="read"]').addEventListener('click', () => speakText(text));
}

/* ---------------------------------------------------------------- customize */

function renderCustomize() {
  const {theme, font, size, lineHeight} = state.prefs;
  view.innerHTML = `
    <a class="ref-line" href="#/more">← More</a>
    <p class="eyebrow" style="margin-top:12px">Make it yours</p>
    <h1>Customize</h1>
    <p class="lede">Type, spacing and colour for the reading screen. Everything applies as you move it.</p>

    <div class="card">
      <p class="eyebrow">Typeface</p>
      <div class="seg" role="tablist" aria-label="Typeface">
        ${['serif', 'sans'].map(f => `<button data-font-opt="${f}" role="tab" aria-selected="${font === f}">${f === 'serif' ? 'Aa Serif' : 'Aa Sans'}</button>`).join('')}
      </div>
      <label class="field" style="margin-top:14px">Text size · ${size}px
        <input type="range" id="size" min="16" max="40" step="1" value="${size}">
      </label>
      <label class="field">Line spacing · ${lineHeight.toFixed(2)}
        <input type="range" id="line" min="1.3" max="2.4" step="0.05" value="${lineHeight}">
      </label>
      <div class="panel panel-quiet">
        <p class="eyebrow">Preview</p>
        <p class="passage" style="margin:0">For God so loved the world, that he gave his one and only Son.</p>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <p class="eyebrow">Background</p>
      <div class="seg" role="tablist" aria-label="Theme">
        ${THEMES.map(t => `<button data-theme-opt="${t}" role="tab" aria-selected="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <p class="eyebrow" style="margin-top:16px">Highlight colours</p>
      <div class="swatches">
        ${HIGHLIGHT_COLORS.map(c => `<button class="swatch" data-color-preview="${c.id}" aria-label="${c.label}" style="background:${c.value}"></button>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn primary" id="save-theme">Save theme</button>
        <button class="btn ghost" id="reset-theme">Reset</button>
      </div>
    </div>`;

  const setPref = (k, v) => { state.prefs[k] = v; applyPrefs(); persist(); };
  view.querySelectorAll('[data-font-opt]').forEach(b => b.addEventListener('click', () => { setPref('font', b.dataset.fontOpt); renderCustomize(); }));
  view.querySelectorAll('[data-theme-opt]').forEach(b => b.addEventListener('click', () => { setPref('theme', b.dataset.themeOpt); renderCustomize(); }));
  const sizeInput = document.getElementById('size');
  sizeInput.addEventListener('input', () => {
    state.prefs.size = Number(sizeInput.value);
    applyPrefs();
    sizeInput.closest('label').firstChild.textContent = `Text size · ${state.prefs.size}px `;
  });
  sizeInput.addEventListener('change', persist);
  const lineInput = document.getElementById('line');
  lineInput.addEventListener('input', () => {
    state.prefs.lineHeight = Number(lineInput.value);
    applyPrefs();
    lineInput.closest('label').firstChild.textContent = `Line spacing · ${state.prefs.lineHeight.toFixed(2)} `;
  });
  lineInput.addEventListener('change', persist);
  view.querySelectorAll('[data-color-preview]').forEach(b => b.addEventListener('click', () => toast(`${b.getAttribute('aria-label')} is used for highlights while reading`)));
  document.getElementById('save-theme').addEventListener('click', () => { persist(); toast('Theme saved'); });
  document.getElementById('reset-theme').addEventListener('click', () => {
    state.prefs.size = 21; state.prefs.lineHeight = 1.75; state.prefs.font = 'serif'; state.prefs.theme = 'night';
    applyPrefs(); persist(); renderCustomize(); toast('Theme reset');
  });
}

/* ---------------------------------------------------------------- my library */

async function renderSaved(r) {
  const tab = ['highlights', 'bookmarks', 'notes'].includes(r.query.tab) ? r.query.tab : 'highlights';
  const hl = Object.entries(state.highlights).map(([k, color]) => {
    const [slug, chapter, verse] = k.split('.');
    return {slug, chapter: Number(chapter), verse: Number(verse), color, key: k};
  });
  const tabs = [['highlights', `Highlights (${hl.length})`], ['bookmarks', `Bookmarks (${state.bookmarks.length})`], ['notes', `Notes (${state.notes.length})`]];

  let body = '';
  if (tab === 'highlights') {
    body = hl.length ? `<div class="list">${hl.slice(0, 300).map(h => {
      const swatch = HIGHLIGHT_COLORS.find(c => c.id === h.color)?.value ?? 'var(--accent-2)';
      return `<a class="item" href="#/read/${h.slug}/${h.chapter}" style="text-decoration:none;color:inherit">
        <div class="item-top"><h3 style="margin:0">${esc(formatReference(h))}</h3>
          <span class="swatch" style="width:16px;height:16px;background:${swatch}"></span></div>
        <span class="muted small">${esc(bookName(h.slug))} ${h.chapter}</span>
      </a>`;
    }).join('')}</div>` : `<div class="panel"><p class="muted" style="margin:0">No highlights yet. Tap a verse while reading and pick a colour.</p></div>`;
  } else if (tab === 'bookmarks') {
    body = state.bookmarks.length ? `<div class="list">${state.bookmarks.slice(0, 300).map(b => `
      <a class="item" href="#/read/${b.slug}/${b.chapter}" style="text-decoration:none;color:inherit">
        <div class="item-top"><h3 style="margin:0">${esc(formatReference(b))}</h3><span class="meta">${new Date(b.createdAt).toLocaleDateString()}</span></div>
        <span class="muted small">${esc(bookName(b.slug))} ${b.chapter}</span>
      </a>`).join('')}</div>` : `<div class="panel"><p class="muted" style="margin:0">No bookmarks yet. Open a verse and choose Bookmark verse.</p></div>`;
  } else {
    body = state.notes.length ? `<div class="list">${state.notes.map(n => `
      <article class="item">
        <div class="item-top"><h3 style="margin:0">${esc(n.title || 'Untitled')}</h3><span class="meta">${new Date(n.createdAt).toLocaleDateString()}</span></div>
        ${n.ref?.label ? `<a class="ref-line" href="#/read/${n.ref.slug}/${n.ref.chapter}">${esc(n.ref.label)}</a>` : ''}
        <p style="margin:0">${esc(n.body.length > 180 ? n.body.slice(0, 180) + '…' : n.body)}</p>
        <div class="row tight"><a class="btn ghost" href="#/journal/edit/${n.id}">Edit</a></div>
      </article>`).join('')}</div>` : `<div class="panel"><p class="muted" style="margin:0">No notes yet. Write one from any verse.</p></div>`;
  }

  view.className = 'grid';
  view.innerHTML = `
    <section>
      <p class="eyebrow">Saved on this device</p>
      <h1>My Library</h1>
      <div class="seg" role="tablist" aria-label="Library" style="margin:12px 0 16px">
        ${tabs.map(([id, label]) => `<button data-lib="${id}" role="tab" aria-selected="${tab === id}">${label}</button>`).join('')}
      </div>
      ${body}
    </section>
    <aside class="aside">
      <div class="panel">
        <p class="eyebrow">Everything here</p>
        <div class="stack" style="gap:8px">
          <div class="row" style="justify-content:space-between"><span class="muted small">Highlights</span><strong>${hl.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Bookmarks</span><strong>${state.bookmarks.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted small">Notes</span><strong>${state.notes.length}</strong></div>
        </div>
      </div>
      <div class="panel panel-quiet">
        <p class="eyebrow">Export</p>
        <p class="small muted">Take everything with you as one file.</p>
        <button class="btn wide" id="export-lib" style="margin-top:8px">Export library</button>
      </div>
    </aside>`;

  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-lib]');
    if (b) location.hash = `#/saved?tab=${b.dataset.lib}`;
  });
  document.getElementById('export-lib').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([backupBlob(state)], {type: 'application/json'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ADAPT2US-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Library exported');
  });
}

/* ---------------------------------------------------------------- bookmarks */

async function renderBookmarks() {
  corpusIndex ??= await loadIndex();
  const grouped = state.bookmarks;
  view.innerHTML = `
    <h1>Bookmarks</h1>
    <p class="muted small">${grouped.length} saved ${grouped.length === 1 ? 'verse' : 'verses'}.</p>
    <div class="list" style="margin-top:16px">
      ${grouped.length ? await Promise.all(grouped.slice(0, 200).map(async b => {
        let text = '';
        try { text = (await loadChapter(b.slug, b.chapter)).verses[b.verse - 1] ?? ''; } catch {}
        return `<article class="item">
          <div class="item-top">
            <a class="ref-line" href="#/read/${b.slug}/${b.chapter}">${esc(formatReference(b))}</a>
            <button class="btn ghost danger" data-unbookmark="${esc(b.id)}">Remove</button>
          </div>
          <p>${esc(text.slice(0, 200))}${text.length > 200 ? '…' : ''}</p>
        </article>`;
      })).then(h => h.join('')) : `<div class="card"><p class="muted" style="margin:0">No bookmarks yet. Tap a verse while reading to save one.</p></div>`}
    </div>`;
  view.addEventListener('click', ev => {
    const b = ev.target.closest('[data-unbookmark]');
    if (!b) return;
    state.bookmarks = state.bookmarks.filter(x => x.id !== b.dataset.unbookmark);
    persist(); toast('Bookmark removed'); renderBookmarks();
  }, {once: true});
}

/* ---------------------------------------------------------------- more + settings */

function renderMore() {
  view.innerHTML = `
    <h1>More</h1>
    <div class="list" style="margin-top:14px">
      <a class="item" href="#/saved" style="text-decoration:none;color:inherit"><div class="item-top"><h3>My Library</h3><span class="meta">Highlights · Bookmarks · Notes</span></div></a>
      <a class="item" href="#/customize" style="text-decoration:none;color:inherit"><div class="item-top"><h3>Customize</h3><span class="meta">Type, spacing, colour</span></div></a>
      <a class="item" href="#/settings" style="text-decoration:none;color:inherit"><div class="item-top"><h3>Adapt &amp; Settings</h3><span class="meta">Reading, privacy, backup</span></div></a>
      <a class="item" href="#/about" style="text-decoration:none;color:inherit"><div class="item-top"><h3>About ADAPT2US Ministries</h3><span class="meta">Sources and status</span></div></a>
    </div>
    <div class="card" style="margin-top:20px">
      <p class="eyebrow">On this device</p>
      <p class="small muted" style="margin:0">${state.notes.length} journal entries · ${state.prayers.length} prayer requests · ${Object.keys(state.highlights).length} highlights · ${state.bookmarks.length} bookmarks. Data stays on this device until you export it.</p>
    </div>`;
}

const ADAPT_KEY = 'adapt2us-adapt-v1';
const ADAPT_DEFAULTS = {readToMe: false, oneSection: false, explainSimply: false, exploreDeeply: false, largerText: false};
function readAdapt() {
  try { return {...ADAPT_DEFAULTS, ...JSON.parse(localStorage.getItem(ADAPT_KEY) ?? '{}')}; } catch { return {...ADAPT_DEFAULTS}; }
}
function writeAdapt(next) {
  localStorage.setItem(ADAPT_KEY, JSON.stringify(next));
  if (next.largerText && state.prefs.size < 24) { state.prefs.size = 24; persist(); }
  if (!next.largerText && state.prefs.size === 24) { state.prefs.size = 21; persist(); }
  applyPrefs();
}

function renderSettings() {
  const {theme, font, size, lineHeight} = state.prefs;
  const adapt = readAdapt();
  const toggle = (key, label, note) => `
    <label class="item" style="grid-template-columns:1fr auto;align-items:center;cursor:pointer">
      <span><strong style="display:block">${label}</strong><span class="muted small">${note}</span></span>
      <input type="checkbox" data-adapt="${key}" ${adapt[key] ? 'checked' : ''} style="width:52px;height:30px;accent-color:var(--accent)">
    </label>`;
  view.innerHTML = `
    <p class="eyebrow">Adapt &amp; settings</p>
    <h1>Adapt to me</h1>
    <p class="lede">Reading options that follow you across the app.</p>
    <div class="card">
      <p class="eyebrow">Adapt to me</p>
      <div class="list">
        ${toggle('readToMe', 'Read to me', 'Offer read-aloud on every passage')}
        ${toggle('oneSection', 'One section at a time', 'Shorter passages, clause by clause')}
        ${toggle('explainSimply', 'Explain simply', 'Open Understand in plain language first')}
        ${toggle('exploreDeeply', 'Explore deeply', 'Show words and surrounding verses')}
        ${toggle('largerText', 'Larger text', 'Bigger type everywhere')}
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <p class="eyebrow">Appearance</p>
      <div class="seg" role="tablist" aria-label="Theme">
        ${THEMES.map(t => `<button data-theme-opt="${t}" role="tab" aria-selected="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <div class="seg" role="tablist" aria-label="Typeface">
        <button data-font-opt="serif" role="tab" aria-selected="${font === 'serif'}">Serif</button>
        <button data-font-opt="sans" role="tab" aria-selected="${font === 'sans'}">Sans</button>
      </div>
      <label class="field" style="margin-top:8px">Text size · ${size}px
        <input type="range" id="size" min="16" max="40" step="1" value="${size}">
      </label>
      <label class="field" style="margin-top:8px">Line spacing · ${lineHeight.toFixed(2)}
        <input type="range" id="line" min="1.3" max="2.4" step="0.05" value="${lineHeight}">
      </label>
    </div>
    <div class="card" style="margin-top:16px">
      <p class="eyebrow">Backup and restore</p>
      <p class="small muted">Everything lives on this device. Export a backup before changing phones or clearing browser data.</p>
      <div class="stack" style="margin-top:10px">
        <button class="btn wide" id="export">Export backup (.json)</button>
        <label class="btn wide ghost" style="cursor:pointer">Import backup<input id="import" type="file" accept="application/json,.json" hidden></label>
        <button class="btn wide danger" id="reset">Erase all local data</button>
      </div>
    </div>
    <p class="muted small" style="margin-top:16px">Scripture: World English Bible (public domain).</p>`;

  view.querySelectorAll('[data-theme-opt]').forEach(b => b.addEventListener('click', () => {
    state.prefs.theme = b.dataset.themeOpt; applyPrefs(); persist(); renderSettings();
  }));
  view.querySelectorAll('[data-font-opt]').forEach(b => b.addEventListener('click', () => {
    state.prefs.font = b.dataset.fontOpt; applyPrefs(); persist(); renderSettings();
  }));
  view.querySelectorAll('[data-adapt]').forEach(el => el.addEventListener('change', () => {
    const next = {...readAdapt(), [el.dataset.adapt]: el.checked};
    writeAdapt(next);
    toast(el.checked ? 'On' : 'Off');
  }));
  const sizeInput = document.getElementById('size');
  sizeInput.addEventListener('input', () => {
    state.prefs.size = Number(sizeInput.value);
    applyPrefs();
    sizeInput.closest('label').firstChild.textContent = `Text size · ${state.prefs.size}px `;
  });
  sizeInput.addEventListener('change', persist);
  const lineInput = document.getElementById('line');
  lineInput.addEventListener('input', () => {
    state.prefs.lineHeight = Number(lineInput.value);
    applyPrefs();
    lineInput.closest('label').firstChild.textContent = `Line spacing · ${state.prefs.lineHeight.toFixed(2)} `;
  });
  lineInput.addEventListener('change', persist);

  document.getElementById('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([backupBlob(state)], {type: 'application/json'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ADAPT2US-Bible-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Backup downloaded');
  });

  document.getElementById('import').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) return toast('That file is too large to be a backup.');
    try {
      const incoming = normalize(JSON.parse(await file.text()));
      if (!confirm('Replace the data on this device with this backup?')) return;
      state = incoming;
      persist();
      applyPrefs();
      toast('Backup restored');
      renderSettings();
    } catch (err) {
      toast(`Import rejected: ${err.message}`, 5000);
    }
  });

  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Erase all journal entries, prayers, highlights and bookmarks on this device?')) return;
    if (!confirm('This cannot be undone. Export a backup first if you need one. Continue?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = initial();
    persist();
    applyPrefs();
    toast('Local data erased');
    renderSettings();
  });
}

function renderAbout() {
  view.innerHTML = `
    <a class="ref-line" href="#/more">← More</a>
    <h1 style="margin-top:10px">About</h1>
    <div class="card">
      <p><strong>ADAPT2US Bible</strong> — read, understand, reflect, pray. Scripture unchanged; the reading presentation, pace and explanation depth adapt to the reader.</p>
      <p class="small muted">Scripture text: World English Bible, public domain (ebible.org). 66 books, 31,103 verses, bundled for offline reading.</p>
      <p class="small muted">This build is a web app with offline support. It installs to the iPhone home screen from Safari (Share → Add to Home Screen) and runs without a network connection.</p>
      <p class="small muted" style="margin:0">Not yet included: native App Store build, study notes and commentary, lexicon, audio recordings, cross-device sync. Nothing here is claimed that is not built.</p>
    </div>`;
}

/* ---------------------------------------------------------------- misc */

document.addEventListener('click', ev => {
  const routeLink = ev.target.closest('[data-route]');
  if (routeLink) location.hash = routeLink.dataset.route;
});

// first paint, once every module-level binding above exists
route();
if (loaded.warning) toast(loaded.warning, 6000);
