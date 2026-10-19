<?php
/**
 * Plugin Name: VV Elspeet – App API
 * Description: Levert programma, uitslagen, standen, teams, agenda en sponsors aan de clubapp via /wp-json/vve/v1/app.
 * Version: 0.1.0
 *
 * CONCEPT, nog niet getest tegen live Sportlink-data.
 *
 * Installeren: als mu-plugin in wp-content/mu-plugins/ zetten, of de functies in het thema
 * (vvelspeet-theme-3) opnemen. Het thema haalt Sportlink al op voor /programma/; als die code
 * herbruikbaar is, vervang dan vve_app_sportlink() door de bestaande functies.
 *
 * In wp-config.php:
 *   define('VVE_SPORTLINK_CLIENT_ID', 'jouw-clientcode');
 *
 * Endpoints (alleen lezen, openbaar):
 *   GET /wp-json/vve/v1/app            alles voor de app in één antwoord (15 min gecachet)
 *   GET /wp-json/vve/v1/pagina/<slug>  de inhoud van een themapagina (bijv. contributie)
 */

if (!defined('ABSPATH')) exit;

const VVE_APP_CACHE = 'vve_app_v1';
const VVE_APP_TTL = 15 * MINUTE_IN_SECONDS;

add_action('rest_api_init', function () {
    register_rest_route('vve/v1', '/app', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'vve_app_payload',
    ]);
    register_rest_route('vve/v1', '/pagina/(?P<slug>[a-z0-9-]+)', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'vve_app_page',
    ]);
});

function vve_app_payload(): WP_REST_Response
{
    $data = get_transient(VVE_APP_CACHE);
    if (!$data) {
        $data = [
            'source' => 'live',
            'updated' => current_time('c'),
            'matches' => [],
            'cancelled' => [],
            'standings' => [],
        ];
        try {
            [$data['matches'], $data['cancelled']] = vve_app_matches();
            $data['standings'] = vve_app_standings(['Elspeet 1']);
        } catch (Throwable $e) {
            // Geen Sportlink: de app valt voor deze onderdelen terug op zijn eigen momentopname.
            unset($data['matches'], $data['standings'], $data['cancelled']);
        }
        // Teams, agenda, sponsors en clubinfo staan nu in het thema. Het thema kan ze hier
        // aanleveren, zodat app en website altijd hetzelfde tonen.
        $data = apply_filters('vve_app_data', $data);
        set_transient(VVE_APP_CACHE, $data, VVE_APP_TTL);
    }
    $res = new WP_REST_Response($data);
    $res->header('Cache-Control', 'public, max-age=300');
    return $res;
}

/** Programma (14 dagen vooruit) en uitslagen (21 dagen terug) van alle eigen teams. */
function vve_app_matches(): array
{
    $common = ['eigenwedstrijden' => 'JA', 'thuis' => 'JA', 'uit' => 'JA', 'gebruiklokaleteamgegevens' => 'NEE', 'aantalregels' => 300];
    $program = vve_app_sportlink('programma', $common + ['aantaldagen' => 14, 'sorteervolgorde' => 'datum']);
    $results = vve_app_sportlink('uitslagen', $common + ['aantaldagen' => 21]);

    $matches = [];
    $cancelled = [];
    foreach ([$program, $results] as $i => $rows) {
        foreach ($rows as $r) {
            $m = vve_app_map_match($r, $i === 1);
            if (!$m) continue;
            if (!empty($m['cancelled'])) { $cancelled[] = vve_app_short_date($m['date']) . " {$m['home']} – {$m['away']}"; continue; }
            $matches[] = $m;
        }
    }
    return [$matches, $cancelled];
}

