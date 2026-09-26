import { XMLParser } from 'fast-xml-parser';
import { toPlainText, isHttpUrl } from './util.mjs';

const ARRAYS = new Set([
  'item', 'entry', 'category', 'media:content', 'media:thumbnail', 'link', 'dc:subject', 'enclosure',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ARRAYS.has(name),
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
});

function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
}

function pickLink(item) {
  const links = item.link;
  if (Array.isArray(links)) {
    for (const l of links) {
      if (typeof l === 'string' && isHttpUrl(l.trim())) return l.trim();
      if (l && typeof l === 'object') {
        const href = l['@_href'];
        const rel = l['@_rel'];
        if (href && (!rel || rel === 'alternate')) return href;
        const t = text(l).trim();
        if (isHttpUrl(t)) return t;
      }
    }
  }
  const guid = text(item.guid).trim();
  if (isHttpUrl(guid)) return guid;
  return '';
}

function pickImage(item) {
  const candidates = [];
  for (const m of item['media:content'] || []) {
    const url = m?.['@_url'];
    const medium = m?.['@_medium'] || m?.['@_type'] || 'image';
    if (url && /image/.test(medium)) candidates.push({ url, w: Number(m['@_width']) || 0 });
  }
  for (const m of item['media:thumbnail'] || []) {
    if (m?.['@_url']) candidates.push({ url: m['@_url'], w: Number(m['@_width']) || 0 });
  }
  for (const e of item.enclosure || []) {
    if (e?.['@_url'] && /^image\//.test(e['@_type'] || 'image/')) candidates.push({ url: e['@_url'], w: 0 });
  }
  // Voorkeur: een middelgrote afbeelding (niet gigantisch, niet piepklein)
  candidates.sort((a, b) => score(b.w) - score(a.w));
  const best = candidates.find((c) => isHttpUrl(c.url));
  return best ? best.url : '';
  function score(w) {
    if (!w) return 1;
    return w >= 300 && w <= 1300 ? 3 : 2;
  }
}

function pickDate(item) {
  const raw = text(item.pubDate) || text(item['dc:date']) || text(item.published) || text(item.updated);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Zet feed-XML om in een lijst genormaliseerde berichten. */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel || doc?.['rdf:RDF'] || null;
  const rawItems = channel?.item || doc?.['rdf:RDF']?.item || doc?.feed?.entry || [];
  const items = [];
  for (const it of rawItems) {
    const title = toPlainText(text(it.title));
    const url = pickLink(it);
    if (!title || !url) continue;
    const description = toPlainText(
      text(it.description) || text(it.summary) || text(it['content:encoded']) || text(it.content),
    );
    const categories = [...(it.category || []), ...(it['dc:subject'] || [])]
      .map((c) => toPlainText(typeof c === 'object' ? c['@_term'] || text(c) : text(c)))
      .filter(Boolean);
    items.push({ title, url, description, categories, date: pickDate(it), image: pickImage(it) });
  }
  return items;
}
