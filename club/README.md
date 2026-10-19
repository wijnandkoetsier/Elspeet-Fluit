# VV Elspeet

De clubapp van V.V. Elspeet: programma en uitslagen, nieuws, wedstrijdverslagen, media, teams, Elspeet 1, over de club, sponsoren, agenda en contact. Werkt in de browser en is te installeren op de telefoon (PWA), zonder App Store.

Losse app, naast de scheidsrechtersapp Elspeet Fluit. Alle content komt van de clubwebsite (WordPress).

Zie [VOORSTEL.md](VOORSTEL.md) voor het plan, de onderdelen, de databronnen en de fasering.

## Lokaal bekijken

```bash
npx http-server -c-1 .
# open http://localhost:8080/
```

## Online zetten

GitHub → **Settings → Pages → Source: GitHub Actions**. Bij elke merge naar `main` publiceert `.github/workflows/pages.yml` de app.

Geen build-stap: gewone HTML/CSS/JavaScript.
