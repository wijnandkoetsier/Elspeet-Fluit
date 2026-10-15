// Supabase Edge Function: stuurt een pushmelding voor elke nieuwe rij in public.notifications.
// Wordt aangeroepen door een Database Webhook (INSERT op notifications). Zie README, stap Pushmeldingen.
//
// Benodigde secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT (e-mailadres van de beheerder)
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn standaard beschikbaar in Edge Functions.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(
  'mailto:' + Deno.env.get('VAPID_CONTACT'),
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

type Notification = { id: string; referee_id: string | null; to_planners: boolean; kind: string; title: string; body: string | null };

Deno.serve(async (req) => {
  const payload = await req.json();
  const n: Notification | undefined = payload.record;
  if (payload.type !== 'INSERT' || !n) return new Response('ignored');

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
  if (!userIds.length) return new Response('no recipients');

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
        console.error('push failed', err?.statusCode, err?.body);
      }
    }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { 'content-type': 'application/json' } });
});
