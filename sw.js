// Service worker — receives pushes from /api/notify and shows them like a
// native notification (this is what makes reminders work with the app
// closed; on iPhone/iPad the app must be added to the Home Screen first).
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Mainichi', body: 'Daily reset reminder', tag: 'mainichi-reset' };
  try { data = { ...data, ...event.data.json() }; } catch (e) { /* keep defaults */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('/');
  })());
});
