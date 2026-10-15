# Scheidsrechtersapp

Webapp voor de voetbalvereniging om clubscheidsrechters te plannen. Werkt in de browser en is te installeren op de telefoon (PWA), zonder App Store.

## Wat kan het?

**Scheidsrechter**
- Beschikbaarheid per speeldag doorgeven: ja/nee, van–tot en maximaal aantal wedstrijden
- Langere afwezigheid (vakantie, blessure) in één keer afmelden
- Eigen gepubliceerde aanstellingen zien en in de agenda zetten (.ics)
- Voorkeuren per categorie (graag / liever niet)
- Seizoenscijfers: aantal gefloten wedstrijden per categorie

**Planner**
- Wedstrijden toevoegen of importeren via CSV (bijv. export uit Sportlink)
- Wedstrijden markeren waarvoor de KNVB zelf aanstelt
- Per wedstrijd een gerangschikte kandidatenlijst: beschikbaarheid, tijdconflicten, maximum per dag, voorkeuren en aantal wedstrijden dit seizoen
- **Voorstel maken** vult de hele speeldag automatisch in als concept
- **Publiceren** maakt de aanstellingen zichtbaar voor scheidsrechters
- Zien wie nog niets heeft ingevuld en een herinnering mailen
- Scheidsrechters zonder account toevoegen
- Weekprogramma en seizoenscijfers exporteren (CSV, opent in Excel)

Alle wijzigingen komen via Supabase Realtime direct op alle telefoons binnen.

## Direct uitproberen (demo)

Zonder configuratie draait de app in **demo-modus** met testdata op je eigen toestel:

```bash
npx http-server -c-1 .
# open http://localhost:8080
```

## In gebruik nemen

### 1. Database (Supabase, gratis)
1. Maak een project aan op [supabase.com](https://supabase.com).
2. Ga naar **SQL Editor** → plak de inhoud van [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. Ga naar **Authentication → URL Configuration** en zet de **Site URL** op het adres waar de app komt te staan (zie stap 2), bijvoorbeeld `https://<gebruiker>.github.io/READ.md/`.
4. Kopieer uit **Project Settings → API** de *Project URL* en de *anon public key* naar [`js/config.js`](js/config.js). Pas daar ook `CLUB_NAME` en eventueel `CATEGORIES` aan.

> De anon key mag openbaar in de code staan; de beveiliging zit in de Row Level Security-regels van het schema.

### 2. Online zetten (GitHub Pages)
1. In GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Merge naar `main`. De workflow `.github/workflows/pages.yml` publiceert de app automatisch.

### 3. Eerste planner aanwijzen
Iedereen die inlogt wordt eerst scheidsrechter. Log zelf één keer in en voer daarna in de SQL Editor uit:

```sql
update public.profiles set role = 'planner' where email = 'jouw@email.nl';
```

Elke ingelogde gebruiker krijgt automatisch ook een scheidsrechtersprofiel. Een planner die niet fluit kan zichzelf bij *Scheidsen* op inactief zetten.

### 4. Scheidsrechters uitnodigen
Voeg scheidsrechters toe met hun e-mailadres en deel de link naar de app. Ze loggen in met een e-maillink (geen wachtwoord) en worden automatisch gekoppeld.

**Op de telefoon zetten:**
- iPhone: open in Safari → **Deel** → **Zet op beginscherm**
- Android: open in Chrome → menu ⋮ → **App installeren**

## CSV-import

Eerste regel bevat de kolomnamen; scheidingsteken `;` of `,`. Datum als `dd-mm-jjjj` of `jjjj-mm-dd`.

```
datum;tijd;thuis;uit;veld;categorie
24-10-2026;09:00;MVC JO11-1;DOS JO11-2;Veld 1;JO11
```

## Opbouw

| Bestand | Inhoud |
|---|---|
| `index.html`, `css/app.css` | App-schil en opmaak (mobiel eerst, licht/donker) |
| `js/app.js` | Schermen en interactie |
| `js/logic.js` | Planningslogica: kandidaten rangschikken, voorstel, CSV |
| `js/store-local.js` | Demo-opslag op het toestel |
| `js/store-supabase.js` | Gedeelde opslag via Supabase |
| `supabase/schema.sql` | Tabellen, triggers en beveiliging |
| `sw.js`, `manifest.webmanifest` | Installeerbaar en offline te openen |

Geen build-stap nodig: alles is gewone HTML/CSS/JavaScript.

## Mogelijke vervolgstappen
- Pushmeldingen bij publicatie (Supabase Edge Function + Web Push)
- Automatische import via de Sportlink Club.Dataservice
- Meerdere clubs / meerdere planners met eigen teams
- Clublogo en -kleuren instelbaar
