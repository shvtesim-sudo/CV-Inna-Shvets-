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
    if (p) state = { lessons: p.lessons || {}, quiz: p.quiz || {} };
  }

  async function boot() {
    try {
      const me = await call('me');
      mode = 'server';
      csrf = me.csrf;
      passScore = me.passScore;
      selfRegister = me.selfRegister;
      user = me.user;
      applyProgress(me.progress);
    } catch (e) {
      if (e.code) {
        // API есть, но не готов (не настроена база или не запущен установщик)
        mode = 'error';
        bootError = e.code === 'server' ? 'Сервер личных кабинетов не готов. Если вы администратор, откройте api/install.php.' : e.message;
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
  const isPassed = (c) => !!(quizResult(c) && quizResult(c).passedAt);
  const pct = (x) => Math.round(x * 100);
  const isAdmin = () => mode === 'server' && user && user.role === 'admin';

  function courseProgress(c) {
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
  function viewHome() {
    const totalLessons = COURSES.reduce((s, c) => s + c.lessons.length, 0);
    const totalQ = COURSES.reduce((s, c) => s + c.quiz.length, 0);
    const inProgress = COURSES.filter((c) => courseProgress(c) > 0 && !isPassed(c));
    const featured = (inProgress.length ? inProgress : COURSES).slice(0, 3);
    const hello = mode === 'server' && user ? `Здравствуйте, ${esc(user.name.split(' ')[0])}!` : 'Обучение для фармацевтов и провизоров';
    return `
      ${demoBanner()}
      <section class="hero">
        <div class="wrap hero__grid">
          <div>
            <span class="eyebrow">${hello}</span>
            <h1>Уверенная консультация за первым столом</h1>
            <p class="lead">Короткие практические уроки, разбор реальных ситуаций в аптеке, тесты с пояснениями и сертификат о прохождении. Учитесь в своём темпе — с телефона или компьютера.</p>
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
          <div class="stat"><b>${totalQ}</b><span>вопросов в тестах</span></div>
          <div class="stat"><b>${Object.keys(CATEGORIES).length}</b><span>направлений</span></div>
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
      </div>`;
  }

  let filter = { cat: 'all', q: '' };

  function viewCourses() {
    const chips = [['all', 'Все']].concat(Object.entries(CATEGORIES))
      .map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="${filter.cat === k}">${esc(v)}</button>`).join('');
    return `
      ${demoBanner()}
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Курсы</div>
        <h1>Каталог курсов</h1>
        <p class="muted">Каждый курс — 3 урока и итоговый тест. Сертификат выдаётся при результате от ${pct(passScore)}%.</p>
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
    const overall = Math.round(COURSES.reduce((s, c) => s + courseProgress(c), 0) / total);
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
            <p class="muted small">Логин: <b>${esc(user.login)}</b></p>`
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
              <text x="70" y="78" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)" font-family="Montserrat, sans-serif">${overall}%</text>
            </svg>
            <p style="text-align:center" class="muted">Сертификатов: <b>${passed.length}</b> из ${total}</p>
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
          </div>
        </div>
      </div>`;
  }

  function viewCertificate(c) {
    const res = quizResult(c);
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
          <div class="logo" style="justify-content:center"><span class="logo__text">Viva<b>Academy</b></span></div>
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
    let sum = 0, certs = 0;
    COURSES.forEach((c) => {
      const done = (u.lessons[c.id] || 0) + (u.quiz[c.id] && u.quiz[c.id].passed ? 1 : 0);
      sum += done / (c.lessons.length + 1);
      if (u.quiz[c.id] && u.quiz[c.id].passed) certs++;
    });
    return { progress: Math.round((sum / COURSES.length) * 100), certs };
  }

  function viewAdmin() {
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Кабинет руководителя</div>
        <div class="section__head"><h1 style="margin:0">Кабинет руководителя</h1>
          <div class="btn-row">
            <button class="btn btn--primary btn--sm" data-admin="new">+ Сотрудник</button>
            <button class="btn btn--ghost btn--sm" data-admin="import">Импорт списка</button>
            <a class="btn btn--ghost btn--sm" href="${API}?action=admin_export">Выгрузить в Excel</a>
          </div>
        </div>
        <div id="admin-body"><p class="muted">Загружаем данные…</p></div>
      </div>`;
  }

  async function loadAdmin() {
    try {
      const r = await call('admin_users');
      admin.users = r.users;
      admin.inviteCode = r.inviteCode;
      renderAdmin();
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
        <td><button class="link-btn" data-user-open="${u.id}" aria-expanded="${admin.open === u.id}"><b>${esc(u.name)}</b></button><small>${esc(u.login)}${u.role === 'admin' ? ' · администратор' : ''}${u.active ? '' : ' · заблокирован'}</small></td>
        <td>${esc(u.branch) || '—'}<small>${esc(u.position)}</small></td>
        <td class="t-progress"><span>${u.progress}%</span>${progressBar(u.progress)}</td>
        <td class="t-num">${u.certs} / ${COURSES.length}</td>
        <td class="t-num">${formatDateTime(u.lastLogin)}</td>
        <td class="t-actions"><button class="btn btn--ghost btn--sm" data-user-edit="${u.id}">Изменить</button></td>
      </tr>
      ${admin.open === u.id ? `<tr class="detail-row"><td colspan="6">${userDetail(u)}</td></tr>` : ''}`).join('');

    body.innerHTML = `
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
          <div class="panel">
            <h3>Прогресс по аптекам</h3>
            ${byBranch.length ? `<ul class="branch-list">${byBranch.map((x) => `
              <li><button class="link-btn" data-branch="${esc(x.b)}">${esc(x.b)}</button><small>${x.n} ${plural(x.n, 'сотрудник', 'сотрудника', 'сотрудников')} · ${x.avg}%</small>${progressBar(x.avg)}</li>`).join('')}</ul>`
              : '<p class="muted small">Укажите сотрудникам аптеку — здесь появится сводка.</p>'}
          </div>
          <div class="panel">
            <h3>Самостоятельная регистрация</h3>
            <form id="invite-form">
              <div class="field"><label for="invite">Код приглашения</label><input id="invite" name="inviteCode" maxlength="60" value="${esc(admin.inviteCode)}" placeholder="Пусто — регистрация выключена"></div>
              <div class="form-msg"></div>
              <button class="btn btn--ghost btn--sm btn--block">Сохранить</button>
            </form>
            <p class="muted small">Сотрудник открывает «${esc(location.origin + location.pathname)}#/register» и вводит этот код.</p>
          </div>
        </div>
      </div>`;
  }

  function userDetail(u) {
    return `<ul class="detail-list">${COURSES.map((c) => {
      const lessons = u.lessons[c.id] || 0;
      const qr = u.quiz[c.id];
      const status = qr && qr.passed
        ? `<span class="badge badge--done">сдан · ${pct(qr.best)}%</span>`
        : qr ? `<span class="badge badge--warn">не сдан · ${pct(qr.best)}% · попыток: ${qr.attempts}</span>`
        : `<span class="badge">уроков ${lessons} из ${c.lessons.length}</span>`;
      return `<li><span>${c.icon} ${esc(c.title)}</span>${status}</li>`;
    }).join('')}</ul>`;
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
          <label class="check"><input type="checkbox" name="admin" ${u.role === 'admin' ? 'checked' : ''}> Администратор</label>
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
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      .map((line) => line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map((s) => s.trim().replace(/^"|"$/g, '')))
      .filter((cols) => !/^(фио|имя|name)$/i.test(cols[0]))
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
          ${r.created.length ? '<button class="btn btn--primary" data-cred-download>Скачать логины и пароли</button>' : ''}
          <button class="btn btn--ghost" data-close>Закрыть</button>
        </div>
      </div>`;
    modal.lastImport = r.created;
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
    else if (page === 'profile') html = viewProfile();
    else if (page === 'admin' && isAdmin()) html = viewAdmin();
    else if (page === 'verify' && id) html = viewVerify(decodeURIComponent(id));
    else if (c && page === 'course') { html = viewCourse(c); nav = 'courses'; }
    else if (c && page === 'lesson') { html = viewLesson(c, parseInt(n, 10)); nav = 'courses'; }
    else if (c && page === 'quiz') { html = viewQuiz(c); nav = 'courses'; }
    else if (c && page === 'certificate') { html = viewCertificate(c); nav = 'profile'; }
    else html = viewNotFound();

    if (page !== 'quiz') quiz = null;
    app.innerHTML = html;
    if (page === 'courses') renderCourseGrid();
    if (page === 'admin' && isAdmin()) loadAdmin();
    if (page === 'verify' && id) loadVerify(decodeURIComponent(id));

    updateNav(nav);
    const title = app.querySelector('h1');
    document.title = (title && page ? title.textContent + ' — ' : '') + 'Viva Academy — обучение для фармацевтов';
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  function updateNav(active) {
    const loggedOut = mode === 'server' && !user;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === active);
      a.hidden = loggedOut || (a.dataset.nav === 'admin' && !isAdmin());
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

  app.addEventListener('input', (e) => {
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
        if (location.hash.startsWith('#/certificate')) route();
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
          role: f.admin.checked ? 'admin' : 'user', active: f.active.checked
        });
        modal.close();
        toast('Сохранено');
        await loadAdmin();
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

  modal.addEventListener('click', async (e) => {
    if (e.target === modal) { modal.close(); return; }
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) {
      modal.close();
    } else if (t.hasAttribute('data-genpass')) {
      modal.querySelector('#u-password').value = genPassword();
    } else if (t.hasAttribute('data-cred-download')) {
      downloadCsv('viva-academy-logins.csv', [['ФИО', 'Логин', 'Пароль']].concat(modal.lastImport.map((u) => [u.name, u.login, u.password])));
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
})();
