#!/usr/bin/env python3
"""Снимок лекарственного каталога vivafarm.md для справочника по МНН (js/assortment.js).

Запуск:  python3 tools/vf-catalog.py
Собирает название, ссылку и раздел каждого товара в «Лекарства и БАДы»; МНН берётся из скобок в названии.
Это снимок каталога, а не остатки аптек: наличие уточняется в программе аптеки.
"""
import html, json, re, sys, time, urllib.request, os

BASE = 'https://vivafarm.md'
UA = {'User-Agent': 'Mozilla/5.0 (VivaAcademy catalog snapshot)'}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode('utf-8', 'ignore')

root = get(BASE + '/catalog/lekarstva_i_bady/')
cats = sorted(set(re.findall(r'href="(/catalog/lekarstva_i_bady/[a-z_]+/)"', root)))
names = dict(re.findall(r'href="(/catalog/lekarstva_i_bady/[a-z_]+/)"[^>]*title="([^"]+)"', root))
items, seen = [], set()
for cat in cats:
    title = html.unescape(names.get(cat, cat.strip('/').split('/')[-1]))
    for page in range(1, 80):
        url = BASE + cat + (f'?PAGEN_1={page}' if page > 1 else '')
        try:
            s = get(url)
        except Exception as e:
            break
        found = re.findall(r'class="item-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>\s*<span>([^<]+)', s)
        new = [(h, html.unescape(n.strip())) for h, n in found if h not in seen]
        if not new:
            break
        for h, n in new:
            seen.add(h)
            m = re.findall(r'\(([^()]+)\)\s*(?:\*+)?\s*$', n)
            items.append({'n': n, 'u': h, 'c': title, 'm': m[-1].strip() if m else ''})
        time.sleep(0.35)
    print(f'{title}: {sum(1 for i in items if i["c"] == title)}', file=sys.stderr)

out = os.path.join(os.path.dirname(__file__), '..', 'js', 'assortment.js')
with open(out, 'w', encoding='utf-8') as f:
    f.write('// Снимок каталога vivafarm.md (раздел «Лекарства и БАДы») от ' + time.strftime('%d.%m.%Y') +
            '. Сгенерировано tools/vf-catalog.py — не редактируйте вручную.\n')
    f.write('window.ASSORTMENT = {date: ' + json.dumps(time.strftime('%d.%m.%Y')) + ', items: ' +
            json.dumps(items, ensure_ascii=False, separators=(',', ':')) + '};\n')
print(f'{len(items)} товаров → js/assortment.js', file=sys.stderr)
