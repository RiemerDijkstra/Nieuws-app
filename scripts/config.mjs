// ---------------------------------------------------------------------------
// Wereldblik – instellingen
// Pas hier bronnen, feeds en regels aan. Na een wijziging haalt de GitHub
// Action bij de volgende run automatisch nieuwe berichten op.
// ---------------------------------------------------------------------------

export const SETTINGS = {
  // Artikelen ouder dan dit aantal uur vallen weg (zo ververst de lijst elke dag).
  maxAgeHours: 36,
  // Maximaal aantal berichten dat per feed wordt bekeken.
  maxItemsPerFeed: 25,
  // Wachttijd per verzoek (ms) en aantal gelijktijdige verzoeken.
  timeoutMs: 15000,
  concurrency: 6,
  // Wat te doen als niet vastgesteld kan worden of een artikel achter een
  // paywall staat (bijv. door een cookiemuur):
  //   'exclude' = weglaten (geen halve artikelen)   'include' = toch tonen
  unverifiedPolicy: 'exclude',
  // Browserachtige user-agent; sommige sites weigeren kale scripts.
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Wereldblik/1.0',
};

// fallback = landcode die gebruikt wordt als in het artikel geen plaats herkend wordt.
// null = geen plek op de kaart (het artikel staat dan alleen in de lijst).
export const SOURCES = [
  {
    id: 'trouw',
    name: 'Trouw',
    home: 'NL',
    lang: 'nl',
    color: '#1f7a8c',
    paywall: { mode: 'check' },
    feeds: [
      { url: 'https://www.trouw.nl/voorpagina/rss.xml', fallback: 'NL' },
      { url: 'https://www.trouw.nl/buitenland/rss.xml', fallback: null },
      { url: 'https://www.trouw.nl/politiek/rss.xml', fallback: 'NL' },
    ],
  },
  {
    id: 'nrc',
    name: 'NRC',
    home: 'NL',
    lang: 'nl',
    color: '#9f1d35',
    paywall: { mode: 'check' },
    feeds: [{ url: 'https://www.nrc.nl/rss/', fallback: 'NL' }],
  },
  {
    id: 'guardian',
    name: 'The Guardian',
    home: 'GB',
    lang: 'en',
    color: '#1d3f8f',
    // The Guardian heeft geen paywall: alle artikelen zijn vrij te lezen.
    paywall: { mode: 'none' },
    feeds: [
      { url: 'https://www.theguardian.com/world/rss', fallback: null },
      { url: 'https://www.theguardian.com/uk-news/rss', fallback: 'GB' },
      { url: 'https://www.theguardian.com/world/netherlands/rss', fallback: 'NL' },
    ],
  },
  {
    id: 'independent',
    name: 'The Independent',
    home: 'GB',
    lang: 'en',
    color: '#6b4fbb',
    paywall: { mode: 'check', urlMarkers: ['/independentpremium/'] },
    feeds: [
      { url: 'https://www.independent.co.uk/news/world/rss', fallback: null },
      { url: 'https://www.independent.co.uk/news/uk/rss', fallback: 'GB' },
    ],
  },
  {
    id: 'zeit',
    name: 'Die Zeit',
    home: 'DE',
    lang: 'de',
    color: '#2f6b4f',
    paywall: { mode: 'check', urlMarkers: ['/zplus/'], textMarkers: ['Z+'] },
    feeds: [
      { url: 'https://newsfeed.zeit.de/politik/ausland/index', fallback: null },
      { url: 'https://newsfeed.zeit.de/politik/deutschland/index', fallback: 'DE' },
      { url: 'https://newsfeed.zeit.de/politik/index', fallback: 'DE' },
    ],
  },
  {
    id: 'nyt',
    name: 'The New York Times',
    home: 'US',
    lang: 'en',
    color: '#3f3f46',
    paywall: { mode: 'check' },
    feeds: [
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', fallback: null },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Europe.xml', fallback: null },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', fallback: 'US' },
    ],
  },
  {
    id: 'spiegel',
    name: 'Der Spiegel',
    home: 'DE',
    lang: 'de',
    color: '#d9480f',
    paywall: { mode: 'check', textMarkers: ['SPIEGEL+', 'Spiegel+', '(S+)'] },
    feeds: [
      { url: 'https://www.spiegel.de/ausland/index.rss', fallback: null },
      { url: 'https://www.spiegel.de/politik/deutschland/index.rss', fallback: 'DE' },
      { url: 'https://www.spiegel.de/international/index.rss', fallback: null, lang: 'en' },
    ],
  },
];
