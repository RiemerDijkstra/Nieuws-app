// ---------------------------------------------------------------------------
// Urgentie: een eenvoudige, uitlegbare inschatting.
//  - trefwoorden per taal (titel telt volledig, samenvatting half)
//  - extra punt bij grote aantallen slachtoffers
//  - extra punten als meerdere bronnen over dezelfde plek berichten
// Het resultaat is een niveau ('urgent' | 'important' | null) plus de redenen,
// zodat de app kan laten zien waarom iets als urgent is gemarkeerd.
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    label: 'Liveverslag', weight: 2, titleOnly: true,
    terms: {
      en: ['live', 'live updates', 'breaking'],
      nl: ['live', 'liveblog', 'net binnen', 'breaking'],
      de: ['live', 'liveblog', 'ticker', 'newsblog', 'eilmeldung'],
    },
  },
  {
    label: 'Doden of gewonden', weight: 4,
    terms: {
      en: ['killed', 'kills', 'dead', 'death toll', 'deaths', 'casualties', 'wounded', 'fatalities', 'massacre'],
      nl: ['doden', 'dode', 'omgekomen', 'dodental', 'gedood', 'gewonden', 'slachtoffers', 'bloedbad', 'om het leven'],
      de: ['tote', 'toten', 'getötet', 'todesopfer', 'verletzte', 'verletzten', 'massaker', 'ums leben'],
    },
  },
  {
    label: 'Natuurramp', weight: 4,
    terms: {
      en: ['earthquake', 'tsunami', 'hurricane', 'typhoon', 'cyclone', 'eruption', 'flood*', 'wildfire*', 'landslide*', 'heatwave'],
      nl: ['aardbeving*', 'tsunami', 'orkaan', 'tyfoon', 'cycloon', 'uitbarsting', 'overstroming*', 'bosbrand*', 'natuurbrand*', 'aardverschuiving*', 'hittegolf'],
      de: ['erdbeben', 'tsunami', 'hurrikan', 'taifun', 'zyklon', 'vulkanausbruch', 'hochwasser', 'überschwemmung*', 'waldbrand*', 'waldbrände', 'erdrutsch*', 'hitzewelle'],
    },
  },
  {
    label: 'Geweld of aanslag', weight: 4,
    terms: {
      en: ['attack', 'attacks', 'attacked', 'explosion*', 'shooting', 'gunman', 'bomb*', 'terror*', 'stabbing', 'hostage*'],
      nl: ['aanslag*', 'aanval', 'aanvallen', 'explosie*', 'schietpartij', 'schietincident', 'bomaanslag', 'terreur*', 'terroris*', 'steekpartij', 'gijzel*'],
      de: ['anschlag*', 'angriff', 'angriffe', 'explosion*', 'schüsse', 'schießerei', 'bombe*', 'terror*', 'messerangriff*', 'geisel*'],
    },
  },
  {
    label: 'Oorlog of militair geweld', weight: 3,
    terms: {
      en: ['war', 'invasion', 'airstrike*', 'air strike*', 'missile*', 'drone strike*', 'shelling', 'offensive', 'ceasefire', 'troops', 'nuclear'],
      nl: ['oorlog', 'invasie', 'luchtaanval*', 'raketaanval*', 'raketten', 'drone-aanval*', 'droneaanval*', 'beschieting*', 'offensief', 'staakt-het-vuren', 'wapenstilstand', 'troepen', 'kernwapen*'],
      de: ['krieg', 'invasion', 'luftangriff*', 'raketenangriff*', 'raketen', 'drohnenangriff*', 'beschuss', 'offensive', 'waffenruhe', 'waffenstillstand', 'truppen', 'atomwaffe*'],
    },
  },
  {
    label: 'Politieke crisis', weight: 3,
    terms: {
      en: ['coup', 'resigns', 'resignation', 'impeach*', 'state of emergency', 'martial law', 'snap election', 'no-confidence', 'no confidence'],
      nl: ['staatsgreep', 'treedt af', 'aftreden', 'afgetreden', 'noodtoestand', 'staat van beleg', 'kabinet gevallen', 'kabinetscrisis', 'vervroegde verkiezingen', 'motie van wantrouwen'],
      de: ['putsch', 'rücktritt', 'tritt zurück', 'zurückgetreten', 'amtsenthebung*', 'ausnahmezustand', 'kriegsrecht', 'neuwahl*', 'regierungskrise', 'misstrauensvotum', 'koalitionsbruch'],
    },
  },
  {
    label: 'Noodsituatie', weight: 3,
    terms: {
      en: ['evacuat*', 'emergency', 'outbreak', 'pandemic', 'epidemic', 'plane crash', 'derail*'],
      nl: ['evacu*', 'noodsituatie', 'uitbraak', 'pandemie', 'epidemie', 'neergestort', 'vliegtuigcrash', 'ontspoord', 'ingestort', 'code rood'],
      de: ['evakuier*', 'notfall', 'pandemie', 'epidemie', 'absturz', 'abgestürzt', 'entgleist', 'eingestürzt'],
    },
  },
  {
    label: 'Weeralarm', weight: 2,
    terms: {
      en: ['red warning', 'amber warning', 'storm'],
      nl: ['code oranje', 'weeralarm', 'storm'],
      de: ['unwetter', 'unwetterwarnung', 'sturm'],
    },
  },
];

