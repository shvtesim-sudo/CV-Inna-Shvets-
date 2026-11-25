# Инструкция по сайту (слайды с голосом)

Файлы в `academy/guide/`: `sNN.jpg` — экран слайда, `sNN.mp3` — озвучка, `vivaacademy-instrukciya.mp4` — всё видео целиком.
Инструкция для руководителей — так же в `academy/guide/admin/` (тексты в `slides-admin.json`, видео `vivaacademy-rukovoditelyu.mp4`).
Тексты слайдов — в `slides.json`: `t` — заголовок, `x` — подпись на сайте (она же в `GUIDE` в `js/app.js`), `s` — текст для озвучки
(«эм эн эн», «пэ дэ эф» и ударения знаком U+0301, чтобы синтезатор читал правильно).

Озвучка сделана синтезатором речи Piper (голос ru_RU-irina-medium):

    pip install piper-tts
    python3 -m piper -m ru_RU-irina-medium.onnx -f v01.wav --length-scale 1.05 --sentence-silence 0.35 < text.txt
    ffmpeg -i v01.wav -af "adelay=300,loudnorm=I=-16:TP=-1.5,apad=pad_dur=0.4" -ac 1 -ar 24000 -b:a 64k s01.mp3

Видео: каждый кадр (`sNN.jpg` + полоса с заголовком) длится столько, сколько его `sNN.mp3`, затем ролики склеиваются `ffmpeg -f concat`.
