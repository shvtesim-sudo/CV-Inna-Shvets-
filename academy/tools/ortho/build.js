// Собирает раздел «Ортопедия» (tools/ortho/*.js) в js/data-ortho.js: 4 курса-блока по ассортименту Крейт.
// Каждый файл делает ORTHO.push({ id, title, short, icon, videos, lessons, quiz }).
// Запуск:  node tools/ortho/build.js && node tools/build-answers.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const root = path.join(dir, '..', '..');
const ORTHO = [];
fs.readdirSync(dir).filter((f) => /^\d.*\.js$/.test(f)).sort()
  .forEach((f) => vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), { ORTHO }, { filename: f }));

// Варианты ответов перемешиваются один раз здесь (детерминированно), чтобы правильный не стоял всегда вторым
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
let errors = 0;
for (const c of ORTHO) {
  Object.assign(c, { category: 'ortho', level: 'Базовый' });
  if (c.quiz.length !== 20) { console.error(`${c.id}: ${c.quiz.length} вопросов вместо 20`); errors++; }
  c.quiz.forEach((q, i) => {
    if (!q.q || q.options.length < 3 || !(q.correct >= 0 && q.correct < q.options.length) || !q.explain) { console.error(`${c.id}: вопрос ${i + 1} оформлен неверно`); errors++; }
    const rnd = seeded(c.id + ':' + i);
    const order = q.options.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const right = q.options[q.correct];
    q.options = order.map((k) => q.options[k]);
    q.correct = q.options.indexOf(right);
  });
  c.lessons.forEach((l, i) => { if (!l.title || !l.html || !l.minutes || !Array.isArray(l.takeaways)) { console.error(`${c.id}: урок ${i + 1} оформлен неверно`); errors++; } });
}
if (errors) process.exit(1);

const META = {
  supplier: 'ООО «Крейт», Санкт-Петербург',
  site: 'https://www.kreitspb.ru',
  youtube: 'https://www.youtube.com/c/Kreitpetersburg/featured',
  novelties: ['Массажёры-валики «Кукуруза»', 'Самонагревающиеся грелки для рук, ног и тела']
};

const out = `// Сгенерировано tools/ortho/build.js из tools/ortho/*.js — не редактируйте вручную.
// Раздел «Ортопедия»: 4 блока по ассортименту Крейт, в каждом уроки и тест из 20 вопросов.
(function () {
  window.CATEGORIES.ortho = 'Ортопедия';
  const BLOCKS = ${JSON.stringify(ORTHO, null, 1)};
  window.ORTHO = Object.assign(${JSON.stringify(META)}, { blocks: BLOCKS.map((c) => c.id) });
  BLOCKS.forEach((c) => window.COURSES.push(c));
})();
`;
fs.writeFileSync(path.join(root, 'js/data-ortho.js'), out);
console.log('js/data-ortho.js: ' + ORTHO.map((c) => `${c.id} (${c.lessons.length} ур., ${c.quiz.length} вопр.)`).join(', '));