const MAGNITUDE = /(?<![\p{L}\p{N}])(\d{2,}|dozens|hundreds|thousands|tientallen|honderden|duizenden|dutzende|hunderte|tausende)(?![\p{L}\p{N}])/iu;

function termToPattern(t) {
  return t
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '*' : `\\${c}`))
    .replace(/\s+/g, '[\\s-]+')
    .replace(/\*/g, '\\p{L}*');
}
const COMPILED = GROUPS.map((g) => ({
  ...g,
  re: Object.fromEntries(
    Object.entries(g.terms).map(([lang, terms]) => [
      lang,
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(termToPattern).join('|')})(?![\\p{L}\\p{N}])`, 'iu'),
    ]),
  ),
}));

/** Trefwoordscore voor één artikel. */
export function keywordScore({ title, description, lang }) {
  let score = 0;
  const reasons = [];
  let casualties = false;
  for (const g of COMPILED) {
    const re = g.re[lang] || g.re.en;
    if (re.test(title)) {
      score += g.weight;
      reasons.push(g.label);
      if (g.label === 'Doden of gewonden') casualties = true;
    } else if (!g.titleOnly && description && re.test(description)) {
      score += Math.ceil(g.weight / 2);
      reasons.push(g.label);
    }
  }
  if (casualties && MAGNITUDE.test(title)) {
    score += 1;
  }
  return { score: Math.min(score, 8), reasons, titleWeight: score };
}

/**
 * Kent per artikel een urgentieniveau toe. Muteert de artikelen (veld urgency).
 * @param {Array} articles  met .keyword (uit keywordScore), .location, .source, .published, .scope
 */
export function assignUrgency(articles, now = Date.now()) {
  // Dekking: hoeveel verschillende bronnen melden nieuws van dezelfde plek (laatste 24 uur)?
  const day = 24 * 3600e3;
  const coverage = new Map();
  for (const a of articles) {
    if (!a.location || now - Date.parse(a.published) > day) continue;
    const key = a.location.precision === 'country' ? `c:${a.location.cc}` : a.location.id;
    if (!coverage.has(key)) coverage.set(key, new Set());
    coverage.get(key).add(a.source);
  }

  for (const a of articles) {
    const { score: kw, reasons } = a.keyword;
    let score = kw;
    const why = [...reasons];
    if (a.location) {
      const key = a.location.precision === 'country' ? `c:${a.location.cc}` : a.location.id;
      const n = coverage.get(key)?.size || 0;
      const precise = a.location.precision !== 'country';
      const bonus = precise ? (n >= 4 ? 2 : n >= 3 ? 1 : 0) : n >= 5 ? 1 : 0;
      if (bonus && kw > 0) {
        score += bonus;
        why.push(`Gemeld door ${n} bronnen`);
      }
    }
    const fresh = now - Date.parse(a.published) <= day;
    let level = null;
    if (score >= 6 && kw >= 4 && fresh) level = 'urgent';
    else if (score >= 3) level = 'important';
    a.urgency = { level, score, reasons: why };
  }

  // Niet alles mag urgent zijn: maximaal ~12% per categorie (minimaal 3).
  for (const scope of ['nl', 'world']) {
    const list = articles.filter((a) => a.scope === scope && a.urgency.level === 'urgent');
    const total = articles.filter((a) => a.scope === scope).length;
    const max = Math.max(3, Math.round(total * 0.12));
    if (list.length > max) {
      list.sort((x, y) => y.urgency.score - x.urgency.score || Date.parse(y.published) - Date.parse(x.published));
      for (const a of list.slice(max)) a.urgency.level = 'important';
    }
  }
}