function vve_app_map_match(array $r, bool $isResult): ?array
{
    $date = substr((string) ($r['wedstrijddatum'] ?? ''), 0, 10);
    $home = trim((string) ($r['thuisteam'] ?? ''));
    $away = trim((string) ($r['uitteam'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $home === '') return null;

    $time = preg_match('/(\d{1,2})[:.](\d{2})/', (string) ($r['aanvangstijd'] ?? $r['wedstrijddatum'] ?? ''), $t) ? sprintf('%02d:%02d', $t[1], $t[2]) : '';
    $ours = stripos($home, 'Elspeet') === 0 ? $home : $away;
    $kind = (string) ($r['competitiesoort'] ?? '');
    $score = null;
    if ($isResult && preg_match('/(\d+)\s*-\s*(\d+)/', (string) ($r['uitslag'] ?? ''), $s)) $score = "$s[1]-$s[2]";

    return [
        'date' => $date,
        'time' => $time,
        'team' => vve_app_team_name($ours),
        'home' => $home,
        'away' => $away,
        'field' => trim((string) ($r['veld'] ?? '')),
        'type' => preg_match('/beker/i', $kind) ? 'Beker' : (preg_match('/oefen/i', $kind) ? 'Oefen' : 'Competitie'),
        'referee' => trim(preg_replace('/\s*\([^)]*\)/', '', (string) ($r['scheidsrechter'] ?? ''))),
        'score' => $score,
        'group' => vve_app_group($ours),
        'cancelled' => (bool) preg_match('/afgelast|vervallen/i', (string) ($r['status'] ?? '')),
    ];
}

/** "Elspeet JO15-1JM" → "Elspeet JO15-1", zodat het team overeenkomt met de teamlijst. */
function vve_app_team_name(string $team): string
{
    return preg_replace('/(JO\d+-\d+)(JM|M)$/', '$1', trim($team));
}

function vve_app_group(string $team): string
{
    if (preg_match('/[JM]?O(\d{1,2})/i', $team, $m)) return ((int) $m[1] >= 13) ? 'Junioren' : 'Pupillen';
    return 'Senioren';
}

/** Standen per team, via de poules van dat team. */
function vve_app_standings(array $teamNames): array
{
    $out = [];
    $teams = vve_app_sportlink('teams', []);
    foreach ($teams as $t) {
        $name = trim((string) ($t['teamnaam'] ?? ''));
        if (!in_array($name, $teamNames, true)) continue;
        $poules = vve_app_sportlink('team-poulelijst', ['teamcode' => $t['teamcode'] ?? '', 'lokaleteamcode' => $t['lokaleteamcode'] ?? '']);
        $poule = null;
        foreach ($poules as $p) {
            if (stripos((string) ($p['competitiesoort'] ?? ''), 'regulier') !== false) { $poule = $p; break; }
        }
        $poule ??= $poules[0] ?? null;
        if (!$poule) continue;
        $rows = vve_app_sportlink('poulestand', ['poulecode' => $poule['poulecode'] ?? '']);
        $out[$name] = array_map(fn ($r) => [
            'pos' => (int) ($r['positie'] ?? 0),
            'team' => (string) ($r['teamnaam'] ?? ''),
            'g' => (int) ($r['gespeeldewedstrijden'] ?? 0),
            'w' => (int) ($r['gewonnen'] ?? 0),
            'gl' => (int) ($r['gelijk'] ?? 0),
            'v' => (int) ($r['verloren'] ?? 0),
            'ds' => (int) ($r['doelsaldo'] ?? 0),
            'p' => (int) ($r['punten'] ?? 0),
        ], $rows);
    }
    return $out;
}

function vve_app_sportlink(string $path, array $query): array
{
    if (!defined('VVE_SPORTLINK_CLIENT_ID')) throw new RuntimeException('Geen Sportlink-clientcode');
    $url = 'https://data.sportlink.com/' . $path . '?' . http_build_query(['client_id' => VVE_SPORTLINK_CLIENT_ID] + $query);
    $res = wp_remote_get($url, ['timeout' => 15]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) throw new RuntimeException("Sportlink $path mislukt");
    $data = json_decode(wp_remote_retrieve_body($res), true);
    return is_array($data) && array_is_list($data) ? $data : [];
}

function vve_app_short_date(string $date): string
{
    return wp_date('D j M', strtotime($date));
}

/**
 * Inhoud van een themapagina voor de app. De pagina's van het thema hebben geen inhoud in de
 * editor, dus renderen we de pagina en knippen we <main> eruit.
 */
function vve_app_page(WP_REST_Request $req)
{
    $page = get_page_by_path($req['slug']);
    if (!$page || $page->post_status !== 'publish') return new WP_Error('niet_gevonden', 'Pagina niet gevonden', ['status' => 404]);

    $key = 'vve_app_page_' . $page->ID . '_' . strtotime($page->post_modified_gmt);
    $html = get_transient($key);
    if ($html === false) {
        $res = wp_remote_get(get_permalink($page), ['timeout' => 15]);
        $body = is_wp_error($res) ? '' : wp_remote_retrieve_body($res);
        $html = preg_match('#<main[^>]*>(.*)</main>#s', $body, $m) ? $m[1] : '';
        $html = wp_kses_post($html);
        set_transient($key, $html, HOUR_IN_SECONDS);
    }
    return ['title' => get_the_title($page), 'html' => $html, 'link' => get_permalink($page)];
}

// Cache legen zodra er in WordPress iets verandert dat de app toont.
add_action('save_post', fn () => delete_transient(VVE_APP_CACHE));
