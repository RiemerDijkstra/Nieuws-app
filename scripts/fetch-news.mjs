#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Haalt de feeds op, laat paywall-artikelen en oude berichten weg, bepaalt de
// locatie en urgentie, en schrijft data/news.json.
// Draait automatisch via GitHub Actions (.github/workflows/static.yml).
// ---------------------------------------------------------------------------
import { mkdir, writeFile } from 'node:fs/promises';
import { SETTINGS, SOURCES } from './config.mjs';
import { parseFeed } from './lib/feeds.mjs';
import { checkArticle } from './lib/paywall.mjs';
import { locate, NL_CODES } from './lib/geocode.mjs';
import { keywordScore, assignUrgency } from './lib/urgency.mjs';
import { fetchText, pool, canonicalUrl, truncate, hash, isHttpUrl } from './lib/util.mjs';

const OUT = new URL('../data/news.json', import.meta.url);

async function main() {
  const now = Date.now();
  const cutoff = now - SETTINGS.maxAgeHours * 3600e3;
  const stats = Object.fromEntries(
    SOURCES.map((s) => [s.id, { feedsOk: 0, feedsFailed: [], inFeeds: 0, recent: 0, paywall: 0, unverified: 0, kept: 0 }]),
  );

  // 1. Feeds ophalen -------------------------------------------------------
  const jobs = SOURCES.flatMap((source) => source.feeds.map((feed) => ({ source, feed })));
  const feedResults = await pool(jobs, 4, async ({ source, feed }) => {
    const res = await fetchText(feed.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' });
    const st = stats[source.id];
    if (!res.ok || !res.text.includes('<')) {
      st.feedsFailed.push(`${feed.url} (${res.error || `HTTP ${res.status}`})`);
      return [];
    }
    try {
      const items = parseFeed(res.text).slice(0, SETTINGS.maxItemsPerFeed);
      st.feedsOk++;
      return items.map((it) => ({ ...it, source, feed }));
    } catch (err) {
      st.feedsFailed.push(`${feed.url} (onleesbaar: ${err.message})`);
      return [];
    }
  });

  // 2. Ontdubbelen en te oude berichten weglaten ----------------------------
  const byUrl = new Map();
  for (const item of feedResults.flat()) {
    stats[item.source.id].inFeeds++;
    const key = canonicalUrl(item.url);
    const prev = byUrl.get(key);
    if (prev) {
      // Hetzelfde artikel in meerdere feeds: bewaar een eventuele landhint
      if (!prev.feed.fallback && item.feed.fallback) prev.feed = item.feed;
      prev.categories = [...new Set([...prev.categories, ...item.categories])];
      continue;
    }
    byUrl.set(key, { ...item, key });
  }
  const recent = [...byUrl.values()].filter((it) => it.date && it.date.getTime() >= cutoff && it.date.getTime() <= now + 3600e3);
  for (const it of recent) stats[it.source.id].recent++;

  // 3. Paywall-controle ------------------------------------------------------
  const checks = await pool(recent, SETTINGS.concurrency, (it) => checkArticle(it, it.source));

  // 4. Artikelen samenstellen ------------------------------------------------
  const articles = [];
  recent.forEach((it, i) => {
    const check = checks[i];
    const st = stats[it.source.id];
    if (check.status === 'paywall') {
      st.paywall++;
      return;
    }
    if (check.status === 'unverified') {
      st.unverified++;
      if (SETTINGS.unverifiedPolicy !== 'include') return;
    }
    const lang = it.feed.lang || it.source.lang;
    const location = locate({
      title: it.title,
      description: it.description,
      categories: it.categories,
      lang,
      fallback: it.feed.fallback,
    });
    let scope;
    if (location?.cc) scope = NL_CODES.has(location.cc) ? 'nl' : 'world';
    else if (location) scope = 'world';
    else scope = it.feed.fallback && NL_CODES.has(it.feed.fallback) ? 'nl' : 'world';

    const summary = it.description && it.description !== it.title ? truncate(it.description, 280) : '';
    const image = [it.image, check.image].find((u) => u && isHttpUrl(u)) || '';
    articles.push({
      id: hash(it.key),
      source: it.source.id,
      title: truncate(it.title, 240),
      summary,
      url: it.url,
      image,
      lang,
      published: it.date.toISOString(),
      scope,
      location,
      paywall: check.status === 'free' ? 'free' : 'unverified',
      keyword: keywordScore({ title: it.title, description: it.description, lang }),
    });
    st.kept++;
  });

  assignUrgency(articles, now);
  for (const a of articles) delete a.keyword;
  articles.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

  // 5. Wegschrijven ----------------------------------------------------------
  const output = {
    meta: {
      generatedAt: new Date(now).toISOString(),
      maxAgeHours: SETTINGS.maxAgeHours,
      unverifiedPolicy: SETTINGS.unverifiedPolicy,
      counts: {
        total: articles.length,
        nl: articles.filter((a) => a.scope === 'nl').length,
        world: articles.filter((a) => a.scope === 'world').length,
        mapped: articles.filter((a) => a.location).length,
      },
      sources: SOURCES.map((s) => ({
        id: s.id, name: s.name, color: s.color, lang: s.lang, home: s.home,
        stats: stats[s.id],
      })),
    },
    articles,
  };

  printSummary(output.meta);
  if (articles.length === 0) {
    // Niets binnengekomen (bijv. alle feeds tijdelijk onbereikbaar):
    // houd dan het nieuws van de huidige website aan, zodat die niet leeg raakt.
    const previous = await previousNews(cutoff);
    if (previous) {
      console.log('::warning::Geen enkel artikel opgehaald. Het nieuws van de vorige run blijft staan.');
      await save(previous);
      return;
    }
    console.log('::warning::Geen enkel artikel opgehaald en geen eerdere versie gevonden. De site toont een melding.');
    output.meta.fetchFailed = true;
  }
  await save(output);
}

async function save(data) {
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data), 'utf8');
  console.log(`\nGeschreven: data/news.json (${data.articles.length} artikelen)`);
}

/** Haalt het news.json van de live website op (wordt door de workflow meegegeven). */
async function previousNews(cutoff) {
  const url = process.env.PREVIOUS_NEWS_URL;
  if (!url || !isHttpUrl(url)) return null;
  const res = await fetchText(url, { accept: 'application/json' });
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.text);
    if (!data?.meta || !Array.isArray(data.articles)) return null;
    data.articles = data.articles.filter((a) => Date.parse(a.published) >= cutoff);
    return data.articles.length ? data : null;
  } catch {
    return null;
  }
}

function printSummary(meta) {
  console.log(`Wereldblik – ${meta.generatedAt}`);
  console.log('Bron'.padEnd(22), 'feeds', 'in feed', 'recent', 'paywall', 'onzeker', 'getoond');
  for (const s of meta.sources) {
    const t = s.stats;
    console.log(
      s.name.padEnd(22),
      String(t.feedsOk).padStart(5),
      String(t.inFeeds).padStart(7),
      String(t.recent).padStart(6),
      String(t.paywall).padStart(7),
      String(t.unverified).padStart(7),
      String(t.kept).padStart(7),
    );
    for (const f of t.feedsFailed) console.log(`::warning::${s.name}: feed mislukt ${f}`);
  }
  console.log(`Nederland: ${meta.counts.nl}  Wereld: ${meta.counts.world}  Op de kaart: ${meta.counts.mapped}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
