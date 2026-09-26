# Wereldblik

Nieuws van **Trouw, NRC, The Guardian, The Independent, Die Zeit, The New York Times en Der Spiegel** in één lijst, met een fysieke wereldkaart waarop pijltjes laten zien waar het nieuws vandaan komt.

- Lijst met artikelen, per dag gegroepeerd, met bron, tijd en plaats
- Knop **Nederland / Wereld**
- Knop **Kaart**: fysieke wereldkaart (reliëf), inzoomen, pijltjes per plek, klik voor de artikelen
- Icoontjes voor **urgent** en **belangrijk** nieuws, met de reden erbij
- Artikelen achter een **paywall worden weggelaten**
- Wordt automatisch ververst: nieuwe artikelen erbij, berichten ouder dan 36 uur eruit

De site zelf is statisch (HTML, CSS, JavaScript). Het ophalen van het nieuws doet een GitHub Action, elke 3 uur.

---

## Publiceren op GitHub Pages

1. **Maak een nieuwe repository** op GitHub, bijvoorbeeld `wereldblik`. Kies *Public* (GitHub Pages is gratis voor openbare repositories).

2. **Zet alle bestanden uit de zip in de repository**, inclusief de map `.github`.
   - Via de website: *Add file → Upload files* en sleep de inhoud van de uitgepakte map erin.
   - Let op: de map `.github` is op Mac en Linux verborgen. Op een Mac maak je verborgen bestanden zichtbaar in Finder met `Cmd + Shift + .`
   - Of via de terminal:
     ```bash
     cd wereldblik
     git init -b main
     git add .
     git commit -m "Wereldblik"
     git remote add origin https://github.com/JOUW-NAAM/wereldblik.git
     git push -u origin main
     ```

3. **Zet Pages aan**: ga in de repository naar *Settings → Pages* en kies bij *Build and deployment → Source* de optie **GitHub Actions**.

4. **Start de eerste run**: ga naar het tabblad *Actions*, kies *Nieuws ophalen en publiceren* en klik op *Run workflow*. (Is er al een run mislukt omdat Pages nog niet aan stond? Start hem dan gewoon opnieuw.) Een run duurt een paar minuten.

5. Je site staat daarna op `https://JOUW-NAAM.github.io/wereldblik/`

Vanaf dan haalt de Action elke 3 uur nieuw nieuws op en publiceert de site opnieuw.

---

## Hoe het werkt

```
GitHub Action (elke 3 uur)
  └─ scripts/fetch-news.mjs
       1. haalt de RSS-feeds van de 7 bronnen op
       2. laat berichten ouder dan 36 uur weg en ontdubbelt
       3. controleert per artikel of er een paywall is  ──► zo ja: weg
       4. bepaalt de plaats (voor de kaart) en Nederland/Wereld
       5. bepaalt de urgentie
       6. schrijft site/data/news.json
  └─ publiceert de map site/ op GitHub Pages

Browser
  └─ site/index.html laadt data/news.json en toont lijst + kaart
     (kijkt elke 10 minuten of er een nieuwere versie is)
```

### Paywalls

Voor elk artikel wordt eerst in de feed gekeken naar bekende kenmerken (zoals *SPIEGEL+*, *Z+* of *Independent Premium*). Daarna wordt de artikelpagina zelf opgehaald en gecontroleerd op de markering die uitgevers voor zoekmachines gebruiken (`isAccessibleForFree` en `article:content_tier`).

Kan het script niet vaststellen of een artikel vrij te lezen is, bijvoorbeeld omdat de site eerst een cookiemuur toont, dan wordt het artikel **ook weggelaten**. Zo komen er geen halve artikelen in de app. Wil je dat anders, zet dan in `scripts/config.mjs`:

```js
unverifiedPolicy: 'include',
```

Wat je per bron kunt verwachten:

| Bron | Verwachting |
|---|---|
| The Guardian | Geen paywall, alles komt door |
| The Independent | Bijna alles, *Premium*-stukken vallen weg |
| Der Spiegel | Gratis artikelen komen door, *SPIEGEL+* valt weg |
| Die Zeit | Gratis artikelen komen door, *Z+* valt weg. Toont Zeit een cookiemuur aan het script, dan vallen ook de gratis stukken weg |
| Trouw | Afhankelijk van de cookiemuur van DPG Media; kan weinig of niets opleveren |
| NRC | Vrijwel alles staat achter de betaalmuur, dus weinig of niets |
| The New York Times | Alles staat achter de betaalmuur, dus vrijwel niets |

