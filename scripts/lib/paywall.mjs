import { fetchText, decodeEntities, isHttpUrl } from './util.mjs';

/**
 * Resultaat: { status: 'free' | 'paywall' | 'unverified', reason, image? }
 *
 * Werkwijze
 * 1. Signalen in de feed zelf (URL-patronen, labels als "SPIEGEL+" of "Z+").
 * 2. De artikelpagina ophalen en kijken naar de standaard die uitgevers voor
 *    zoekmachines gebruiken: schema.org "isAccessibleForFree" en de meta-tag
 *    "article:content_tier" (locked / metered / free).
 * 3. Komt het script niet bij het artikel (cookiemuur, blokkade, time-out),
 *    dan is de status 'unverified'.
 */
export function feedHints(item, source) {
  const cfg = source.paywall || {};
  for (const m of cfg.urlMarkers || []) {
    if (item.url.includes(m)) return { status: 'paywall', reason: `URL bevat ${m}` };
  }
  const haystack = `${item.title} ${item.categories.join(' ')}`;
  for (const m of cfg.textMarkers || []) {
    if (haystack.includes(m)) return { status: 'paywall', reason: `label ${m}` };
  }
  return null;
}

/** Herkent doorverwijzingen naar een cookie-/toestemmingspagina. */
function isConsentUrl(u) {
  try {
    const { hostname, pathname } = new URL(u);
    return (
      /^(consent|myprivacy|guce|cmp)\./i.test(hostname) ||
      /myprivacy\.dpgmedia/i.test(hostname) ||
      /^\/(zustimmung|consent|cookiewall|privacy-gate)(\/|$|\?)/i.test(pathname)
    );
  } catch {
    return false;
  }
}

export function analyzeHtml(html, finalUrl, source) {
  if (isConsentUrl(finalUrl)) {
    return { status: 'unverified', reason: 'cookiemuur' };
  }
  const cfg = source.paywall || {};

  // schema.org: "isAccessibleForFree": false / "False" / "false"
  const flags = [...html.matchAll(/"isAccessibleForFree"\s*:\s*"?(true|false)"?/gi)].map((m) => m[1].toLowerCase());
  if (flags.includes('false')) return { status: 'paywall', reason: 'isAccessibleForFree=false', image: ogImage(html) };

  // Open Graph uitbreiding: article:content_tier
  const tier = metaContent(html, 'article:content_tier');
  if (tier && /locked|metered/i.test(tier)) return { status: 'paywall', reason: `content_tier=${tier}`, image: ogImage(html) };

  for (const m of cfg.htmlMarkers || []) {
    if (html.includes(m)) return { status: 'paywall', reason: `pagina bevat ${m}`, image: ogImage(html) };
  }

  if (flags.includes('true') || (tier && /free/i.test(tier))) {
    return { status: 'free', reason: 'gemarkeerd als gratis', image: ogImage(html) };
  }
  // Een echte artikelpagina zonder paywall-kenmerken: we beschouwen hem als vrij.
  if (/<article[\s>]|"@type"\s*:\s*"(News)?Article"|property=["']og:type["'][^>]*article/i.test(html)) {
    return { status: 'free', reason: 'geen paywall-kenmerken', image: ogImage(html) };
  }
  return { status: 'unverified', reason: 'geen artikelpagina ontvangen' };
}

export async function checkArticle(item, source) {
  const hint = feedHints(item, source);
  if (hint) return hint;
  if ((source.paywall?.mode || 'check') === 'none') return { status: 'free', reason: 'bron zonder paywall' };

  const res = await fetchText(item.url, { accept: 'text/html,application/xhtml+xml' });
  if (!res.ok) {
    if (isConsentUrl(res.url)) return { status: 'unverified', reason: 'cookiemuur' };
    return { status: 'unverified', reason: res.error || `HTTP ${res.status}` };
  }
  return analyzeHtml(res.text, res.url, source);
}

function metaContent(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i'));
  if (a) return a[1];
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, 'i'));
  return b ? b[1] : '';
}

function ogImage(html) {
  const u = decodeEntities(metaContent(html, 'og:image'));
  return isHttpUrl(u) ? u : '';
}
