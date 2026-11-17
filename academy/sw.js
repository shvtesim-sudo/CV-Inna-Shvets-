// Нужен, чтобы сайт можно было установить на телефон как приложение.
// Ничего не кэширует: всегда показывается свежая версия сайта.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
