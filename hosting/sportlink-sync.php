<?php
/**
 * Elspeet Fluit – Sportlink-koppeling.
 *
 * Haalt het programma met thuiswedstrijden op bij de Sportlink Club.Dataservice en werkt de
 * wedstrijden in de database (Supabase) bij: nieuw → toevoegen, gewijzigd → bijwerken,
 * uit het programma verdwenen → verwijderen. Aangestelde scheidsrechters krijgen daarover
 * automatisch een melding (database-triggers in supabase/schema.sql).
 *
 * Aanroepen:
 *   - Cronjob:  https://jouwsite.nl/elspeet-fluit/sportlink-sync.php?token=GEHEIME_CODE
 *   - Test:     https://jouwsite.nl/elspeet-fluit/sportlink-sync.php?token=GEHEIME_CODE&mode=test
 *               (laat zien wat Sportlink teruggeeft, verandert niets)
 *   - De app:   knop "Nu ophalen uit Sportlink" (stuurt de inlog van de planner mee)
 *
 * De clientcode en sleutels staan in elspeet-fluit-config.php, BUITEN de map www.
 * Zie hosting/elspeet-fluit-config.example.php en de README.
 */
declare(strict_types=1);

date_default_timezone_set('Europe/Amsterdam');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

final class HttpError extends Exception
{
    public function __construct(string $message, public int $status = 500)
    {
        parent::__construct($message);
    }
}

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------- Configuratie ----------

function config_candidates(): array
{
    return array_values(array_filter([
        getenv('ELSPEET_FLUIT_CONFIG') ?: null,
        dirname(__DIR__, 2) . '/elspeet-fluit-config.php', // naast de map www (aanbevolen)
        dirname(__DIR__) . '/elspeet-fluit-config.php',
        __DIR__ . '/elspeet-fluit-config.php',               // noodoplossing, minder veilig
    ]));
}

function load_config(): array
{
    foreach (config_candidates() as $path) {
        if (is_file($path)) {
            $c = require $path;
            if (!is_array($c)) throw new HttpError('Het configuratiebestand is ongeldig.');
            foreach (['sportlink_client_id', 'supabase_url', 'supabase_anon_key', 'supabase_service_key', 'sync_token'] as $key) {
                if (empty($c[$key]) || str_contains((string) $c[$key], 'VUL_IN')) {
                    throw new HttpError("In het configuratiebestand ontbreekt '$key'.");
                }
            }
            $c['_path'] = $path;
            return $c + [
                'allowed_origins' => [],
                'days_ahead' => 42,
                'club_name' => 'Elspeet',
                'knvb_teams' => ['Elspeet 1'],
                'sportlink_url' => 'https://data.sportlink.com',
            ];
        }
    }
    throw new HttpError('Configuratiebestand elspeet-fluit-config.php niet gevonden. Zet het naast de map www.');
}

function cors(array $c): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && in_array(rtrim($origin, '/'), array_map(fn($o) => rtrim($o, '/'), $c['allowed_origins']), true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Max-Age: 600');
    }
}

// ---------- HTTP ----------

