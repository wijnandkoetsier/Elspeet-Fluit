<?php
/**
 * Instellingen voor hosting/sportlink-sync.php.
 *
 * 1. Kopieer dit bestand naar elspeet-fluit-config.php.
 * 2. Vul de waarden in.
 * 3. Zet het via SFTP NAAST de map www (dus niet erin), zodat het niet via internet te openen is:
 *
 *      /                          ← hier: elspeet-fluit-config.php
 *      /www/elspeet-fluit/        ← hier: sportlink-sync.php
 *
 * Zet dit bestand NOOIT in GitHub: het bevat geheime sleutels.
 */
return [
    // Clientcode van de Sportlink Club.Dataservice (van Sportlink gekregen).
    'sportlink_client_id' => 'VUL_IN',

    // Supabase → Project Settings → API.
    'supabase_url' => 'https://VUL_IN.supabase.co',
    'supabase_anon_key' => 'VUL_IN',
    // De "service_role"-sleutel: geeft volledige toegang tot de database. Alleen hier gebruiken.
    'supabase_service_key' => 'VUL_IN',

    // Zelfgekozen geheime code voor de cronjob-link (minimaal 32 tekens).
    // Maak er een met bijvoorbeeld: https://www.random.org/strings/ of `openssl rand -hex 24`.
    'sync_token' => 'VUL_IN',

    // Vanaf welk adres de app de knop "Nu ophalen uit Sportlink" mag gebruiken.
    'allowed_origins' => [
        'https://wijnandkoetsier.github.io',
    ],

    // Hoeveel dagen vooruit ophalen (Sportlink staat maximaal 42 toe).
    'days_ahead' => 42,
];
