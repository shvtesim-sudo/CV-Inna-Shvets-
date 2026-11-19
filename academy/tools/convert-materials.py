#!/usr/bin/env python3
"""Делает PDF-копии презентаций PowerPoint из «Учебных материалов», чтобы их можно было открыть прямо на сайте.

Запускается из GitHub Actions (.github/workflows/academy-cron.yml) каждые 15 минут:
спрашивает у сайта следующую презентацию без PDF, скачивает её, конвертирует LibreOffice
и загружает PDF обратно частями. Оригинал на сайте не меняется.

Окружение: SITE (https://vivaacademy.md), CONV_KEY (ключ выкладки, см. deploy-academy.yml).
"""
import base64, json, os, secrets, subprocess, sys, tempfile, time, urllib.request

SITE = os.environ.get('SITE', 'https://vivaacademy.md').rstrip('/')
KEY = os.environ['CONV_KEY']
API = SITE + '/api/index.php?action='
CHUNK = 512 * 1024
MAX_PER_RUN = 5
# Изображения в PDF — до 200 точек на дюйм: на экране телефона и компьютера выглядит чётко, а файл легче
PDF_FILTER = 'pdf:impress_pdf_Export:' + json.dumps({
    'ReduceImageResolution': {'type': 'boolean', 'value': 'true'},
    'MaxImageResolution': {'type': 'long', 'value': '200'},
    'Quality': {'type': 'long', 'value': '85'},
    'ExportNotesPages': {'type': 'boolean', 'value': 'false'},
})


def call(action, data=None, raw=False, timeout=120):
    req = urllib.request.Request(API + action, headers={'X-Conv-Key': KEY, 'User-Agent': 'VivaAcademy converter'},
                                 data=json.dumps(data).encode() if data is not None else None)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            return body if raw else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(3 + attempt * 5)


def convert(m, work):
    ext = os.path.splitext(m['name'])[1].lower() or '.pptx'
    src = os.path.join(work, 'source' + ext)
    with open(src, 'wb') as f:
        f.write(call('conv_source&id=%d' % m['id'], raw=True, timeout=600))
    print('  скачано %.1f МБ' % (os.path.getsize(src) / 1048576))
    subprocess.run(['soffice', '--headless', '--norestore', '--convert-to', PDF_FILTER, '--outdir', work, src],
                   check=True, timeout=900, capture_output=True)
    pdf = os.path.join(work, 'source.pdf')
    if not os.path.exists(pdf) or os.path.getsize(pdf) < 1000:
        raise RuntimeError('LibreOffice не создал PDF')
    print('  PDF %.1f МБ' % (os.path.getsize(pdf) / 1048576))
    token = secrets.token_hex(16)
    with open(pdf, 'rb') as f:
        i = 0
        while True:
            part = f.read(CHUNK)
            if not part:
                break
            call('conv_chunk', {'upload': token, 'index': i, 'data': base64.b64encode(part).decode()})
            i += 1
    call('conv_done', {'id': m['id'], 'upload': token})


def main():
    done = 0
    while done < MAX_PER_RUN:
        m = call('conv_next')['material']
        if not m:
            break
        print('Материал %d: %s' % (m['id'], m['name']))
        with tempfile.TemporaryDirectory() as work:
            try:
                convert(m, work)
                print('  готово')
            except Exception as e:
                msg = (e.stderr.decode('utf-8', 'ignore')[-200:] if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e))[:290]
                print('  ошибка: ' + msg, file=sys.stderr)
                call('conv_fail', {'id': m['id'], 'error': msg})
        done += 1
    print('Обработано презентаций: %d' % done)


if __name__ == '__main__':
    main()
