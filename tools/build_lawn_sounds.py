#!/usr/bin/env python3
"""
Fetch the real recordings Apex Lawn uses (Wikimedia Commons: public domain, CC0 and CC BY) and cut
them into small mono WAVs under public/lawn/sfx/ (WAV, so the loops stay gapless in every browser).

  python3 tools/build_lawn_sounds.py

Sources land in assets-src/lawn-sfx (git-ignored). Credits for the CC BY ones: public/lawn/sfx/CREDITS.txt
"""
import os, subprocess, sys, time, wave
import numpy as np
from scipy.signal import butter, sosfiltfilt

SRC = 'assets-src/lawn-sfx'
OUT = 'public/lawn/sfx'
BASE = 'https://upload.wikimedia.org/wikipedia/commons/'
FILES = {
    # name: (path on Commons, licence, title)
    'mower': ('8/81/WWS_Lawnmower.ogg', 'CC BY 4.0', 'WWS Lawnmower (Wikimedia Commons, Wiener Wunder-Sounds)'),
    'thud': ('5/5b/Dull_thud.ogg', 'Public domain', 'Dull thud'),
    'knock': ('1/1c/Knocking_on_wood_or_door.ogg', 'Public domain', 'Knocking on wood or door'),
    'twig': ('0/0d/Snapping_twig_%28single%29.ogg', 'CC0', 'Snapping twig (single)'),
    'anvil': ('f/f8/WWS_Blacksmith8217sanvil.ogg', 'CC BY 4.0', 'WWS Blacksmith\'s anvil'),
    'coins_palm': ('4/46/Shaking_coins_in_palm.ogg', 'Public domain', 'Shaking coins in palm'),
    'coins_metal': ('2/2d/Coins_dropped_in_metallic_moneybox.ogg', 'Public domain', 'Coins dropped in metallic moneybox'),
    'cash': ('7/70/Cash_register.ogg', 'Public domain', 'Cash register'),
    'glock': ('a/a6/Windglockenspiel.Koshi.ogg', 'CC0', 'Windglockenspiel (Koshi)'),
    'chimes': ('0/09/Windchimes.ogg', 'Public domain', 'Windchimes'),
    'applause': ('0/09/Applause_ii.ogg', 'Public domain', 'Applause ii'),
    'birds1': ('7/75/Birdsong_mild_sunny_day.ogg', 'Public domain', 'Birdsong mild sunny day'),
    'birds2': ('0/0e/Gentle_breeze_and_birds_singing.ogg', 'Public domain', 'Gentle breeze and birds singing'),
    'frogs': ('6/60/Night_Chorus_of_Frogs_and_Toads_in_Niger_Delta.ogg', 'CC BY 4.0', 'Night Chorus of Frogs and Toads in Niger Delta'),
}
SR = 32000
SR_AMB = 22050


def fetch():
    os.makedirs(SRC, exist_ok=True)
    for k, (p, _, _) in FILES.items():
        f = f'{SRC}/{k}.ogg'
        for attempt in range(6):
            if os.path.exists(f) and os.path.getsize(f) > 0 and open(f, 'rb').read(4) == b'OggS':
                break
            subprocess.run(['curl', '-s', '-L', '-A', 'ApexGP-asset-fetch/1.0', '-o', f, BASE + p], check=True)
            time.sleep(2 + attempt * 4)  # Commons rate-limits: an error page comes back instead of audio
        else:
            sys.exit(f'could not fetch {k}')


def load(k, sr=SR):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{SRC}/{k}.ogg', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(b, dtype=np.float32).copy()