function http_json(string $method, string $url, array $headers = [], $body = null, int $timeout = 30): array
{
    $ch = curl_init($url);
    $h = array_merge(['Accept: application/json'], $headers);
    if ($body !== null) {
        $h[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $h,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    // Alleen host en pad in de melding: de querystring bevat de geheime Sportlink-clientcode.
    $where = (parse_url($url, PHP_URL_HOST) ?: '') . (parse_url($url, PHP_URL_PATH) ?: '');
    if ($raw === false) throw new HttpError("Verbinding mislukt met $where: $err", 502);
    $data = $raw === '' ? null : json_decode($raw, true);
    return [$status, $data, $raw];
}

function supabase(array $c, string $method, string $path, $body = null, array $extra = []): mixed
{
    [$status, $data, $raw] = http_json($method, rtrim($c['supabase_url'], '/') . '/rest/v1/' . $path, array_merge([
        'apikey: ' . $c['supabase_service_key'],
        'Authorization: Bearer ' . $c['supabase_service_key'],
    ], $extra), $body);
    if ($status >= 300) {
        $msg = is_array($data) ? ($data['message'] ?? $raw) : $raw;
        throw new HttpError("Database ($method $path): $msg", 502);
    }
    return $data;
}

// ---------- Wie mag dit aanroepen? ----------

function authorize(array $c): string
{
    $token = $_GET['token'] ?? ($_SERVER['HTTP_X_SYNC_TOKEN'] ?? '');
    if ($token !== '' && hash_equals((string) $c['sync_token'], (string) $token)) return 'cron';

    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer\s+(\S+)$/i', $auth, $m)) {
        // Controleer bij Supabase of deze ingelogde gebruiker planner is.
        [$status, $data] = http_json('POST', rtrim($c['supabase_url'], '/') . '/rest/v1/rpc/is_planner', [
            'apikey: ' . $c['supabase_anon_key'],
            'Authorization: Bearer ' . $m[1],
        ], new stdClass(), 15);
        if ($status === 200 && $data === true) return 'planner';
        throw new HttpError('Alleen planners kunnen Sportlink ophalen.', 403);
    }
    throw new HttpError('Geen toegang.', 401);
}

// ---------- Sportlink ----------

/** Programma uit Sportlink. Standaard de thuiswedstrijden; met $away = true de uitwedstrijden. */
function fetch_sportlink(array $c, bool $away = false): array
{
    $query = http_build_query([
        'client_id' => $c['sportlink_client_id'],
        'thuis' => $away ? 'NEE' : 'JA',
        'uit' => $away ? 'JA' : 'NEE',
        'eigenwedstrijden' => 'JA',
        'gebruiklokaleteamgegevens' => 'NEE',
        'aantaldagen' => min(42, max(1, (int) $c['days_ahead'])),
        'aantalregels' => 500,
        'sorteervolgorde' => 'datum',
    ]);
    // Sportlink is soms traag: wacht 45 seconden en probeer het daarna nog één keer.
    $url = rtrim($c['sportlink_url'], '/') . '/programma?' . $query;
    try {
        [$status, $data, $raw] = http_json('GET', $url, [], null, 45);
    } catch (HttpError $e) {
        sleep(2);
        [$status, $data, $raw] = http_json('GET', $url, [], null, 45);
    }
    if ($status !== 200) {
        throw new HttpError("Sportlink gaf foutcode $status. Klopt de clientcode? Antwoord: " . substr((string) $raw, 0, 300), 502);
    }
    if (!is_array($data) || ($data !== [] && !array_is_list($data))) {
        $msg = is_array($data) ? ($data['error']['message'] ?? $data['error'] ?? $data['message'] ?? json_encode($data)) : substr((string) $raw, 0, 300);
        throw new HttpError('Sportlink gaf een fout (klopt de clientcode?): ' . (is_string($msg) ? $msg : json_encode($msg)), 502);
    }
    return $data;
}

function pick(array $r, array $keys): ?string
{
    foreach ($keys as $k) {
        if (isset($r[$k]) && $r[$k] !== '' && $r[$k] !== null && !is_array($r[$k])) return trim((string) $r[$k]);
    }
    return null;
}

/**
 * Categorie uit de teamnaam, in de KNVB-naamgeving: "Elspeet O13-1JM" → O13, oude namen als
 * "JO11-1" of "MO15-2" → O11 / O15, "Elspeet VR1" → VR1, "Elspeet VR30+1" → VR30+,
 * "Elspeet 35+1" → 35+, "Elspeet 7x7 1" → 7x7, "Elspeet 2" → 2e.
 * Zelfde regels als categoryFromTeam() in js/logic.js.
 */
function category_from_team(string $team): string
{
    if (preg_match('/\b[JM]?O\s?(\d{1,2})(?=-|\b|[A-Z])/i', $team, $m)) return 'O' . (int) $m[1];
    if (preg_match('/30\+/', $team)) return 'VR30+';
    if (preg_match('/\bVR\s?\d|vrouwen|dames/i', $team)) return 'VR1';
    if (preg_match('/4[05]\+/', $team)) return '40+';
    if (preg_match('/35\+|vet|VE\d/i', $team)) return '35+';
    if (preg_match('/7\s?[x×]\s?7/iu', $team)) return '7x7';
    // "Elspeet 2" of "Elspeet 2 (zon)" → 2e
    if (preg_match('/(\d+)\s*(?:\([^)]*\))?\s*$/', $team, $m)) return (int) $m[1] . 'e';
    return '1e';
}

/** Speelduur incl. rust in minuten (KNVB-speeltijden). Zelfde tabel als defaultDuration() in js/logic.js. */
function default_duration(string $category): int
{
    if (preg_match('/^[JM]?O(\d{1,2})$/', $category, $m)) {
        $age = (int) $m[1];
        return match (true) {
            $age <= 9 => 45,
            $age <= 11 => 55,
            $age <= 13 => 65,
            $age <= 15 => 75,
            $age <= 17 => 85,
            default => 105,
        };
    }
    if ($category === '7x7') return 60;
    return in_array($category, ['35+', '40+', 'VR30+'], true) ? 80 : 105;
}

/** "veld 1-hoofdveld" → "Veld 1". Zelfde regel als fieldName() in js/logic.js. */
function clean_field(string $field): string
{
    $field = trim($field);
    $short = trim(preg_replace('/\s*[-–]?\s*hoofdveld\b/iu', '', $field));
    if ($short !== '') $field = $short;
    if (preg_match('/^veld\b/i', $field)) $field = 'Veld' . substr($field, 4);
    return $field;
}

function map_match(array $r, string $club = ''): ?array
{
    $status = (string) (pick($r, ['status', 'wedstrijdstatus']) ?? '');
    // Afgelast, afgekeurd enz.: blijft in de app staan met de status Afgelast (geen scheidsrechter nodig).
    $cancelled = (bool) preg_match('/afgelast|vervallen|geannuleerd|afgekeurd/i', $status);

    $code = pick($r, ['wedstrijdcode', 'wedstrijdnummer', 'code']);
    $when = pick($r, ['wedstrijddatum', 'datum', 'kaledatum', 'datumvolledig']);
    $home = pick($r, ['thuisteam', 'thuisteamnaam', 'thuis']);
    if (!$code || !$when || !$home) return null;

    $date = null;
    if (preg_match('/(\d{4})-(\d{2})-(\d{2})/', $when, $m)) $date = "$m[1]-$m[2]-$m[3]";
    elseif (preg_match('/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/', $when, $m)) $date = sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    if (!$date) return null;

    $timeSrc = pick($r, ['aanvangstijd', 'tijd', 'aanvang']) ?? $when;
    if (preg_match('/(?:^|[T\s])(\d{1,2})[:.](\d{2})/', $timeSrc, $m) || preg_match('/^(\d{1,2})[:.](\d{2})/', $timeSrc, $m)) {
        $time = sprintf('%02d:%02d', $m[1], $m[2]);
    } else {
        return null;
    }

    // Oefenwedstrijden met een lokaal team heten soms alleen "JO8-1": zet de clubnaam ervoor.
    // Alleen bij zo'n kale teamcode, niet bij een team van een andere club ("Nunspeet JO7-2").
    $away = pick($r, ['uitteam', 'uitteamnaam', 'uit']) ?? '';
    $bare = fn(string $t) => (bool) preg_match('/^\s*([JM]?O\s?\d{1,2}|VR|\d)/i', $t);
    if ($club !== '' && stripos($home, $club) === false && stripos($away, $club) === false && $bare($home)) $home = "$club $home";

    // Scheidsrechter zoals Sportlink die kent (bijv. door de KNVB of in Sportlink aangesteld).
    $ref = pick($r, ['scheidsrechter', 'scheidsrechters']);
    if ($ref) $ref = trim(preg_replace('/\s*\((?:Scheidsrechter|Assistent[^)]*)\)\s*/i', ' ', $ref));

    $kind = (string) (pick($r, ['competitiesoort']) ?? '');
    $type = preg_match('/oefen/i', $kind) ? 'Oefen' : (preg_match('/beker/i', $kind) ? 'Beker' : '');

    $field = clean_field(pick($r, ['veld', 'veldnaam', 'accommodatieveld']) ?? '');
    // Ons eigen team staat niet altijd voorop (bij JO7-ochtenden en uitwedstrijden).
    $own = ($club !== '' && stripos($home, $club) === false && stripos($away, $club) !== false) ? $away : $home;
    $category = category_from_team($own);
    // Waar wordt gespeeld: accommodatie en plaats uit Sportlink, plus het veld (voor thuis/uit bij de JO7).
    $venue = trim(implode(' ', array_filter([pick($r, ['accommodatie', 'accommodatienaam']), pick($r, ['plaats', 'locatie', 'adres']), $field])));

    return [
        'sportlink_code' => $code,
        'date' => $date,
        'time' => $time,
        'home' => $home,
        'away' => $away,
        'field' => $field ?? '',
        'category' => $category,
        'duration' => default_duration($category),
        'match_type' => $type,
        'sportlink_referee' => $ref ?: '',
        'cancelled' => $cancelled,
        'parts' => null, // alleen bij een JO7-ochtend (zie combine_jo7); alle rijen moeten dezelfde velden hebben
        '_own' => $own,
        '_venue' => $venue,
    ];
}

/**
 * JO7 speelt op zaterdag een paar korte wedstrijden bij één club.
 * - Bij een andere club (geen "Elspeet" in accommodatie, plaats of veld): niet in de app.
 * - Thuis: alle JO7-wedstrijden van die dag (alle teams samen, bijv. O7-1 en O7-2) worden één
 *   wedstrijd in de app, met één scheidsrechter. De losse wedstrijden staan in 'parts'.
 * Alle andere wedstrijden blijven zoals ze zijn.
 */
function combine_jo7(array $mapped, string $club): array
{
    $out = [];
    $groups = [];
    foreach ($mapped as $m) {
        if ($m['category'] !== 'O7') { $out[] = $m; continue; }
        if ($club !== '' && stripos($m['_venue'], $club) === false) continue; // uit → overslaan
        $groups[$m['date']][$m['sportlink_code']] = $m; // per dag, elke wedstrijd één keer
    }
    foreach ($groups as $date => $list) {
        $list = array_values($list);
        usort($list, fn($a, $b) => strcmp($a['time'] . $a['home'], $b['time'] . $b['home']));
        $first = $list[0];
        $last = end($list);
        // "Elspeet O7-1" → "Elspeet O7": de naam voor alle JO7-teams samen.
        $title = trim(preg_replace('/\s*-\s*\d+\w*$/u', '', $first['_own'])) ?: $first['_own'];
        [$h, $mi] = array_map('intval', explode(':', $last['time']));
        $endMin = min(23 * 60 + 59, $h * 60 + $mi + 30); // laatste wedstrijdje duurt ongeveer een half uur
        [$fh, $fm] = array_map('intval', explode(':', $first['time']));
        $parts = array_map(fn($m) => [
            'time' => $m['time'],
            'home' => $m['home'],
            'away' => $m['away'],
            'field' => $m['field'],
            'code' => $m['sportlink_code'],
            'cancelled' => $m['cancelled'],
        ], $list);
        $refs = array_values(array_filter(array_unique(array_map(fn($m) => $m['sportlink_referee'], $list))));
        $out[] = [
            'sportlink_code' => 'JO7:' . $date,
            'date' => $date,
            'time' => $first['time'],
            'home' => $title,
            'away' => '',
            'field' => implode(', ', array_values(array_unique(array_filter(array_map(fn($m) => $m['field'], $list))))),
            'category' => 'O7',
            'duration' => max(30, $endMin - ($fh * 60 + $fm)),
            'match_type' => $first['match_type'],
            'sportlink_referee' => $refs[0] ?? '',
            // Afgelast als alle wedstrijdjes van die ochtend zijn afgelast.
            'cancelled' => !array_filter($list, fn($m) => !$m['cancelled']),
            'parts' => $parts,
            '_own' => $title,
            '_venue' => $first['_venue'],
        ];
    }
    usort($out, fn($a, $b) => strcmp($a['date'] . $a['time'], $b['date'] . $b['time']));
    return $out;
}

// ---------- Bijwerken ----------

// ---------- Scheidsrechters uit Sportlink ----------

/** Afkortingen van tussenvoegsels zoals Sportlink ze schrijft. */
function expand_infix(string $infix): string
{
    $map = ['v/d' => 'van der', 'v.d.' => 'van der', 'vd' => 'van der', 'v/d.' => 'van der', 'v.' => 'van', 'v' => 'van',
            'd.' => 'de', 'i/t' => 'in ’t', 'v/h' => 'van het', 'v/den' => 'van den'];
    $parts = preg_split('/\s+/', trim($infix)) ?: [];
    return trim(implode(' ', array_map(fn($p) => $map[mb_strtolower($p)] ?? $p, $parts)));
}

/**
 * "Hoorn, D. (Daniël) v/d"  → "Daniël van der Hoorn"
 * "T.M. (Thomas) v/d Hoorn" → "Thomas van der Hoorn"
 * "Jansen, B."              → "B. Jansen"
 */
function referee_display_name(string $raw): string
{
    $raw = trim(preg_replace('/\s+/', ' ', $raw));
    $first = preg_match('/\(([^)]+)\)/', $raw, $m) ? trim($m[1]) : '';
    $rest = trim(preg_replace('/\s*\([^)]*\)\s*/', ' ', $raw));
    if (str_contains($rest, ',')) {
        [$last, $after] = array_map('trim', explode(',', $rest, 2));
        $tokens = $after === '' ? [] : explode(' ', $after);
    } else {
        $tokens = explode(' ', $rest);
        $last = array_pop($tokens) ?? '';
    }
    $initials = implode('', array_filter($tokens, fn($t) => preg_match('/^(\p{Lu}\.)+$/u', $t)));
    $infix = implode(' ', array_filter($tokens, fn($t) => !preg_match('/^(\p{Lu}\.)+$/u', $t)));
    return trim(preg_replace('/\s+/', ' ', ($first !== '' ? $first : $initials) . ' ' . expand_infix($infix) . ' ' . $last));
}

/** Vergelijkingssleutel: kleine letters, zonder spaties en leestekens. */
function name_key(string $name): string
{
    return preg_replace('/[^\p{L}\p{N}]/u', '', mb_strtolower($name));
}

/** Voornaam + achternaam zonder tussenvoegsel ("v/d" kan van der, van den of van de zijn). */
function loose_key(string $name): string
{
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    return count($parts) < 2 ? name_key($name) : name_key($parts[0] . end($parts));
}

/** Zoek de scheidsrechter bij een Sportlink-naam; maak hem aan als hij nog niet bestaat. */
function resolve_referee(array $c, array &$refs, string $raw, int &$created): ?string
{
    if ($raw === '') return null;
    $display = referee_display_name($raw);
    $key = name_key($display);
    foreach ($refs as $r) {
        if (($r['sportlink_name'] ?? '') === $key || name_key((string) $r['name']) === $key) return $r['id'];
    }
    // Geen exacte match: probeer voornaam + achternaam, maar alleen als dat precies één persoon is.
    $loose = array_values(array_filter($refs, fn($r) => empty($r['sportlink_name']) && loose_key((string) $r['name']) === loose_key($display)));
    if (count($loose) === 1) {
        supabase($c, 'PATCH', 'referees?id=eq.' . rawurlencode($loose[0]['id']), ['sportlink_name' => $key], ['Prefer: return=minimal']);
        foreach ($refs as &$r) if ($r['id'] === $loose[0]['id']) $r['sportlink_name'] = $key;
        unset($r);
        return $loose[0]['id'];
    }
    $row = supabase($c, 'POST', 'referees', ['name' => $display, 'sportlink_name' => $key, 'active' => true],
        ['Prefer: return=representation']);
    $refs[] = $row[0];
    $created++;
    return $row[0]['id'];
}

// ---------- Bijwerken ----------

function sync(array $c, array $feed): array
{
    $today = date('Y-m-d');
    $until = date('Y-m-d', strtotime('+' . min(42, (int) $c['days_ahead']) . ' days'));
    $knvbTeams = array_map('mb_strtolower', $c['knvb_teams'] ?? []);

    $existing = supabase($c, 'GET', 'matches?select=id,sportlink_code,date,time,duration,home,away,field,category,match_type,sportlink_referee,parts,cancelled,referee_id,published,referee_from_sportlink,external_ref&sportlink_code=not.is.null&date=gte.' . $today);
    $manual = supabase($c, 'GET', 'matches?select=id,date,time,home,referee_id&sportlink_code=is.null&date=gte.' . $today);
    $refs = supabase($c, 'GET', 'referees?select=id,name,sportlink_name');
    $byCode = [];
    foreach ($existing as $m) $byCode[$m['sportlink_code']] = $m;
    $manualKey = [];
    foreach ($manual as $m) $manualKey[$m['date'] . '|' . $m['time'] . '|' . mb_strtolower($m['home'])] = $m;

    $added = $updated = $removed = $assigned = $createdRefs = 0;
    $inserts = [];
    $seen = [];
    foreach ($feed as $f) {
        $seen[$f['sportlink_code']] = true;
        $knvb = in_array(mb_strtolower($f['home']), $knvbTeams, true);
        // Door de club in Sportlink aangesteld → overnemen. Bij KNVB-teams alleen de naam tonen.
        $refId = $knvb ? null : resolve_referee($c, $refs, $f['sportlink_referee'], $createdRefs);

        $old = $byCode[$f['sportlink_code']] ?? null;
        if (!$old) {
            $key = $f['date'] . '|' . $f['time'] . '|' . mb_strtolower($f['home']);
            if (isset($manualKey[$key])) {
                // Al eerder met de hand of via CSV ingevoerd: koppelen in plaats van dubbel toevoegen.
                $old = $manualKey[$key] + ['sportlink_code' => null, 'referee_from_sportlink' => false, 'published' => false, 'external_ref' => false];
                unset($manualKey[$key]);
            }
        }

        if ($old) {
            $patch = [];
            if (empty($old['sportlink_code'])) $patch += ['sportlink_code' => $f['sportlink_code'], 'source' => 'sportlink'];
            foreach (['date', 'time', 'home', 'away', 'field', 'match_type', 'sportlink_referee'] as $k) {
                if ((string) ($old[$k] ?? '') !== (string) $f[$k]) $patch[$k] = $f[$k];
            }
            if ((bool) ($old['cancelled'] ?? false) !== (bool) $f['cancelled']) $patch['cancelled'] = $f['cancelled'];
            // JO7-ochtend: de losse wedstrijden en de totale duur volgen Sportlink.
            if (isset($f['parts'])) {
                if (json_encode($old['parts'] ?? null) !== json_encode($f['parts'])) $patch['parts'] = $f['parts'];
                if ((int) ($old['duration'] ?? 0) !== (int) $f['duration']) $patch['duration'] = $f['duration'];
            }
            // Leeg, of nog een oude categorie van vóór de indeling in teams.
            if (empty($old['category']) || in_array($old['category'], ['Senioren', 'Veteranen', 'Vrouwen', '45+'], true)) $patch['category'] = $f['category'];
            if ($knvb && empty($old['external_ref'])) $patch['external_ref'] = true;
            if ($refId && ($old['referee_id'] ?? null) !== $refId) {
                $patch += ['referee_id' => $refId, 'published' => true, 'referee_from_sportlink' => true];
                $assigned++;
            } elseif (!$refId && !empty($old['referee_from_sportlink'])) {
                // Scheidsrechter is in Sportlink weggehaald: alleen de aanstelling uit Sportlink vervalt.
                $patch += ['referee_id' => null, 'published' => false, 'referee_from_sportlink' => false];
            }
            if ($patch) {
                supabase($c, 'PATCH', 'matches?id=eq.' . rawurlencode($old['id']), $patch, ['Prefer: return=minimal']);
                $updated++;
            }
            continue;
        }

        $row = $f + ['source' => 'sportlink', 'external_ref' => $knvb, 'referee_id' => $refId, 'published' => (bool) $refId, 'referee_from_sportlink' => (bool) $refId];
        if ($refId) $assigned++;
        $inserts[] = $row;
    }
    if ($inserts) {
        supabase($c, 'POST', 'matches', $inserts, ['Prefer: return=minimal']);
        $added = count($inserts);
    }

    // Uit het programma verdwenen (binnen de opgehaalde periode) → verwijderen.
    // Alleen als Sportlink überhaupt wedstrijden teruggaf, zodat een storing niet alles wist.
    if ($feed) {
        $gone = array_values(array_filter($existing, fn($m) => $m['date'] <= $until && !isset($seen[$m['sportlink_code']])));
        if ($gone) {
            $ids = implode(',', array_map(fn($m) => $m['id'], $gone));
            supabase($c, 'DELETE', 'matches?id=in.(' . $ids . ')', null, ['Prefer: return=minimal']);
            $removed = count($gone);
        }
    }
    return ['added' => $added, 'updated' => $updated, 'removed' => $removed, 'total' => count($feed),
            'scheidsrechters_overgenomen' => $assigned, 'scheidsrechters_aangemaakt' => $createdRefs];
}

function log_run(array $c, bool $ok, array $r, ?string $message): void
{
    try {
        supabase($c, 'POST', 'sync_runs', [
            'source' => 'sportlink', 'ok' => $ok,
            'added' => $r['added'] ?? 0, 'updated' => $r['updated'] ?? 0, 'removed' => $r['removed'] ?? 0, 'total' => $r['total'] ?? 0,
            'message' => $message,
        ], ['Prefer: return=minimal']);
    } catch (Throwable $e) {
        // Loggen is niet belangrijk genoeg om de hele run te laten mislukken.
    }
}

// ---------- Uitvoeren ----------

$config = null;
try {
    $config = load_config();
    cors($config);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

    $who = authorize($config);
    $club = (string) $config['club_name'];
    $records = fetch_sportlink($config);
    $mapped = [];
    foreach ($records as $r) {
        if (is_array($r) && ($m = map_match($r, $club))) $mapped[] = $m;
    }
    // JO7: ook de "uit"-wedstrijden ophalen, want bij een JO7-ochtend thuis staat Elspeet soms als tweede.
    $awayRecords = [];
    try { $awayRecords = fetch_sportlink($config, true); } catch (Throwable $e) { /* thuisprogramma gaat voor */ }
    $codes = array_flip(array_map(fn($m) => $m['sportlink_code'], $mapped));
    foreach ($awayRecords as $r) {
        if (is_array($r) && ($m = map_match($r, $club)) && $m['category'] === 'O7' && !isset($codes[$m['sportlink_code']])) $mapped[] = $m;
    }
    $jo7Raw = array_values(array_filter($mapped, fn($m) => $m['category'] === 'O7'));
    $recognized = count($mapped);
    $mapped = combine_jo7($mapped, $club);
    $strip = fn(array $m) => array_diff_key($m, ['_own' => 1, '_venue' => 1]);

    if (($_GET['mode'] ?? '') === 'test') {
        $docroot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ?: null;
        respond([
            'ok' => true,
            'mode' => 'test (er is niets gewijzigd)',
            'configuratie' => $docroot && str_starts_with(realpath($config['_path']), $docroot)
                ? 'LET OP: het configuratiebestand staat in de map www en is mogelijk via internet te openen. Zet het een map hoger.'
                : 'Configuratiebestand staat veilig buiten de map www.',
            'sportlink_wedstrijden' => count($records),
            'herkend' => $recognized,
            'niet_herkend' => count($records) + count($awayRecords) - $recognized,
            'in_de_app' => count($mapped),
            'voorbeeld_van_sportlink' => array_slice($records, 0, 2),
            'zo_komen_ze_in_de_app' => array_map($strip, array_slice($mapped, 0, 10)),
            'jo7_uit_sportlink' => array_map(fn($m) => [
                'datum' => $m['date'], 'tijd' => $m['time'], 'thuis' => $m['home'], 'uit' => $m['away'],
                'ons_team' => $m['_own'], 'plaats_en_veld' => $m['_venue'],
                'in_app' => stripos($m['_venue'], $club) !== false ? 'thuis (samen in één JO7-kaart)' : 'uit (niet in de app)',
            ], $jo7Raw),
            'voorbeeld_jo7_van_sportlink' => array_slice(array_values(array_filter(array_merge($records, $awayRecords),
                fn($r) => is_array($r) && preg_match('/\bJO\s?7\b|\bO7\b/i', ($r['thuisteam'] ?? '') . ' ' . ($r['uitteam'] ?? '')))), 0, 2),
            'scheidsrechters_uit_sportlink' => array_values(array_unique(array_map(
                fn($m) => $m['sportlink_referee'] . '  →  ' . referee_display_name($m['sportlink_referee']),
                array_filter($mapped, fn($m) => $m['sportlink_referee'] !== '')))),
        ]);
    }

    $result = sync($config, array_map($strip, $mapped));
    log_run($config, true, $result, null);
    respond(['ok' => true, 'door' => $who] + $result);
} catch (HttpError $e) {
    if ($config && $e->status >= 500) log_run($config, false, [], $e->getMessage());
    respond(['ok' => false, 'error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    if ($config) log_run($config, false, [], $e->getMessage());
    respond(['ok' => false, 'error' => 'Onverwachte fout: ' . $e->getMessage()], 500);
}
