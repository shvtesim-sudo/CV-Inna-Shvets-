// Превращает пакет тестов Вивафарм (tools/test-bank.json) в курсы Академии: js/data-viva.js.
// Запуск:  node tools/import-test-bank.js && node tools/build-answers.js
// В test-bank.json номер правильного варианта — с 1 (correctOption), в курсах — с 0.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-bank.json'), 'utf8'));

// id теста → название в Академии (совпадает с названием в импорте прежних результатов) и иконка
const META = {
  revyline_25: ['Revyline — профессиональная консультация', '🪥'],
  solution_selling_vivafarm: ['Solution Selling и архитектура решений VivaFarm', '💼'],
  seborrhea: ['Себорея, себорейный дерматит, кетоконазол 2% и триаж выпадения волос', '🧴'],
  hair_length: ['Активы и формулы для длины волос', '💇'],
  hair_consultation: ['Себорея, перхоть и выпадение волос: консультация за первым столом', '💆'],
  tylol_anzibel: ['Один день из жизни фармацевта: Tylol и Anzibel', '🤒'],
  siddhayu_natures_only: ['Siddhayu и Natures Only', '🌿'],
  orvi_first_table: ['Сезон ОРВИ у первого стола ВиваФарм', '🤧'],
  melatonin: ['Мелатонин в аптечной практике', '🌙'],
  retinol: ['Ретинол: от состава до грамотной консультации', '✨'],
  autumn_blues: ['Осенняя хандра у первого стола', '🍂']
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const courses = bank.tests.map((t) => {
  const meta = META[t.id];
  if (!meta) throw new Error('Нет названия для теста ' + t.id + ' — добавьте его в META');
  const [title, icon] = meta;
  // Конспект: пояснения к вопросам, сгруппированные по темам в порядке появления
  const topics = new Map();
  t.questions.forEach((q) => {
    const k = q.topic || 'Ключевые положения';
    if (!topics.has(k)) topics.set(k, []);
    if (q.explanation) topics.get(k).push(q.explanation);
  });
  const html = `
<p>Ключевые положения тренинга «${esc(title)}». Прочитайте конспект перед итоговым тестом: для сертификата нужно ответить верно не меньше чем на ${t.passingPercentage}% вопросов.</p>
${Array.from(topics).map(([k, items]) => `<h3>${esc(k)}</h3>
<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('\n')}`;
  const takeaways = Array.from(topics.values()).map((items) => items[0]).filter(Boolean).slice(0, 3);
  return {
    id: t.id,
    title,
    short: t.description,
    category: 'viva',
    level: 'Базовый',
    icon,
    legacy: title,
    lessons: [{ title: 'Конспект перед тестом', minutes: Math.max(5, Math.round(t.questions.length * 0.6)), html, takeaways }],
    quiz: t.questions.map((q) => {
      if (q.options.length < 2 || q.correctOption < 1 || q.correctOption > q.options.length) {
        throw new Error(`${t.id}, вопрос ${q.number}: неверный номер правильного ответа`);
      }
      return { q: q.text, options: q.options, correct: q.correctOption - 1, explain: q.explanation || '' };
    })
  };
});

const out = `// Сгенерировано tools/import-test-bank.js из tools/test-bank.json — не редактируйте вручную.
// Тренинги Вивафарм: тесты, которые сотрудники проходили до запуска Академии.
window.CATEGORIES.viva = 'Тренинги Вивафарм';
window.COURSES.push(...${JSON.stringify(courses, null, 1)});
`;
fs.writeFileSync(path.join(root, 'js/data-viva.js'), out);
console.log('js/data-viva.js: ' + courses.length + ' курсов, ' + courses.reduce((n, c) => n + c.quiz.length, 0) + ' вопросов');
