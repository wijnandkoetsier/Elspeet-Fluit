# Elspeet Fluit

De scheidsrechtersapp van VV Elspeet: clubscheidsrechters plannen en indelen vanaf je telefoon. Werkt in de browser en is te installeren op de telefoon (PWA), zonder App Store.

## Wat kan het?

**Scheidsrechter**
- **Overzicht** als startpagina: komende wedstrijden die je fluit, de laatste meldingen, en open wedstrijden zonder scheidsrechter met de knop **Ik kan fluiten** (de planner krijgt bericht en ziet je bovenaan bij het toewijzen)
- Beschikbaarheid per speeldag doorgeven: ja/nee, van–tot en maximaal aantal wedstrijden
- Langere afwezigheid (vakantie, blessure) in één keer afmelden
- Eigen gepubliceerde aanstellingen zien en in de agenda zetten (.ics)
- Voorkeuren per categorie (graag / liever niet)
- Seizoenscijfers: aantal gefloten wedstrijden per categorie
- **Meldingen** bij een aanstelling, wijziging, intrekking of vervallen wedstrijd, ook als pushmelding op de telefoon

**Planner**
- Thuiswedstrijden **automatisch uit Sportlink** (Club.Dataservice), elk uur bijgewerkt; of handmatig/CSV
- Speelduur per categorie automatisch ingevuld (bijv. O9 45 min, O13 65 min, senioren 105 min)
- Scheidsrechters die in Sportlink al zijn aangesteld worden overgenomen
- Wedstrijden markeren waarvoor de KNVB zelf aanstelt
- **JO7**: een JO7-ochtend thuis wordt één kaartje met één scheidsrechter; de vier wedstrijden klap je eronder open. Een ochtend bij een andere club komt niet in de app. Thuis of uit bepaalt de koppeling met de accommodatie, plaats en het veld uit Sportlink (staat er "Elspeet" in, dan is het thuis)
- Per wedstrijd een gerangschikte kandidatenlijst: beschikbaarheid, tijdconflicten, maximum per dag, voorkeuren en aantal wedstrijden dit seizoen
- **Voorstel maken** vult de hele speeldag automatisch in als concept
- **Publiceren** maakt de aanstellingen zichtbaar voor scheidsrechters
- Per dag zien **wie er kan fluiten**, en beschikbaarheid invullen namens iemand (ook voor scheidsrechters zonder account)
- Zien wie nog niets heeft ingevuld en een herinnering mailen; elke donderdagavond krijgt wie nog niets heeft ingevuld automatisch een herinnering (melding en pushmelding)
- Telefoonnummer per scheidsrechter, met knoppen om te bellen of te WhatsAppen
- Waarschuwing in de planning en een melding als een aangestelde scheidsrechter zich afmeldt
- Andere planners aanwijzen: bij **Scheidsen → Toevoegen** kies je Scheidsrechter, Planner (plant alleen, wordt nooit ingepland) of Allebei
- Weekprogramma en seizoenscijfers exporteren (CSV, opent in Excel)

Alle wijzigingen komen via Supabase Realtime direct op alle telefoons binnen.

**Privacy:** alleen e-mailadressen die de planner heeft toegevoegd kunnen inloggen. Scheidsrechters zien alleen hun eigen gegevens; namen, e-mailadressen en beschikbaarheid van anderen zijn alleen zichtbaar voor planners.

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
3. Ga naar **Authentication → URL Configuration** en zet de **Site URL** op het adres waar de app komt te staan (zie stap 2), bijvoorbeeld `https://<gebruiker>.github.io/Elspeet-Fluit/`.
4. Ga naar **Authentication → Email Templates** en zet de code in de e-mail, zodat inloggen ook werkt vanuit de app op het beginscherm. Doe dit bij **Confirm signup** (de mail bij de allereerste keer inloggen) én bij **Magic Link** (alle keren daarna). Bijvoorbeeld:
   ```html
   <h2>Inloggen bij Elspeet Fluit</h2>
   <p>Je code is: <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>Of tik op deze link: <a href="{{ .ConfirmationURL }}">inloggen</a></p>
   ```
5. Kopieer uit **Project Settings → API** de *Project URL* en de *anon public key* naar [`js/config.js`](js/config.js). Pas daar ook `CLUB_NAME` en eventueel `CATEGORIES` aan.

