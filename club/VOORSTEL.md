# Voorstel: clubapp V.V. Elspeet

Een app voor leden, ouders, supporters en sponsors, gebouwd op de nieuwe website (nu op wijnandkoetsier.nl). We beginnen als **webapp** die je op het beginscherm van je telefoon zet, zonder App Store. Later kan dezelfde app in de App Store en Play Store.

Het is een **aparte app naast Elspeet Fluit**: eigen naam, eigen icoon op het beginscherm, eigen bestanden. Er wordt niets gedeeld met de Fluit-app, dus deze map kan zo naar een eigen repository.

De app bevat **alleen deze tien onderdelen**: Programma en uitslagen, Nieuws, Wedstrijdverslagen, Media, Teams, Elspeet 1, Over de club, Sponsoren, Agenda en Contact. Al het andere (bestuur, contributie, roosters, ledenshop, …) blijft alleen op de website.

Adres: **app.vv-elspeet.nl**.

Er staat al een werkend prototype in deze map (`club/`).

## Uitgangspunten

- **Eén bron.** Alles komt van de WordPress-site. Het webteam blijft op één plek werken en de app werkt zichzelf bij.
- **Snel en simpel.** Gewone HTML/CSS/JavaScript, geen build-stap, net als Elspeet Fluit.
- **Huisstijl van de site.** Zelfde kleuren (zwart, wit, groen, geel), lettertypen (Inter, Inter Tight) en logo.
- **Ook offline.** Wat je eerder bekeek, blijft leesbaar zonder bereik op het sportpark.
- **Privacy.** Geen accounts nodig, geen tracking. Het gevolgde team wordt alleen op je eigen telefoon onthouden.

## Navigatie

Onderaan vijf tabbladen: **Home · Programma · Nieuws · Teams · Meer**.
Onder *Meer*: Elspeet 1, Wedstrijdverslagen, Media, Agenda, Over de club, Sponsoren, Contact.

## Onderdelen

| Onderdeel | Wat je ziet | Bron |
|---|---|---|
| **Home** (startscherm) | Alleen een samenvatting van de onderdelen hieronder: volgende wedstrijd van Elspeet 1 met aftellen en *In agenda*, laatste uitslag, snelknoppen, je gevolgde teams, laatste 3 nieuwsberichten, eerstvolgende activiteiten, sponsorlogo's | Alles hieronder |
| **Programma en uitslagen** | Wedstrijden per dag, filter op senioren/junioren/pupillen, afgelaste wedstrijden bovenaan. Tik op een wedstrijd voor veld, scheidsrechter en *In agenda* (.ics). Uitslagen in groen/geel/rood, plus de stand van Elspeet 1 | Sportlink, via de site |
| **Nieuws** | Alle berichten met foto, filter op categorie, *Meer berichten*, volledig artikel in de app met *Delen* | WordPress (live) |
| **Wedstrijdverslagen** | Nieuws gefilterd op de categorie Wedstrijdverslagen | WordPress (live) |
| **Media** | Instagram @vvelspeet, fotogalerij uit de mediabibliotheek (tik voor groot), laatste verslagen | WordPress (live) |
| **Teams** | Alle 20 teams per leeftijdsgroep. Met ☆ volg je een team; het komt dan op Home. Per team: programma, uitslagen, stand en berichten uit de teamcategorie | Sportlink + WordPress |
| **Elspeet 1** | Positie, punten en vorm (laatste 5), volgende wedstrijden, stand, uitslagen, verslagen, over het team, technische staf | Sportlink + WordPress |
| **Over de club** | Geschiedenis, sportpark en kerncijfers. Voor de rest een link naar de website | Site |
| **Sponsoren** | Alle sponsorlogo's samen in één overzicht, de pakketten (1 tot 5 sterren) en een knop om de sponsorcommissie te mailen | Site |
| **Agenda** | Clubactiviteiten met datum en tijd, elk met *In agenda* | Site |
| **Contact** | Knoppen Bellen, Mailen, Route en Instagram; adres, kantinetijden, parkeren, KNVB-code; berichtformulier | Site |

## Hoe de data binnenkomt

1. **Nieuws, verslagen, foto's.** Komt live uit de standaard WordPress-API van de site. Werkt nu al.
2. **Programma, uitslagen, standen, teams, agenda, sponsors.** Daarvoor komt één extra adres op de site: `/wp-json/vve/v1/app`. Een concept staat in [`wordpress/vve-app-api.php`](wordpress/vve-app-api.php). Het haalt Sportlink op en bewaart het 15 minuten. Zolang dat adres er niet is, gebruikt de app een momentopname van 19 oktober ([`data/snapshot.json`](data/snapshot.json)) en zegt dat er ook bij.

## Fasering

**Fase 1: webapp (dit prototype afmaken)**
- App-endpoint op de site zetten en testen met de Sportlink-clientcode (die heeft het thema al)
- Teams, agenda, sponsors en clubinfo uit het thema via het endpoint leveren, zodat app en site altijd gelijk zijn
- Eigen repository en online op `app.vv-elspeet.nl` (zie hieronder)

**Fase 2: meer binding**
- Pushmeldingen: uitslag en afgelasting van je gevolgde team, nieuw verslag van Elspeet 1 (techniek hebben we al in Elspeet Fluit)
- Live tussenstand bij Elspeet 1 (ingevoerd door het mediateam)
- Instagram-feed in de app
- Selectie Elspeet 1 met foto's en rugnummers

**Fase 3: in de stores**
- Dezelfde code verpakken (bijv. met Capacitor) voor App Store en Play Store

## Besluiten

- Elspeet 1 speelt in de **5e klasse**.
- Sponsors staan **samen in één overzicht**, zonder indeling in niveaus.
- De app komt op **app.vv-elspeet.nl**.
- De **ledenshop** komt niet in de app.
- Alleen de tien genoemde onderdelen; de rest blijft op de website.

## Open vragen

1. **Staf Elspeet 1:** staat overal op "Naam volgt".
2. **Contactformulier:** nu opent het je mailapp. Liever versturen via de site (zoals het formulier daar)?

## Online op app.vv-elspeet.nl

1. Zet in de repository van de app **Settings → Pages → Source: GitHub Actions** aan.
2. Maak bij de beheerder van het domein vv-elspeet.nl een DNS-record: `app` → **CNAME** → `<gebruikersnaam>.github.io`.
3. Vul daarna in GitHub bij **Settings → Pages → Custom domain** `app.vv-elspeet.nl` in en zet **Enforce HTTPS** aan.

Doe stap 3 pas als het DNS-record werkt, anders is de app even onbereikbaar.

## Prototype bekijken

```bash
cd club
npx http-server -c-1 .
# open http://localhost:8080/
```

Na merge naar `main` staat het ook op GitHub Pages onder `/club/`.

| Bestand | Inhoud |
|---|---|
| `index.html`, `css/club.css` | App-schil en opmaak in de huisstijl van de site |
| `js/app.js` | Schermen, navigatie, team volgen, agenda-export |
| `js/api.js` | Data ophalen van de site, met terugval op de momentopname |
| `js/config.js` | Adres van de site en het app-endpoint |
| `data/snapshot.json` | Momentopname van programma, uitslagen, teams, agenda en sponsors |
| `wordpress/vve-app-api.php` | Concept voor het app-endpoint op de site |
| `sw.js`, `manifest.webmanifest` | Installeerbaar en offline te openen |
