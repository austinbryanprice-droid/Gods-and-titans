"""Render the intro film's narration (src/intro/voiceover.js plays it) with Kokoro, an open neural voice model.

    python3 -m venv venv && ./venv/bin/pip install kokoro-onnx soundfile
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
    ./venv/bin/python tools/narration/render.py --models . [--voice bm_george] [--speed 0.85] [--out assets/narration]

Needs ffmpeg with libmp3lame. Each line is written as a mono 64 kbps MP3 at -20 LUFS (true peak -2 dBTP), with a
little low end added and the rumble cut, so the clips sit where the score under the film expects a voice. The lines
must match CAPTIONS in src/intro/script.js word for word (tests/intro/voiceover.test.js checks the files are there):
change a caption, change it here, and render again. Kokoro-82M and its voices are Apache 2.0.
"""
import argparse, os, subprocess, tempfile

import soundfile as sf
from kokoro_onnx import Kokoro

# file name, the caption, and what Kokoro is given to read (punctuation shapes the delivery)
LINES = [
    ('raise-a-city', 'Raise a city of the faithful', 'Raise a city of the faithful.'),
    ('summon-the-gods', 'Pray. Summon the gods.', 'Pray. Summon the gods.'),
    ('lead-them-to-war', 'Lead them to war', 'Lead them to war.'),
    ('unleash-the-titans', 'Unleash the titans', 'Unleash the titans!'),
    ('one-war', 'Ten mythologies. One war.', 'Ten mythologies. One war.'),
]

CHAIN = ','.join([
    'silenceremove=start_periods=1:start_threshold=-50dB',
    'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    'highpass=f=70',
    'lowshelf=f=160:g=2.5',
    'equalizer=f=3000:t=q:w=1:g=1',
    'apad=pad_dur=0.08',
    'loudnorm=I=-20:TP=-2:LRA=11:linear=true',
    'aresample=24000',
])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', default='.', help='folder with kokoro-v1.0.onnx and voices-v1.0.bin')
    ap.add_argument('--voice', default='bm_george')
    ap.add_argument('--speed', type=float, default=0.85)
    ap.add_argument('--out', default='assets/narration')
    a = ap.parse_args()
    k = Kokoro(os.path.join(a.models, 'kokoro-v1.0.onnx'), os.path.join(a.models, 'voices-v1.0.bin'))
    lang = 'en-gb' if a.voice.startswith('b') else 'en-us'
    os.makedirs(a.out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, _caption, said in LINES:
            samples, rate = k.create(said, voice=a.voice, speed=a.speed, lang=lang)
            wav = os.path.join(tmp, name + '.wav')
            sf.write(wav, samples, rate)
            mp3 = os.path.join(a.out, name + '.mp3')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', CHAIN, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', mp3], check=True)
            print(f'{mp3}  {len(samples) / rate:.2f} s')


if __name__ == '__main__':
    main()
