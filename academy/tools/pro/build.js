// Собирает углублённые версии курсов (tools/pro/<id>.js) в js/data-pro.js.
// Каждый файл задаёт PRO['<id>'] = { short, level, lessons, quiz } — эти поля заменяют базовые из data.js.
// Запуск:  node tools/pro/build.js && node tools/build-answers.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const root = path.join(dir, '..', '..');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'build.js').sort();
const PRO = {};
for (const f of files) vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), { PRO }, { filename: f });

// Порядок вариантов перемешивается один раз здесь (детерминированно, Фишер — Йетс),
// чтобы правильный ответ не стоял всегда на одном месте. Браузер и сервер получают уже готовый порядок.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
for (const id of Object.keys(PRO)) {
  (PRO[id].quiz || []).forEach((q, i) => {
    const rnd = seeded(id + ':' + i);
    const order = q.options.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const right = q.options[q.correct];
    q.options = order.map((k) => q.options[k]);
    q.correct = q.options.indexOf(right);
  });
}

const out = `// Сгенерировано tools/pro/build.js из tools/pro/*.js — не редактируйте вручную.
// Углублённые курсы для провизоров и фармацевтов: заменяют уроки и тесты базовых курсов из data.js.
(function () {
  const PRO = ${JSON.stringify(PRO, null, 1)};
  window.COURSES.forEach((c) => { if (PRO[c.id]) Object.assign(c, PRO[c.id]); });
})();
`;

// Проверка структуры до записи
const sb = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), sb);
const before = Object.fromEntries(sb.window.COURSES.map((c) => [c.id, c.lessons.length]));
vm.runInNewContext(out, sb);
let errors = 0;
for (const c of sb.window.COURSES) {
  c.quiz.forEach((q, i) => {
    if (!q.q || !Array.isArray(q.options) || q.options.length < 3 || !(q.correct >= 0 && q.correct < q.options.length) || !q.explain) {
      console.error(`${c.id}: вопрос ${i + 1} оформлен неверно`); errors++;
    }
  });
  c.lessons.forEach((l, i) => { if (!l.title || !l.html || !l.minutes || !Array.isArray(l.takeaways)) { console.error(`${c.id}: урок ${i + 1} оформлен неверно`); errors++; } });
  if (c.lessons.length < before[c.id]) { console.error(`${c.id}: уроков стало меньше (${c.lessons.length} < ${before[c.id]}) — сломается сохранённый прогресс`); errors++; }
}
if (errors) process.exit(1);
fs.writeFileSync(path.join(root, 'js/data-pro.js'), out);
console.log('js/data-pro.js: ' + files.length + ' курсов — ' + files.map((f) => f.replace('.js', '')).join(', '));
