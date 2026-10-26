// Supabase Edge Function: stuurt een pushmelding voor elke nieuwe rij in public.notifications.
// Wordt aangeroepen door een Database Webhook (INSERT op notifications). Zie README, stap Pushmeldingen.
//
// Benodigde secrets (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT (e-mailadres van de beheerder)
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn standaard beschikbaar in Edge Functions.
//
// Veiligheid: de functie gebruikt alleen het id uit de aanroep en leest de melding zelf uit de database.
// Zo kan niemand van buitenaf eigen teksten laten versturen; alleen een echte, verse melding gaat de deur uit.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
webpush.setVapidDetails(
  'mailto:' + (Deno.env.get('VAPID_CONTACT') ?? ''),
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  let payload: { type?: string; record?: { id?: string } } = {};
  try { payload = await req.json(); } catch { return json({ skipped: 'geen geldige JSON' }, 400); }
  const id = payload.record?.id;
  if (payload.type !== 'INSERT' || !id) return json({ skipped: 'geen nieuwe melding' });

  // De melding zelf uit de database: alleen die van de afgelopen 10 minuten.
  const { data: n, error } = await supabase.from('notifications')
    .select('id, referee_id, to_planners, title, body, created_at').eq('id', id).maybeSingle();
  if (error) { console.error('melding lezen mislukt', error.message); return json({ error: error.message }, 500); }
  if (!n) return json({ skipped: 'melding bestaat niet' });
  if (Date.now() - new Date(n.created_at).getTime() > 10 * 60 * 1000) return json({ skipped: 'melding is te oud' });

  // Wie moet deze melding krijgen?
  const userIds: string[] = [];
  if (n.referee_id) {
    const { data } = await supabase.from('referees').select('user_id').eq('id', n.referee_id).maybeSingle();
    if (data?.user_id) userIds.push(data.user_id);
  }
  if (n.to_planners) {
    const { data } = await supabase.from('profiles').select('id').eq('role', 'planner');
    for (const p of data ?? []) userIds.push(p.id);
  }
  if (!userIds.length) { console.log('geen ontvanger', n.id); return json({ sent: 0, reason: 'geen ontvanger' }); }

  const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', userIds);
  const message = JSON.stringify({
    title: n.title,
    body: n.body ?? '',
    tag: n.id,
    url: n.to_planners ? './#planning' : './#meldingen',
  });

  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, message);
      sent++;
    } catch (err) {
      // Toestel heeft meldingen uitgezet of de app verwijderd: abonnement opruimen.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', s.id);
      } else {
        console.error('push mislukt', err?.statusCode, err?.body);
      }
    }
  }));
  console.log(`melding ${n.id}: ${sent} van ${subs?.length ?? 0} toestellen`);
  return json({ sent, devices: subs?.length ?? 0 });
});
