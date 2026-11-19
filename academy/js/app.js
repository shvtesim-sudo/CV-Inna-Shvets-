(function () {
  'use strict';

  const COURSES = window.COURSES;
  const CATEGORIES = window.CATEGORIES;
  const STORE_KEY = 'viva-academy-v1';
  const API = 'api/index.php';
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');

  /* ───────────── Данные: сервер (личные кабинеты) или демо-режим ─────────────
     Если рядом с сайтом работает api/ (PHP + MySQL), прогресс хранится на сервере.
     Иначе сайт работает в демо-режиме и хранит прогресс в браузере. */

  let mode = 'local';
  let csrf = '';
  let passScore = 0.8;
  let selfRegister = false;
  let user = null;
  let bootError = '';
  let siteStats = null;
  let state = { lessons: {}, quiz: {} };

  async function call(action, body, method) {
    const res = await fetch(`${API}?action=${action}`, {
      method: method || (body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* не JSON */ }
    if (!res.ok || !data) {
      const err = new Error((data && data.message) || 'Сервер недоступен. Попробуйте позже.');
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  function applyProgress(p) {
    if (p) state = { lessons: p.lessons || {}, quiz: p.quiz || {}, external: p.external || [] };
  }

  // Если на сервере уже новая версия, а браузер показал сохранённую старую —
  // обновляем страницу один раз, минуя кэш
  async function reloadIfOutdated(serverVersion) {
    const mine = window.APP_VERSION || '';
    if (!serverVersion || mine.indexOf('__') === 0 || serverVersion === mine) return false;
    let tried = '';
    try { tried = sessionStorage.getItem('viva-reloaded-for') || ''; } catch (e) { /* ignore */ }
    if (tried === serverVersion) return false;
    try { sessionStorage.setItem('viva-reloaded-for', serverVersion); } catch (e) { return false; }
    try { await fetch(location.pathname, { cache: 'reload' }); } catch (e) { /* всё равно перезагружаем */ }
    location.reload();
    return true;
  }

  // Сводные цифры для главной приходят только вошедшим — обновляем после входа
  async function refreshStats() {
    try { siteStats = (await call('me')).stats || null; } catch (e) { /* цифры не обязательны */ }
  }

  async function boot() {
    try {
      let me;
      try {
        me = await call('me');
      } catch (first) {
        // Разовый сбой сервера не должен включать демо-режим: пробуем ещё раз
        if (!(first.status >= 500)) throw first;
        await new Promise((r) => setTimeout(r, 800));
        me = await call('me');
      }
      if (await reloadIfOutdated(me.version)) return;
      mode = 'server';
      csrf = me.csrf;
      passScore = me.passScore;
      selfRegister = me.selfRegister;
      user = me.user;
      applyProgress(me.progress);
      siteStats = me.stats || null;
    } catch (e) {
      if (e.code) {
        // API есть, но не готов (не настроена база или не запущен установщик)
        mode = 'error';
        bootError = e.code === 'server' ? 'Сервер личных кабинетов не готов. Если вы администратор, откройте api/install.php.' : e.message;
        return;
      }
      if (e.status >= 500) {
        mode = 'error';
        bootError = 'Сервер временно не отвечает. Обновите страницу через минуту.';
        return;
      }
      mode = 'local';
      const saved = loadLocal();
      state = { lessons: saved.lessons, quiz: saved.quiz };
      user = { name: saved.name, role: 'user' };
    }
  }

  function loadLocal() {
    const empty = { name: '', lessons: {}, quiz: {} };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign(empty, JSON.parse(raw)) : empty;
    } catch (e) {
      return empty;
    }
  }
  function saveLocal() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ name: user.name, lessons: state.lessons, quiz: state.quiz }));
    } catch (e) { /* приватный режим */ }
  }

  async function markLesson(c, i) {
    if (mode === 'server') {
      applyProgress((await call('lesson', { course: c.id, lesson: i })).progress);
      return;
    }
    const list = doneLessons(c);
    if (!list.includes(i)) state.lessons[c.id] = list.concat(i);
    saveLocal();
  }

  async function submitQuiz(c, answers) {
    if (mode === 'server') {
      const r = await call('quiz', { course: c.id, answers });
      applyProgress(r.progress);
      return { correct: r.correct, total: r.total, passed: r.passed };
    }
    const correct = c.quiz.reduce((s, q, i) => s + (answers[i] === q.correct ? 1 : 0), 0);
    const score = correct / c.quiz.length;
    const passed = score >= passScore;
    const prev = state.quiz[c.id] || {};
    state.quiz[c.id] = {
      best: Math.max(prev.best || 0, score),
      attempts: (prev.attempts || 0) + 1,
      passedAt: prev.passedAt || (passed ? Date.now() : null),
      certId: prev.certId || (passed ? makeCertId(c) : null)
    };
    saveLocal();
    return { correct, total: c.quiz.length, passed };
  }

  function makeCertId(c) {
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `VA-${c.id.slice(0, 3).toUpperCase()}-${new Date().getFullYear()}-${rnd}`;
  }

  /* ───────────── Утилиты ───────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const findCourse = (id) => COURSES.find((c) => c.id === id);
  const courseMinutes = (c) => c.lessons.reduce((s, l) => s + l.minutes, 0) + 5;
  const doneLessons = (c) => state.lessons[c.id] || [];
  const isLessonDone = (c, i) => doneLessons(c).includes(i);
  const quizResult = (c) => state.quiz[c.id];
  // Курс, тест которого сотрудник сдал на прежнем сайте до запуска Академии, считается пройденным
  const legacyResult = (c, list) => c.legacy ? (list || []).find((r) => r.test === c.legacy && r.passed) : null;
  const legacyRes = (c) => legacyResult(c, state.external);
  const isQuizPassed = (c) => !!(quizResult(c) && quizResult(c).passedAt);
  const isPassed = (c) => isQuizPassed(c) || !!legacyRes(c);
  const pct = (x) => Math.round(x * 100);
  const isAdmin = () => mode === 'server' && user && user.role === 'admin';
  // Руководитель видит кабинет руководителя и выгрузку, но ничего не меняет
  const canViewAdmin = () => mode === 'server' && user && (user.role === 'admin' || user.role === 'manager');
  const ROLE_LABEL = { admin: ' · администратор', manager: ' · руководитель (просмотр)' };

  function courseProgress(c) {
    if (!isQuizPassed(c) && legacyRes(c)) return 100;
    const done = doneLessons(c).length + (isPassed(c) ? 1 : 0);
    return Math.round((done / (c.lessons.length + 1)) * 100);
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function formatDateTime(sqlUtc) {
    if (!sqlUtc) return '—';
    const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  const progressBar = (p) => `<div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>`;
  const formError = (msg) => `<p class="form-error" role="alert">${esc(msg)}</p>`;

  function downloadCsv(filename, rows) {
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ───────────── Шаблоны ───────────── */
  function courseCard(c) {
    const p = courseProgress(c);
    const status = isPassed(c)
      ? '<span class="badge badge--done">Сертификат ✓</span>'
      : p > 0 ? `<span class="badge">${p}%</span>` : `<span class="badge">${esc(c.level)}</span>`;
    return `
      <a class="card" href="#/course/${c.id}">
        <div class="card__top"><div class="card__icon" aria-hidden="true">${c.icon}</div>${status}</div>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.short)}</p>
        <div class="meta"><span>${esc(CATEGORIES[c.category])}</span><span>${c.lessons.length} ${plural(c.lessons.length, 'урок', 'урока', 'уроков')} + тест</span><span>≈ ${courseMinutes(c)} мин</span></div>
        ${p > 0 ? progressBar(p) : ''}
      </a>`;
  }

  function nextStepFor(c) {
    const i = c.lessons.findIndex((_, idx) => !isLessonDone(c, idx));
    if (i !== -1) return { href: `#/lesson/${c.id}/${i + 1}`, label: !doneLessons(c).length ? 'Начать курс' : 'Продолжить' };
    if (!isPassed(c)) return { href: `#/quiz/${c.id}`, label: 'Пройти тест' };
    return { href: `#/certificate/${c.id}`, label: 'Открыть сертификат' };
  }

  const demoBanner = () => mode === 'local'
    ? '<div class="wrap"><p class="demo-banner">Демо-режим: личные кабинеты не подключены, прогресс сохраняется только в этом браузере.</p></div>'
    : '';

  /* ───────────── Вход и регистрация ───────────── */
  function viewLogin() {
    return `
      <div class="wrap auth">
        <div class="panel auth__panel">
          <h1>Вход в личный кабинет</h1>
          <p class="muted">Логин и пароль выдаёт руководитель или администратор платформы.</p>
          <form id="login-form" novalidate>
            <div class="field"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" required></div>
            <div class="field"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
            <div class="form-msg"></div>
            <button class="btn btn--primary btn--block">Войти</button>
          </form>
          ${selfRegister ? '<p class="auth__alt">Есть код приглашения? <a href="#/register">Зарегистрироваться</a></p>' : ''}
        </div>
      </div>`;
  }

  function viewRegister() {
    return `
      <div class="wrap auth">
        <div class="panel auth__panel">
          <h1>Регистрация</h1>
          <p class="muted">Код приглашения выдаёт руководитель.</p>
          <form id="register-form" novalidate>
            <div class="field"><label for="r-code">Код приглашения</label><input id="r-code" name="code" required></div>
            <div class="field"><label for="r-name">Имя и фамилия</label><input id="r-name" name="name" autocomplete="name" required></div>
            <div class="field"><label for="r-branch">Аптека / филиал</label><input id="r-branch" name="branch"></div>
            <div class="field"><label for="r-position">Должность</label><input id="r-position" name="position" placeholder="Фармацевт, провизор…"></div>
            <div class="field"><label for="r-login">Логин</label><input id="r-login" name="login" autocomplete="username" required></div>
            <div class="field"><label for="r-password">Пароль (от 8 символов)</label><input id="r-password" name="password" type="password" autocomplete="new-password" required minlength="8"></div>
            <div class="form-msg"></div>
            <button class="btn btn--primary btn--block">Создать кабинет</button>
          </form>
          <p class="auth__alt">Уже есть кабинет? <a href="#/login">Войти</a></p>
        </div>
      </div>`;
  }

  /* ───────────── Страницы обучения ───────────── */
  function overallProgress() {
    return Math.round(COURSES.reduce((s, c) => s + courseProgress(c), 0) / COURSES.length);
  }

  // Главная для вошедшего сотрудника: что сделать сегодня
  function viewToday() {
    const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Chisinau' }));
    const greet = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    // «Фамилия Имя Отчество» → Имя; два слова — неизвестен порядок, обращаемся полностью
    const parts = (user.name || '').split(/\s+/).filter(Boolean);
    const first = esc(parts.length === 3 ? parts[1] : parts.join(' '));
    const date = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Chisinau' });
    // Курс, который стоит продолжить: начатый с наибольшим прогрессом, иначе первый несданный
    const started = COURSES.filter((c) => courseProgress(c) > 0 && !isPassed(c)).sort((a, b) => courseProgress(b) - courseProgress(a));
    const next = started[0] || COURSES.find((c) => !isPassed(c));
    const passed = COURSES.filter(isPassed).length;
    const overall = overallProgress();
    const law = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M6 20h12M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/></svg>';
    const cont = next ? `
        <div class="today-card today-card--accent">
          <h2>${started.length ? 'Продолжить обучение' : 'Следующий курс'}</h2>
          <h3>${next.icon} ${esc(next.title)}</h3>
          <p class="muted small" style="margin:0">${esc(CATEGORIES[next.category] || '')} · ≈ ${courseMinutes(next)} мин</p>
          ${progressBar(courseProgress(next))}
          <div class="btn-row"><a class="btn btn--primary" href="${nextStepFor(next).href}">${nextStepFor(next).label}</a><a class="btn btn--ghost btn--sm" style="color:#fff;border-color:rgba(255,255,255,.4)" href="#/courses">Все курсы</a></div>
        </div>` : `
        <div class="today-card today-card--accent"><h2>Обучение</h2><h3>🎉 Все курсы пройдены!</h3>
          <p class="muted" style="margin:0">Новые курсы появятся здесь — бот сообщит о них в Telegram.</p></div>`;
    return `
      <div class="wrap today">
        <h1 class="today__hello">${greet}${first ? ', ' + first : ''}!</h1>
        <p class="today__date">${esc(date)}</p>
        <div class="today-grid">
          ${cont}
          <div class="today-card">
            <h2>Мой прогресс</h2>
            <div class="me-stats">
              <div><b>${overall}%</b><span>пройдено</span></div>
              <div><b>${passed}</b><span>из ${COURSES.length} серт.</span></div>
              <div><b id="me-place">—</b><span>место</span></div>
            </div>
            <div class="btn-row"><a class="btn btn--ghost btn--sm" href="#/profile">Мои сертификаты</a></div>
          </div>
          <section class="today-full" id="home-event" hidden></section>
          <div class="today-card today-full" id="home-mats" hidden></div>
          <div class="today-card today-full" id="install-card" hidden></div>
          <div class="today-links today-full">
            <a href="#/drugs">💊 Справочник по МНН</a>
            <a href="#/drugs/check">⚠️ Проверка взаимодействий</a>
            <a href="#/law">${law} Нормативная база</a>
            <a href="#/law/buh">${law} Бухгалтерия: касса и налоги</a>
            ${teamReady() ? '<a href="#/team">👥 К кому обращаться</a>' : ''}
          </div>
        </div>
      </div>
      <div class="wrap">
        <section class="section" id="top10" aria-live="polite"></section>
        ${pillarsHtml()}
      </div>`;
  }

  async function loadTodayExtras() {
    loadHomeEvent();
    call('top').then((r) => {
      const b = document.getElementById('me-place');
      if (b) b.textContent = r.me ? r.me.place : '—';
      const box = document.getElementById('top10');
      if (box) box.innerHTML = topHtml(r, false);
    }).catch(() => {});
    call('materials').then((r) => {
      mats.list = r.materials;
      const box = document.getElementById('home-mats');
      const fresh = r.materials.slice(0, 3);
      if (!box || !fresh.length) return;
      box.hidden = false;
      box.innerHTML = `<h2>Новое в материалах</h2><div class="mat-mini">${fresh.map((m) => `
        <a ${matOpen(m)}><span class="pdf">${matType(m)}</span><span><b>${esc(m.title)}</b><small>${esc(m.brand || CATEGORIES[m.category] || '')} · ${formatDate(m.added)}</small></span></a>`).join('')}</div>
        <div class="btn-row"><a class="btn btn--ghost btn--sm" href="#/materials">Все материалы</a></div>`;
    }).catch(() => {});
    renderInstallCard();
  }

  /* ───────────── Установка на телефон (PWA) ───────────── */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstallCard(); });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function renderInstallCard() {
    const box = document.getElementById('install-card');
    if (!box) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem('viva-install-dismissed') === '1'; } catch (e) { /* без хранилища */ }
    const mobile = window.matchMedia('(max-width: 1100px)').matches;
    if (isStandalone() || dismissed || (!installPrompt && !(isIOS() && mobile))) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="install-card"><img src="img/icon-192.png" alt="">
      <div class="grow"><b>Установите ВИВААКАДЕМИЮ на телефон</b>
        <p class="muted small">${installPrompt ? 'Откроется как приложение — без адресной строки, в одно касание.' : 'В Safari нажмите «Поделиться» <span aria-hidden="true">⬆️</span> и выберите «На экран „Домой“».'}</p></div></div>
      <div class="btn-row">${installPrompt ? '<button class="btn btn--primary btn--sm" data-install>Установить</button>' : ''}<button class="btn btn--ghost btn--sm" data-install-dismiss>Скрыть</button></div>`;
  }

  function viewHome() {
    if (mode === 'server' && user) return viewToday();
    const totalLessons = COURSES.reduce((s, c) => s + c.lessons.length, 0);
    const totalQ = COURSES.reduce((s, c) => s + c.quiz.length, 0);
    const inProgress = COURSES.filter((c) => courseProgress(c) > 0 && !isPassed(c));
    const featured = (inProgress.length ? inProgress : COURSES).slice(0, 3);
    const hello = mode === 'server' && user ? `Здравствуйте, ${esc(user.name.split(' ')[0])}!` : 'ВИВААКАДЕМИЯ · Вивафарм';
    return `
      ${demoBanner()}
      <section class="hero">
        <div class="wrap hero__grid">
          <div>
            <span class="eyebrow">${hello}</span>
            <h1>Знания, которые помогают у первого стола</h1>
            <p class="lead">Обучающие материалы, тесты и сертификаты для сотрудников аптек и салонов оптики Вивафарм. Ваш прогресс всегда под рукой.</p>
            <div class="btn-row">
              <a class="btn btn--primary" href="#/courses">Выбрать курс</a>
              <a class="btn btn--ghost" href="#/course/consult">Начать с основ</a>
            </div>
          </div>
          <div class="hero__card">
            <h3>Что внутри</h3>
            <ul class="mini-list">
              <li><span class="ico" aria-hidden="true">🩺</span><div><b>Алгоритм консультирования</b><small>Опрос, «красные флаги», направление к врачу</small></div></li>
              <li><span class="ico" aria-hidden="true">⚗️</span><div><b>Взаимодействия лекарств</b><small>Сочетания, которые нельзя пропустить</small></div></li>
              <li><span class="ico" aria-hidden="true">🎓</span><div><b>Сертификат</b><small>После теста с результатом от ${pct(passScore)}%</small></div></li>
            </ul>
          </div>
        </div>
      </section>
      <div class="wrap">
        <div class="stats">
          <div class="stat"><b>${COURSES.length}</b><span>курсов</span></div>
          <div class="stat"><b>${totalLessons}</b><span>уроков</span></div>
          ${siteStats ? `<div class="stat"><b>${siteStats.staff}</b><span>сотрудников в Академии</span></div>
          <div class="stat"><b>${siteStats.certs}</b><span>выданных сертификатов</span></div>`
            : `<div class="stat"><b>${totalQ}</b><span>вопросов в тестах</span></div>
          <div class="stat"><b>${Object.keys(CATEGORIES).length}</b><span>направлений</span></div>`}
        </div>
        <div class="quick-links">
          ${mode === 'server' ? '<a class="quick-link" href="#/events"><span aria-hidden="true">📅</span><b>Афиша</b><small>Лекции и вебинары — запись и напоминания</small></a>' : ''}
          ${mode === 'server' ? '<a class="quick-link" href="#/materials"><span aria-hidden="true">📚</span><b>Учебные материалы</b><small>Презентации брендов и тренингов</small></a>' : ''}
          <a class="quick-link" href="#/law"><span aria-hidden="true">⚖️</span><b>Нормативная база</b><small>Законы и приказы ПМР для аптеки и бухгалтерии</small></a>
          ${teamReady() ? '<a class="quick-link" href="#/team"><span aria-hidden="true">👥</span><b>К кому обращаться</b><small>Кто в Вивафарм отвечает за ваш вопрос</small></a>' : ''}
          <a class="quick-link" href="#/profile"><span aria-hidden="true">🎓</span><b>Мои сертификаты</b><small>Прогресс и документы в личном кабинете</small></a>
        </div>
        <section class="section">
          <div class="section__head">
            <div><h2>${inProgress.length ? 'Продолжить обучение' : 'Популярные курсы'}</h2></div>
            <a href="#/courses">Все курсы →</a>
          </div>
          <div class="grid">${featured.map(courseCard).join('')}</div>
        </section>
        <section class="section">
          <h2>Как проходит обучение</h2>
          <div class="how">
            <div><b>Выберите курс</b><p>От базового консультирования до взаимодействий и дермокосметики.</p></div>
            <div><b>Изучите уроки</b><p>7–10 минут на урок, ключевые выводы в конце каждого.</p></div>
            <div><b>Пройдите тест</b><p>Вопросы-кейсы из практики с объяснением каждого ответа.</p></div>
            <div><b>Получите сертификат</b><p>Распечатайте или сохраните в PDF для портфолио.</p></div>
          </div>
        </section>
        ${pillarsHtml()}
      </div>`;
  }

  // Таблицы в уроках: подписи столбцов в каждой ячейке — на телефоне строка показывается карточкой
  function labelLessonTables() {
    app.querySelectorAll('.lesson table').forEach((t) => {
      const rows = Array.from(t.rows);
      if (!rows.length || !rows[0].querySelector('th')) return;
      const heads = Array.from(rows[0].cells).map((c) => c.textContent.trim());
      t.classList.add('stack');
      rows.slice(1).forEach((r) => Array.from(r.cells).forEach((c, i) => { if (heads[i]) c.setAttribute('data-label', heads[i]); }));
    });
  }

  /* ───────────── Топ-10 по результатам тестов ───────────── */
  function topHtml(r, compact) {
    if (!r.top.length) return compact ? '<p class="muted small">Рейтинг появится, когда сотрудники сдадут первые тесты.</p>' : '';
    const medal = ['🥇', '🥈', '🥉'];
    const mine = r.me && !r.top.some((x) => x.isMe)
      ? `<p class="top-me">Ваше место: <b>${r.me.place}</b> из ${r.total} · ${r.me.points} ${plural(r.me.points, 'балл', 'балла', 'баллов')}</p>` : '';
    return `
      ${compact ? '<h3>Топ-10 фармацевтов</h3><p class="muted small">Сумма результатов сданных тестов; при равенстве — меньше попыток</p>' : `<div class="section__head"><div><h2>Топ-10 фармацевтов</h2>
        <p>За каждый сданный тест — его результат в процентах, баллы суммируются. При равенстве выше тот, кто сдал с меньшего числа попыток</p></div></div>`}
      <ol class="top-list${compact ? ' top-list--compact' : ''}">${r.top.map((x, i) => `
        <li class="${x.isMe ? 'is-me' : ''}">
          <span class="top-place" aria-label="${x.place} место">${medal[x.place - 1] || x.place}</span>
          <span class="grow"><b>${esc(x.name)}</b>${x.isMe ? ' <span class="badge badge--done">это вы</span>' : ''}<small>${esc(x.branch || '')}${x.branch ? ' · ' : ''}${x.passed} ${plural(x.passed, 'тест', 'теста', 'тестов')} · средний результат ${x.avg}% · попыток: ${x.attempts}</small></span>
          <span class="top-points"><b>${x.points}</b><small>${plural(x.points, 'балл', 'балла', 'баллов')}</small></span>
        </li>`).join('')}
      </ol>${mine}`;
  }

  async function loadTop(id, compact) {
    const box = document.getElementById(id);
    if (!box) return;
    try {
      const r = await call('top');
      if (document.getElementById(id) === box) box.innerHTML = topHtml(r, compact);
    } catch (e) { box.innerHTML = ''; }
  }

  /* ───────────── Четыре опоры фармацевта ───────────── */
  const PILLARS = [
    { name: 'Знания', q: 'Что я знаю?', text: 'Фармакология, составы, показания, взаимодействия и ассортимент своей аптеки.', where: 'В Академии: курсы, тесты и нормативная база.' },
    { name: 'Опыт', q: 'Что я видел на практике?', text: 'Реальные случаи у первого стола, разборы ошибок и советы наставника.', where: 'В Академии: разборы ситуаций в уроках.' },
    { name: 'Консультация', q: 'Как я объясняю?', text: 'Выявить потребность, предложить решение и понятно объяснить, как его применять.', where: 'В Академии: алгоритм первого стола, сервис и этичные рекомендации.' },
    { name: 'Забота', q: 'Ради кого я это делаю?', text: 'Видеть человека, вовремя заметить красный флаг и направить к врачу, когда это нужно.', where: 'В Академии: красные флаги и безопасная рекомендация.' }
  ];
  let pillarsTimer = null;

  function pillarsHtml() {
    const ring = (i, cx, cy, lx, ly, qy) => `
      <g class="pl-g pl-g${i}" data-pillar="${i}">
        <g class="pl-orbit pl-o${i}">
          <circle class="pl-ring" cx="${cx}" cy="${cy}" r="128" stroke="var(--pl${i})"/>
          <text class="pl-label" x="${lx}" y="${ly}" text-anchor="middle" fill="var(--pl${i})">${PILLARS[i - 1].name}</text>
          <text class="pl-q" x="${lx}" y="${qy}" text-anchor="middle" fill="var(--pl${i})">${PILLARS[i - 1].q}</text>
        </g>
      </g>`;
    return `
      <section class="section pillars" aria-labelledby="pillars-title">
        <div>
          <h2 id="pillars-title">Четыре опоры фармацевта, которому доверяют</h2>
          <p class="muted">Покупатель возвращается не за таблеткой, а к человеку. Доверие появляется там, где сходятся четыре вещи, и каждую из них Академия помогает развивать.</p>
          <ul class="pl-list">${PILLARS.map((p, k) => `
            <li class="pl-item" data-pillar="${k + 1}" style="--dot: var(--pl${k + 1})">
              <button type="button" aria-expanded="false" data-pillar-btn="${k + 1}">
                <span class="pl-dot"></span>
                <span><b class="pl-name">${p.name}</b><small>${p.q}</small>
                  <span class="pl-body"><span class="pl-inner"><span>${p.text}</span><span class="muted">${p.where}</span></span></span>
                </span>
              </button>
            </li>`).join('')}
          </ul>
        </div>
        <div class="pl-diagram" id="pl-diagram" role="img" aria-label="Четыре пересекающихся круга: знания, опыт, консультация и забота. В центре — доверие.">
          <svg viewBox="0 0 520 520" aria-hidden="true">
            <defs><linearGradient id="plCore" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3fa36b"/><stop offset="100%" stop-color="#17324d"/></linearGradient></defs>
            ${ring(1, 260, 170, 260, 92, 112)}${ring(2, 170, 260, 108, 256, 276)}${ring(3, 350, 260, 412, 256, 276)}${ring(4, 260, 350, 260, 424, 444)}
            <circle class="pl-halo" cx="260" cy="260" r="48" fill="#3fa36b" opacity=".3"/>
            <g class="pl-core"><circle cx="260" cy="260" r="42" fill="url(#plCore)"/><text x="260" y="265" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">Доверие</text></g>
          </svg>
        </div>
      </section>`;
  }

  function activatePillar(i) {
    const d = document.getElementById('pl-diagram');
    if (!d) return;
    d.dataset.active = i;
    document.querySelectorAll('.pl-item').forEach((li) => {
      const on = Number(li.dataset.pillar) === i;
      li.classList.toggle('is-active', on);
      li.querySelector('button').setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }

  function startPillars() {
    if (!document.getElementById('pl-diagram')) return;
    activatePillar(1);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let cur = 1;
      pillarsTimer = setInterval(() => { cur = (cur % 4) + 1; activatePillar(cur); }, 4500);
    }
  }
  function stopPillars() { if (pillarsTimer) { clearInterval(pillarsTimer); pillarsTimer = null; } }

  /* ───────────── Нормативная база ───────────── */
  const law = { sec: 'pharm', cat: null, q: '' };

  function viewLaw(sec) {
    const L = window.LAW;
    if (sec) { law.sec = sec; law.cat = null; }
    const tabs = L.SECTIONS.map((x) => `<button type="button" class="law-tab" role="tab" data-law-sec="${x.key}" aria-selected="${law.sec === x.key}">${esc(x.label)}</button>`).join('');
    const n = L.CHECK_NOTICE;
    return `
      <div class="wrap narrow law">
        <div class="crumbs"><a href="#/">Главная</a> / Нормативная база</div>
        <h1>Нормативная база</h1>
        <p class="muted law__lead">Законы и приказы ПМР, по которым работает Вивафарм. Напишите вопрос своими словами — покажем документы, где искать ответ.</p>
        <div class="law-tabs" role="tablist" aria-label="Подраздел">${tabs}</div>
        <div class="law-alert" role="status" ${law.sec === 'acc' ? '' : 'hidden'}>
          <span class="law-alert__icon" aria-hidden="true">!</span>
          <div><p class="law-alert__title">${esc(n.title)}</p><p>${esc(n.text)}</p><p class="small muted">${esc(n.src)}</p></div>
        </div>
        <div class="law-search">
          <input id="law-q" class="search" type="search" autocomplete="off" aria-label="Поиск по нормативной базе"
            placeholder="${{ acc: 'Например: лимит остатка наличных в кассе', local: 'Например: подарки от поставщиков' }[law.sec] || 'Например: можно ли вернуть лекарство'}" value="${esc(law.q)}">
        </div>
        <div class="law-hints"><span class="muted small">Частые вопросы:</span>
          ${(L.HINTS[law.sec] || []).map((h) => `<button type="button" class="law-hint" data-law-hint="${esc(h)}">${esc(h)}</button>`).join('')}
        </div>
        <div class="filters" role="group" aria-label="Раздел" id="law-cats"></div>
        <p class="muted small" id="law-count" aria-live="polite"></p>
        <div class="law-docs" id="law-docs"></div>
        <p class="law__disclaimer muted small">Раздел носит справочный характер. Ссылки ведут на официальные и открытые источники ПМР; перед применением проверяйте, что документ действует в текущей редакции. Вопросы по толкованию норм — к ответственному провизору или главному бухгалтеру.</p>
      </div>`;
  }

  function renderLaw() {
    const L = window.LAW;
    const box = document.getElementById('law-docs');
    if (!box) return;
    const inSecDocs = L.DOCS.filter((d) => L.inSec(d, law.sec));
    document.getElementById('law-cats').innerHTML = [['', 'Все', inSecDocs.length]]
      .concat(L.CATEGORIES.filter((c) => c.sec === law.sec).map((c) => [c.key, c.label, L.DOCS.filter((d) => d.cat.indexOf(c.key) > -1).length]))
      .map(([k, label, cnt]) => `<button type="button" class="chip" data-law-cat="${k}" aria-pressed="${(k || null) === law.cat}">${esc(label)} <span class="muted">${cnt}</span></button>`).join('');
    const raw = law.q.trim();
    const qt = raw ? L.expand(L.tokens(raw)) : [];
    const list = L.search(law.sec, law.cat, qt);
    document.getElementById('law-count').textContent = raw ? (list.length ? `Найдено документов: ${list.length}` : '') : `Документов: ${list.length}`;
    if (!list.length) {
      // Предлагаем подраздел с самым точным совпадением, а не первый попавшийся
      const others = L.SECTIONS.filter((x) => x.key !== law.sec).map((x) => {
        const found = raw ? L.search(x.key, null, qt) : [];
        return { x, n: found.length, top: found.length ? found[0].s : 0 };
      });
      const best = others.sort((a, b) => b.top - a.top || b.n - a.n)[0];
      const other = best.x, inOther = best.n;
      box.innerHTML = `<div class="empty">По запросу «${esc(raw)}» здесь документов не нашлось. ${inOther
        ? `Но в подразделе «${esc(other.label)}» найдено: ${inOther}. <button type="button" class="link-btn law-other" data-law-sec="${other.key}" data-keep-q="1">Показать</button>`
        : 'Попробуйте другое слово или задайте вопрос ответственному сотруднику.'}</div>`;
      return;
    }
    const hl = L.tokens(raw);
    box.innerHTML = list.map(({ d }) => {
      const meta = [d.kind, d.num, d.date ? (/^\d/.test(d.date) && d.date.length === 10 ? 'от ' + d.date : d.date) : ''].filter(Boolean).join(' ');
      const cats = d.cat.filter((c) => L.catOf(c).sec === law.sec).map((c) => L.catOf(c).label).join(', ');
      const url = /^(https:\/\/|#\/)/.test(d.url || '') ? d.url : '';
      const internal = url.indexOf('#/') === 0;
      return `<article class="law-doc">
        <p class="law-doc__meta"><b>${esc(cats)}</b> · ${esc(meta)}</p>
        <h3>${L.highlight(d.title, hl)}</h3>
        <p class="small muted">${law.sec === 'pharm' ? 'Что это значит для фармацевта' : 'Что это значит на практике'}</p>
        <p>${L.highlight(d.means, hl)}</p>
        ${d.warn ? `<p class="law-doc__warn">${esc(d.warn)}</p>` : ''}
        <div class="law-doc__foot">
          ${url ? (internal ? `<a class="btn btn--primary btn--sm" href="${esc(url)}">Изучить и пройти тест</a>`
            : `<a class="btn btn--primary btn--sm" href="${esc(url)}" target="_blank" rel="noopener">Открыть документ</a>`) : '<span class="badge">Ссылка уточняется</span>'}
          ${internal ? '' : `<span class="small muted">${d.checked ? 'Редакция сверена: ' + esc(d.checked) : 'Редакция не сверена'}</span>`}
        </div>
      </article>`;
    }).join('');
  }

  /* ───────────── К кому обращаться ───────────── */
  let teamTopic = null;
  const teamPeople = () => ((window.TEAM && window.TEAM.PEOPLE) || []).filter((p) => p.name && p.name !== 'Имя Фамилия');
  // Раздел появляется, когда заполнено хотя бы два человека
  const teamReady = () => teamPeople().length >= 2;

  function viewTeam() {
    const people = teamPeople();
    const topics = window.TEAM.TOPICS.filter((t) => people.some((p) => p.topics.indexOf(t.key) > -1));
    const initials = (n) => n.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();
    const safeLink = (u) => (/^(https:\/\/|tel:|mailto:)/.test(u || '') ? u : '');
    return `
      <div class="wrap team">
        <div class="crumbs"><a href="#/">Главная</a> / К кому обращаться</div>
        <h1>К кому обращаться</h1>
        <p class="muted">Выберите тему вопроса — подсветим, кто в Вивафарм за неё отвечает.</p>
        <div class="filters" role="group" aria-label="Тема вопроса"><span class="muted small team__label">Мой вопрос о…</span>
          ${topics.map((t) => `<button type="button" class="chip" data-team-topic="${t.key}" aria-pressed="${teamTopic === t.key}">${esc(t.label)}</button>`).join('')}
        </div>
        <div class="team-grid">${people.map((p) => {
          const match = teamTopic && p.topics.indexOf(teamTopic) > -1;
          const link = safeLink(p.contact);
          return `<article class="team-card ${teamTopic ? (match ? 'is-match' : 'is-dim') : ''}">
            <div class="team-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : `<span aria-hidden="true">${esc(initials(p.name))}</span>`}</div>
            <h3>${esc(p.name)}</h3>
            <p class="muted small">${esc(p.role)}</p>
            <span class="badge">${esc(p.dept)}</span>
            <p class="team-card__text">${esc(p.text)}</p>
            ${link ? `<a class="btn btn--ghost btn--sm" href="${esc(link)}" target="_blank" rel="noopener">Написать</a>` : ''}
          </article>`;
        }).join('')}</div>
      </div>`;
  }

  let filter = { cat: 'all', q: '' };

  /* ───────────── Справочник по МНН ───────────── */
  // Внешние справочники открываются в браузере сотрудника (поиск по ссылке), содержимое мы не копируем.
  const DRUG_SOURCES = [
    { name: 'Видаль', note: 'инструкции и описания препаратов', url: (q) => 'https://www.vidal.ru/search?t=all&q=' + encodeURIComponent(q) },
    { name: 'РЛС', note: 'регистр лекарственных средств', url: (q) => 'https://www.rlsnet.ru/search_result.htm?word=' + encodeURIComponent(q) }
  ];
  let drugs = { q: '', timer: null, form: '' };
  const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е');

  function drugTabs(tab) {
    return `<div class="law-tabs drug-tabs" role="tablist">
      <a class="law-tab" role="tab" href="#/drugs" aria-selected="${tab === 'search'}">Поиск по МНН</a>
      <a class="law-tab" role="tab" href="#/drugs/check" aria-selected="${tab === 'check'}">Проверка взаимодействий</a></div>`;
  }

  function viewDrugs(tab) {
    if (tab === 'check') return viewCheck();
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Справочник по МНН</div>
        <h1>Справочник по МНН</h1>
        ${drugTabs('search')}
        <p class="muted">Введите действующее вещество или название препарата — покажем, что о нём сказано в курсах Академии, какие препараты с ним есть в каталоге Вивафарм, и откроем инструкцию в справочниках.</p>
        <input class="search" id="drug-q" type="search" list="drug-list" placeholder="Например: ибупрофен, омепразол, левоцетиризин…" value="${esc(drugs.q)}" aria-label="Поиск по МНН" autocomplete="off">
        <datalist id="drug-list"></datalist>
        <div id="drug-body" aria-live="polite"></div>
      </div>`;
  }

  function loadAssortment() {
    if (window.ASSORTMENT || loadAssortment.p) return loadAssortment.p || Promise.resolve();
    loadAssortment.p = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = 'js/assortment.js?v=' + encodeURIComponent(window.APP_VERSION || '');
      sc.onload = resolve; sc.onerror = resolve;
      document.head.appendChild(sc);
    });
    return loadAssortment.p;
  }

  async function initDrugs() {
    renderDrugs();
    await loadAssortment();
    const dl = document.getElementById('drug-list');
    if (dl && window.ASSORTMENT) {
      const mnn = Array.from(new Set(window.ASSORTMENT.rows.map((r) => r[3]).filter((m) => m && m.length < 60))).sort((a, b) => a.localeCompare(b, 'ru'));
      dl.innerHTML = mnn.map((m) => `<option value="${esc(m)}">`).join('');
    }
    renderDrugs();
  }

  function snippet(text, i, len) {
    const from = Math.max(0, i - 90), to = Math.min(text.length, i + len + 110);
    return (from ? '…' : '') + esc(text.slice(from, i)) + '<mark>' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len, to)) + (to < text.length ? '…' : '');
  }

  function renderDrugs() {
    const box = document.getElementById('drug-body');
    if (!box) return;
    const raw = drugs.q.trim();
    const q = norm(raw);
    if (q.length < 3) {
      box.innerHTML = '<p class="muted small" style="margin-top:16px">Введите не меньше 3 букв. Ищем по русскому названию МНН или торговому названию.</p>';
      return;
    }
    // Курсы Академии
    const hits = [];
    COURSES.forEach((c) => c.lessons.forEach((l, li) => {
      const text = l.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const i = norm(text).indexOf(q);
      if (i >= 0) hits.push({ c, l, li, snip: snippet(text, i, raw.length) });
    }));
    // Каталог Вивафарм (снимок)
    const A = window.ASSORTMENT;
    const items = A ? A.rows.filter((r) => norm(r[0]).includes(q) || norm(r[3]).includes(q))
      .map((r) => ({ n: r[0], u: A.base + r[1], c: A.cats[r[2]], m: r[3], f: r[4] || '', g: r[5], rx: r[6] })) : [];
    const formsHere = Array.from(new Set(items.map((it) => it.f).filter(Boolean)));
    if (drugs.form && !formsHere.includes(drugs.form)) drugs.form = '';
    const shown = drugs.form ? items.filter((it) => it.f === drugs.form) : items;
    const FN = (A && A.forms) || {};
    const src = DRUG_SOURCES.map((s) => `<a class="btn btn--ghost btn--sm" href="${esc(s.url(raw))}" target="_blank" rel="noopener">${esc(s.name)} ↗<small>${esc(s.note)}</small></a>`).join('');
    box.innerHTML = `
      <section class="drug-sec">
        <h2>Инструкция и описание</h2>
        <div class="drug-src">${src}</div>
        <p class="muted small">Откроется сайт справочника. Инструкции в российских справочниках могут отличаться от инструкции препарата, зарегистрированного в ПМР: при отпуске сверяйтесь с инструкцией в упаковке.</p>
      </section>
      <section class="drug-sec">
        <h2>В курсах Академии <span class="muted">${hits.length}</span></h2>
        ${hits.length ? `<ul class="drug-hits">${hits.slice(0, 20).map((h) => `
          <li><a href="#/lesson/${h.c.id}/${h.li + 1}"><b>${h.c.icon} ${esc(h.c.title)}</b><small>Урок ${h.li + 1}. ${esc(h.l.title)}</small></a><p>${h.snip}</p></li>`).join('')}</ul>`
          : '<p class="muted small">В уроках пока не упоминается. Если тема важна — напишите в учебный отдел, добавим.</p>'}
      </section>
      <section class="drug-sec">
        <h2>В каталоге Вивафарм <span class="muted">${A ? items.length : '…'}</span></h2>
        ${!A ? '<p class="muted small">Загружаем каталог…</p>' : items.length ? `
          ${formsHere.length > 1 ? `<div class="filters drug-forms">${[['', 'Все формы']].concat(formsHere.map((f) => [f, FN[f] || f]))
            .map(([f, l]) => `<button type="button" class="chip" data-drug-form="${f}" aria-pressed="${drugs.form === f}">${esc(l)} <small>${f ? items.filter((it) => it.f === f).length : items.length}</small></button>`).join('')}</div>` : ''}
          <ul class="drug-items">${shown.slice(0, 60).map((it) => `
          <li><a href="${esc(it.u)}" target="_blank" rel="noopener">${esc(it.n)}</a>${it.rx ? ' <span class="rx-badge" title="На vivafarm.md отмечен как рецептурный (препараты особого учёта)">Рецепт</span>' : ''}<small>${it.f ? esc(FN[it.f] || '') + ' · ' : ''}${esc(it.c)}${it.m ? (/биоакт|добавк|,/i.test(it.m) || it.m.length > 60 ? ' · Состав: ' + esc(it.m.length > 140 ? it.m.slice(0, 140) + '…' : it.m) : ' · МНН: ' + esc(it.m)) + (it.g ? ' <span title="МНН определено по названию или бренду">(по названию)</span>' : '') : ''}</small></li>`).join('')}</ul>
          ${shown.length > 60 ? `<p class="muted small">Показаны первые 60 из ${shown.length}. Уточните запрос или выберите форму.</p>` : ''}`
          : '<p class="muted small">В каталоге не найдено. Проверьте написание или поищите по торговому названию.</p>'}
        ${A ? `<p class="muted small">Снимок каталога vivafarm.md от ${esc(A.date)}. МНН и форма выпуска — из карточек товаров на сайте. Отметка «Рецепт» стоит там у препаратов особого учёта; рецептурный статус остальных проверяйте по инструкции. Это не остатки: наличие и цену уточняйте в программе аптеки.</p>` : ''}
      </section>`;
  }

  /* ───────────── Проверка взаимодействий ───────────── */
  let ix = { items: [] };
  const SEV = {
    contra: { label: 'Противопоказано', cls: 'contra', order: 0 },
    high: { label: 'Опасно — нужен врач', cls: 'high', order: 1 },
    mod: { label: 'Значимо — осторожность и контроль', cls: 'mod', order: 2 },
    time: { label: 'Разнести по времени', cls: 'time', order: 3 },
    low: { label: 'Низкий риск — местная форма', cls: 'low', order: 4 }
  };
  const ixFormOf = (text) => { const n = norm(text); const f = (IX.formRe || []).find(([, re]) => re.test(n)); return f ? f[0] : ''; };
  const ixSystemic = (it) => !it.form || (IX.systemic || 'oir').includes(it.form);

  function viewCheck() {
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/drugs">Справочник по МНН</a> / Взаимодействия</div>
        <h1>Проверка взаимодействий</h1>
        ${drugTabs('check')}
        <p class="muted">Добавьте 2–5 препаратов, которые человек принимает или покупает: МНН или торговое название. Лучше выбрать точное название из подсказки — тогда учтётся форма выпуска (таблетки, гель, глазные капли…). Можно добавить алкоголь, грейпфрут, зверобой, молочные продукты.</p>
        <form id="ix-form" class="ix-form" autocomplete="off">
          <input class="search" id="ix-q" list="drug-list" placeholder="Например: варфарин, Нурофен, кларитромицин…" aria-label="Препарат">
          <button class="btn btn--primary">Добавить</button>
        </form>
        <datalist id="drug-list"></datalist>
        <div class="ix-extras">${IX.extras.map((x) => `<button type="button" class="chip" data-ix-add="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>
        <div id="ix-body" aria-live="polite"></div>
      </div>`;
  }

  function ixGroups(text) {
    const t = ' ' + norm(text) + ' ';
    return Object.keys(IX.groups).filter((g) => IX.groups[g].s.some((stem) => t.includes(norm(stem))));
  }
  const asList = (x) => (Array.isArray(x) ? x : [x]);

  function ixCheck(items) {
    const found = [];
    const seen = new Set();
    const add = (f) => { const k = f.key; if (!seen.has(k)) { seen.add(k); found.push(f); } };
    const triples = [];
    IX.triples.forEach((tr, ti) => {
      const who = tr.g.map((g) => items.findIndex((it) => it.groups.includes(g) && ixSystemic(it)));
      if (who.every((i) => i >= 0) && new Set(who).size >= 2) {
        triples.push(tr);
        add({ key: 'tr' + ti, sev: tr.sev, names: Array.from(new Set(who)).map((i) => items[i].name), t: tr.t, d: tr.d, ref: tr.ref });
      }
    });
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        IX.rules.forEach((r, ri) => {
          const ra = asList(r.a), rb = asList(r.b);
          const hit = (ra.some((g) => A.groups.includes(g)) && rb.some((g) => B.groups.includes(g)))
                   || (ra.some((g) => B.groups.includes(g)) && rb.some((g) => A.groups.includes(g)));
          if (!hit) return;
          if (triples.length && r.a === 'raas' && r.b === 'nsaid') return; // уже учтено в «тройном ударе»
          // Форма выпуска: правило по умолчанию касается системных форм; «разнести по времени» — только приёма внутрь
          const ok = (it) => (r.sev === 'time' ? (!it.form || it.form === 'o') : (r.forms ? (!it.form || r.forms.includes(it.form)) : ixSystemic(it)));
          if (ok(A) && ok(B)) {
            add({ key: ri + ':' + i + ':' + j, sev: r.sev, names: [A.name, B.name], t: r.t, d: r.d, ref: r.ref });
          } else if (r.localNote) {
            add({ key: ri + ':' + i + ':' + j, sev: 'low', names: [A.name, B.name], t: r.localNote, d: r.d, ref: r.ref });
          }
        });
        Object.keys(IX.duplicates).forEach((g) => {
          if (A.groups.includes(g) && B.groups.includes(g) && ixSystemic(A) && ixSystemic(B)) {
            const dup = IX.duplicates[g];
            add({ key: 'dup' + g + i + j, sev: dup.sev, names: [A.name, B.name], t: dup.t, d: dup.d, ref: dup.ref });
          }
        });
        // Одно и то же действующее вещество в двух препаратах (по МНН из карточек каталога)
        const same = ixSameMnn(A, B);
        if (same && ixSystemic(A) && ixSystemic(B) && !found.some((f) => f.key.startsWith('dup') && f.names.includes(A.name) && f.names.includes(B.name))) {
          add({ key: 'mnn' + i + j, sev: 'high', names: [A.name, B.name], t: `В обоих препаратах ${same} — двойная доза одного вещества, риск передозировки.`, d: 'Оставить один препарат; если оба назначены врачом — уточнить у врача.', ref: 'consult/4' });
        }
        const sa = A.groups.includes('sorbent'), sb = B.groups.includes('sorbent');
        const other = sa ? B : A;
        if (sa !== sb && (!other.form || other.form === 'o')) add({ key: 'sorb' + i + j, sev: 'time', names: [A.name, B.name], t: 'Сорбент снижает всасывание других лекарств.', d: 'Интервал не менее 1,5–2 часов.', ref: 'interactions/4' });
      }
    }
    return found.sort((x, y) => SEV[x.sev].order - SEV[y.sev].order);
  }

  // Составные МНН: «Парацетамол + Кофеин», синонимы через «/» («Метамизол натрия/Анальгин»)
  const MNN_SKIP = /аскорбин|витамин|ментол|глицер|натрия хлорид|вода|глюкоз|декстроз|сахар|экстракт|масло|кальци|магни|цинк/;
  const mnnParts = (m) => (m && m.length <= 100 && !/биоакт|добавк/i.test(m) ? m.split(/\s*\+\s*/) : [])
    .map((p) => p.split('/').map((x) => norm(x).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()).filter((x) => x.length > 3 && !MNN_SKIP.test(x)))
    .filter((p) => p.length);
  function ixSameMnn(A, B) {
    const pa = mnnParts(A.mnn), pb = mnnParts(B.mnn);
    for (const a of pa) for (const b of pb) if (a.some((x) => b.includes(x))) return a[0].charAt(0).toUpperCase() + a[0].slice(1);
    return '';
  }

  function renderCheck() {
    const box = document.getElementById('ix-body');
    if (!box) return;
    const items = ix.items;
    const chips = items.map((it, k) => `<span class="ix-chip ${it.groups.length || it.low ? '' : 'ix-chip--unknown'}">${esc(it.name)}
      <small>${it.groups.length ? esc(it.groups.map((g) => IX.groups[g].name).join(', ')) : it.low ? 'значимых взаимодействий обычно нет' : 'нет в базе — проверьте инструкцию'}</small>
      <select class="ix-form-sel" data-ix-form="${k}" aria-label="Форма выпуска ${esc(it.name)}">${Object.entries(IX.formNames).map(([c, l]) => `<option value="${c}" ${it.form === c ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${it.groups.length && !ixSystemic(it) ? '<small class="ix-local">Местная форма: системные взаимодействия маловероятны</small>' : ''}
      <button type="button" class="link-btn" data-ix-del="${k}" aria-label="Убрать ${esc(it.name)}">×</button></span>`).join('');
    let res = '';
    if (items.length < 2) {
      res = '<p class="muted small">Добавьте ещё хотя бы один препарат.</p>';
    } else {
      const f = ixCheck(items);
      res = f.length ? `<ul class="ix-list">${f.map((x) => `
        <li class="ix-item ix-item--${SEV[x.sev].cls}">
          <span class="ix-sev">${SEV[x.sev].label}</span>
          <b>${x.names.map(esc).join(' + ')}</b>
          <p>${esc(x.t)}</p>
          <p class="ix-do"><b>Что делать:</b> ${esc(x.d)}</p>
          ${x.ref ? `<a class="small" href="#/lesson/${x.ref}">Подробнее в уроке Академии →</a>` : ''}
        </li>`).join('')}</ul>`
        : (() => {
          const unknown = items.filter((it) => !it.groups.length && !it.low);
          const list = (unknown.length ? unknown : items).map((it) => `<a href="${esc(DRUG_SOURCES[0].url(it.name))}" target="_blank" rel="noopener">${esc(it.name)} в Видале ↗</a>`).join(', ');
          return `<div class="ix-none"><b>В базе Академии значимых взаимодействий между этими препаратами не найдено.</b>
           <p class="muted small">${unknown.length ? `Не распознаны: ${unknown.map((it) => esc(it.name)).join(', ')} — для них проверьте раздел «Взаимодействие» в инструкции или справочник: ${list}.`
             : `База охватывает важные для первого стола сочетания, но не все. При сомнении сверьтесь с инструкцией: ${list}.`}</p></div>`;
        })();
    }
    box.innerHTML = `${items.length ? `<div class="ix-chips">${chips}</div>
      <button type="button" class="link-btn small" data-ix-clear>Очистить список</button>` : ''}
      <section class="drug-sec">${res}</section>
      <p class="muted small">Проверка опирается на ${IX.rules.length + IX.triples.length + Object.keys(IX.duplicates).length} правил из курсов Академии и не заменяет инструкцию и решение врача. Если препарат назначен врачом — не отменяйте его, а посоветуйте обсудить сочетание с врачом.</p>`;
  }

  async function initCheck() {
    renderCheck();
    await loadAssortment();
    const dl = document.getElementById('drug-list');
    if (dl && window.ASSORTMENT) {
      // МНН и точные названия из каталога (по названию определяется форма выпуска)
      const mnn = Array.from(new Set(window.ASSORTMENT.rows.map((r) => r[3]).filter((m) => m && m.length < 60))).sort((a, b) => a.localeCompare(b, 'ru'));
      const names = window.ASSORTMENT.rows.filter((r) => r[3] || r[4]).map((r) => r[0]);
      dl.innerHTML = mnn.concat(names).map((m) => `<option value="${esc(m)}">`).join('');
    }
  }

  function ixAdd(name) {
    name = String(name || '').trim().slice(0, 120);
    if (!name || ix.items.length >= 8 || ix.items.some((it) => norm(it.name) === norm(name))) return;
    // Торговое название из каталога → добавляем МНН для распознавания
    let text = name;
    let form = ixFormOf(name);
    let mnn = '';
    const A = window.ASSORTMENT;
    if (A) {
      const nn = norm(name);
      const row = A.rows.find((r) => norm(r[0]) === nn) || A.rows.find((r) => norm(r[0]).startsWith(nn));
      if (row) {
        if (row[3]) { text += ' ' + row[3]; mnn = row[3]; }
        if (!form && row[4] && norm(row[0]) === nn) form = row[4];
      }
    }
    const groups = ixGroups(text);
    const t = ' ' + norm(text) + ' ';
    const low = !groups.length && (IX.low || []).some((stem) => t.includes(norm(stem)));
    ix.items.push({ name, groups, low, form, mnn });
    renderCheck();
  }

  /* ───────────── Афиша мероприятий ───────────── */
  let evs = { data: null };
  const TZ = 'Europe/Chisinau';
  const evDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', timeZone: TZ });
  const evMonth = (ts) => new Date(ts).toLocaleDateString('ru-RU', { month: 'short', timeZone: TZ }).replace('.', '');
  const evTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const evWeekday = (ts) => new Date(ts).toLocaleDateString('ru-RU', { weekday: 'long', timeZone: TZ });
  const evFull = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ }) + ', ' + evTime(ts);

  function viewEvents() {
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Афиша</div>
        <div class="section__head"><div><h1 style="margin:0">Афиша</h1>
          <p>Лекции, вебинары и встречи для сотрудников Вивафарм. Записывайтесь — бот напомнит в Telegram накануне и за час до начала.</p></div>
          ${isAdmin() ? '<button class="btn btn--primary btn--sm" data-ev-new>+ Мероприятие</button>' : ''}</div>
        <div id="ev-body"><p class="muted">Загружаем афишу…</p></div>
      </div>`;
  }

  async function loadEvents() {
    try {
      evs.data = await call('events');
    } catch (e) {
      const b = document.getElementById('ev-body');
      if (b) b.innerHTML = formError(e.message);
      return;
    }
    renderEvents();
  }

  // Ближайшее мероприятие на главной
  async function loadHomeEvent() {
    const box = document.getElementById('home-event');
    if (!box) return;
    try {
      evs.data = await call('events');
    } catch (e) { return; }
    const next = evs.data.upcoming.filter((e) => e.startsAt > Date.now())[0];
    if (!next || !document.getElementById('home-event')) return;
    box.hidden = false;
    box.innerHTML = `<div class="section__head"><div><h2>Ближайшее мероприятие</h2></div><a href="#/events">Вся афиша →</a></div>
      ${eventCard(next, false)}${tgBanner(evs.data.telegram, 'home')}`;
  }

  function tgBanner(tg, where) {
    if (!tg || !tg.bot || tg.linked) return '';
    return `<div class="tg-banner"><span aria-hidden="true">✈️</span><div class="grow"><b>Получайте напоминания в Telegram</b>
      <small>${where === 'events' ? 'Подключите бота — он напомнит о мероприятиях, на которые вы записались, и сообщит о новых тестах.' : 'Бот сообщит о новых тестах и мероприятиях и напомнит о записи.'}</small></div>
      <button class="btn btn--primary btn--sm" data-tg-link>Подключить</button></div>`;
  }

  function eventCard(e, past) {
    const full = e.capacity > 0 && e.registered >= e.capacity && !e.mine;
    const started = e.startsAt <= Date.now();
    let action = '';
    if (!past && !started) {
      action = e.mine
        ? `<span class="badge badge--done">Вы записаны ✓</span><button class="link-btn" data-ev-reg="${e.id}" data-on="0">Отменить запись</button>`
        : full ? '<span class="badge badge--warn">Мест нет</span>'
        : `<button class="btn btn--primary btn--sm" data-ev-reg="${e.id}" data-on="1">Записаться</button>`;
    }
    return `
      <article class="ev-card${past ? ' ev-card--past' : ''}">
        <div class="ev-date" aria-hidden="true"><b>${evDay(e.startsAt)}</b><span>${evMonth(e.startsAt)}</span><small>${evTime(e.startsAt)}</small></div>
        <div class="ev-body">
          <div class="meta"><span>${esc(evWeekday(e.startsAt))}, ${evFull(e.startsAt)}</span>${e.duration ? `<span>${e.duration} мин</span>` : ''}${e.place ? `<span>📍 ${esc(e.place)}</span>` : ''}</div>
          <h3>${esc(e.title)}</h3>
          ${e.speaker ? `<p class="ev-speaker">${esc(e.speaker)}</p>` : ''}
          ${e.description ? `<p class="muted small">${esc(e.description)}</p>` : ''}
          ${e.mine && e.link && e.link !== 'after' ? `<p class="small">🔗 Ссылка для подключения: <a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.link)}</a></p>`
            : e.link === 'after' && !past ? '<p class="muted small">🔗 Ссылка для подключения появится после записи.</p>' : ''}
          <div class="ev-actions">
            ${action}
            <span class="muted small">Записались: ${e.registered}${e.capacity ? ` из ${e.capacity}` : ''}</span>
            ${canViewAdmin() ? `<button class="link-btn" data-ev-list="${e.id}">Список</button>` : ''}
            ${isAdmin() ? `<button class="link-btn" data-ev-edit="${e.id}">Изменить</button><button class="link-btn" data-ev-delete="${e.id}">Удалить</button>` : ''}
          </div>
        </div>
      </article>`;
  }

  function renderEvents() {
    const box = document.getElementById('ev-body');
    if (!box || !evs.data) return;
    const d = evs.data;
    box.innerHTML = `
      ${tgBanner(d.telegram, 'events')}
      ${d.upcoming.length ? `<div class="ev-list">${d.upcoming.map((e) => eventCard(e, false)).join('')}</div>`
        : `<div class="empty">Ближайших мероприятий пока нет.${isAdmin() ? ' Нажмите «+ Мероприятие».' : ' Мы сообщим, когда появятся новые.'}</div>`}
      ${d.past.length ? `<details class="ev-past"><summary>Прошедшие мероприятия (${d.past.length})</summary><div class="ev-list">${d.past.map((e) => eventCard(e, true)).join('')}</div></details>` : ''}`;
  }

  function openEventForm(e) {
    const isNew = !e;
    e = e || { id: 0, title: '', speaker: '', description: '', place: '', link: '', local: '', duration: 60, capacity: 0 };
    modal.innerHTML = `
      <form id="event-form" class="modal__body">
        <h2>${isNew ? 'Новое мероприятие' : 'Мероприятие'}</h2>
        <input type="hidden" name="id" value="${e.id}">
        <div class="field"><label for="ev-title">Тема</label><input id="ev-title" name="title" required maxlength="200" value="${esc(e.title)}"></div>
        <div class="field"><label for="ev-speaker">Спикер</label><input id="ev-speaker" name="speaker" maxlength="200" value="${esc(e.speaker)}" placeholder="например, врач Иванова Анна Сергеевна"></div>
        <div class="field-row">
          <div class="field"><label for="ev-local">Дата и время (Тирасполь)</label><input id="ev-local" name="local" type="datetime-local" required value="${esc(e.local)}"></div>
          <div class="field"><label for="ev-duration">Длительность, мин</label><input id="ev-duration" name="duration" type="number" min="0" max="600" value="${e.duration}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="ev-place">Место</label><input id="ev-place" name="place" maxlength="200" value="${esc(e.place)}" placeholder="адрес или «Онлайн, Zoom»"></div>
          <div class="field"><label for="ev-capacity">Мест (0 — без ограничений)</label><input id="ev-capacity" name="capacity" type="number" min="0" value="${e.capacity}"></div>
        </div>
        <div class="field"><label for="ev-link">Ссылка для подключения (видна только записавшимся)</label><input id="ev-link" name="link" maxlength="300" value="${esc(e.link === 'after' ? '' : e.link)}" placeholder="https://…"></div>
        <div class="field"><label for="ev-desc">Описание</label><textarea id="ev-desc" name="description" rows="3" maxlength="3000">${esc(e.description)}</textarea></div>
        <label class="check"><input type="checkbox" name="announce" ${isNew ? 'checked' : ''}> ${isNew ? 'Сообщить всем в Telegram' : 'Разослать всем в Telegram ещё раз (например, о переносе)'}</label>
        <div class="form-msg"></div>
        <div class="btn-row"><button class="btn btn--primary">Сохранить</button><button type="button" class="btn btn--ghost" data-close>Отмена</button></div>
      </form>`;
    modal.showModal();
  }

  async function openEventList(id) {
    const e = evs.data.upcoming.concat(evs.data.past).find((x) => x.id === id);
    modal.innerHTML = `<div class="modal__body"><h2>Записались</h2><p class="muted">${esc(e.title)} · ${evFull(e.startsAt)}</p><div id="ev-people"><p class="muted">Загружаем…</p></div>
      <div class="btn-row"><button type="button" class="btn btn--ghost" data-ev-csv="${id}" hidden>Скачать список</button><button type="button" class="btn btn--ghost" data-close>Закрыть</button></div></div>`;
    modal.showModal();
    try {
      const r = await call('event_regs&id=' + id);
      modal.peopleList = r.people;
      document.getElementById('ev-people').innerHTML = r.people.length
        ? `<ol class="ev-people">${r.people.map((p) => `<li><b>${esc(p.name)}</b> <small class="muted">${esc(p.branch || '')}${p.tg ? ' · Telegram ✓' : ''}</small></li>`).join('')}</ol>`
        : '<p class="muted">Пока никто не записался.</p>';
      if (r.people.length) modal.querySelector('[data-ev-csv]').hidden = false;
    } catch (err) { document.getElementById('ev-people').innerHTML = formError(err.message); }
  }

  async function connectTelegram() {
    try {
      const r = await call('tg_status');
      if (r.linked) { toast('Telegram уже подключён'); return; }
      if (!r.link) { toast('Бот пока не настроен администратором'); return; }
      window.open(r.link, '_blank', 'noopener');
      toast('Нажмите «Старт» в Telegram — и уведомления подключатся');
    } catch (e) { toast(e.message); }
  }

  async function renderTgPanel() {
    const box = document.getElementById('tg-panel');
    if (!box) return;
    try {
      const r = await call('tg_status');
      if (!r.bot) { box.remove(); return; }
      box.innerHTML = r.linked
        ? `<p class="small"><b>Telegram подключён ✓</b><br><span class="muted">Сюда приходят новые тесты, анонсы и напоминания о мероприятиях.</span></p>
           <button class="btn btn--ghost btn--sm btn--block" data-tg-unlink>Отключить</button>`
        : `<p class="small"><b>Уведомления в Telegram</b><br><span class="muted">Новые тесты, анонсы мероприятий и напоминания о записи.</span></p>
           <a class="btn btn--primary btn--sm btn--block" href="${esc(r.link)}" target="_blank" rel="noopener">Подключить Telegram</a>
           <p class="muted small">Откроется бот @${esc(r.bot)} — нажмите «Старт». Затем обновите эту страницу.</p>`;
    } catch (e) { box.remove(); }
  }

  /* ───────────── Учебные материалы (презентации PDF) ───────────── */
  let mats = { list: null, cat: 'all', q: '' };
  const matUrl = (m, dl) => `${API}?action=material_file&id=${m.id}${dl ? '&dl=1' : ''}`;
  const isPpt = (m) => m.type === 'pptx' || m.type === 'ppt';
  const matType = (m) => (isPpt(m) ? 'PPT' : 'PDF');
  // PDF открывается в браузере, PowerPoint — скачивается и открывается в программе
  const matOpen = (m) => (isPpt(m) ? `href="${matUrl(m, true)}"` : `href="${matUrl(m)}" target="_blank" rel="noopener"`);
  const fileSize = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;

  function viewMaterials() {
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Учебные материалы</div>
        <div class="section__head"><div><h1 style="margin:0">Учебные материалы</h1>
          <p>Презентации брендов и тренингов в исходном виде. PDF открывается прямо на сайте, PowerPoint — скачивается и открывается в PowerPoint или Google Презентациях.</p></div>
          ${isAdmin() ? '<button class="btn btn--primary btn--sm" data-mat-new>+ Загрузить презентацию</button>' : ''}</div>
        <input class="search" id="mat-q" type="search" placeholder="Поиск: бренд, тема, продукт…" value="${esc(mats.q)}" aria-label="Поиск материалов">
        <div class="filters" id="mat-cats" role="group" aria-label="Направления"></div>
        <div class="mat-grid" id="mat-grid"><p class="muted">Загружаем материалы…</p></div>
      </div>`;
  }

  async function loadMaterials() {
    try {
      mats.list = (await call('materials')).materials;
    } catch (e) {
      const g = document.getElementById('mat-grid');
      if (g) g.innerHTML = formError(e.message);
      return;
    }
    renderMaterials();
  }

  function renderMaterials() {
    const grid = document.getElementById('mat-grid');
    if (!grid || !mats.list) return;
    const used = Array.from(new Set(mats.list.map((m) => m.category).filter((k) => CATEGORIES[k])));
    if (mats.cat !== 'all' && !used.includes(mats.cat)) mats.cat = 'all';
    document.getElementById('mat-cats').innerHTML = used.length > 1 ? [['all', 'Все']].concat(used.map((k) => [k, CATEGORIES[k]]))
      .map(([k, v]) => `<button class="chip" data-mat-cat="${k}" aria-pressed="${mats.cat === k}">${esc(v)}</button>`).join('') : '';
    // Каждое слово запроса ищется по основе (без окончания): «выпадение» найдёт «выпадения»
    const words = mats.q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
    const list = mats.list.filter((m) => {
      if (mats.cat !== 'all' && m.category !== mats.cat) return false;
      const hay = (m.title + ' ' + m.brand + ' ' + m.description + ' ' + (CATEGORIES[m.category] || '')).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (!mats.list.length) {
      grid.innerHTML = `<div class="empty">Материалов пока нет.${isAdmin() ? ' Нажмите «+ Загрузить презентацию».' : ''}</div>`;
      return;
    }
    const fresh = Date.now() - 14 * 864e5;
    grid.innerHTML = list.length ? list.map((m) => {
      const c = m.course && findCourse(m.course);
      return `
        <article class="mat-card">
          <a class="mat-cover${isPpt(m) ? ' mat-cover--ppt' : ''}" ${matOpen(m)} aria-label="Открыть «${esc(m.title)}»">
            <span class="mat-cover__type">${matType(m)}</span><span class="mat-cover__brand">${esc(m.brand || CATEGORIES[m.category] || 'Вивафарм')}</span>
          </a>
          <div class="mat-body">
            <div class="meta">${m.category && CATEGORIES[m.category] ? `<span>${esc(CATEGORIES[m.category])}</span>` : ''}<span>${fileSize(m.size)}</span><span>${formatDate(m.added)}</span>${m.added > fresh ? '<span class="badge badge--done">новое</span>' : ''}</div>
            <h3>${esc(m.title)}</h3>
            ${m.description ? `<p class="muted small">${esc(m.description)}</p>` : ''}
            <div class="btn-row">
              ${isPpt(m) ? `<a class="btn btn--primary btn--sm" href="${matUrl(m, true)}" title="Откроется в PowerPoint; на телефоне — в приложении PowerPoint или Google Презентации">Скачать PowerPoint</a>`
                : `<a class="btn btn--primary btn--sm" href="${matUrl(m)}" target="_blank" rel="noopener">Открыть</a>
              <a class="btn btn--ghost btn--sm" href="${matUrl(m, true)}">Скачать</a>`}
              ${c ? `<a class="btn btn--ghost btn--sm" href="#/course/${c.id}">${isPassed(c) ? 'Курс пройден ✓' : 'Тест по теме'}</a>` : ''}
            </div>
            ${isAdmin() ? `<div class="mat-admin"><button class="link-btn" data-mat-edit="${m.id}">Изменить</button><button class="link-btn" data-mat-delete="${m.id}">Удалить</button></div>` : ''}
          </div>
        </article>`;
    }).join('') : '<div class="empty">Ничего не найдено. Попробуйте другой запрос.</div>';
  }

  function openMaterialForm(m) {
    const isNew = !m;
    m = m || { id: 0, title: '', brand: '', category: '', description: '', course: '' };
    modal.innerHTML = `
      <form id="material-form" class="modal__body">
        <h2>${isNew ? 'Новая презентация' : 'Материал'}</h2>
        <input type="hidden" name="id" value="${m.id}">
        ${isNew ? `<div class="field"><label for="mat-file">Файл PDF или PowerPoint</label><input id="mat-file" name="file" type="file" accept="application/pdf,.pdf,.pptx,.ppsx,.ppt,.pps,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" required>
          <p class="muted small">Файл загружается без изменений. PDF сотрудники откроют прямо на сайте, а PowerPoint (.pptx, .ppt) — скачают и откроют в программе. Для просмотра с телефона удобнее PDF: в PowerPoint «Файл → Сохранить как → PDF».</p></div>` : ''}
        <div class="field"><label for="mat-title">Название</label><input id="mat-title" name="title" required maxlength="200" value="${esc(m.title)}"></div>
        <div class="field-row">
          <div class="field"><label for="mat-brand">Бренд или автор</label><input id="mat-brand" name="brand" maxlength="120" value="${esc(m.brand)}" placeholder="например, Гельтек"></div>
          <div class="field"><label for="mat-cat">Направление</label><select id="mat-cat" name="category">
            <option value="">—</option>${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${m.category === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
        </div>
        <div class="field"><label for="mat-desc">Коротко о чём (1–2 предложения)</label><textarea id="mat-desc" name="description" rows="3" maxlength="2000">${esc(m.description)}</textarea></div>
        <div class="field"><label for="mat-course">Курс с тестом по этой теме (необязательно)</label><select id="mat-course" name="course">
          <option value="">—</option>${COURSES.map((c) => `<option value="${c.id}" ${m.course === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
        </select></div>
        ${isNew ? '<label class="check"><input type="checkbox" name="announce" checked> Сообщить всем в Telegram</label>' : ''}
        <div class="form-msg"></div>
        <p class="muted small" id="mat-progress" aria-live="polite"></p>
        <div class="btn-row"><button class="btn btn--primary">${isNew ? 'Загрузить' : 'Сохранить'}</button><button type="button" class="btn btn--ghost" data-close>Отмена</button></div>
      </form>`;
    modal.showModal();
    const file = modal.querySelector('#mat-file');
    if (file) {
      file.addEventListener('change', () => {
        const t = modal.querySelector('#mat-title');
        if (file.files[0] && !t.value) t.value = file.files[0].name.replace(/\.(pdf|pptx|ppsx|ppt|pps)$/i, '').replace(/\s*\(\d+\)$/, '').replace(/[_]+/g, ' ').trim();
      });
    }
  }

  // Файл уходит на сервер частями по 512 КБ: так не мешают ограничения хостинга на размер запроса
  async function uploadPdf(file, onProgress) {
    const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    const ext = (file.name.match(/\.([a-z]+)$/i) || ['', ''])[1].toLowerCase();
    const kind = head.startsWith('%PDF-') ? 'pdf' : head.startsWith('PK\x03\x04') ? 'pptx' : head === '\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1' ? 'ppt' : '';
    const want = { pdf: 'pdf', pptx: 'pptx', ppsx: 'pptx', potx: 'pptx', ppt: 'ppt', pps: 'ppt' }[ext];
    if (!kind || kind !== want) throw new Error('Можно загрузить PDF или презентацию PowerPoint (.pptx, .ppt). Этот файл не подходит.');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const size = 512 * 1024;
    for (let i = 0, off = 0; off < file.size; i++, off += size) {
      const buf = new Uint8Array(await file.slice(off, off + size).arrayBuffer());
      let bin = '';
      for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      await call('admin_material_chunk', { upload: token, index: i, offset: off, data: btoa(bin) });
      onProgress(Math.min(100, Math.round(((off + buf.length) / file.size) * 100)));
    }
    return token;
  }

  function viewCourses() {
    const chips = [['all', 'Все']].concat(Object.entries(CATEGORIES))
      .map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="${filter.cat === k}">${esc(v)}</button>`).join('');
    return `
      ${demoBanner()}
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Курсы</div>
        <h1>Каталог курсов</h1>
        <p class="muted">Каждый курс — уроки или конспект и итоговый тест. Сертификат выдаётся при результате от ${pct(passScore)}%.</p>
        <input class="search" type="search" placeholder="Поиск: антибиотики, SPF, варфарин…" value="${esc(filter.q)}" aria-label="Поиск курсов">
        <div class="filters" role="group" aria-label="Направления">${chips}</div>
        <div class="grid" id="course-grid" style="margin-bottom:48px"></div>
      </div>`;
  }

  function renderCourseGrid() {
    const grid = document.getElementById('course-grid');
    if (!grid) return;
    const q = filter.q.trim().toLowerCase();
    const list = COURSES.filter((c) => {
      if (filter.cat !== 'all' && c.category !== filter.cat) return false;
      if (!q) return true;
      const hay = (c.title + ' ' + c.short + ' ' + c.lessons.map((l) => l.title + ' ' + l.html).join(' ')).toLowerCase();
      return hay.includes(q);
    });
    grid.innerHTML = list.length ? list.map(courseCard).join('') : '<div class="empty">Ничего не найдено. Попробуйте другой запрос.</div>';
  }

  function viewCourse(c) {
    const p = courseProgress(c);
    const next = nextStepFor(c);
    const res = quizResult(c);
    const lessons = c.lessons.map((l, i) => `
      <li class="${isLessonDone(c, i) ? 'done' : ''}">
        <a href="#/lesson/${c.id}/${i + 1}">
          <span class="lesson-num">${isLessonDone(c, i) ? '✓' : i + 1}</span>
          <span class="t">${esc(l.title)}<br><small>${l.minutes} мин</small></span>
        </a>
      </li>`).join('');
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/courses">Курсы</a> / ${esc(c.title)}</div>
        <div class="course-head">
          <div>
            <div class="card__icon" aria-hidden="true">${c.icon}</div>
            <h1>${esc(c.title)}</h1>
            <p class="muted">${esc(c.short)}</p>
            <div class="meta"><span>${esc(CATEGORIES[c.category])}</span><span>Уровень: ${esc(c.level)}</span><span>≈ ${courseMinutes(c)} мин</span></div>
          </div>
          <aside>
            <b>Ваш прогресс: ${p}%</b>
            <div style="margin-top:10px">${progressBar(p)}</div>
            ${res ? `<p class="muted" style="margin:12px 0 0">Лучший результат теста: ${pct(res.best)}%</p>` : ''}
            ${legacyRes(c) ? `<p class="muted" style="margin:12px 0 0">Тест сдан до запуска Академии: ${Math.round(legacyRes(c).score)}%${legacyRes(c).date ? `, ${formatDate(legacyRes(c).date)}` : ''}</p>` : ''}
            <a class="btn btn--primary" href="${next.href}">${next.label}</a>
          </aside>
        </div>
        <h2>Программа курса</h2>
        <ol class="lesson-list">
          ${lessons}
          <li class="quiz-link ${isPassed(c) ? 'done' : ''}">
            <a href="#/quiz/${c.id}">
              <span class="lesson-num">${isPassed(c) ? '✓' : '?'}</span>
              <span class="t">Итоговый тест<br><small>${c.quiz.length} ${plural(c.quiz.length, 'вопрос', 'вопроса', 'вопросов')} · проходной балл ${pct(passScore)}%</small></span>
            </a>
          </li>
        </ol>
      </div>`;
  }

  function viewLesson(c, n) {
    const i = n - 1;
    const l = c.lessons[i];
    if (!l) return viewNotFound();
    const isLast = i === c.lessons.length - 1;
    const nextHref = isLast ? `#/quiz/${c.id}` : `#/lesson/${c.id}/${n + 1}`;
    return `
      <div class="wrap narrow">
        <div class="crumbs"><a href="#/courses">Курсы</a> / <a href="#/course/${c.id}">${esc(c.title)}</a> / Урок ${n}</div>
        <article class="lesson">
          <p class="muted" style="margin-bottom:6px">Урок ${n} из ${c.lessons.length} · ${l.minutes} мин</p>
          <h1>${esc(l.title)}</h1>
          ${l.html}
          <div class="takeaways">
            <h3>Ключевые выводы</h3>
            <ul>${l.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>
        </article>
        <div class="lesson-nav">
          ${i > 0 ? `<a class="btn btn--ghost" href="#/lesson/${c.id}/${n - 1}">← Предыдущий</a>` : `<a class="btn btn--ghost" href="#/course/${c.id}">← К курсу</a>`}
          <button class="btn btn--primary" data-complete="${c.id}:${i}" data-next="${nextHref}">${isLast ? 'Завершить и перейти к тесту' : 'Урок изучен, дальше →'}</button>
        </div>
      </div>`;
  }

  /* Тест: порядок вариантов перемешивается, ответы хранятся как исходные индексы */
  let quiz = null;

  function startQuiz(c) {
    quiz = {
      id: c.id, i: 0, correct: 0, answered: false, answers: [], result: null,
      order: c.quiz.map((q) => shuffle(q.options.map((_, k) => k)))
    };
  }

  function quizCrumbs(c) {
    return `<div class="crumbs"><a href="#/courses">Курсы</a> / <a href="#/course/${c.id}">${esc(c.title)}</a> / Тест</div>`;
  }

  function viewQuiz(c) {
    if (!quiz || quiz.id !== c.id) startQuiz(c);
    const total = c.quiz.length;

    if (quiz.i >= total) {
      if (!quiz.result) return `<div class="wrap narrow">${quizCrumbs(c)}<div class="quiz result"><p class="muted">Сохраняем результат…</p></div></div>`;
      const r = quiz.result;
      return `
        <div class="wrap narrow">
          ${quizCrumbs(c)}
          <div class="quiz result ${r.passed ? 'pass' : ''}">
            <div class="result__score">${Math.round((r.correct / r.total) * 100)}%</div>
            <h2>${r.passed ? 'Тест пройден!' : 'Почти получилось'}</h2>
            <p class="muted">Правильных ответов: ${r.correct} из ${r.total}. ${r.passed ? 'Сертификат готов.' : `Для сертификата нужно от ${pct(passScore)}%. Повторите уроки и попробуйте ещё раз.`}</p>
            <div class="btn-row" style="justify-content:center">
              ${r.passed ? `<a class="btn btn--primary" href="#/certificate/${c.id}">Получить сертификат</a>` : `<button class="btn btn--primary" data-retry="${c.id}">Пройти заново</button>`}
              <a class="btn btn--ghost" href="#/course/${c.id}">К курсу</a>
            </div>
          </div>
        </div>`;
    }

    const q = c.quiz[quiz.i];
    return `
      <div class="wrap narrow">
        ${quizCrumbs(c)}
        <div class="quiz">
          <div class="quiz__top"><span>Вопрос ${quiz.i + 1} из ${total}</span><span>Верно: ${quiz.correct}</span></div>
          ${progressBar(Math.round((quiz.i / total) * 100))}
          <h2>${esc(q.q)}</h2>
          <div class="options" role="group" aria-label="Варианты ответа">
            ${quiz.order[quiz.i].map((k) => `<button class="option" data-answer="${k}">${esc(q.options[k])}</button>`).join('')}
          </div>
          <div id="explain" aria-live="polite"></div>
        </div>
      </div>`;
  }

  function answer(c, k) {
    if (quiz.answered) return;
    quiz.answered = true;
    quiz.answers[quiz.i] = k;
    const q = c.quiz[quiz.i];
    const ok = k === q.correct;
    if (ok) quiz.correct++;
    document.querySelectorAll('.option').forEach((b) => {
      const idx = Number(b.dataset.answer);
      b.disabled = true;
      if (idx === q.correct) b.classList.add('correct');
      else if (idx === k) b.classList.add('wrong');
    });
    const last = quiz.i === c.quiz.length - 1;
    document.getElementById('explain').innerHTML = `
      <div class="explain"><b>${ok ? '✓ Верно.' : '✗ Неверно.'}</b> ${esc(q.explain)}</div>
      <button class="btn btn--primary" data-qnext>${last ? 'Показать результат' : 'Следующий вопрос →'}</button>`;
    document.querySelector('[data-qnext]').focus();
  }

  async function finishQuiz(c) {
    app.innerHTML = viewQuiz(c);
    try {
      quiz.result = await submitQuiz(c, quiz.answers);
    } catch (e) {
      toast(e.message);
      quiz.result = { correct: quiz.correct, total: c.quiz.length, passed: false };
    }
    app.innerHTML = viewQuiz(c);
  }

  /* ───────────── Личный кабинет ───────────── */
  function viewProfile() {
    const total = COURSES.length;
    const passed = COURSES.filter(isPassed);
    const extDone = COURSES.filter((c) => !isQuizPassed(c) && legacyRes(c)).length;
    const overall = overallProgress();
    const r = 60, circ = 2 * Math.PI * r;
    const rows = COURSES.map((c) => {
      const next = nextStepFor(c);
      return `
        <li>
          <span class="card__icon" aria-hidden="true">${c.icon}</span>
          <div class="grow"><b>${esc(c.title)}</b>${progressBar(courseProgress(c))}</div>
          <a class="btn btn--sm ${isPassed(c) ? 'btn--primary' : 'btn--ghost'}" href="${next.href}">${isPassed(c) ? 'Сертификат' : next.label}</a>
        </li>`;
    }).join('');
    const serverFields = mode === 'server' ? `
              <div class="field"><label for="p-branch">Аптека / филиал</label><input id="p-branch" name="branch" maxlength="120" value="${esc(user.branch)}"></div>
              <div class="field"><label for="p-position">Должность</label><input id="p-position" name="position" maxlength="120" value="${esc(user.position)}"></div>` : '';
    const accountPanel = mode === 'server' ? `
            <details class="panel-details">
              <summary>Сменить пароль</summary>
              <form id="password-form">
                <div class="field"><label for="old">Текущий пароль</label><input id="old" name="old" type="password" autocomplete="current-password" required></div>
                <div class="field"><label for="new">Новый пароль (от 8 символов)</label><input id="new" name="new" type="password" autocomplete="new-password" minlength="8" required></div>
                <div class="form-msg"></div>
                <button class="btn btn--ghost btn--block">Сменить пароль</button>
              </form>
            </details>
            <p class="muted small">Логин: <b>${esc(user.login)}</b></p>
            <div class="tg-panel" id="tg-panel"></div>`
      : '<button class="btn btn--ghost btn--sm btn--block" id="reset" style="margin-top:12px">Сбросить прогресс</button>';
    return `
      ${demoBanner()}
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Личный кабинет</div>
        <h1>Личный кабинет</h1>
        <div class="profile-grid">
          <div class="panel">
            <svg class="ring" viewBox="0 0 140 140" role="img" aria-label="Общий прогресс ${overall}%">
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round"
                stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - overall / 100)}" transform="rotate(-90 70 70)"/>
              <text x="70" y="78" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)" font-family="Onest, sans-serif">${overall}%</text>
            </svg>
            <p style="text-align:center" class="muted">Сертификатов: <b>${passed.length}</b> из ${total}</p>
            ${extDone ? `<p style="text-align:center" class="muted small">из них ${extDone} — по тестам, сданным до запуска Академии</p>` : ''}
            <form id="name-form">
              <div class="field">
                <label for="name">Имя и фамилия для сертификата</label>
                <input id="name" name="name" maxlength="80" autocomplete="name" value="${esc(user.name)}" placeholder="Например, Анна Иванова" required>
              </div>
              ${serverFields}
              <div class="form-msg"></div>
              <button class="btn btn--primary btn--block">Сохранить</button>
            </form>
            ${accountPanel}
          </div>
          <div class="panel">
            <h3>Курсы</h3>
            <ul class="row-list">${rows}</ul>
            ${externalHtml(state.external || [])}
          </div>
        </div>
      </div>`;
  }

  // Тесты, пройденные на прежнем сайте тестирования до запуска Академии
  function externalHtml(list) {
    if (!list.length) return '';
    const passed = list.filter((r) => r.passed).length;
    return `
      <h3 class="ext-title">Тесты, пройденные до запуска Академии</h3>
      <p class="muted small">Сдано ${passed} из ${list.length}. Результаты перенесены с прежнего сайта тестирования.</p>
      <ul class="row-list ext-list">${list.map((r) => `
        <li>
          <div class="grow"><b>${esc(r.test)}</b>
            <small class="muted">${r.date ? formatDate(r.date) : ''}${r.attempts > 1 ? ` · попыток: ${r.attempts}` : ''}${r.certNo ? ` · сертификат № ${esc(r.certNo)}` : ''}</small></div>
          <span class="badge ${r.passed ? 'badge--done' : 'badge--warn'}">${r.passed ? 'сдан' : 'не сдан'} · ${Math.round(r.score)}%${r.total ? ` (${r.correct} из ${r.total})` : ''}</span>
          ${r.passed ? `<a class="btn btn--sm btn--primary" href="#/xcert/${encodeURIComponent(r.test)}">Сертификат</a>` : ''}
        </li>`).join('')}
      </ul>`;
  }

  function viewCertificate(c) {
    const res = quizResult(c);
    if (!isQuizPassed(c) && legacyRes(c)) return viewExtCertificate(c.legacy);
    if (!isPassed(c)) {
      return `
        <div class="wrap narrow">
          <div class="crumbs"><a href="#/course/${c.id}">${esc(c.title)}</a> / Сертификат</div>
          <div class="quiz result"><h2>Сертификат пока недоступен</h2>
          <p class="muted">Пройдите итоговый тест с результатом от ${pct(passScore)}%.</p>
          <a class="btn btn--primary" href="#/quiz/${c.id}">Пройти тест</a></div>
        </div>`;
    }
    const nameBlock = user.name
      ? `<div class="name">${esc(user.name)}</div>`
      : `<form id="name-form" class="no-print" style="max-width:360px;margin:16px auto">
           <div class="field"><label for="name">Введите имя и фамилию</label><input id="name" name="name" maxlength="80" autocomplete="name" required></div>
           <div class="form-msg"></div>
           <button class="btn btn--primary">Показать на сертификате</button>
         </form>`;
    const verifyUrl = `${location.origin}${location.pathname}#/verify/${encodeURIComponent(res.certId)}`;
    return `
      <div class="wrap cert-wrap">
        <div class="crumbs no-print"><a href="#/profile">Личный кабинет</a> / Сертификат</div>
        <div class="cert">
          <div class="logo" style="justify-content:center"><img class="logo__img" src="img/logo-vivafarm.svg" alt="Вивафарм" width="125" height="54"><span class="logo__divider" aria-hidden="true"></span><span class="logo__text">ВИВА<b>АКАДЕМИЯ</b></span></div>
          <h1>Сертификат</h1>
          <p>подтверждает, что</p>
          ${nameBlock}
          <p>успешно завершил(а) курс</p>
          <div class="course">«${esc(c.title)}»</div>
          <p>Результат итогового теста: <b>${pct(res.best)}%</b> · Объём: ${courseMinutes(c)} мин</p>
          <div class="cert__foot"><span>Дата: ${formatDate(res.passedAt)}</span><span>№ ${esc(res.certId)}</span></div>
          ${mode === 'server' ? `<p class="cert__verify">Проверить подлинность: ${esc(verifyUrl)}</p>` : ''}
        </div>
        <div class="btn-row no-print" style="justify-content:center">
          <button class="btn btn--primary" data-print>Печать / Сохранить в PDF</button>
          <a class="btn btn--ghost" href="#/courses">Другие курсы</a>
        </div>
      </div>`;
  }

  // Сертификат по тесту, сданному на прежнем сайте тестирования
  function viewExtCertificate(test) {
    const r = (state.external || []).find((x) => x.test === test && x.passed);
    if (!r) {
      return `
        <div class="wrap narrow">
          <div class="crumbs"><a href="#/profile">Личный кабинет</a> / Сертификат</div>
          <div class="quiz result"><h2>Сертификат не найден</h2>
          <p class="muted">Этот тест не отмечен как сданный в вашем кабинете.</p>
          <a class="btn btn--primary" href="#/profile">В личный кабинет</a></div>
        </div>`;
    }
    const nameBlock = user.name
      ? `<div class="name">${esc(user.name)}</div>`
      : `<form id="name-form" class="no-print" style="max-width:360px;margin:16px auto">
           <div class="field"><label for="name">Введите имя и фамилию</label><input id="name" name="name" maxlength="80" autocomplete="name" required></div>
           <div class="form-msg"></div>
           <button class="btn btn--primary">Показать на сертификате</button>
         </form>`;
    const verifyUrl = r.certNo ? `${location.origin}${location.pathname}#/verify/${encodeURIComponent(r.certNo)}` : '';
    return `
      <div class="wrap cert-wrap">
        <div class="crumbs no-print"><a href="#/profile">Личный кабинет</a> / Сертификат</div>
        <div class="cert">
          <div class="logo" style="justify-content:center"><img class="logo__img" src="img/logo-vivafarm.svg" alt="Вивафарм" width="125" height="54"><span class="logo__divider" aria-hidden="true"></span><span class="logo__text">ВИВА<b>АКАДЕМИЯ</b></span></div>
          <h1>Сертификат</h1>
          <p>подтверждает, что</p>
          ${nameBlock}
          <p>успешно прошёл(а) тестирование</p>
          <div class="course">«${esc(r.test)}»</div>
          <p>Результат: <b>${Math.round(r.score)}%</b>${r.total ? ` · верных ответов: ${r.correct} из ${r.total}` : ''}</p>
          <div class="cert__foot"><span>Дата: ${r.date ? formatDate(r.date) : '—'}</span>${r.certNo ? `<span>№ ${esc(r.certNo)}</span>` : ''}</div>
          ${verifyUrl && mode === 'server' ? `<p class="cert__verify">Проверить подлинность: ${esc(verifyUrl)}</p>` : ''}
        </div>
        <div class="btn-row no-print" style="justify-content:center">
          <button class="btn btn--primary" data-print>Печать / Сохранить в PDF</button>
          <a class="btn btn--ghost" href="#/profile">Личный кабинет</a>
        </div>
      </div>`;
  }

  function viewVerify(id) {
    return `<div class="wrap narrow"><div class="quiz result" id="verify" style="margin-top:32px"><p class="muted">Проверяем сертификат № ${esc(id)}…</p></div></div>`;
  }

  async function loadVerify(id) {
    const box = document.getElementById('verify');
    if (mode !== 'server') {
      box.innerHTML = '<h2>Проверка недоступна</h2><p class="muted">Сервер личных кабинетов не подключён.</p>';
      return;
    }
    try {
      const r = await call('cert&id=' + encodeURIComponent(id));
      box.innerHTML = `<div class="result__score" style="font-size:2.4rem">✓</div><h2>Сертификат действителен</h2>
        <p><b>${esc(r.name)}</b><br>«${esc(r.course)}»<br>Дата: ${formatDate(r.passedAt)} · Результат: ${pct(r.score)}%</p>
        <p class="muted">№ ${esc(id)}</p>`;
    } catch (e) {
      box.innerHTML = `<h2>Сертификат не найден</h2><p class="muted">Номер ${esc(id)} не зарегистрирован на платформе.</p>`;
    }
  }

  function viewNotFound() {
    return `<div class="wrap narrow"><div class="quiz result" style="margin-top:32px"><h2>Страница не найдена</h2><a class="btn btn--primary" href="#/">На главную</a></div></div>`;
  }

  /* ───────────── Кабинет руководителя ───────────── */
  let admin = { users: [], inviteCode: '', q: '', branch: '', status: 'all', open: null };

  function userStats(u) {
    let sum = 0, certs = 0, ext = 0;
    COURSES.forEach((c) => {
      const quizOk = !!(u.quiz[c.id] && u.quiz[c.id].passed);
      if (!quizOk && legacyResult(c, u.external)) {
        sum += 1; certs++; ext++;
        return;
      }
      sum += ((u.lessons[c.id] || 0) + (quizOk ? 1 : 0)) / (c.lessons.length + 1);
      if (quizOk) certs++;
    });
    return { progress: Math.round((sum / COURSES.length) * 100), certs, ext };
  }

  function viewAdmin() {
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Кабинет руководителя</div>
        <div class="section__head"><h1 style="margin:0">Кабинет руководителя</h1>
          <div class="btn-row">${isAdmin() ? `
            <button class="btn btn--primary btn--sm" data-admin="new">+ Сотрудник</button>
            <button class="btn btn--ghost btn--sm" data-admin="import">Импорт списка</button>
            <button class="btn btn--ghost btn--sm" data-admin="sheets">Логины по аптекам</button>
            <button class="btn btn--ghost btn--sm" data-admin="results">Импорт результатов</button>` : ''}
            <a class="btn btn--ghost btn--sm" href="${API}?action=admin_export">Выгрузить в Excel</a>
          </div>
        </div>
        ${isAdmin() ? '' : '<p class="muted small">Режим просмотра: вы видите результаты всех сотрудников и можете выгрузить их в Excel. Изменения вносит администратор.</p>'}
        <div id="admin-body"><p class="muted">Загружаем данные…</p></div>
      </div>`;
  }

  async function loadAdmin() {
    try {
      const r = await call('admin_users');
      admin.users = r.users;
      admin.inviteCode = r.inviteCode;
      admin.telegram = r.telegram;
      admin.top = null;
      renderAdmin();
      call('events').then((d) => {
        evs.data = d;
        const box = document.getElementById('admin-events');
        if (box) { box.innerHTML = adminEventsHtml(); box.hidden = false; }
      }).catch(() => {});
      call('top').then((t) => {
        admin.top = t;
        const box = document.getElementById('admin-top');
        if (box) box.innerHTML = topHtml(t, true);
      }).catch(() => {});
    } catch (e) {
      const body = document.getElementById('admin-body');
      if (body) body.innerHTML = formError(e.message);
    }
  }

  function renderAdmin() {
    const body = document.getElementById('admin-body');
    if (!body) return;
    const staff = admin.users.filter((u) => u.role === 'user');
    const withStats = staff.map((u) => Object.assign({}, u, userStats(u)));
    const weekAgo = Date.now() - 7 * 864e5;
    const activeWeek = staff.filter((u) => u.lastLogin && new Date(u.lastLogin.replace(' ', 'T') + 'Z') > weekAgo).length;
    const certs = withStats.reduce((s, u) => s + u.certs, 0);
    const avg = withStats.length ? Math.round(withStats.reduce((s, u) => s + u.progress, 0) / withStats.length) : 0;
    const branches = Array.from(new Set(staff.map((u) => u.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));

    const q = admin.q.trim().toLowerCase();
    const list = admin.users
      .map((u) => Object.assign({}, u, userStats(u)))
      .filter((u) => (!admin.branch || u.branch === admin.branch)
        && (!q || (u.name + ' ' + u.login + ' ' + u.position).toLowerCase().includes(q))
        && (admin.status === 'all'
          || (admin.status === 'notstarted' && u.progress === 0)
          || (admin.status === 'progress' && u.progress > 0 && u.progress < 100)
          || (admin.status === 'done' && u.progress === 100)
          || (admin.status === 'blocked' && !u.active)));

    const byBranch = branches.map((b) => {
      const us = withStats.filter((u) => u.branch === b);
      return { b, n: us.length, avg: Math.round(us.reduce((s, u) => s + u.progress, 0) / us.length) };
    }).sort((x, y) => y.avg - x.avg);

    const rows = list.map((u) => `
      <tr class="${u.active ? '' : 'is-blocked'}">
        <td><button class="link-btn" data-user-open="${u.id}" aria-expanded="${admin.open === u.id}"><b>${esc(u.name)}</b></button><small>${esc(u.login)}${ROLE_LABEL[u.role] || ''}${u.active ? '' : ' · заблокирован'}</small></td>
        <td>${esc(u.branch) || '—'}<small>${esc(u.position)}</small></td>
        <td class="t-progress"><span>${u.progress}%</span>${progressBar(u.progress)}</td>
        <td class="t-num">${u.certs} / ${COURSES.length}${u.ext ? `<small>в т. ч. до запуска Академии: ${u.ext}</small>` : ''}</td>
        <td class="t-num">${formatDateTime(u.lastLogin)}</td>
        <td class="t-actions">${isAdmin() ? `<button class="btn btn--ghost btn--sm" data-user-edit="${u.id}">Изменить</button>` : ''}</td>
      </tr>
      ${admin.open === u.id ? `<tr class="detail-row"><td colspan="6">${userDetail(u)}</td></tr>` : ''}`).join('');

    body.innerHTML = `
      ${isAdmin() && !(admin.telegram && admin.telegram.bot) ? tgAdminPanel(staff, true) : ''}
      <div class="panel admin-events" id="admin-events"${evs.data ? '' : ' hidden'}>${evs.data ? adminEventsHtml() : ''}</div>
      <div class="stats">
        <div class="stat"><b>${staff.length}</b><span>сотрудников</span></div>
        <div class="stat"><b>${activeWeek}</b><span>заходили за 7 дней</span></div>
        <div class="stat"><b>${avg}%</b><span>средний прогресс</span></div>
        <div class="stat"><b>${certs}</b><span>сертификатов выдано</span></div>
      </div>
      <div class="admin-grid">
        <div class="panel">
          <div class="toolbar">
            <input class="search" id="admin-q" type="search" placeholder="Поиск по ФИО, логину, должности" value="${esc(admin.q)}" aria-label="Поиск сотрудников">
            <select id="admin-branch" aria-label="Аптека">
              <option value="">Все аптеки</option>
              ${branches.map((b) => `<option ${b === admin.branch ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            </select>
            <select id="admin-status" aria-label="Статус">
              ${[['all', 'Все статусы'], ['notstarted', 'Не начинали'], ['progress', 'В процессе'], ['done', 'Прошли всё'], ['blocked', 'Заблокированы']]
                .map(([v, t]) => `<option value="${v}" ${admin.status === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <p class="muted small">Показано: ${list.length} из ${admin.users.length}</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Сотрудник</th><th>Аптека / должность</th><th>Прогресс</th><th>Сертификаты</th><th>Вход</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" class="muted">Никого не найдено. Добавьте сотрудников кнопкой «+ Сотрудник» или «Импорт списка».</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="admin-side">
          <div class="panel" id="admin-top">${admin.top ? topHtml(admin.top, true) : '<p class="muted small">Загружаем рейтинг…</p>'}</div>
          <div class="panel">
            <h3>Прогресс по аптекам</h3>
            ${byBranch.length ? `<ul class="branch-list">${byBranch.map((x) => `
              <li><button class="link-btn" data-branch="${esc(x.b)}">${esc(x.b)}</button><small>${x.n} ${plural(x.n, 'сотрудник', 'сотрудника', 'сотрудников')} · ${x.avg}%</small>${progressBar(x.avg)}</li>`).join('')}</ul>`
              : '<p class="muted small">Укажите сотрудникам аптеку — здесь появится сводка.</p>'}
          </div>
          ${isAdmin() && admin.telegram && admin.telegram.bot ? tgAdminPanel(staff) : ''}
          ${isAdmin() ? `<div class="panel">
            <h3>Самостоятельная регистрация</h3>
            <form id="invite-form">
              <div class="field"><label for="invite">Код приглашения</label><input id="invite" name="inviteCode" maxlength="60" value="${esc(admin.inviteCode)}" placeholder="Пусто — регистрация выключена"></div>
              <div class="form-msg"></div>
              <button class="btn btn--ghost btn--sm btn--block">Сохранить</button>
            </form>
            <p class="muted small">Сотрудник открывает «${esc(location.origin + location.pathname)}#/register» и вводит этот код.</p>
          </div>` : ''}
        </div>
      </div>`;
  }

  // Сводка записей на ближайшие мероприятия
  function adminEventsHtml() {
    const list = evs.data.upcoming.filter((e) => e.startsAt > Date.now() - 3 * 3600e3);
    return `<h3>Записи на мероприятия</h3>
      ${list.length ? `<ul class="admin-ev-list">${list.map((e) => `
        <li><div class="grow"><b>${esc(e.title)}</b><small>${evFull(e.startsAt)}</small></div>
          <span class="admin-ev-count"><b>${e.registered}</b>${e.capacity ? ` из ${e.capacity}` : ''} <small>${plural(e.registered, 'записался', 'записались', 'записались')}</small></span>
          <button class="btn btn--ghost btn--sm" data-ev-list="${e.id}">Список</button></li>`).join('')}</ul>`
        : '<p class="muted small">Ближайших мероприятий нет.</p>'}
      <p class="small" style="margin:12px 0 0"><a href="#/events">Вся афиша →</a></p>`;
  }

  // Настройка Telegram-бота. Пока бот не подключён — заметный блок над сводкой, потом — компактная панель сбоку.
  function tgAdminPanel(staff, top) {
    const t = admin.telegram || {};
    return `<div class="panel${top ? ' tg-setup' : ''}">
            <h3>${top ? '✈️ Подключите Telegram-бота' : 'Telegram-бот'}</h3>
            ${t.bot
              ? `<p class="small">Подключён: <b>@${esc(t.bot)}</b><br><span class="muted">Сотрудников с уведомлениями: ${t.linked} из ${staff.length}</span></p>`
              : '<p class="muted small">Бот присылает сотрудникам новые тесты, анонсы мероприятий и напоминания о записи. В Telegram откройте @BotFather, отправьте /newbot, придумайте имя и адрес бота (должен заканчиваться на bot) — BotFather пришлёт токен. Вставьте его сюда.</p>'}
            <form id="tg-form">
              <div class="field"><label for="tg-token">${t.bot ? 'Новый токен (если меняете бота)' : 'Токен бота'}</label><input id="tg-token" name="token" autocomplete="off" placeholder="123456789:AA…"></div>
              <div class="form-msg"></div>
              <button class="btn ${t.bot ? 'btn--ghost' : 'btn--primary'} btn--sm${top ? '' : ' btn--block'}">${t.bot ? 'Заменить бота' : 'Подключить бота'}</button>
            </form>
          </div>`;
  }

  function userDetail(u) {
    return `<ul class="detail-list">${COURSES.map((c) => {
      const lessons = u.lessons[c.id] || 0;
      const qr = u.quiz[c.id];
      const old = !(qr && qr.passed) && legacyResult(c, u.external);
      const status = old ? `<span class="badge badge--done">сдан до запуска · ${Math.round(old.score)}%</span>`
        : qr && qr.passed
        ? `<span class="badge badge--done">сдан · ${pct(qr.best)}%</span>`
        : qr ? `<span class="badge badge--warn">не сдан · ${pct(qr.best)}% · попыток: ${qr.attempts}</span>`
        : `<span class="badge">уроков ${lessons} из ${c.lessons.length}</span>`;
      return `<li><span>${c.icon} ${esc(c.title)}</span>${status}</li>`;
    }).join('')}</ul>${(u.external || []).length ? `
      <p class="small muted ext-admin-title">Тесты до запуска Академии</p>
      <ul class="detail-list">${u.external.map((r) => `<li><span>${esc(r.test)}</span><span class="badge ${r.passed ? 'badge--done' : 'badge--warn'}">${r.passed ? 'сдан' : 'не сдан'} · ${Math.round(r.score)}%${r.attempts > 1 ? ` · попыток: ${r.attempts}` : ''}</span></li>`).join('')}</ul>` : ''}`;
  }

  function openUserForm(u) {
    const isNew = !u;
    u = u || { id: 0, name: '', login: '', branch: '', position: '', role: 'user', active: true };
    const branches = Array.from(new Set(admin.users.map((x) => x.branch).filter(Boolean)));
    modal.innerHTML = `
      <form id="user-form" class="modal__body">
        <h2>${isNew ? 'Новый сотрудник' : 'Сотрудник'}</h2>
        <input type="hidden" name="id" value="${u.id}">
        <div class="field"><label for="u-name">Имя и фамилия</label><input id="u-name" name="name" required maxlength="120" value="${esc(u.name)}"></div>
        <div class="field"><label for="u-login">Логин</label><input id="u-login" name="login" required maxlength="120" value="${esc(u.login)}" placeholder="например, ivanova.a или телефон"></div>
        <div class="field-row">
          <div class="field"><label for="u-branch">Аптека / филиал</label><input id="u-branch" name="branch" maxlength="120" list="branch-options" value="${esc(u.branch)}"></div>
          <div class="field"><label for="u-position">Должность</label><input id="u-position" name="position" maxlength="120" value="${esc(u.position)}"></div>
        </div>
        <datalist id="branch-options">${branches.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
        <div class="field"><label for="u-password">${isNew ? 'Пароль (от 8 символов)' : 'Новый пароль (оставьте пустым, чтобы не менять)'}</label>
          <div class="input-with-btn"><input id="u-password" name="password" type="text" autocomplete="off" ${isNew ? 'required minlength="8"' : ''}><button type="button" class="btn btn--ghost btn--sm" data-genpass>Сгенерировать</button></div></div>
        <div class="field-row">
          <div class="field"><label for="u-role">Роль</label><select id="u-role" name="role">
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Сотрудник</option>
            <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Руководитель — только просмотр результатов</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Администратор — полный доступ</option>
          </select></div>
          <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Доступ разрешён</label>
        </div>
        <div class="form-msg"></div>
        <div class="btn-row">
          <button class="btn btn--primary">Сохранить</button>
          <button type="button" class="btn btn--ghost" data-close>Отмена</button>
        </div>
        ${isNew ? '' : `<div class="danger-zone">
          <button type="button" class="btn btn--ghost btn--sm" data-user-reset="${u.id}">Сбросить прогресс</button>
          <button type="button" class="btn btn--danger btn--sm" data-user-delete="${u.id}">Удалить</button>
        </div>`}
      </form>`;
    modal.showModal();
    modal.querySelector('input[name="name"]').focus();
  }

  function genPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(10);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => chars[n % chars.length]).join('');
  }

  function openImport() {
    modal.innerHTML = `
      <form id="import-form" class="modal__body">
        <h2>Импорт сотрудников</h2>
        <p class="muted small">Вставьте список из Excel или загрузите файл CSV. Колонки по порядку: <b>ФИО; логин; аптека; должность; пароль</b>. Пароль можно не указывать — он будет создан автоматически.</p>
        <div class="field"><label for="imp-file">Файл CSV</label><input id="imp-file" type="file" accept=".csv,.txt,text/csv"></div>
        <div class="field"><label for="imp-text">или вставьте строки</label>
          <textarea id="imp-text" name="text" rows="8" placeholder="Иванова Анна;ivanova.a;Аптека №1;Фармацевт&#10;Петров Игорь;petrov.i;Аптека №2;Провизор"></textarea></div>
        <div class="form-msg"></div>
        <div class="btn-row">
          <button class="btn btn--primary">Импортировать</button>
          <button type="button" class="btn btn--ghost" data-close>Отмена</button>
        </div>
      </form>`;
    modal.showModal();
  }

  function parseRows(text) {
    return text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.replace(/^\uFEFF/, '').trim()).filter(Boolean)
      .map((line) => line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map((s) => s.trim().replace(/^"|"$/g, '')))
      .filter((cols) => !/^(фио|ф\.и\.о\.|имя|name|фамилия.*)$/i.test(cols[0]))
      .map(([name, login, branch, position, password]) => ({ name, login, branch, position, password }));
  }

  function showImportResult(r) {
    const rows = r.created.map((u) => `<li><b>${esc(u.name)}</b> — логин <code>${esc(u.login)}</code>, пароль <code>${esc(u.password)}</code></li>`).join('');
    const skipped = r.skipped.map((s) => `<li>${esc(s.login || '(пусто)')} — ${esc(s.reason)}</li>`).join('');
    modal.innerHTML = `
      <div class="modal__body">
        <h2>Импорт завершён</h2>
        <p>Добавлено: <b>${r.created.length}</b>${r.skipped.length ? `, пропущено: <b>${r.skipped.length}</b>` : ''}.</p>
        ${r.created.length ? `<p class="note">Сохраните логины и пароли сейчас — после закрытия окна пароли больше не будут показаны.</p><ul class="cred-list">${rows}</ul>` : ''}
        ${skipped ? `<details><summary>Пропущенные строки</summary><ul>${skipped}</ul></details>` : ''}
        <div class="btn-row" style="margin-top:16px">
          ${r.created.length ? '<button class="btn btn--primary" data-cred-download>Скачать логины и пароли</button><button class="btn btn--ghost" data-cred-print>Печать по аптекам</button>' : ''}
          <button class="btn btn--ghost" data-close>Закрыть</button>
        </div>
      </div>`;
    modal.lastImport = r.created;
  }

  /* Импорт результатов тестов со старого сайта тестирования */
  function openResultsImport() {
    modal.innerHTML = `
      <form id="results-form" class="modal__body">
        <h2>Импорт результатов тестов</h2>
        <p class="muted small">Файл с результатами тестов, пройденных до запуска Академии. Колонки: <b>логин; тест; результат; верных; всего; статус; дата; попыток; сертификат</b>. Сотрудники находятся по логину. Повторный импорт ничего не дублирует, более высокий балл заменяет прежний.</p>
        <div class="field"><label for="res-file">Файл CSV</label><input id="res-file" type="file" accept=".csv,.txt,text/csv" required></div>
        <div class="form-msg"></div>
        <div class="btn-row"><button class="btn btn--primary">Импортировать</button><button type="button" class="btn btn--ghost" data-close>Отмена</button></div>
      </form>`;
    modal.showModal();
  }

  function parseResults(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    const head = (lines.shift() || '').toLowerCase().split(';').map((h) => h.trim().replace(/^"|"$/g, ''));
    const at = (name) => head.indexOf(name);
    if (at('логин') < 0 || at('тест') < 0 || at('результат') < 0) return null;
    return lines.map((l) => {
      const c = l.split(';').map((v) => v.trim().replace(/^"|"$/g, ''));
      const get = (n) => (at(n) >= 0 ? c[at(n)] || '' : '');
      return {
        login: get('логин'), test: get('тест'), score: parseFloat(get('результат').replace('%', '').replace(',', '.')) || 0,
        correct: parseInt(get('верных'), 10) || 0, total: parseInt(get('всего'), 10) || 0,
        passed: /^сдан/i.test(get('статус')), date: get('дата'), attempts: parseInt(get('попыток'), 10) || 1, cert: get('сертификат')
      };
    }).filter((r) => r.login && r.test);
  }

  async function importResults(rows, form) {
    const sum = { added: 0, updated: 0, unchanged: 0, unknown: new Set() };
    for (let i = 0; i < rows.length; i += 400) {
      showFormMsg(form, '');
      form.querySelector('.form-msg').innerHTML = `<p class="muted small">Загружено ${i} из ${rows.length}…</p>`;
      const r = await call('admin_import_results', { rows: rows.slice(i, i + 400) });
      sum.added += r.added; sum.updated += r.updated; sum.unchanged += r.unchanged;
      r.unknownLogins.forEach((l) => sum.unknown.add(l));
    }
    modal.innerHTML = `
      <div class="modal__body">
        <h2>Результаты загружены</h2>
        <p>Строк в файле: <b>${rows.length}</b>. Добавлено: <b>${sum.added}</b>, обновлено (балл выше прежнего): <b>${sum.updated}</b>, без изменений: <b>${sum.unchanged}</b>.</p>
        ${sum.unknown.size ? `<p class="note warn">Не найдены на платформе логины (${sum.unknown.size}): ${esc(Array.from(sum.unknown).join(', '))}. Эти строки пропущены.</p>` : ''}
        <p class="muted small">Сотрудники увидят результаты в личном кабинете в блоке «Тесты, пройденные до запуска Академии».</p>
        <div class="btn-row"><button class="btn btn--primary" data-close>Готово</button></div>
      </div>`;
  }

  /* Листы доступа по аптекам: файл с паролями обрабатывается только в браузере */
  let sheets = null;

  function parseCreds(text) {
    const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
      .map((line) => line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',')
        .map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"')));
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.toLowerCase());
    const col = (re, def) => { const i = head.findIndex((h) => re.test(h)); return i === -1 ? def : i; };
    const hasHead = head.some((h) => /логин|login|пароль|password/.test(h));
    const iName = col(/фио|имя|name/, 0);
    const iLogin = col(/логин|login/, hasHead ? -1 : 1);
    const iPass = col(/пароль|password/, hasHead ? -1 : rows[0].length - 1);
    const iBranch = col(/аптек|филиал|подразд|branch/, -1);
    if (iLogin < 0 || iPass < 0) return [];
    return rows.slice(hasHead ? 1 : 0).map((c) => ({
      name: c[iName] || '', login: (c[iLogin] || '').toLowerCase(), password: c[iPass] || '', branch: iBranch >= 0 ? c[iBranch] || '' : ''
    })).filter((r) => r.login && r.password);
  }

  // Имя файла латиницей: браузеры не всегда принимают кириллицу в имени загрузки
  function translit(text) {
    const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    return text.toLowerCase().split('').map((ch) => (ch in map ? map[ch] : ch)).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'apteka';
  }

  function groupCreds(list) {
    const byLogin = new Map(admin.users.map((u) => [u.login, u]));
    const groups = new Map();
    list.forEach((r) => {
      const u = byLogin.get(r.login);
      const branch = (u && u.branch) || r.branch || 'Без аптеки';
      if (!groups.has(branch)) groups.set(branch, []);
      groups.get(branch).push({ name: (u && u.name) || r.name, login: r.login, password: r.password });
    });
    return new Map(Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru', { numeric: true })));
  }

  function openSheets() {
    modal.innerHTML = `
      <div class="modal__body">
        <h2>Логины по аптекам</h2>
        <p class="muted small">Выберите файл с логинами и паролями, который вы скачали после импорта. Файл обрабатывается только в этом браузере и никуда не отправляется.</p>
        <div class="field"><label for="cred-file">Файл с логинами и паролями (CSV)</label><input id="cred-file" type="file" accept=".csv,.txt,text/csv"></div>
        <div id="sheet-panel"></div>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn--ghost" data-close>Закрыть</button></div>
      </div>`;
    modal.showModal();
  }

  function renderSheetPanel() {
    const panel = document.getElementById('sheet-panel');
    if (!panel) return;
    if (!sheets || !sheets.size) {
      panel.innerHTML = formError('В файле не найдены логины и пароли. Нужен файл, скачанный кнопкой «Скачать логины и пароли» после импорта.');
      return;
    }
    const total = Array.from(sheets.values()).reduce((n, g) => n + g.length, 0);
    panel.innerHTML = `
      <p>Найдено сотрудников: <b>${total}</b>, аптек и подразделений: <b>${sheets.size}</b>.</p>
      <div class="btn-row" style="margin-bottom:14px"><button class="btn btn--primary" data-sheet-print="">Печать / PDF — все аптеки</button></div>
      <ul class="sheet-list">${Array.from(sheets.entries()).map(([b, list], i) => `
        <li><span><b>${esc(b)}</b><small>${list.length} ${plural(list.length, 'сотрудник', 'сотрудника', 'сотрудников')}</small></span>
          <span class="btn-row"><button class="btn btn--ghost btn--sm" data-sheet-print="${i + 1}">Печать</button><button class="btn btn--ghost btn--sm" data-sheet-csv="${i + 1}">CSV</button></span></li>`).join('')}
      </ul>`;
  }

  function sheetHtml(branch, list) {
    const site = location.origin.replace(/^https?:\/\//, '');
    return `
      <section class="sheet">
        <header class="sheet__head">
          <img src="img/logo-vivafarm.svg" alt="" width="92" height="40">
          <div><b>ВИВААКАДЕМИЯ — доступ к обучению</b><span>${esc(branch)} · ${new Date().toLocaleDateString('ru-RU')}</span></div>
        </header>
        <ol class="sheet__steps">
          <li>Откройте сайт <b>${esc(site)}</b> на телефоне или компьютере.</li>
          <li>Введите свой логин и пароль из таблицы ниже.</li>
          <li>Сразу смените пароль: <b>Личный кабинет → Сменить пароль</b>.</li>
          <li>Откройте <b>Курсы</b>, пройдите уроки и итоговый тест — сертификат появится в личном кабинете.</li>
        </ol>
        <table class="sheet__table">
          <thead><tr><th>№</th><th>ФИО</th><th>Логин</th><th>Пароль</th></tr></thead>
          <tbody>${list.map((u, i) => `<tr><td>${i + 1}</td><td>${esc(u.name)}</td><td>${esc(u.login)}</td><td>${esc(u.password)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="sheet__note">Логин и пароль личные — не передавайте их другим. Вопросы по доступу — к руководителю аптеки.</p>
      </section>`;
  }

  function printSheets(which) {
    const entries = Array.from(sheets.entries());
    const chosen = which ? [entries[Number(which) - 1]] : entries;
    let box = document.getElementById('print-sheets');
    if (!box) { box = document.createElement('div'); box.id = 'print-sheets'; document.body.appendChild(box); }
    box.innerHTML = chosen.map(([b, list]) => sheetHtml(b, list)).join('');
    if (modal.open) modal.close();
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); box.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    const imgs = Array.from(box.querySelectorAll('img'));
    Promise.all(imgs.map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; })))).then(() => window.print());
  }

  /* ───────────── Роутер ───────────── */
  const PUBLIC = ['login', 'register', 'verify'];

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [page, id, n] = parts;

    if (mode === 'error') {
      app.innerHTML = `<div class="wrap narrow"><div class="quiz result" style="margin-top:32px"><h2>Платформа временно недоступна</h2><p class="muted">${esc(bootError)}</p></div></div>`;
      document.querySelectorAll('[data-nav]').forEach((a) => { a.hidden = true; });
      return;
    }
    if (mode === 'server' && !user && !PUBLIC.includes(page)) {
      location.replace('#/login');
      return;
    }
    if (mode === 'server' && user && (page === 'login' || page === 'register')) {
      location.replace('#/');
      return;
    }

    const c = id ? findCourse(id) : null;
    let html, nav = page || 'home';

    if (!page) html = viewHome();
    else if (page === 'login' && mode === 'server') html = viewLogin();
    else if (page === 'register' && mode === 'server' && selfRegister) html = viewRegister();
    else if (page === 'courses') html = viewCourses();
    else if (page === 'law') { html = viewLaw({ buh: 'acc', pharm: 'pharm', local: 'local' }[id] || null); }
    else if (page === 'team' && teamReady()) html = viewTeam();
    else if (page === 'profile') html = viewProfile();
    else if (page === 'materials' && mode === 'server') html = viewMaterials();
    else if (page === 'events' && mode === 'server') html = viewEvents();
    else if (page === 'drugs') html = viewDrugs(id === 'check' ? 'check' : 'search');
    else if (page === 'admin' && canViewAdmin()) html = viewAdmin();
    else if (page === 'verify' && id) html = viewVerify(decodeURIComponent(id));
    else if (page === 'xcert' && id) { html = viewExtCertificate(decodeURIComponent(id)); nav = 'profile'; }
    else if (c && page === 'course') { html = viewCourse(c); nav = 'courses'; }
    else if (c && page === 'lesson') { html = viewLesson(c, parseInt(n, 10)); nav = 'courses'; }
    else if (c && page === 'quiz') { html = viewQuiz(c); nav = 'courses'; }
    else if (c && page === 'certificate') { html = viewCertificate(c); nav = 'profile'; }
    else html = viewNotFound();

    if (page !== 'quiz') quiz = null;
    stopPillars();
    app.innerHTML = html;
    if (!page) { startPillars(); if (mode === 'server' && user) loadTodayExtras(); }
    if (page === 'law') renderLaw();
    if (page === 'courses') renderCourseGrid();
    if (page === 'lesson') labelLessonTables();
    if (page === 'materials' && mode === 'server') { if (mats.list) renderMaterials(); loadMaterials(); }
    if (page === 'events' && mode === 'server') { if (evs.data) renderEvents(); loadEvents(); }
    if (page === 'profile' && mode === 'server') renderTgPanel();
    if (page === 'drugs') { if (id === 'check') initCheck(); else initDrugs(); }
    if (page === 'admin' && canViewAdmin()) loadAdmin();
    if (page === 'verify' && id) loadVerify(decodeURIComponent(id));

    updateNav(nav);
    const title = app.querySelector('h1');
    document.title = (title && page ? title.textContent + ' — ' : '') + 'ВИВААКАДЕМИЯ — обучение сотрудников Вивафарм';
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  function updateNav(active) {
    const loggedOut = mode === 'server' && !user;
    document.body.classList.toggle('logged-in', !!user && mode !== 'error');
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === active);
      a.hidden = loggedOut || (a.dataset.nav === 'admin' && !canViewAdmin()) || ((a.dataset.nav === 'materials' || a.dataset.nav === 'events') && mode !== 'server');
    });
    document.querySelector('.nav-logout').hidden = !(mode === 'server' && user);
    document.getElementById('nav').classList.remove('open');
    document.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
  }

  /* ───────────── События ───────────── */
  function setBusy(form, busy) {
    form.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  }
  function showFormMsg(form, msg) {
    const box = form.querySelector('.form-msg');
    if (box) box.innerHTML = msg ? formError(msg) : '';
  }

  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.pillarBtn) {
      stopPillars();
      activatePillar(Number(t.dataset.pillarBtn));
      return;
    }
    if (t.dataset.lawSec) {
      law.sec = t.dataset.lawSec; law.cat = null;
      if (!t.dataset.keepQ) law.q = '';
      app.innerHTML = viewLaw(); renderLaw();
      return;
    }
    if (t.dataset.lawCat !== undefined) { law.cat = t.dataset.lawCat || null; renderLaw(); return; }
    if (t.dataset.lawHint) {
      law.q = t.dataset.lawHint;
      const box = document.getElementById('law-q'); box.value = law.q; renderLaw(); box.focus();
      return;
    }
    if (t.dataset.teamTopic) {
      teamTopic = teamTopic === t.dataset.teamTopic ? null : t.dataset.teamTopic;
      app.innerHTML = viewTeam();
      return;
    }
    if (t.dataset.drugForm !== undefined) { drugs.form = t.dataset.drugForm; renderDrugs(); return; }
    if (t.dataset.ixAdd) { ixAdd(t.dataset.ixAdd); return; }
    if (t.dataset.ixDel !== undefined) { ix.items.splice(Number(t.dataset.ixDel), 1); renderCheck(); return; }
    if (t.hasAttribute('data-ix-clear')) { ix.items = []; renderCheck(); return; }
    if (t.hasAttribute('data-ev-new')) { openEventForm(null); return; }
    if (t.dataset.evEdit) { openEventForm(evs.data.upcoming.concat(evs.data.past).find((x) => x.id === Number(t.dataset.evEdit))); return; }
    if (t.dataset.evList) { openEventList(Number(t.dataset.evList)); return; }
    if (t.dataset.evDelete) {
      const e = evs.data.upcoming.concat(evs.data.past).find((x) => x.id === Number(t.dataset.evDelete));
      if (!e || !confirm(`Удалить «${e.title}» вместе со списком записавшихся?`)) return;
      try { await call('admin_event_delete', { id: e.id }); toast('Мероприятие удалено'); await loadEvents(); } catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.evReg) {
      t.disabled = true;
      try {
        const on = t.dataset.on === '1';
        const r = await call('event_register', { id: Number(t.dataset.evReg), on });
        toast(on ? (r.telegram ? 'Вы записаны. Подтверждение пришло в Telegram' : 'Вы записаны') : (r.telegram ? 'Запись отменена. Сообщение пришло в Telegram' : 'Запись отменена'));
        if (document.getElementById('home-event')) await loadHomeEvent(); else await loadEvents();
      } catch (err) { toast(err.message); t.disabled = false; }
      return;
    }
    if (t.hasAttribute('data-tg-link')) { connectTelegram(); return; }
    if (t.hasAttribute('data-install') && installPrompt) {
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (err) { /* закрыли окно */ }
      installPrompt = null;
      renderInstallCard();
      return;
    }
    if (t.hasAttribute('data-install-dismiss')) {
      try { localStorage.setItem('viva-install-dismissed', '1'); } catch (err) { /* без хранилища */ }
      renderInstallCard();
      return;
    }
    if (t.hasAttribute('data-tg-unlink')) {
      try { await call('tg_unlink', {}); toast('Уведомления отключены'); renderTgPanel(); } catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.matCat) {
      mats.cat = t.dataset.matCat;
      renderMaterials();
      return;
    }
    if (t.hasAttribute('data-mat-new')) { openMaterialForm(null); return; }
    if (t.dataset.matEdit) { openMaterialForm(mats.list.find((m) => m.id === Number(t.dataset.matEdit))); return; }
    if (t.dataset.matDelete) {
      const m = mats.list.find((x) => x.id === Number(t.dataset.matDelete));
      if (!m || !confirm(`Удалить «${m.title}»? Файл будет удалён с сервера.`)) return;
      try {
        await call('admin_material_delete', { id: m.id });
        toast('Материал удалён');
        await loadMaterials();
      } catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.cat) {
      filter.cat = t.dataset.cat;
      document.querySelectorAll('.chip').forEach((ch) => ch.setAttribute('aria-pressed', ch.dataset.cat === filter.cat));
      renderCourseGrid();
    } else if (t.dataset.complete) {
      const [cid, i] = t.dataset.complete.split(':');
      t.disabled = true;
      try {
        await markLesson(findCourse(cid), parseInt(i, 10));
        location.hash = t.dataset.next;
      } catch (err) {
        t.disabled = false;
        toast(err.message);
      }
    } else if (t.dataset.answer !== undefined) {
      answer(findCourse(quiz.id), parseInt(t.dataset.answer, 10));
    } else if (t.hasAttribute('data-qnext')) {
      const c = findCourse(quiz.id);
      quiz.i++;
      quiz.answered = false;
      if (quiz.i >= c.quiz.length) {
        await finishQuiz(c);
      } else {
        app.innerHTML = viewQuiz(c);
        app.querySelector('.option').focus();
      }
    } else if (t.dataset.retry) {
      startQuiz(findCourse(t.dataset.retry));
      app.innerHTML = viewQuiz(findCourse(t.dataset.retry));
    } else if (t.hasAttribute('data-print')) {
      window.print();
    } else if (t.id === 'reset') {
      if (confirm('Удалить весь прогресс, результаты тестов и сертификаты в этом браузере?')) {
        state = { lessons: {}, quiz: {} };
        saveLocal();
        route();
        toast('Прогресс сброшен');
      }
    } else if (t.dataset.admin === 'new') {
      openUserForm(null);
    } else if (t.dataset.admin === 'import') {
      openImport();
    } else if (t.dataset.admin === 'results') {
      openResultsImport();
    } else if (t.dataset.admin === 'sheets') {
      sheets = null;
      openSheets();
    } else if (t.dataset.userEdit) {
      openUserForm(admin.users.find((u) => u.id === Number(t.dataset.userEdit)));
    } else if (t.dataset.userOpen) {
      const uid = Number(t.dataset.userOpen);
      admin.open = admin.open === uid ? null : uid;
      renderAdmin();
    } else if (t.dataset.branch !== undefined) {
      admin.branch = admin.branch === t.dataset.branch ? '' : t.dataset.branch;
      renderAdmin();
    }
  });

  app.addEventListener('mouseover', (e) => {
    const g = e.target.closest && e.target.closest('.pl-g');
    if (g) { stopPillars(); activatePillar(Number(g.dataset.pillar)); }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'law-q') {
      law.q = e.target.value;
      clearTimeout(renderLaw.timer);
      renderLaw.timer = setTimeout(renderLaw, 150);
      return;
    }
    if (e.target.id === 'drug-q') {
      drugs.q = e.target.value;
      clearTimeout(drugs.timer);
      drugs.timer = setTimeout(renderDrugs, 200);
      return;
    }
    if (e.target.id === 'mat-q') {
      mats.q = e.target.value;
      renderMaterials();
      return;
    }
    if (e.target.classList.contains('search') && e.target.id !== 'admin-q') {
      filter.q = e.target.value;
      renderCourseGrid();
    } else if (e.target.id === 'admin-q') {
      admin.q = e.target.value;
      renderAdmin();
      const box = document.getElementById('admin-q');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  });

  app.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.ixForm !== undefined) {
      const it = ix.items[Number(e.target.dataset.ixForm)];
      if (it) { it.form = e.target.value; renderCheck(); }
      return;
    }
    if (e.target.id === 'admin-branch') { admin.branch = e.target.value; renderAdmin(); }
    if (e.target.id === 'admin-status') { admin.status = e.target.value; renderAdmin(); }
  });

  async function handleSubmit(e) {
    const form = e.target;
    const f = form.elements;
    // form.id перекрывается полем name="id", поэтому читаем атрибут
    const formId = form.getAttribute('id');
    e.preventDefault();
    showFormMsg(form, '');
    setBusy(form, true);
    try {
      if (formId === 'login-form') {
        const r = await call('login', { login: f.login.value, password: f.password.value });
        user = r.user;
        applyProgress(r.progress);
        await refreshStats();
        location.hash = '#/';
        return;
      }
      if (formId === 'register-form') {
        const r = await call('register', {
          code: f.code.value, name: f.name.value, branch: f.branch.value,
          position: f.position.value, login: f.login.value, password: f.password.value
        });
        user = r.user;
        applyProgress(r.progress);
        await refreshStats();
        toast('Кабинет создан. Добро пожаловать!');
        location.hash = '#/';
        return;
      }
      if (formId === 'name-form') {
        const name = f.name.value.trim().slice(0, 80);
        if (!name) throw new Error('Укажите имя и фамилию.');
        if (mode === 'server') {
          const r = await call('profile', {
            name,
            branch: f.branch ? f.branch.value : user.branch,
            position: f.position ? f.position.value : user.position
          });
          user = r.user;
        } else {
          user.name = name;
          saveLocal();
        }
        if (/^#\/(certificate|xcert)/.test(location.hash)) route();
        toast('Данные сохранены');
      }
      if (formId === 'password-form') {
        await call('password', { old: f.old.value, new: f.new.value });
        form.reset();
        toast('Пароль изменён');
      }
      if (formId === 'invite-form') {
        await call('admin_settings', { inviteCode: f.inviteCode.value.trim() });
        admin.inviteCode = f.inviteCode.value.trim();
        toast(admin.inviteCode ? 'Регистрация по коду включена' : 'Самостоятельная регистрация выключена');
      }
      if (formId === 'user-form') {
        await call('admin_user_save', {
          id: Number(f.namedItem('id').value), name: f.name.value, login: f.login.value, branch: f.branch.value,
          position: f.position.value, password: f.password.value,
          role: f.role.value, active: f.active.checked
        });
        modal.close();
        toast('Сохранено');
        await loadAdmin();
      }
      if (formId === 'results-form') {
        const file = document.getElementById('res-file').files[0];
        const rows = file ? parseResults(await file.text()) : null;
        if (!rows || !rows.length) throw new Error('В файле не найдены колонки «логин», «тест», «результат» или строки с результатами.');
        await importResults(rows, form);
        await loadAdmin();
        return;
      }
      if (formId === 'ix-form') {
        ixAdd(f[0].value);
        f[0].value = '';
        f[0].focus();
        return;
      }
      if (formId === 'event-form') {
        const r = await call('admin_event_save', {
          id: Number(f.id.value) || 0, title: f.title.value, speaker: f.speaker.value, local: f.local.value,
          duration: Number(f.duration.value) || 0, place: f.place.value, capacity: Number(f.capacity.value) || 0,
          link: f.link.value.trim(), description: f.description.value, announce: f.announce.checked
        });
        modal.close();
        toast(r.sent ? `Сохранено. Сообщение отправлено: ${r.sent}` : 'Сохранено');
        await loadEvents();
        return;
      }
      if (formId === 'tg-form') {
        const token = f.token.value.trim();
        if (!token) throw new Error('Вставьте токен от @BotFather.');
        const r = await call('admin_tg_setup', { token });
        toast(`Бот @${r.bot} подключён`);
        await loadAdmin();
        return;
      }
      if (formId === 'material-form') {
        const data = {
          id: Number(f.id.value) || 0, title: f.title.value, brand: f.brand.value,
          category: f.category.value, description: f.description.value, course: f.course.value,
          announce: !!(f.announce && f.announce.checked)
        };
        if (!data.id) {
          const file = f.file.files[0];
          if (!file) throw new Error('Выберите файл PDF или PowerPoint.');
          const pr = form.querySelector('#mat-progress');
          data.upload = await uploadPdf(file, (p) => { pr.textContent = `Загружено ${p}% из ${fileSize(file.size)}…`; });
          data.name = file.name;
          pr.textContent = 'Сохраняем…';
        }
        await call('admin_material_save', data);
        modal.close();
        toast(data.id ? 'Изменения сохранены' : 'Презентация загружена');
        await loadMaterials();
        return;
      }
      if (formId === 'import-form') {
        const file = document.getElementById('imp-file').files[0];
        const text = (file ? await file.text() : '') + '\n' + f.text.value;
        const rows = parseRows(text);
        if (!rows.length) throw new Error('Список пуст.');
        const r = await call('admin_import', { rows });
        showImportResult(r);
        await loadAdmin();
      }
    } catch (err) {
      showFormMsg(form, err.message);
    } finally {
      setBusy(form, false);
    }
  }

  app.addEventListener('submit', handleSubmit);
  modal.addEventListener('submit', handleSubmit);

  modal.addEventListener('change', async (e) => {
    if (e.target.id !== 'cred-file' || !e.target.files[0]) return;
    sheets = groupCreds(parseCreds(await e.target.files[0].text()));
    renderSheetPanel();
  });

  modal.addEventListener('click', async (e) => {
    if (e.target === modal) { modal.close(); return; }
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) {
      modal.close();
    } else if (t.dataset.sheetPrint !== undefined) {
      printSheets(t.dataset.sheetPrint);
    } else if (t.dataset.sheetCsv) {
      const [b, list] = Array.from(sheets.entries())[Number(t.dataset.sheetCsv) - 1];
      downloadCsv(`viva-academy-${translit(b)}.csv`, [['ФИО', 'Логин', 'Пароль']].concat(list.map((u) => [u.name, u.login, u.password])));
    } else if (t.dataset.evCsv) {
      downloadCsv('viva-academy-zapis.csv', [['ФИО', 'Логин', 'Аптека', 'Telegram', 'Записался']].concat(modal.peopleList.map((p) => [p.name, p.login, p.branch || '', p.tg ? 'да' : 'нет', p.at])));
    } else if (t.hasAttribute('data-genpass')) {
      modal.querySelector('#u-password').value = genPassword();
    } else if (t.hasAttribute('data-cred-download')) {
      downloadCsv('viva-academy-logins.csv', [['ФИО', 'Аптека', 'Логин', 'Пароль']].concat(modal.lastImport.map((u) => [u.name, u.branch || '', u.login, u.password])));
    } else if (t.hasAttribute('data-cred-print')) {
      sheets = groupCreds(modal.lastImport.map((u) => ({ name: u.name, login: u.login, password: u.password, branch: u.branch || '' })));
      printSheets('');
    } else if (t.dataset.userReset) {
      if (!confirm('Сбросить весь прогресс и сертификаты этого сотрудника?')) return;
      try {
        await call('admin_reset_progress', { id: Number(t.dataset.userReset) });
        modal.close();
        toast('Прогресс сброшен');
        await loadAdmin();
      } catch (err) { toast(err.message); }
    } else if (t.dataset.userDelete) {
      if (!confirm('Удалить сотрудника и все его результаты? Это действие нельзя отменить.')) return;
      try {
        await call('admin_delete', { id: Number(t.dataset.userDelete) });
        modal.close();
        toast('Сотрудник удалён');
        await loadAdmin();
      } catch (err) { toast(err.message); }
    }
  });

  document.querySelector('.nav-logout').addEventListener('click', async () => {
    try {
      const r = await call('logout', {});
      csrf = r.csrf;
    } catch (e) { /* всё равно выходим */ }
    user = null;
    state = { lessons: {}, quiz: {} };
    location.hash = '#/login';
  });

  /* Меню на мобильных */
  const menuBtn = document.querySelector('.menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = document.getElementById('nav').classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
  });

  /* Тема */
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('viva-theme');
    if (saved) root.dataset.theme = saved;
  } catch (e) { /* нет доступа к хранилищу */ }
  document.querySelector('.theme-btn').addEventListener('click', () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('viva-theme', root.dataset.theme); } catch (e) { /* ignore */ }
  });

  window.addEventListener('hashchange', route);
  boot().then(route);
  // Установка на телефон как приложение (нужен service worker; он ничего не кэширует)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
