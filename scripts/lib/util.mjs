import { SETTINGS } from '../config.mjs';

/** Haalt een URL op met een tijdslimiet. Geeft nooit een exception; kijk naar .ok / .error. */
export async function fetchText(url, { accept = '*/*', timeoutMs = SETTINGS.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': SETTINGS.userAgent,
        Accept: accept,
        'Accept-Language': 'nl,en;q=0.9,de;q=0.8',
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, text };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'time-out' : err?.message || String(err);
    return { ok: false, status: 0, url, text: '', error: reason };
  } finally {
    clearTimeout(timer);
  }
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bdquo: '„', sbquo: '‚',
  euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', auml: 'ä', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', oacute: 'ó', ograve: 'ò',
  ocirc: 'ô', uacute: 'ú', ugrave: 'ù', ucirc: 'û', iacute: 'í', icirc: 'î', ccedil: 'ç', ntilde: 'ñ',
  szlig: 'ß', Eacute: 'É', euro: '€', pound: '£', shy: '',
};

export function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Maakt platte tekst van (mogelijk) HTML, met decodering van entities. */
export function toPlainText(s) {
  if (!s) return '';
  let t = String(s)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(decodeEntities(t)); // soms dubbel gecodeerd
  return t.replace(/\s+/g, ' ').trim();
}

export function truncate(s, max) {
  if (!s || s.length <= max) return s || '';
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, '') + '…';
}

/** URL normaliseren voor ontdubbelen (zonder trackingparameters en #anker). */
export function canonicalUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|at_|cmp|ref|partner|referrer|smid|smtyp)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

export function isHttpUrl(u) {
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/** Voert taken uit met een maximum aantal tegelijk. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
