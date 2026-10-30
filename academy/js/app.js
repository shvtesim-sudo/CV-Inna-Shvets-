(function () {
  'use strict';

  const COURSES = window.COURSES;
  const CATEGORIES = window.CATEGORIES;
  const PASS_SCORE = 0.8;
  const STORE_KEY = 'viva-academy-v1';
  const app = document.getElementById('app');

  /* ── Хранилище прогресса (только в этом браузере) ── */
  const emptyState = () => ({ name: '', lessons: {}, quiz: {} });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign(emptyState(), JSON.parse(raw)) : emptyState();
    } catch (e) {
      return emptyState();
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
  }

  /* ── Утилиты ── */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const findCourse = (id) => COURSES.find((c) => c.id === id);
  const courseMinutes = (c) => c.lessons.reduce((s, l) => s + l.minutes, 0) + 5;
  const doneLessons = (c) => state.lessons[c.id] || [];
  const isLessonDone = (c, i) => doneLessons(c).includes(i);
  const quizResult = (c) => state.quiz[c.id];
  const isPassed = (c) => !!(quizResult(c) && quizResult(c).passedAt);

  function courseProgress(c) {
    const steps = c.lessons.length + 1;
    const done = doneLessons(c).length + (isPassed(c) ? 1 : 0);
    return Math.round((done / steps) * 100);
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
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const progressBar = (pct) => `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;

  function markLesson(c, i) {
    const list = doneLessons(c);
    if (!list.includes(i)) {
      state.lessons[c.id] = list.concat(i);
      save();
    }
  }

  /* ── Шаблоны ── */
  function courseCard(c) {
    const pct = courseProgress(c);
    const status = isPassed(c)
      ? '<span class="badge badge--done">Сертификат ✓</span>'
      : pct > 0 ? `<span class="badge">${pct}%</span>` : `<span class="badge">${esc(c.level)}</span>`;
    return `
      <a class="card" href="#/course/${c.id}">
        <div class="card__top"><div class="card__icon" aria-hidden="true">${c.icon}</div>${status}</div>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.short)}</p>
        <div class="meta"><span>${esc(CATEGORIES[c.category])}</span><span>${c.lessons.length} ${plural(c.lessons.length, 'урок', 'урока', 'уроков')} + тест</span><span>≈ ${courseMinutes(c)} мин</span></div>
        ${pct > 0 ? progressBar(pct) : ''}
      </a>`;
  }

  function nextStepFor(c) {
    const i = c.lessons.findIndex((_, idx) => !isLessonDone(c, idx));
    if (i !== -1) return { href: `#/lesson/${c.id}/${i + 1}`, label: i === 0 && !doneLessons(c).length ? 'Начать курс' : 'Продолжить' };
    if (!isPassed(c)) return { href: `#/quiz/${c.id}`, label: 'Пройти тест' };
    return { href: `#/certificate/${c.id}`, label: 'Открыть сертификат' };
  }

  /* ── Страницы ── */
  function viewHome() {
    const totalLessons = COURSES.reduce((s, c) => s + c.lessons.length, 0);
    const totalQ = COURSES.reduce((s, c) => s + c.quiz.length, 0);
    const inProgress = COURSES.filter((c) => courseProgress(c) > 0 && !isPassed(c));
    const featured = (inProgress.length ? inProgress : COURSES).slice(0, 3);
    return `
      <section class="hero">
        <div class="wrap hero__grid">
          <div>
            <span class="eyebrow">Обучение для фармацевтов и провизоров</span>
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
              <li><span class="ico" aria-hidden="true">🎓</span><div><b>Сертификат</b><small>После теста с результатом от ${PASS_SCORE * 100}%</small></div></li>
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
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Курсы</div>
        <h1>Каталог курсов</h1>
        <p class="muted">Каждый курс — 3 урока и итоговый тест. Сертификат выдаётся при результате от ${PASS_SCORE * 100}%.</p>
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
    const pct = courseProgress(c);
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
            <b>Ваш прогресс: ${pct}%</b>
            <div style="margin-top:10px">${progressBar(pct)}</div>
            ${res ? `<p class="muted" style="margin:12px 0 0">Лучший результат теста: ${Math.round(res.best * 100)}%</p>` : ''}
            <a class="btn btn--primary" href="${next.href}">${next.label}</a>
          </aside>
        </div>
        <h2>Программа курса</h2>
        <ol class="lesson-list">
          ${lessons}
          <li class="quiz-link ${isPassed(c) ? 'done' : ''}">
            <a href="#/quiz/${c.id}">
              <span class="lesson-num">${isPassed(c) ? '✓' : '?'}</span>
              <span class="t">Итоговый тест<br><small>${c.quiz.length} ${plural(c.quiz.length, 'вопрос', 'вопроса', 'вопросов')} · проходной балл ${PASS_SCORE * 100}%</small></span>
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

  /* Тест хранит состояние в памяти, пока открыт */
  let quiz = null;

  function startQuiz(c) {
    quiz = { id: c.id, i: 0, correct: 0, answered: false };
  }

  function viewQuiz(c) {
    if (!quiz || quiz.id !== c.id) startQuiz(c);
    const total = c.quiz.length;

    if (quiz.i >= total) {
      const score = quiz.correct / total;
      const passed = score >= PASS_SCORE;
      const prev = quizResult(c) || {};
      state.quiz[c.id] = {
        best: Math.max(prev.best || 0, score),
        passedAt: prev.passedAt || (passed ? Date.now() : null),
        certId: prev.certId || (passed ? makeCertId(c) : null)
      };
      save();
      const pct = Math.round(score * 100);
      return `
        <div class="wrap narrow">
          <div class="crumbs"><a href="#/courses">Курсы</a> / <a href="#/course/${c.id}">${esc(c.title)}</a> / Тест</div>
          <div class="quiz result ${passed ? 'pass' : ''}">
            <div class="result__score">${pct}%</div>
            <h2>${passed ? 'Тест пройден!' : 'Почти получилось'}</h2>
            <p class="muted">Правильных ответов: ${quiz.correct} из ${total}. ${passed ? 'Сертификат готов.' : `Для сертификата нужно от ${PASS_SCORE * 100}%. Повторите уроки и попробуйте ещё раз.`}</p>
            <div class="btn-row" style="justify-content:center">
              ${passed ? `<a class="btn btn--primary" href="#/certificate/${c.id}">Получить сертификат</a>` : `<button class="btn btn--primary" data-retry="${c.id}">Пройти заново</button>`}
              <a class="btn btn--ghost" href="#/course/${c.id}">К курсу</a>
            </div>
          </div>
        </div>`;
    }

    const q = c.quiz[quiz.i];
    return `
      <div class="wrap narrow">
        <div class="crumbs"><a href="#/courses">Курсы</a> / <a href="#/course/${c.id}">${esc(c.title)}</a> / Тест</div>
        <div class="quiz">
          <div class="quiz__top"><span>Вопрос ${quiz.i + 1} из ${total}</span><span>Верно: ${quiz.correct}</span></div>
          ${progressBar(Math.round((quiz.i / total) * 100))}
          <h2>${esc(q.q)}</h2>
          <div class="options" role="group" aria-label="Варианты ответа">
            ${q.options.map((o, k) => `<button class="option" data-answer="${k}">${esc(o)}</button>`).join('')}
          </div>
          <div id="explain" aria-live="polite"></div>
        </div>
      </div>`;
  }

  function answer(c, k) {
    if (quiz.answered) return;
    quiz.answered = true;
    const q = c.quiz[quiz.i];
    const ok = k === q.correct;
    if (ok) quiz.correct++;
    document.querySelectorAll('.option').forEach((b, idx) => {
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

  function makeCertId(c) {
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `VA-${c.id.slice(0, 3).toUpperCase()}-${new Date().getFullYear()}-${rnd}`;
  }

  function viewProfile() {
    const total = COURSES.length;
    const passed = COURSES.filter(isPassed);
    const overall = Math.round(COURSES.reduce((s, c) => s + courseProgress(c), 0) / total);
    const r = 60, circ = 2 * Math.PI * r;
    const rows = COURSES.map((c) => {
      const pct = courseProgress(c);
      const next = nextStepFor(c);
      return `
        <li>
          <span class="card__icon" aria-hidden="true">${c.icon}</span>
          <div class="grow"><b>${esc(c.title)}</b>${progressBar(pct)}</div>
          <a class="btn btn--sm ${isPassed(c) ? 'btn--primary' : 'btn--ghost'}" href="${next.href}">${isPassed(c) ? 'Сертификат' : next.label}</a>
        </li>`;
    }).join('');
    return `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Главная</a> / Мой прогресс</div>
        <h1>Мой прогресс</h1>
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
                <input id="name" name="name" maxlength="80" autocomplete="name" value="${esc(state.name)}" placeholder="Например, Анна Иванова">
              </div>
              <button class="btn btn--primary" style="width:100%">Сохранить</button>
            </form>
            <button class="btn btn--ghost btn--sm" id="reset" style="width:100%;margin-top:12px">Сбросить прогресс</button>
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
          <p class="muted">Пройдите итоговый тест с результатом от ${PASS_SCORE * 100}%.</p>
          <a class="btn btn--primary" href="#/quiz/${c.id}">Пройти тест</a></div>
        </div>`;
    }
    const nameBlock = state.name
      ? `<div class="name">${esc(state.name)}</div>`
      : `<form id="name-form" class="no-print" style="max-width:360px;margin:16px auto">
           <div class="field"><label for="name">Введите имя и фамилию</label><input id="name" name="name" maxlength="80" autocomplete="name" required></div>
           <button class="btn btn--primary">Показать на сертификате</button>
         </form>`;
    return `
      <div class="wrap cert-wrap">
        <div class="crumbs no-print"><a href="#/profile">Мой прогресс</a> / Сертификат</div>
        <div class="cert">
          <div class="logo" style="justify-content:center"><span class="logo__text">Viva<b>Academy</b></span></div>
          <h1>Сертификат</h1>
          <p>подтверждает, что</p>
          ${nameBlock}
          <p>успешно завершил(а) курс</p>
          <div class="course">«${esc(c.title)}»</div>
          <p>Результат итогового теста: <b>${Math.round(res.best * 100)}%</b> · Объём: ${courseMinutes(c)} мин</p>
          <div class="cert__foot"><span>Дата: ${formatDate(res.passedAt)}</span><span>№ ${esc(res.certId)}</span></div>
        </div>
        <div class="btn-row no-print" style="justify-content:center">
          <button class="btn btn--primary" onclick="window.print()">Печать / Сохранить в PDF</button>
          <a class="btn btn--ghost" href="#/courses">Другие курсы</a>
        </div>
      </div>`;
  }

  function viewNotFound() {
    return `<div class="wrap narrow"><div class="quiz result" style="margin-top:32px"><h2>Страница не найдена</h2><a class="btn btn--primary" href="#/">На главную</a></div></div>`;
  }

  /* ── Роутер ── */
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [page, id, n] = parts;
    const c = id ? findCourse(id) : null;
    let html, nav = page || 'home';

    if (!page) html = viewHome();
    else if (page === 'courses') html = viewCourses();
    else if (page === 'profile') html = viewProfile();
    else if (c && page === 'course') { html = viewCourse(c); nav = 'courses'; }
    else if (c && page === 'lesson') { html = viewLesson(c, parseInt(n, 10)); nav = 'courses'; }
    else if (c && page === 'quiz') { html = viewQuiz(c); nav = 'courses'; }
    else if (c && page === 'certificate') { html = viewCertificate(c); nav = 'profile'; }
    else html = viewNotFound();

    if (page !== 'quiz') quiz = null;
    app.innerHTML = html;
    if (page === 'courses') renderCourseGrid();

    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    document.getElementById('nav').classList.remove('open');
    document.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
    const title = app.querySelector('h1');
    document.title = (title && page ? title.textContent + ' — ' : '') + 'Viva Academy — обучение для фармацевтов';
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  /* ── События ── */
  app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.cat) {
      filter.cat = t.dataset.cat;
      document.querySelectorAll('.chip').forEach((ch) => ch.setAttribute('aria-pressed', ch.dataset.cat === filter.cat));
      renderCourseGrid();
    } else if (t.dataset.complete) {
      const [id, i] = t.dataset.complete.split(':');
      markLesson(findCourse(id), parseInt(i, 10));
      location.hash = t.dataset.next;
    } else if (t.dataset.answer !== undefined) {
      answer(findCourse(quiz.id), parseInt(t.dataset.answer, 10));
    } else if (t.hasAttribute('data-qnext')) {
      quiz.i++;
      quiz.answered = false;
      app.innerHTML = viewQuiz(findCourse(quiz.id));
      app.querySelector('.option, .btn').focus();
    } else if (t.dataset.retry) {
      startQuiz(findCourse(t.dataset.retry));
      app.innerHTML = viewQuiz(findCourse(t.dataset.retry));
    } else if (t.id === 'reset') {
      if (confirm('Удалить весь прогресс, результаты тестов и сертификаты в этом браузере?')) {
        state = emptyState();
        save();
        route();
        toast('Прогресс сброшен');
      }
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.classList.contains('search')) {
      filter.q = e.target.value;
      renderCourseGrid();
    }
  });

  app.addEventListener('submit', (e) => {
    if (e.target.id !== 'name-form') return;
    e.preventDefault();
    state.name = e.target.name.value.trim().slice(0, 80);
    save();
    if (location.hash.startsWith('#/certificate')) route();
    toast('Имя сохранено');
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
  route();
})();
