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

const TAB_FOR = {home: 'home', read: 'read', library: 'read', search: 'read', journal: 'journal', pray: 'pray', more: 'more', settings: 'more', bookmarks: 'more', about: 'more'};

async function route() {
  const r = parseHash();
  stopSpeaking();
  const tab = TAB_FOR[r.name] ?? 'home';
  document.querySelectorAll('.tabbar a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    if (r.name === 'home') await renderHome();
    else if (r.name === 'read') await renderReader(r);
    else if (r.name === 'library') await renderLibrary(r);
    else if (r.name === 'search') renderSearch(r);
    else if (r.name === 'journal') renderJournal(r);
    else if (r.name === 'pray') renderPray();
    else if (r.name === 'more') renderMore();
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

  view.innerHTML = `
    <p class="eyebrow">${greeting()}</p>
    <h1>Read. Understand. Reflect. Pray.</h1>
    <div class="stack" style="margin:20px 0 22px">${continueCard}</div>
    <div class="tiles">
      <a class="tile" href="#/read">${icon.read}<strong>Read the Bible</strong><small>All 66 books, offline</small></a>
      <a class="tile" href="#/read?listen=1">${icon.listen}<strong>Listen</strong><small>Hear the passage</small></a>
      <a class="tile" href="#/pray">${icon.pray}<strong>Pray</strong><small>Your prayer list</small></a>
      <a class="tile" href="#/journal">${icon.journal}<strong>My Journal</strong><small>${state.notes.length} ${state.notes.length === 1 ? 'entry' : 'entries'}</small></a>
    </div>
    <div class="card" id="votd" style="margin-top:22px">
      <p class="eyebrow">Verse of the day</p>
      <p class="muted small" style="margin:0">Loading…</p>
    </div>`;

  try {
    corpusIndex ??= await loadIndex();
    const {slug, chapter, verse} = verseOfTheDay(corpusIndex);
    const {verses} = await loadChapter(slug, chapter);
    const el = document.getElementById('votd');
    if (!el) return;
    el.innerHTML = `<p class="eyebrow">Verse of the day</p>
      <p class="passage" style="font-size:calc(var(--reading-size) * 0.86);margin:0 0 10px">${esc(verses[verse - 1])}</p>
      <a class="ref-line" href="#/read/${slug}/${chapter}">${esc(formatReference({slug, chapter, verse}))}</a>`;
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

  view.innerHTML = `
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
    <p class="muted small" style="margin-top:20px">Tap any verse to highlight, bookmark or write a note. Scripture text: World English Bible, public domain.</p>`;

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
    view.innerHTML = `
      <a class="ref-line" href="#/library">← All books</a>
      <h1 style="margin-top:10px">${esc(book.name)}</h1>
      <p class="muted small">${counts.length} chapters · ${counts.reduce((a, b) => a + b, 0)} verses</p>
      <div class="chapter-grid" style="margin-top:16px">
        ${counts.map((_, i) => `<button data-chapter="${i + 1}"${state.lastRead?.slug === slug && state.lastRead?.chapter === i + 1 ? ' aria-current="true"' : ''}>${i + 1}</button>`).join('')}
      </div>`;
    view.querySelector('.chapter-grid').addEventListener('click', ev => {
      const b = ev.target.closest('[data-chapter]');
      if (b) location.hash = `#/read/${slug}/${b.dataset.chapter}`;
    });
    return;
  }

  const testament = r.query.t ?? 'OT';
  view.innerHTML = `
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
    </div>`;
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
    </form>
    <p class="muted small">Type a word or phrase, or jump to a reference like <strong>first john 4:8</strong>.</p>
    <div id="results"></div>`;

  const input = document.getElementById('q');
  const form = document.getElementById('search-form');
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    runSearch(input.value);
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

  view.innerHTML = `
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
        </article>`).join('') : `<div class="card"><p class="muted" style="margin:0">No entries yet. Write your first reflection, or tap a verse while reading.</p></div>`}
    </div>`;

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
  view.innerHTML = `
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
      </div>` : ''}`;

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
      <a class="item" href="#/bookmarks" style="text-decoration:none;color:inherit"><div class="item-top"><h3>Bookmarks</h3><span class="meta">${state.bookmarks.length}</span></div></a>
      <a class="item" href="#/settings" style="text-decoration:none;color:inherit"><div class="item-top"><h3>Settings</h3><span class="meta">Reading, theme, backup</span></div></a>
      <a class="item" href="#/about" style="text-decoration:none;color:inherit"><div class="item-top"><h3>About ADAPT2US Bible</h3><span class="meta">Sources and status</span></div></a>
    </div>
    <div class="card" style="margin-top:20px">
      <p class="eyebrow">On this device</p>
      <p class="small muted" style="margin:0">${state.notes.length} journal entries · ${state.prayers.length} prayer requests · ${Object.keys(state.highlights).length} highlights · ${state.bookmarks.length} bookmarks. Data stays on this device until you export it.</p>
    </div>`;
}

function renderSettings() {
  const {theme, font, size, lineHeight} = state.prefs;
  view.innerHTML = `
    <h1>Settings</h1>
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
