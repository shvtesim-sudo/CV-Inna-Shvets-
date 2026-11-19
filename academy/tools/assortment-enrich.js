// Дополняет снимок каталога (js/assortment.js): достраивает МНН и определяет форму выпуска.
// Запускается автоматически из tools/vf-catalog.py, можно и вручную:  node tools/assortment-enrich.js
// Строка товара: [название, путь, № раздела, МНН, форма, мнн_достроено(1/0), рецептурный(1/0)]
// Главный источник — карточки товаров на vivafarm.md (tools/vf-props.json, собирает tools/vf-props.py):
// поля «МНН», «Форма выпуска», «Способ применения», «Отпускается по рецепту».
// Если в карточке МНН нет — достраиваем по скобкам в названии, по началу названия и по бренду.
// Формы: o — внутрь, i — инъекции, r — ректально, t — наружно (кожа), e — глаза, n — нос,
//        h — ингаляции, v — вагинально, m — полость рта и горло, '' — не определено
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'js', 'assortment.js');
const src = fs.readFileSync(file, 'utf8');
const sb = { window: {} };
vm.runInNewContext(src, sb);
const A = sb.window.ASSORTMENT;
const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е');

const FORMS = [
  ['e', /глазн/],
  ['n', /назал|в нос|д\/носа|носов|для носа/],
  ['h', /ингал|д\/инг|небул|турбухалер|дискус/],
  ['v', /вагин/],
  ['r', /рект|суппоз|свеч/],
  ['i', /инъек|инфуз|\bамп\b|в\/в|в\/м|лиоф|р-р д\/ин|подкожн/],
  ['o', /внутр|д\/пр\b|приема внутрь|д\/приема/],
  ['m', /рассас|д\/горла|полоскан|полост[ьи] рта|д\/местн|д\/рта|жеват.*резин/],
  ['t', /мазь|крем|гель|лосьон|наруж|паста|бальзам|пластыр|шампун|пена|линимент|лак д\/ногт|присып|раствор д\/наруж|спрей д\/кожи/],
  ['o', /таб|драже|капс|пастил|гранул|порош|\bпор\b|саше|стик|сироп|сусп|капли|эликсир|эмульс|р-р|раствор|настойк|сбор|чай|ф\/п|ф-пак|фильтр-пакет/]
];
const ROUTE = { 'инъекционный': 'инъек', 'инфузионный': 'инфуз', 'ректально': 'рект', 'наружно': 'наруж', 'местно, наружно': 'наруж' };
const formOf = (name, p) => {
  // Название + форма выпуска и способ применения из карточки товара
  const n = norm(name + ' ' + ((p && p.form) || '') + ' ' + ((p && ROUTE[norm(p.route)]) || ''));
  const f = FORMS.find(([, re]) => re.test(n));
  if (f) return f[0];
  return p && norm(p.route) === 'внутреннее' ? 'o' : '';
};
const propsFile = path.join(__dirname, 'vf-props.json');
const PROPS = fs.existsSync(propsFile) ? JSON.parse(fs.readFileSync(propsFile, 'utf8')) : {};
const BAD_MNN = /^(-|—|нет|не указано|отсутствует|бад|комбинированн.*|гомеопат.*|.*полоск.*)$/i;
const siteMnn = (u) => { const m = String((PROPS[u] && PROPS[u].mnn) || '').replace(/\s+/g, ' ').trim(); return m && !BAD_MNN.test(m) ? m : ''; };
// МНН из карточки сайта важнее, чем из скобок в названии
let fromSite = 0;
A.rows.forEach((r) => { if (BAD_MNN.test(r[3] || '')) r[3] = ''; });
A.rows = A.rows.map((r) => { const m = siteMnn(r[1]); if (m) { fromSite++; return [r[0], r[1], r[2], m]; } return [r[0], r[1], r[2], r[5] ? '' : r[3]]; }); // достроенное в прошлый раз считаем заново

// Известные МНН (из скобок в названиях) — для достраивания по началу названия
const known = Array.from(new Set(A.rows.map((r) => r[3]).filter((m) => m && m.length >= 4 && !/[+/]/.test(m)))).sort((a, b) => b.length - a.length);
const knownNorm = known.map((m) => [norm(m), m]);
// Бренд (первое слово) → МНН, если у всех товаров бренда с указанным МНН оно одинаковое
const brandOf = (name) => norm(name).replace(/^["«]/, '').split(/[\s(]/)[0];
const brandMnn = {};
A.rows.forEach((r) => {
  if (!r[3]) return;
  const b = brandOf(r[0]);
  if (b.length < 3) return;
  brandMnn[b] = brandMnn[b] === undefined || brandMnn[b] === r[3] ? r[3] : null;
});

let filledStart = 0, filledBrand = 0;
A.rows = A.rows.map((r) => {
  let [n, u, c, m] = r;
  let guessed = 0;
  if (!m) {
    const nn = norm(n);
    const hit = knownNorm.find(([k]) => nn.startsWith(k + ' ') || nn.startsWith(k + '-') || nn === k);
    if (hit) { m = hit[1]; guessed = 1; filledStart++; }
    else {
      const bm = brandMnn[brandOf(n)];
      if (bm) { m = bm; guessed = 1; filledBrand++; }
    }
  }
  const p = PROPS[u];
  return [n, u, c, m || '', formOf(n, p), guessed, p && norm(p.rx) === 'да' ? 1 : 0];
});
A.forms = { o: 'Внутрь', i: 'Инъекции', r: 'Ректально', t: 'Наружно (кожа)', e: 'Глаза', n: 'Нос', h: 'Ингаляции', v: 'Вагинально', m: 'Полость рта и горло' };

const header = src.split('\n')[0];
fs.writeFileSync(file, header + '\nwindow.ASSORTMENT = ' + JSON.stringify(A) + ';\n');
const withM = A.rows.filter((r) => r[3]).length;
const withF = A.rows.filter((r) => r[4]).length;
const rx = A.rows.filter((r) => r[6]).length;
console.log(`Карточек прочитано: ${Object.keys(PROPS).length}; МНН с сайта: ${fromSite}; рецептурных: ${rx}`);
console.log(`МНН: ${withM} из ${A.rows.length} (достроено по названию ${filledStart}, по бренду ${filledBrand}); форма определена: ${withF}`);
