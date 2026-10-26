// Vervangt de oude service worker van de app op dit adres: oude opslag wissen, zichzelf uitschakelen
// en open vensters naar het nieuwe adres sturen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate('https://scheids.vv-elspeet.nl/');
})()));