> De anon key mag openbaar in de code staan; de beveiliging zit in de Row Level Security-regels van het schema.

### 2. Online zetten (GitHub Pages)
1. In GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Merge naar `main`. De workflow `.github/workflows/pages.yml` publiceert de app automatisch.

### 3. Eerste planner aanwijzen
Alleen wie als scheidsrechter in de lijst staat, kan inloggen. Zet jezelf er dus eerst in via de SQL Editor (`active` op `false` als je zelf niet fluit):

```sql
insert into public.referees (name, email, active) values ('Jouw naam', 'jouw@email.nl', true);
```

Log daarna één keer in de app in met dat e-mailadres, en maak jezelf planner:

```sql
update public.profiles set role = 'planner' where email = 'jouw@email.nl';
```

Andere planners wijs je daarna in de app aan: **Scheidsen** → naam → **Planner** (kan zodra die persoon één keer heeft ingelogd).

### 4. Scheidsrechters uitnodigen
Voeg scheidsrechters toe bij **Scheidsen** met hun e-mailadres en deel de link naar de app. Ze loggen in met een code die ze per e-mail krijgen (geen wachtwoord) en worden automatisch gekoppeld. Een onbekend e-mailadres wordt geweigerd.

**Op de telefoon zetten:**
- iPhone: open in Safari → **Deel** → **Zet op beginscherm**
- Android: open in Chrome → menu ⋮ → **App installeren**

