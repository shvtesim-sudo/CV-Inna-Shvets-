#!/usr/bin/env python3
"""Свойства товаров vivafarm.md для справочника по МНН: МНН, форма выпуска, способ применения, рецептурность.

Запуск:  python3 tools/vf-props.py   (после tools/vf-catalog.py; потом node tools/assortment-enrich.js)
Берёт пути товаров из js/assortment.js, открывает карточку каждого товара и читает блок характеристик
(schema.org additionalProperty). Результат копится в tools/vf-props.json — повторный запуск
дочитывает только новые товары (ключ --all перечитывает всё).
"""
import gzip, html, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ASSORT = os.path.join(HERE, '..', 'js', 'assortment.js')
CACHE = os.path.join(HERE, 'vf-props.json')
UA = {'User-Agent': 'Mozilla/5.0 (VivaAcademy catalog snapshot)', 'Accept-Encoding': 'gzip'}
WANT = {'МНН': 'mnn', 'Форма выпуска': 'form', 'Способ применения': 'route', 'Отпускается по рецепту': 'rx'}

src = open(ASSORT, encoding='utf-8').read()
data = json.loads(src[src.index('{'):src.rindex('}') + 1])
base = data['base']
paths = [r[1] for r in data['rows']]
cache = {} if '--all' in sys.argv or not os.path.exists(CACHE) else json.load(open(CACHE, encoding='utf-8'))
todo = [p for p in paths if p not in cache]
print(f'товаров {len(paths)}, уже прочитано {len(paths) - len(todo)}, читаем {len(todo)}', file=sys.stderr)

PROP = re.compile(r'itemprop="name"[^>]*>\s*(?:<[^>]+>\s*)*([^<]*?)\s*<.*?itemprop="value"[^>]*>\s*(?:<[^>]+>\s*)*([^<]*?)\s*<', re.S)

def fetch(p):
    url = p if p.startswith('http') else (base + p if not p.startswith('/') else 'https://vivafarm.md' + p)
    for attempt in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40)
            b = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                b = gzip.decompress(b)
            s = b.decode('utf-8', 'ignore')
            props = {}
            i = s.find('additionalProperty')
            for name, value in PROP.findall(s[i:] if i >= 0 else ''):
                key = WANT.get(html.unescape(name).strip())
                if key and key not in props:
                    props[key] = html.unescape(value).strip()
            time.sleep(0.3)
            return p, props
        except Exception:
            time.sleep(2 + attempt * 3)
    return p, None

done = 0
with ThreadPoolExecutor(4) as ex:
    for p, props in ex.map(fetch, todo):
        if props is not None:
            cache[p] = props
        done += 1
        if done % 200 == 0:
            print(f'  {done}/{len(todo)}', file=sys.stderr)
            json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, sort_keys=True, indent=0)
cache = {p: cache[p] for p in paths if p in cache}  # убрать товары, которых больше нет в каталоге
json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, sort_keys=True, indent=0)
withm = sum(1 for v in cache.values() if v.get('mnn'))
print(f'готово: {len(cache)} карточек, с МНН {withm}', file=sys.stderr)
