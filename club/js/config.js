// Instellingen van de clubapp.

// De WordPress-site waar nieuws, verslagen, foto's en pagina's vandaan komen.
export const SITE = 'https://wijnandkoetsier.nl';

// Programma, uitslagen, standen, teams, agenda en sponsors. Zolang dit endpoint nog niet
// bestaat (zie wordpress/vve-app-api.php), gebruikt de app de momentopname in data/snapshot.json.
export const APP_ENDPOINT = `${SITE}/wp-json/vve/v1/app`;

// Categorie-slugs in WordPress.
export const CAT_VERSLAGEN = 'wedstrijdverslagen';

export const INSTAGRAM = 'vvelspeet';