### 5. Pushmeldingen (optioneel)
Meldingen staan altijd in het tabblad **Meldingen**. Voor een melding op het vergrendelscherm (alles via de Supabase-website, geen extra programma's nodig):

1. **Sleutelpaar maken** (VAPID): op een computer met Node.js `npx web-push generate-vapid-keys`. Je krijgt een *Public Key* en een *Private Key*. De private key is geheim: alleen in Supabase invullen, nooit in de app of op GitHub.
2. Zet de **Public Key** in `VAPID_PUBLIC_KEY` in [`js/config.js`](js/config.js).
3. Supabase → **Edge Functions → Secrets**: voeg toe `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` en `VAPID_CONTACT` (je e-mailadres).
4. Supabase → **Edge Functions → Deploy a new function → Via Editor**: naam `send-push`, plak de inhoud van [`supabase/functions/send-push/index.ts`](supabase/functions/send-push/index.ts) en klik **Deploy**.
5. Supabase → **Database → Webhooks → Create a new hook**: naam `push`, tabel `notifications`, event **Insert**, type **Supabase Edge Functions**, functie `send-push`.

**Wekelijkse herinnering:** `schema.sql` plant met de extensie **pg_cron** elke donderdag om 17:00 UTC een herinnering in voor wie de komende week wedstrijden heeft en nog niets heeft ingevuld. Meldt de SQL Editor *"Herinnering niet ingepland"*? Zet dan **Database → Extensions → pg_cron** aan en voer `schema.sql` opnieuw uit.
6. Iedereen kan daarna bij **Meldingen** op **Meldingen aanzetten** tikken. Op de iPhone werkt dit alleen als de app op het beginscherm staat (iOS 16.4 of nieuwer).

### 6. Sportlink koppelen (via je TransIP-hosting)
De app haalt de thuiswedstrijden op via een klein PHP-bestand op je eigen hosting. Zo blijft de Sportlink-clientcode geheim. Elk uur worden:
- nieuwe wedstrijden **toegevoegd**,
- gewijzigde datum, tijd, tegenstander of veld **bijgewerkt**,
- wedstrijden die uit het Sportlink-programma verdwijnen (afgelast, verplaatst buiten de periode) **verwijderd**. Een aangestelde scheidsrechter krijgt daarvan een melding.

Een wedstrijd die je eerder met de hand of via CSV invoerde (zelfde datum, tijd en thuisteam) wordt gekoppeld in plaats van dubbel toegevoegd; de aangestelde scheidsrechter blijft staan.

**Scheidsrechters uit Sportlink:** staat in Sportlink al een scheidsrechter bij een wedstrijd, dan neemt de app die aanstelling over (direct gepubliceerd). De naam wordt herkend in je lijst bij **Scheidsen** ("Hoorn, D. (Daniël) v/d" → Daniël van der Hoorn); staat iemand er nog niet in, dan wordt hij aangemaakt met het label *Uit Sportlink* en kun je later een e-mailadres toevoegen. Sportlink is leidend: verandert de scheidsrechter daar, dan ook in de app. Wie je in de app zelf hebt ingepland, blijft staan zolang Sportlink niemand noemt. Voor de teams in `knvb_teams` (standaard *Elspeet 1*) stelt de KNVB aan: daar wordt de naam alleen getoond.

**Stappen**

1. Voer [`supabase/schema.sql`](supabase/schema.sql) opnieuw uit in de SQL Editor (veilig om te herhalen).
2. Kopieer [`hosting/elspeet-fluit-config.example.php`](hosting/elspeet-fluit-config.example.php) naar `elspeet-fluit-config.php` en vul in:
   - `sportlink_client_id`: je clientcode
   - `supabase_url`, `supabase_anon_key` en `supabase_service_key` (*service_role*): Supabase → **Project Settings → API**
   - `sync_token`: een zelfgekozen lange geheime code (minimaal 32 tekens)
3. Upload via SFTP (TransIP-controlepaneel → **Webhosting → Site → SFTP/SSH** voor de inloggegevens):
   ```
   /                                   ← elspeet-fluit-config.php  (NIET in www!)
   /www/elspeet-fluit/sportlink-sync.php
   ```
4. Test in je browser: `https://jouwdomein.nl/elspeet-fluit/sportlink-sync.php?token=JOUW_SYNC_TOKEN&mode=test`
   Je ziet hoeveel wedstrijden Sportlink teruggeeft, hoe ze in de app komen, en of het configuratiebestand veilig staat. Er wordt niets gewijzigd.
5. Zet in [`js/config.js`](js/config.js) `SPORTLINK_SYNC_URL` op `https://jouwdomein.nl/elspeet-fluit/sportlink-sync.php` (voor de knop **Nu ophalen uit Sportlink** bij **Wedstrijden**). Staat de app niet op `https://wijnandkoetsier.github.io`, zet dan het juiste adres in `allowed_origins`.
6. Automatisch elk uur: TransIP-controlepaneel → **Webhosting → Geavanceerd → Cronjobs → + Toevoegen**
   - URL: `https://jouwdomein.nl/elspeet-fluit/sportlink-sync.php?token=JOUW_SYNC_TOKEN`
   - Frequentie: elk uur (bijv. minuut `5`, uur `*`)

> Het bestand `elspeet-fluit-config.php` staat in `.gitignore` en hoort nooit in GitHub. De *service_role*-sleutel geeft volledige toegang tot de database.

Wedstrijden waarvoor de KNVB zelf aanstelt, vink je bij de wedstrijd aan (**KNVB stelt scheidsrechter aan**); die keuze blijft bij elke synchronisatie behouden.

## CSV-import

Eerste regel bevat de kolomnamen; scheidingsteken `;` of `,`. Datum als `dd-mm-jjjj` of `jjjj-mm-dd`.

```
datum;tijd;thuis;uit;veld;categorie
24-10-2026;09:00;Elspeet JO11-1;DOS JO11-2;Veld 1;JO11
```

## Opbouw

| Bestand | Inhoud |
|---|---|
| `index.html`, `css/app.css` | App-schil en opmaak in clubkleuren (zwart-wit, groen en geel; tekstgrootte instelbaar) |
| `icons/` | Clublogo en app-iconen |
| `js/app.js` | Schermen en interactie (Sportlink ophalen en CSV-import staan onder **Overzicht**) |
| `js/logic.js` | Planningslogica: kandidaten rangschikken, voorstel, CSV |
| `js/store-local.js` | Demo-opslag op het toestel |
| `js/store-supabase.js` | Gedeelde opslag via Supabase |
| `supabase/schema.sql` | Tabellen, triggers (meldingen) en beveiliging |
| `supabase/functions/send-push/` | Verstuurt pushmeldingen bij nieuwe meldingen |
| `hosting/sportlink-sync.php` | Sportlink-koppeling voor je eigen hosting (PHP 8.1+) |
| `sw.js`, `manifest.webmanifest` | Installeerbaar, offline te openen, ontvangt pushmeldingen |

Geen build-stap nodig: alles is gewone HTML/CSS/JavaScript.

## Mogelijke vervolgstappen
- Meerdere clubs / meerdere planners met eigen teams
- Clublogo en -kleuren instelbaar
