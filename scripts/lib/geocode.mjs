import { readFileSync } from 'node:fs';

const CI = 1;
const STEM = 2;
const EXACT = 4;

const gaz = JSON.parse(readFileSync(new URL('../data/gazetteer.json', import.meta.url), 'utf8'));
const PLACES = gaz.places.map(([id, name, cc, lat, lon, kind, show]) => ({ id, name, cc, lat, lon, kind, show: !!show }));
const COUNTRY_BY_CC = new Map(PLACES.filter((p) => p.kind === 'country').map((p) => [p.cc, p]));

// Landen die tot "Nederland" worden gerekend voor de knop Nederland/Wereld
export const NL_CODES = new Set(['NL', 'AW', 'CW', 'SX', 'BQ']);

const exact = new Map();
const stems = new Map();
let maxN = 1;
for (const [key, p, langs, flags, w] of gaz.aliases) {
  const entry = { key, p, langs: langs ? new Set(langs.split(',')) : null, flags, w };
  if (flags & STEM) {
    const k = key[0];
    if (!stems.has(k)) stems.set(k, []);
    stems.get(k).push(entry);
  } else {
    maxN = Math.max(maxN, key.split(' ').length);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(entry);
  }
}

export function norm(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ orig: m[0], norm: norm(m[0]) });
  return out;
}

const UPPER_START = /^\p{Lu}/u;
function caseOk(entry, span) {
  if (entry.flags & CI) return true;
  if (entry.flags & EXACT) return span.every((t) => t.orig === t.orig.toUpperCase() && /\p{L}/u.test(t.orig));
  return span.some((t) => UPPER_START.test(t.orig));
}
const langOk = (entry, lang) => !entry.langs || entry.langs.has(lang);

/** Vindt plaatsvermeldingen in een tekst. */
export function findMentions(text, lang) {
  const toks = tokenize(text || '');
  const found = [];
  let i = 0;
  while (i < toks.length) {
    let matched = 0;
    for (let n = Math.min(maxN, toks.length - i); n >= 1 && !matched; n--) {
      const span = toks.slice(i, i + n);
      const entries = exact.get(span.map((t) => t.norm).join(' '));
      if (!entries) continue;
      const e = entries.find((en) => langOk(en, lang) && caseOk(en, span));
      if (e) {
        found.push({ p: e.p, w: e.w, pos: i });
        matched = n;
      }
    }
    if (matched) {
      i += matched;
      continue;
    }
    const t = toks[i];
    const cands = stems.get(t.norm[0]);
    if (cands) {
      const e = cands.find(
        (en) =>
          t.norm.startsWith(en.key) &&
          t.norm.length - en.key.length <= 8 &&
          langOk(en, lang) &&
          caseOk(en, [t]),
      );
      if (e) found.push({ p: e.p, w: e.w, pos: i });
    }
    i++;
  }
  return found;
}

function groupKey(place) {
  return place.cc || `p:${place.id}`;
}

export function describe(place) {
  const country = place.cc ? COUNTRY_BY_CC.get(place.cc) : null;
  let label = place.name;
  if (place.kind !== 'country' && place.show && country && country.name !== place.name) {
    label = `${place.name}, ${country.name}`;
  }
  return {
    id: place.id,
    name: place.name,
    label,
    cc: place.cc || null,
    country: country ? country.name : null,
    lat: place.lat,
    lon: place.lon,
    precision: place.kind,
  };
}

/**
 * Bepaalt de meest waarschijnlijke locatie van een artikel.
 * Titel telt zwaarder dan categorieën, die zwaarder tellen dan de samenvatting.
 */
export function locate({ title, description, categories = [], lang, fallback }) {
  const groups = new Map();
  const add = (text, factor, section) => {
    for (const m of findMentions(text, lang)) {
      const place = PLACES[m.p];
      const key = groupKey(place);
      if (!groups.has(key)) groups.set(key, { score: 0, first: Infinity, places: new Map() });
      const g = groups.get(key);
      const s = m.w * factor;
      g.score += s;
      g.first = Math.min(g.first, section * 10000 + m.pos);
      g.places.set(m.p, (g.places.get(m.p) || 0) + s);
    }
  };
  add(title, 3, 0);
  categories.slice(0, 12).forEach((c, i) => add(c, 2, 1 + i * 0.01));
  add(description, 1, 2);

  let best = null;
  for (const [key, g] of groups) {
    if (!best || g.score > best.g.score + 1e-9 || (Math.abs(g.score - best.g.score) < 1e-9 && g.first < best.g.first)) {
      best = { key, g };
    }
  }

  if (best && best.g.score >= 0.5) {
    let chosen = null;
    let chosenScore = -1;
    for (const [p, s] of best.g.places) {
      const place = PLACES[p];
      if (place.kind === 'country') continue;
      if (s > chosenScore) {
        chosen = place;
        chosenScore = s;
      }
    }
    if (!chosen) chosen = COUNTRY_BY_CC.get(best.key) || PLACES[[...best.g.places.keys()][0]];
    return { ...describe(chosen), confidence: Math.round(best.g.score * 10) / 10 };
  }
  if (fallback && COUNTRY_BY_CC.has(fallback)) {
    return { ...describe(COUNTRY_BY_CC.get(fallback)), confidence: 0, fromFeed: true };
  }
  return null;
}
