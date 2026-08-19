// Service worker — receives pushes from /api/notify and shows them like a
// native notification (this is what makes reminders work with the app
// closed; on iPhone/iPad the app must be added to the Home Screen first).
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Keep the server-side push registration tied to the identity currently used
// by this browser. This fixes the case where a user signs into another account
// (or changes sync code) while the browser still has the same PushSubscription.
// It also records this device's timezone so follow-device games are evaluated
// correctly when one account is used in multiple countries.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/push' && req.method === 'POST') {
    event.respondWith(forwardPushRegistration(req));
    return;
  }

  // Sign-out must also turn off this device's old push binding. Do it before
  // the session token is revoked, then unsubscribe locally.
  if (url.pathname === '/api/me' && req.method === 'DELETE') {
    event.respondWith(forwardSignOut(req));
    return;
  }

  if (url.pathname === '/api/sync') {
    const copy = req.clone();
    const hadBearer = !!req.headers.get('Authorization');
    const network = fetch(req);
    event.respondWith(network);
    event.waitUntil(network.then((res) => {
      if (res.status === 401 && hadBearer) return unsubscribeLocalPush();
      if (!res.ok) return;
      return rebindCurrentSubscription(copy);
    }).catch(() => {}));
  }
});

function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (e) { return 'UTC'; }
}

async function forwardPushRegistration(req) {
  try {
    const body = await req.clone().json();
    if (!body || typeof body !== 'object') return fetch(req);
    if (!body.timezone) body.timezone = localTimeZone();
    const headers = new Headers(req.headers);
    headers.set('Content-Type', 'application/json');
    return fetch(req.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: req.credentials,
      cache: 'no-store',
    });
  } catch (e) {
    return fetch(req);
  }
}

async function forwardSignOut(req) {
  const auth = req.headers.get('Authorization');
  const sub = await self.registration.pushManager.getSubscription().catch(() => null);
  if (sub) {
    if (auth) {
      try {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          cache: 'no-store',
        });
      } catch (e) { /* server will prune an invalid endpoint later */ }
    }
    try { await sub.unsubscribe(); } catch (e) { /* best effort */ }
  }
  return fetch(req);
}

async function unsubscribeLocalPush() {
  const sub = await self.registration.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  try { await sub.unsubscribe(); } catch (e) { /* best effort */ }
}

async function rebindCurrentSubscription(syncReq) {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return;

  const auth = syncReq.headers.get('Authorization');
  const syncUrl = new URL(syncReq.url);
  let deviceId = syncUrl.searchParams.get('device_id');

  if (!deviceId && syncReq.method === 'POST') {
    try {
      const body = await syncReq.json();
      if (body && typeof body.device_id === 'string') deviceId = body.device_id;
    } catch (e) { /* bearer-session POST has no device_id */ }
  }

  // A sync request without either identity form cannot authorize /api/push.
  if (!auth && !deviceId) return;

  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  const body = {
    subscription: sub.toJSON(),
    timezone: localTimeZone(),
  };
  if (!auth && deviceId) body.device_id = deviceId;

  await fetch('/api/push', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

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
