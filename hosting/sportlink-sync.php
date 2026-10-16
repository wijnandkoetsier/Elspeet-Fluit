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
    if ($raw === false) throw new HttpError("Verbinding mislukt met $url: $err", 502);
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

function fetch_sportlink(array $c): array
{
    $query = http_build_query([
        'client_id' => $c['sportlink_client_id'],
        'thuis' => 'JA',
        'uit' => 'NEE',
        'eigenwedstrijden' => 'JA',
        'gebruiklokaleteamgegevens' => 'NEE',
        'aantaldagen' => min(42, max(1, (int) $c['days_ahead'])),
        'aantalregels' => 500,
        'sorteervolgorde' => 'datum',
    ]);
    [$status, $data, $raw] = http_json('GET', rtrim($c['sportlink_url'], '/') . '/programma?' . $query);
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

/** Categorie uit de teamnaam: "Elspeet JO11-1" → JO11, "Elspeet MO15-2" → MO15, "Elspeet 35+1" → Veteranen. */
function category_from_team(string $team): string
{
    if (preg_match('/\b([JM]O)\s?(\d{1,2})\b/i', $team, $m)) return strtoupper($m[1]) . $m[2];
    if (preg_match('/(35\+|45\+|vet|VE\d)/i', $team)) return 'Veteranen';
    return 'Senioren';
}

/** Speelduur incl. rust in minuten (KNVB-speeltijden). Zelfde tabel als defaultDuration() in js/logic.js. */
function default_duration(string $category): int
{
    if (preg_match('/^[JM]O(\d{1,2})$/', $category, $m)) {
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
    return $category === 'Veteranen' ? 80 : 105;
}

function map_match(array $r): ?array
{
    $status = (string) (pick($r, ['status', 'wedstrijdstatus']) ?? '');
    if (preg_match('/afgelast|vervallen|geannuleerd|afgekeurd/i', $status)) return null;

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

    $field = pick($r, ['veld', 'veldnaam', 'accommodatieveld']);
    if ($field && preg_match('/^veld\b/i', $field)) $field = 'Veld' . substr($field, 4);
    $category = category_from_team($home);

    return [
        'sportlink_code' => $code,
        'date' => $date,
        'time' => $time,
        'home' => $home,
        'away' => pick($r, ['uitteam', 'uitteamnaam', 'uit']) ?? '',
        'field' => $field ?? '',
        'category' => $category,
        'duration' => default_duration($category),
    ];
}

// ---------- Bijwerken ----------

function sync(array $c, array $feed): array
{
    $today = date('Y-m-d');
    $until = date('Y-m-d', strtotime('+' . min(42, (int) $c['days_ahead']) . ' days'));

    $existing = supabase($c, 'GET', 'matches?select=id,sportlink_code,date,time,home,away,field,category&sportlink_code=not.is.null&date=gte.' . $today);
    $manual = supabase($c, 'GET', 'matches?select=id,date,time,home&sportlink_code=is.null&date=gte.' . $today);
    $byCode = [];
    foreach ($existing as $m) $byCode[$m['sportlink_code']] = $m;
    $manualKey = [];
    foreach ($manual as $m) $manualKey[$m['date'] . '|' . $m['time'] . '|' . mb_strtolower($m['home'])] = $m;

    $added = $updated = $removed = 0;
    $inserts = [];
    $seen = [];
    foreach ($feed as $f) {
        $seen[$f['sportlink_code']] = true;
        if (isset($byCode[$f['sportlink_code']])) {
            $old = $byCode[$f['sportlink_code']];
            $patch = [];
            foreach (['date', 'time', 'home', 'away', 'field'] as $k) {
                if ((string) ($old[$k] ?? '') !== (string) $f[$k]) $patch[$k] = $f[$k];
            }
            if (empty($old['category'])) $patch['category'] = $f['category'];
            if ($patch) {
                supabase($c, 'PATCH', 'matches?id=eq.' . rawurlencode($old['id']), $patch, ['Prefer: return=minimal']);
                $updated++;
            }
            continue;
        }
        // Al eerder met de hand of via CSV ingevoerd? Dan koppelen in plaats van dubbel toevoegen.
        $key = $f['date'] . '|' . $f['time'] . '|' . mb_strtolower($f['home']);
        if (isset($manualKey[$key])) {
            supabase($c, 'PATCH', 'matches?id=eq.' . rawurlencode($manualKey[$key]['id']),
                ['sportlink_code' => $f['sportlink_code'], 'source' => 'sportlink', 'away' => $f['away'], 'field' => $f['field']],
                ['Prefer: return=minimal']);
            unset($manualKey[$key]);
            $updated++;
            continue;
        }
        $inserts[] = $f + ['source' => 'sportlink'];
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
    return ['added' => $added, 'updated' => $updated, 'removed' => $removed, 'total' => count($feed)];
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
    $records = fetch_sportlink($config);
    $mapped = [];
    foreach ($records as $r) {
        if (is_array($r) && ($m = map_match($r))) $mapped[] = $m;
    }

    if (($_GET['mode'] ?? '') === 'test') {
        $docroot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ?: null;
        respond([
            'ok' => true,
            'mode' => 'test (er is niets gewijzigd)',
            'configuratie' => $docroot && str_starts_with(realpath($config['_path']), $docroot)
                ? 'LET OP: het configuratiebestand staat in de map www en is mogelijk via internet te openen. Zet het een map hoger.'
                : 'Configuratiebestand staat veilig buiten de map www.',
            'sportlink_wedstrijden' => count($records),
            'herkend' => count($mapped),
            'niet_herkend' => count($records) - count($mapped),
            'voorbeeld_van_sportlink' => array_slice($records, 0, 2),
            'zo_komen_ze_in_de_app' => array_slice($mapped, 0, 10),
        ]);
    }

    $result = sync($config, $mapped);
    log_run($config, true, $result, null);
    respond(['ok' => true, 'door' => $who] + $result);
} catch (HttpError $e) {
    if ($config && $e->status >= 500) log_run($config, false, [], $e->getMessage());
    respond(['ok' => false, 'error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    if ($config) log_run($config, false, [], $e->getMessage());
    respond(['ok' => false, 'error' => 'Onverwachte fout: ' . $e->getMessage()], 500);
}