Hoeveel artikelen er per bron zijn doorgekomen, weggelaten of niet te controleren waren, zie je onderaan in de app onder *Over de bronnen en deze app*, en in het logboek van elke Action-run.

### Plaats op de kaart

Het script zoekt in titel, categorieën en samenvatting naar plaatsnamen in het Nederlands, Engels en Duits (landen, grote steden, brandhaarden, Nederlandse gemeenten en provincies, Amerikaanse staten). De titel telt het zwaarst. Wordt niets gevonden, dan valt het script terug op het land van de feed (bijvoorbeeld Nederland voor de binnenlandfeed van Trouw) of komt het artikel alleen in de lijst te staan.

De plaatsnamenlijst staat in `scripts/data/gazetteer.json` en wordt gemaakt met `tools/build_gazetteer.py` (alleen nodig als je de lijst wilt uitbreiden).

### Urgentie

Een artikel krijgt punten voor trefwoorden in titel of samenvatting (bijvoorbeeld *doden*, *aardbeving*, *aanslag*, *oorlog*, *staatsgreep*, *code rood*, en de Engelse en Duitse varianten) en extra punten als meerdere bronnen over dezelfde plek berichten. Zo ontstaan twee niveaus:

- **Urgent** (rood): zwaar nieuws van de afgelopen 24 uur. Maximaal ongeveer 12% van de artikelen.
- **Belangrijk** (amber)

De reden staat bij het artikel. Het is een automatische inschatting, geen redactionele keuze.

---

## Aanpassen

Alles staat in **`scripts/config.mjs`**:

- `maxAgeHours` – hoe lang artikelen blijven staan (standaard 36 uur)
- `unverifiedPolicy` – zie hierboven
- `SOURCES` – bronnen, kleuren en RSS-feeds. Per feed geeft `fallback` het land aan als er geen plaats wordt herkend (`null` = alleen in de lijst)

Hoe vaak er wordt opgehaald staat in **`.github/workflows/nieuws.yml`** bij `cron` (tijden in UTC).

Het uiterlijk staat in `site/assets/app.css`, de werking van de pagina in `site/assets/app.js`.

---

## Lokaal testen (optioneel)

Nodig: [Node.js](https://nodejs.org) 20 of nieuwer.

```bash
npm install
npm run fetch      # haalt echt nieuws op en schrijft site/data/news.json
npm run preview    # open daarna http://localhost:8080
```

Open `index.html` niet rechtstreeks als bestand: browsers blokkeren dan het laden van `news.json`.

---

## Goed om te weten

- **GitHub pauzeert geplande Actions** in openbare repositories als er 60 dagen niets aan de repository is veranderd. Je krijgt daar een mail over; met één klik (of een kleine wijziging) loopt het weer.
- Geplande runs kunnen bij drukte op GitHub een paar minuten tot soms langer vertraagd zijn.
- Mislukt een run volledig (geen enkel artikel opgehaald), dan blijft de vorige versie van de site gewoon online.
- Uitgevers passen soms hun feeds aan. Mislukte feeds staan in het logboek van de Action met de melding *feed mislukt*; pas dan de URL aan in `scripts/config.mjs`.
- Kaarttegels: reliëf en grenzen van Esri, terreinkaart van OpenTopoMap, straatkaart van OpenStreetMap. Kaartbibliotheek: Leaflet en Leaflet.markercluster (meegeleverd in `site/assets/vendor`).
- De artikelen zelf blijven van de uitgevers: de app toont alleen titel, korte samenvatting uit de feed en een link naar het origineel.

## Bestanden

```
.github/workflows/nieuws.yml   GitHub Action: ophalen + publiceren
scripts/config.mjs             bronnen en instellingen
scripts/fetch-news.mjs         het ophaalscript
scripts/lib/                   feeds, paywall, locatie, urgentie
scripts/data/gazetteer.json    plaatsnamenlijst
site/                          de website (dit wordt gepubliceerd)
  index.html
  assets/app.css, app.js
  assets/vendor/               Leaflet + markercluster
  data/news.json               wordt door de Action gevuld
tools/build_gazetteer.py       maakt de plaatsnamenlijst (optioneel)
```
