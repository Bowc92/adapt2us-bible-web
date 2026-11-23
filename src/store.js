// Local-first state: preferences, reading position, highlights, bookmarks, journal, prayer.
export const STORAGE_KEY = 'adapt2us-bible-v2';
export const SCHEMA_VERSION = 2;

export const THEMES = ['night', 'day', 'sepia'];
export const FONTS = ['serif', 'sans'];
export const HIGHLIGHT_COLORS = [
  {id: 'cyan', label: 'Cyan', value: '#00f5ff'},
  {id: 'blue', label: 'Blue', value: '#00a3ff'},
  {id: 'gold', label: 'Gold', value: '#ffd166'},
  {id: 'green', label: 'Green', value: '#7ee787'},
  {id: 'rose', label: 'Rose', value: '#ff9db1'},
];

export function initial() {
  return {
    version: SCHEMA_VERSION,
    prefs: {size: 21, lineHeight: 1.75, font: 'serif', theme: 'night', redLetter: false},
    lastRead: null,               // {slug, chapter, verse}
    highlights: {},               // verseKey -> color id
    bookmarks: [],                // [{id, slug, chapter, verse, createdAt}]
    notes: [],                    // [{id, title, body, ref, createdAt, updatedAt}]
    prayers: [],                  // [{id, text, answered, createdAt, answeredAt}]
    searchHistory: [],
  };
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string';
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const clamp = (v, min, max, fallback) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const id = v => (str(v) && v.length > 0 && v.length <= 100 ? v : null);

/** Migrate + validate any stored or imported object into a usable state. Throws on junk. */
export function normalize(raw) {
  if (!isObj(raw)) throw new Error('Not an ADAPT2US Bible backup');
  if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > SCHEMA_VERSION) {
    throw new Error(`Unsupported backup version: ${raw.version ?? 'missing'}`);
  }
  const base = initial();
  const prefs = isObj(raw.prefs) ? raw.prefs : {};
  // v1 stored a bare `size` number
  const size = prefs.size ?? raw.size;
  const state = {
    ...base,
    prefs: {
      size: Math.round(clamp(size, 16, 40, base.prefs.size)),
      lineHeight: clamp(prefs.lineHeight, 1.3, 2.4, base.prefs.lineHeight),
      font: oneOf(prefs.font, FONTS, base.prefs.font),
      theme: oneOf(prefs.theme, THEMES, base.prefs.theme),
      redLetter: typeof prefs.redLetter === 'boolean' ? prefs.redLetter : false,
    },
  };

  if (isObj(raw.lastRead) && str(raw.lastRead.slug)) {
    state.lastRead = {
      slug: raw.lastRead.slug,
      chapter: Math.max(1, Math.round(clamp(raw.lastRead.chapter, 1, 200, 1))),
      verse: raw.lastRead.verse == null ? null : Math.max(1, Math.round(clamp(raw.lastRead.verse, 1, 200, 1))),
    };
  }

  if (isObj(raw.highlights)) {
    for (const [k, v] of Object.entries(raw.highlights)) {
      const color = HIGHLIGHT_COLORS.some(c => c.id === v || c.value === v) ? v : null;
      if (color && /^[a-z0-9]+\.\d+\.\d+$/.test(k)) state.highlights[k] = color;
    }
  }

  if (Array.isArray(raw.bookmarks)) {
    state.bookmarks = raw.bookmarks
      .filter(b => isObj(b) && str(b.slug) && Number.isInteger(b.chapter) && Number.isInteger(b.verse))
      .map(b => ({id: id(b.id) ?? cryptoId(), slug: b.slug, chapter: b.chapter, verse: b.verse,
        createdAt: str(b.createdAt) ? b.createdAt : new Date().toISOString()}))
      .slice(0, 2000);
  }

  if (Array.isArray(raw.notes)) {
    state.notes = raw.notes
      .filter(n => isObj(n) && str(n.body))
      .map(n => ({
        id: id(n.id) ?? cryptoId(),
        title: str(n.title) ? n.title.slice(0, 200) : '',
        body: n.body.slice(0, 20000),
        ref: isObj(n.ref) ? {slug: String(n.ref.slug ?? ''), chapter: Number(n.ref.chapter) || null,
          verse: n.ref.verse == null ? null : Number(n.ref.verse), label: str(n.ref.label) ? n.ref.label : ''} : null,
        createdAt: str(n.createdAt) ? n.createdAt : new Date().toISOString(),
        updatedAt: str(n.updatedAt) ? n.updatedAt : new Date().toISOString(),
      }))
      .slice(0, 5000);
  }

  if (Array.isArray(raw.prayers)) {
    state.prayers = raw.prayers
      .filter(p => isObj(p) && str(p.text))
      .map(p => ({
        id: id(p.id) ?? cryptoId(),
        text: p.text.slice(0, 2000),
        answered: p.answered === true,
        createdAt: str(p.createdAt) ? p.createdAt : new Date().toISOString(),
        answeredAt: str(p.answeredAt) ? p.answeredAt : null,
      }))
      .slice(0, 2000);
  }

  if (Array.isArray(raw.searchHistory)) {
    state.searchHistory = raw.searchHistory.filter(str).slice(0, 10);
  }
  return state;
}

export function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function load(storage) {
  const store = storage ?? globalThis.localStorage;
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return {state: initial(), warning: null};
    return {state: normalize(JSON.parse(raw)), warning: null};
  } catch (err) {
    return {state: initial(), warning: `Saved data could not be read (${err.message}). Import a backup to restore.`};
  }
}

export function save(state, storage) {
  const store = storage ?? globalThis.localStorage;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return {ok: true};
  } catch (err) {
    return {ok: false, error: `Storage failed: ${err.message}`};
  }
}

export const toggleHighlight = (state, key, colorId) => {
  if (state.highlights[key] === colorId) delete state.highlights[key];
  else state.highlights[key] = colorId;
  return state;
};

export const isBookmarked = (state, slug, chapter, verse) =>
  state.bookmarks.some(b => b.slug === slug && b.chapter === chapter && b.verse === verse);

export function toggleBookmark(state, slug, chapter, verse) {
  const i = state.bookmarks.findIndex(b => b.slug === slug && b.chapter === chapter && b.verse === verse);
  if (i >= 0) state.bookmarks.splice(i, 1);
  else state.bookmarks.unshift({id: cryptoId(), slug, chapter, verse, createdAt: new Date().toISOString()});
  return state;
}

export const notesForVerse = (state, slug, chapter, verse) =>
  state.notes.filter(n => n.ref && n.ref.slug === slug && n.ref.chapter === chapter && n.ref.verse === verse);

export function addPrayer(state, text) {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const prayer = {id: cryptoId(), text: clean.slice(0, 2000), answered: false,
    createdAt: new Date().toISOString(), answeredAt: null};
  state.prayers.unshift(prayer);
  return prayer;
}

export function togglePrayer(state, prayerId) {
  const p = state.prayers.find(x => x.id === prayerId);
  if (!p) return null;
  p.answered = !p.answered;
  p.answeredAt = p.answered ? new Date().toISOString() : null;
  return p;
}

export function backupBlob(state) {
  return JSON.stringify({...state, exportedAt: new Date().toISOString()}, null, 2);
}
