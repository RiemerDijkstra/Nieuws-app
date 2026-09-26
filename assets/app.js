/* Wereldblik – front-end (geen build-stap nodig) */
(() => {
  'use strict';

  const DATA_URL = 'data/news.json';
  const REFRESH_MS = 10 * 60 * 1000;
  const NL_BOUNDS = [[50.75, 3.2], [53.7, 7.3]];
  const LANG_LABEL = { en: 'Engelstalig', de: 'Duitstalig' };
  const RANK = { urgent: 2, important: 1 };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktopQuery = window.matchMedia('(min-width: 960px)');

  const state = {
    data: null,
    pending: null,
    scope: 'world',
    disabled: new Set(),
    onlyUrgent: false,
    sort: 'new',
    layer: 'relief',
    mapOpen: false,
  };

  // ---------- Hulpfuncties ------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svgUse(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  const safeUrl = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  };

  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem('wereldblik') || '{}'); } catch { return {}; }
    },
    set(patch) {
      try { localStorage.setItem('wereldblik', JSON.stringify({ ...store.get(), ...patch })); } catch { /* opslag niet beschikbaar */ }
    },
  };

  const rtf = new Intl.RelativeTimeFormat('nl', { numeric: 'auto' });
  const clock = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function ago(iso) {
    const t = Date.parse(iso);
    const diff = (t - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'zojuist';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 6 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
    const today = startOfDay(Date.now());
    if (t >= today) return `vandaag ${clock.format(t)}`;
    if (t >= today - 864e5) return `gisteren ${clock.format(t)}`;
    return `${dayFmt.format(t)} ${clock.format(t)}`;
  }

  function dayLabel(iso) {
    const t = Date.parse(iso);
    const today = startOfDay(Date.now());
    if (t >= today) return 'Vandaag';
    if (t >= today - 864e5) return 'Gisteren';
    const s = dayFmt.format(t);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // In de Nederland-weergave is ", Nederland" achter elke plaats overbodig.
  function placeLabel(loc) {
    if (state.scope === 'nl' && loc.cc === 'NL' && loc.precision !== 'country') return loc.name;
    return loc.label;
  }

  const sourceById = (id) => state.data?.meta.sources.find((s) => s.id === id);

  // ---------- Data -------------------------------------------------------
  async function fetchData() {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.meta || !Array.isArray(data.articles)) throw new Error('Onverwacht formaat');
    return data;
  }

  async function load() {
    setStatus('Nieuws laden…');
    try {
      state.data = await fetchData();
    } catch (err) {
      renderError(err);
      return;
    }
    buildChips();
    fillStats();
    render();
    if (!state.timers) {
      state.timers = [setInterval(checkForUpdates, REFRESH_MS), setInterval(refreshTimes, 60 * 1000)];
    }
  }

  async function checkForUpdates() {
    if (document.hidden || !state.data) return;
    try {
      const fresh = await fetchData();
      if (fresh.meta.generatedAt && fresh.meta.generatedAt !== state.data.meta.generatedAt) {
        state.pending = fresh;
        $('#freshPill').hidden = false;
      }
    } catch { /* volgende keer opnieuw */ }
  }

  $('#freshPill').addEventListener('click', () => {
    if (!state.pending) return;
    state.data = state.pending;
    state.pending = null;
    $('#freshPill').hidden = true;
    buildChips();
    fillStats();
    render();
    $('#lijst').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  // ---------- Filteren ---------------------------------------------------
  function inScope() {
    return state.data.articles.filter((a) => a.scope === state.scope);
  }

  function visibleArticles() {
    let list = inScope().filter((a) => !state.disabled.has(a.source));
    if (state.onlyUrgent) list = list.filter((a) => a.urgency?.level === 'urgent');
    const byTime = (a, b) => Date.parse(b.published) - Date.parse(a.published);
    if (state.sort === 'important') {
      list.sort(
        (a, b) =>
          (RANK[b.urgency?.level] || 0) - (RANK[a.urgency?.level] || 0) ||
          (b.urgency?.score || 0) - (a.urgency?.score || 0) ||
          byTime(a, b),
      );
    } else {
      list.sort(byTime);
    }
    return list;
  }

  // ---------- Weergave: lijst ------------------------------------------------
  function setStatus(text) {
    $('#status').textContent = text;
  }

  function updateStatus() {
    const meta = state.data?.meta;
    if (!meta?.generatedAt || !state.shown) return;
    const { total, mapped } = state.shown;
    setStatus(`Bijgewerkt ${ago(meta.generatedAt)}. ${total} ${total === 1 ? 'artikel' : 'artikelen'}, waarvan ${mapped} op de kaart.`);
  }

  function render() {
    const meta = state.data.meta;
    $('#maxAge').textContent = meta.maxAgeHours || 36;
    updateChipCounts();
    const container = $('#articles');
    container.replaceChildren();

    if (!meta.generatedAt) {
      setStatus('');
      container.append(
        el('div', { class: 'empty' },
          el('h2', { text: 'Er is nog geen nieuws opgehaald' }),
          el('p', { text: 'Het ophalen gebeurt automatisch door de GitHub Action van deze site. Kijk in je repository onder Actions of de workflow ‘Nieuws ophalen en publiceren’ is gelukt en vernieuw daarna deze pagina.' }),
        ),
      );
      renderMarkers([]);
      return;
    }

    if (!state.data.articles.length) {
      setStatus('');
      container.append(
        el('div', { class: 'empty' },
          el('h2', { text: 'Bij de laatste ophaalronde kwam geen nieuws binnen' }),
          el('p', { text: 'Kijk in je repository onder Actions in het logboek van de laatste run: daar staat per bron wat er misging. Bij de volgende run wordt het opnieuw geprobeerd.' }),
        ),
      );
      renderMarkers([]);
      return;
    }

    const list = visibleArticles();
    state.shown = { total: list.length, mapped: list.filter((a) => a.location).length };
    updateStatus();

    if (!list.length) {
      const reasons = [];
      if (state.onlyUrgent) reasons.push('alleen urgent nieuws');
      if (state.disabled.size) reasons.push('een deel van de bronnen uitgezet');
      container.append(
        el('div', { class: 'empty' },
          el('h2', { text: 'Geen artikelen voor deze selectie' }),
          el('p', {
            text: reasons.length
              ? `Je filtert op ${reasons.join(' en ')}. Zet de filters terug om alles te zien.`
              : `Er is op dit moment geen ${state.scope === 'nl' ? 'Nederlands nieuws' : 'wereldnieuws'} zonder paywall beschikbaar.`,
          }),
          (state.onlyUrgent || state.disabled.size) &&
            el('p', {}, el('button', { type: 'button', text: 'Filters wissen', onclick: resetFilters })),
        ),
      );
      renderMarkers([]);
      return;
    }

    if (state.sort === 'new') {
      const groups = new Map();
      for (const a of list) {
        const label = dayLabel(a.published);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(a);
      }
      for (const [label, items] of groups) container.append(section(label, items));
    } else {
      container.append(section('Op volgorde van belang', list));
    }
    renderMarkers(list);
  }

  function section(title, items) {
    const id = `d-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return el('section', { class: 'day', 'aria-labelledby': id },
      el('h2', { class: 'day__title', id },
        el('span', { text: title }),
        el('span', { class: 'day__count', text: `${items.length} ${items.length === 1 ? 'bericht' : 'berichten'}` }),
      ),
      el('ol', { class: 'list' }, items.map((a) => el('li', {}, card(a)))),
    );
  }

  function flag(level) {
    if (level === 'urgent') return el('span', { class: 'flag flag--urgent' }, svgUse('i-urgent'), 'Urgent');
    if (level === 'important') return el('span', { class: 'flag flag--important' }, svgUse('i-important'), 'Belangrijk');
    return null;
  }

  function card(a) {
    const src = sourceById(a.source);
    const level = a.urgency?.level || null;
    const url = safeUrl(a.url);
    const img = a.image && safeUrl(a.image);

    const place = a.location
      ? el('button', {
          type: 'button',
          class: `place${level ? ` is-${level}` : ''}`,
          'aria-label': `Toon ${placeLabel(a.location)} op de kaart`,
          onclick: () => showOnMap(a),
        }, svgUse('i-arrow'), el('span', { text: placeLabel(a.location) }))
      : el('span', { class: 'place place--none', text: 'Geen plaats herkend' });

    const reasons = (a.urgency?.reasons || []).filter(Boolean);
    const node = el('article', {
      class: `item${level === 'urgent' ? ' is-urgent' : ''}`,
      id: `a-${a.id}`,
      'data-id': a.id,
    },
      el('div', { class: 'item__kicker' }, place, flag(level)),
      el('h3', { class: 'item__title' },
        url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: a.title }) : a.title,
      ),
      a.summary ? el('p', { class: 'item__summary', text: a.summary }) : null,
      el('p', { class: 'item__meta' },
        el('span', { class: 'src', style: `--src:${src?.color || 'currentColor'}`, text: src?.name || a.source }),
        el('time', { datetime: a.published, 'data-ts': a.published, text: ago(a.published) }),
        LANG_LABEL[a.lang] ? el('span', { text: LANG_LABEL[a.lang] }) : null,
        level && reasons.length ? el('span', { class: 'why', text: reasons.join(', ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }) : null,
        a.paywall === 'unverified' ? el('span', { text: 'Paywall niet gecontroleerd' }) : null,
      ),
      img
        ? el('img', { class: 'item__img', src: img, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() })
        : null,
    );
    node.addEventListener('mouseenter', () => highlight(a, true));
    node.addEventListener('mouseleave', () => highlight(a, false));
    return node;
  }

  function refreshTimes() {
    for (const t of $$('time[data-ts]')) t.textContent = ago(t.dataset.ts);
    updateStatus();
  }

  function renderError(err) {
    setStatus('');
    $('#articles').replaceChildren(
      el('div', { class: 'empty' },
        el('h2', { text: 'Het nieuwsbestand kon niet worden geladen' }),
        el('p', { text: `De app vond data/news.json niet (${err.message}). Is de site net gepubliceerd? Wacht dan tot de GitHub Action klaar is en vernieuw de pagina. Open je index.html direct vanaf je computer? Dan werkt het niet: de app moet via GitHub Pages of een webserver draaien.` }),
        el('p', {}, el('button', { type: 'button', text: 'Opnieuw proberen', onclick: () => load() })),
      ),
    );
  }

  // ---------- Filters en bronnen -------------------------------------------
  function buildChips() {
    const wrap = $('#sourceChips');
    wrap.replaceChildren();
    wrap.append(
      el('button', {
        type: 'button', class: 'chip chip--all', 'data-source': '*',
        'aria-pressed': String(state.disabled.size === 0),
        onclick: () => {
          state.disabled.clear();
          afterFilterChange();
        },
      }, 'Alle bronnen'),
    );
    for (const s of state.data.meta.sources) {
      wrap.append(
        el('button', {
          type: 'button', class: 'chip', 'data-source': s.id, style: `--src:${s.color}`,
          'aria-pressed': String(!state.disabled.has(s.id)),
          onclick: () => {
            if (state.disabled.has(s.id)) state.disabled.delete(s.id);
            else state.disabled.add(s.id);
            afterFilterChange();
          },
        }, el('span', { class: 'chip__dot' }), s.name, el('span', { class: 'chip__n', text: '' })),
      );
    }
  }

  function updateChipCounts() {
    const counts = {};
    for (const a of inScope()) counts[a.source] = (counts[a.source] || 0) + 1;
    for (const chip of $$('#sourceChips .chip')) {
      const id = chip.dataset.source;
      if (id === '*') {
        chip.setAttribute('aria-pressed', String(state.disabled.size === 0));
        continue;
      }
      chip.setAttribute('aria-pressed', String(!state.disabled.has(id)));
      $('.chip__n', chip).textContent = String(counts[id] || 0);
    }
  }

  function afterFilterChange() {
    store.set({ disabled: [...state.disabled], onlyUrgent: state.onlyUrgent, sort: state.sort });
    render();
  }

  function resetFilters() {
    state.disabled.clear();
    state.onlyUrgent = false;
    $('#onlyUrgent').checked = false;
    afterFilterChange();
  }

  function fillStats() {
    const body = $('#statsTable tbody');
    body.replaceChildren();
    for (const s of state.data.meta.sources) {
      const st = s.stats || {};
      body.append(
        el('tr', {},
          el('td', {}, el('span', { class: 'src', style: `--src:${s.color}`, text: s.name })),
          el('td', { text: String(st.kept ?? 0) }),
          el('td', { text: String(st.paywall ?? 0) }),
          el('td', { text: String(st.unverified ?? 0) }),
        ),
      );
    }
  }

  function setScope(scope, { fromHash = false } = {}) {
    state.scope = scope === 'nl' ? 'nl' : 'world';
    for (const b of $$('.scope__btn')) b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope));
    const hash = state.scope === 'nl' ? '#nederland' : '#wereld';
    if (!fromHash && location.hash !== hash) history.replaceState(null, '', hash);
    store.set({ scope: state.scope });
    $('#mapTitle').textContent = state.scope === 'nl' ? 'Nederlands nieuws op de kaart' : 'Wereldnieuws op de kaart';
    if (state.data) render();
    if (map) fitScope();
  }

  // ---------- Kaart ------------------------------------------------------
  let map = null;
  let cluster = null;
  let baseLayers = null;
  const markers = new Map();

  function initMap() {
    if (map) return;
    map = L.map('map', { worldCopyJump: true, minZoom: 2, maxZoom: 12, zoomSnap: 0.5 });
    map.createPane('labels');
    map.getPane('labels').style.zIndex = 350;
    map.getPane('labels').style.pointerEvents = 'none';

    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services';
    baseLayers = {
      relief: L.layerGroup([
        L.tileLayer(`${esri}/World_Physical_Map/MapServer/tile/{z}/{y}/{x}`, {
          maxNativeZoom: 8, maxZoom: 12,
          attribution: 'Reliëf &copy; Esri, US National Park Service',
        }),
        L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, {
          pane: 'labels', maxNativeZoom: 13, maxZoom: 12, opacity: 0.9,
          attribution: 'Grenzen en namen &copy; Esri',
        }),
      ]),
      terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 12, subdomains: 'abc',
        attribution: 'Kaartdata &copy; OpenStreetMap-bijdragers, SRTM; stijl &copy; OpenTopoMap (CC-BY-SA)',
      }),
      streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap-bijdragers',
      }),
    };
    setLayer(state.layer);

    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      iconCreateFunction(c) {
        const children = c.getAllChildMarkers();
        const n = children.reduce((sum, m) => sum + (m.options.count || 1), 0);
        const urgent = children.some((m) => m.options.level === 'urgent');
        return L.divIcon({
          html: `<div class="cluster${urgent ? ' has-urgent' : ''}"><span>${n}</span></div>`,
          className: 'cluster-wrap',
          iconSize: [40, 40],
        });
      },
    });
    map.addLayer(cluster);
    fitScope(false);
  }

  function setLayer(name) {
    if (!baseLayers[name]) name = 'relief';
    state.layer = name;
    for (const [key, layer] of Object.entries(baseLayers)) {
      if (key === name) layer.addTo(map);
      else map.removeLayer(layer);
    }
    for (const b of $$('.basemap button')) b.setAttribute('aria-pressed', String(b.dataset.layer === name));
    store.set({ layer: name });
  }

  function fitScope(animate = !reduceMotion) {
    if (!map) return;
    if (state.scope === 'nl') map.fitBounds(NL_BOUNDS, { animate, padding: [16, 16] });
    else map.setView([30, 12], map.getSize().x > 900 ? 2.5 : 2, { animate });
  }

  function arrowIcon(level, count) {
    return L.divIcon({
      className: 'arrow-wrap',
      html: `<div class="arrow-marker${level ? ` is-${level}` : ''}"><svg viewBox="0 0 28 40" aria-hidden="true"><use href="#i-arrow"/></svg>${count > 1 ? `<span class="count">${count}</span>` : ''}</div>`,
      iconSize: [28, 40],
      iconAnchor: [14, 39],
      popupAnchor: [0, -34],
    });
  }

  function renderMarkers(list) {
    markers.clear();
    const groups = new Map();
    for (const a of list) {
      if (!a.location) continue;
      const key = a.location.id;
      if (!groups.has(key)) groups.set(key, { loc: a.location, items: [] });
      groups.get(key).items.push(a);
    }
    const unmapped = list.length - list.filter((a) => a.location).length;
    $('#mapNote').textContent = unmapped
      ? `${unmapped} ${unmapped === 1 ? 'artikel staat' : 'artikelen staan'} alleen in de lijst: geen plaats herkend.`
      : '';
    if (!map) return;

    cluster.clearLayers();
    const layerList = [];
    for (const [key, g] of groups) {
      g.items.sort((x, y) => (RANK[y.urgency?.level] || 0) - (RANK[x.urgency?.level] || 0) || Date.parse(y.published) - Date.parse(x.published));
      const level = g.items[0].urgency?.level || null;
      const m = L.marker([g.loc.lat, g.loc.lon], {
        icon: arrowIcon(level, g.items.length),
        count: g.items.length,
        level,
        title: `${placeLabel(g.loc)}: ${g.items.length} ${g.items.length === 1 ? 'artikel' : 'artikelen'}`,
        alt: g.loc.label,
        riseOnHover: true,
      });
      m.bindPopup(() => popup(g), { maxWidth: 320, autoPanPaddingTopLeft: [20, 60], autoPanPaddingBottomRight: [20, 20] });
      markers.set(key, m);
      layerList.push(m);
    }
    cluster.addLayers(layerList);
  }

  function popup(g) {
    return el('div', { class: 'pop' },
      el('p', { class: 'pop__title', text: placeLabel(g.loc) }),
      el('ul', { class: 'pop__list' },
        g.items.map((a) => {
          const src = sourceById(a.source);
          const url = safeUrl(a.url);
          return el('li', { class: 'pop__item' },
            url ? el('a', { class: 'pop__link', href: url, target: '_blank', rel: 'noopener noreferrer', text: a.title }) : el('span', { class: 'pop__link', text: a.title }),
            el('div', { class: 'pop__meta' },
              flag(a.urgency?.level),
              el('span', { class: 'src', style: `--src:${src?.color || 'currentColor'}`, text: src?.name || a.source }),
              el('span', { text: ago(a.published) }),
              el('button', { type: 'button', class: 'pop__show', text: 'Toon in lijst', onclick: () => scrollToArticle(a.id) }),
            ),
          );
        }),
      ),
    );
  }

  function openMap() {
    if (state.mapOpen) return;
    state.mapOpen = true;
    $('#kaart').hidden = false;
    $('#layout').classList.add('is-map');
    $('#mapToggle').setAttribute('aria-expanded', 'true');
    if (!desktopQuery.matches) document.documentElement.classList.add('map-overlay');
    const first = !map;
    initMap();
    if (first && state.data?.meta.generatedAt) renderMarkers(visibleArticles());
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (first) fitScope(false);
    });
    store.set({ mapOpen: desktopQuery.matches });
  }

  function closeMap() {
    if (!state.mapOpen) return;
    state.mapOpen = false;
    $('#kaart').hidden = true;
    $('#layout').classList.remove('is-map');
    $('#mapToggle').setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('map-overlay');
    store.set({ mapOpen: false });
  }

  function zoomFor(loc) {
    if (state.scope === 'nl') return loc.precision === 'country' ? 7.5 : 9;
    if (loc.precision === 'country') return 4.5;
    if (loc.precision === 'region') return 5.5;
    return 7;
  }

  function showOnMap(a) {
    openMap();
    const m = markers.get(a.location.id);
    if (!m) return;
    const go = () => {
      map.setView(m.getLatLng(), zoomFor(a.location), { animate: false });
      cluster.zoomToShowLayer(m, () => m.openPopup());
    };
    requestAnimationFrame(() => {
      map.invalidateSize();
      go();
    });
  }

  function highlight(a, on) {
    if (!map || !state.mapOpen || !a.location) return;
    const m = markers.get(a.location.id);
    const icon = m?.getElement();
    if (icon) $('.arrow-marker', icon)?.classList.toggle('is-hot', on);
  }

  function scrollToArticle(id) {
    const node = document.getElementById(`a-${id}`);
    if (!node) return;
    if (!desktopQuery.matches) closeMap();
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
    $('.item__title a', node)?.focus({ preventScroll: true });
  }

  // ---------- Kopbalkhoogte bijhouden ------------------------------------
  function measureHeader() {
    document.documentElement.style.setProperty('--header-h', `${$('.top').offsetHeight}px`);
  }
  new ResizeObserver(measureHeader).observe($('.top'));

  // ---------- Gebeurtenissen ---------------------------------------------
  for (const b of $$('.scope__btn')) b.addEventListener('click', () => setScope(b.dataset.scope));
  $('#mapToggle').addEventListener('click', () => (state.mapOpen ? closeMap() : openMap()));
  $('#mapClose').addEventListener('click', () => {
    closeMap();
    $('#mapToggle').focus();
  });
  for (const b of $$('.basemap button')) b.addEventListener('click', () => setLayer(b.dataset.layer));
  $('#onlyUrgent').addEventListener('change', (e) => {
    state.onlyUrgent = e.target.checked;
    afterFilterChange();
  });
  $('#sortBy').addEventListener('change', (e) => {
    state.sort = e.target.value;
    afterFilterChange();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.mapOpen && !desktopQuery.matches) closeMap();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nederland') setScope('nl', { fromHash: true });
    else if (location.hash === '#wereld') setScope('world', { fromHash: true });
  });
  desktopQuery.addEventListener('change', () => {
    if (!state.mapOpen) return;
    document.documentElement.classList.toggle('map-overlay', !desktopQuery.matches);
    requestAnimationFrame(() => map && map.invalidateSize());
  });

  // ---------- Start -------------------------------------------------------
  const prefs = store.get();
  state.disabled = new Set(Array.isArray(prefs.disabled) ? prefs.disabled : []);
  state.onlyUrgent = !!prefs.onlyUrgent;
  state.sort = prefs.sort === 'important' ? 'important' : 'new';
  state.layer = prefs.layer || 'relief';
  $('#onlyUrgent').checked = state.onlyUrgent;
  $('#sortBy').value = state.sort;
  const initialScope = location.hash === '#nederland' ? 'nl' : location.hash === '#wereld' ? 'world' : prefs.scope || 'world';
  setScope(initialScope, { fromHash: true });
  measureHeader();
  load().then(() => {
    if (prefs.mapOpen && desktopQuery.matches) openMap();
  });
})();
