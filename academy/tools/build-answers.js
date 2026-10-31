// Генерирует api/answers.php — ключ ответов для проверки тестов на сервере.
// Запуск после изменения js/data.js:  node tools/build-answers.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), sandbox);

const lines = sandbox.window.COURSES.map((c) => {
  const keys = c.quiz.map((q) => q.correct).join(', ');
  const title = c.title.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  '${c.id}' => ['title' => '${title}', 'lessons' => ${c.lessons.length}, 'answers' => [${keys}]],`;
});

const php = `<?php
// Сгенерировано tools/build-answers.js из js/data.js — не редактируйте вручную.
return [
${lines.join('\n')}
];
`;
fs.writeFileSync(path.join(root, 'api/answers.php'), php);
console.log('api/answers.php: ' + lines.length + ' courses');