def write(name, x, sr=SR):
    x = np.clip(x, -1, 1)
    with wave.open(f'{OUT}/{name}.wav', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(f'{name}.wav  {len(x) / sr:.2f}s  {os.path.getsize(f"{OUT}/{name}.wav") // 1024} KB')


def peak_norm(x, db=-2.0):
    return x * (10 ** (db / 20) / (np.abs(x).max() + 1e-9))


def lp(x, hz, sr=SR, order=4):
    return sosfiltfilt(butter(order, hz, btype='low', fs=sr, output='sos'), x).astype(np.float32)


def rms_norm(x, db):
    return x * (10 ** (db / 20) / (np.sqrt(np.mean(x ** 2)) + 1e-9))


def hp(x, hz, sr=SR):
    # one-pole high-pass, enough to clear rumble and DC
    a = np.exp(-2 * np.pi * hz / sr)
    y = np.zeros_like(x)
    p = q = 0.0
    for i, v in enumerate(x):
        y[i] = a * (p + v - q)
        p, q = y[i], v
    return y


def snip(x, t0, dur, fi=0.002, fo=0.06, sr=SR, norm=-2.0):
    s = x[int(t0 * sr):int((t0 + dur) * sr)].copy()
    n = len(s)
    a = max(1, int(fi * sr))
    b = max(1, int(fo * sr))
    s[:a] *= np.linspace(0, 1, a)
    s[-b:] *= np.linspace(1, 0, b)
    return peak_norm(s, norm)


def loop(x, a, b, xf, sr=SR):
    """a seamless loop of x[a:b] seconds: the tail is crossfaded (equal power) over the head"""
    n = int(xf * sr)
    seg = x[int(a * sr):int(b * sr) + n].copy()
    t = np.linspace(0, 1, n)
    cf = seg[:n] * np.sin(t * np.pi / 2) + seg[-n:] * np.cos(t * np.pi / 2)
    return np.concatenate([cf, seg[n:-n]])


def main():
    os.makedirs(OUT, exist_ok=True)
    fetch()

    # the mower: an idle-ish stretch (engine near free-running, ~42 Hz firing) and a loaded one
    # (cutting thick grass, ~48 Hz); the game crossfades them and plays both at the same pitch
    # (the recording has a thin whine at 7 and 11 kHz: low-passed away)
    m = lp(load('mower'), 5800)
    write('mower_lo', rms_norm(loop(m, 6.2, 13.0, 0.6), -18))
    write('mower_hi', rms_norm(loop(m, 46.0, 52.5, 0.6), -18))

    # impacts
    write('thud', peak_norm(load('thud'), -1.5))
    k = load('knock')
    write('knock', snip(k, 4.835, 0.42, 0.001, 0.12))
    write('knock2', snip(k, 2.65, 0.4, 0.001, 0.12))
    write('twig', snip(load('twig'), 0.235, 0.36, 0.001, 0.1))
    an = load('anvil')
    write('clank', snip(an, 5.87, 0.7, 0.001, 0.25))

    # coins: real clinks, pitched on the scale in the game
    cp = load('coins_palm')
    cm = load('coins_metal')
    write('coin1', snip(cp, 1.635, 0.55, 0.001, 0.2))
    write('coin2', snip(cm, 2.695, 0.7, 0.001, 0.25))
    write('coin3', snip(cm, 5.425, 0.7, 0.001, 0.25))
    write('coin4', snip(cm, 0.225, 0.7, 0.001, 0.25))
    write('cash', peak_norm(load('cash')[int(0.7 * SR):], -2.0))

    # chimes for milestones / finishing
    g = load('glock')
    write('glock1', snip(g, 1.885, 2.2, 0.001, 0.6))
    write('glock2', snip(g, 0.455, 2.2, 0.001, 0.6))
    ch = load('chimes')
    write('chime', snip(ch, 1.6, 2.8, 0.001, 0.9))
    ap = load('applause')
    write('applause', snip(ap, 1.2, 4.8, 0.35, 1.6, norm=-6.0))

    # the bed under everything: birds, a breeze, frogs for the dusk
    b1 = load('birds1', SR_AMB)
    write('amb_day', rms_norm(loop(b1, 3.0, 29.0, 2.0, SR_AMB), -26), SR_AMB)
    b2 = load('birds2', SR_AMB)
    write('amb_breeze', rms_norm(loop(b2, 3.0, 17.0, 2.0, SR_AMB), -26), SR_AMB)
    fr = load('frogs', SR_AMB)
    write('amb_dusk', rms_norm(loop(fr, 3.0, 22.0, 2.0, SR_AMB), -26), SR_AMB)

    with open(f'{OUT}/CREDITS.txt', 'w') as f:
        f.write('Recordings from Wikimedia Commons, cut and levelled for Apex Lawn.\n\n')
        for k, (p, lic, title) in FILES.items():
            f.write(f'{title} - {lic} - {BASE}{p}\n')


if __name__ == '__main__':
    main()
