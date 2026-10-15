"""Extract only driver from the updated multi-view source sheet.

Run: python tools/refresh_driver_assets.py
All RGB values come directly from 素材/角色-driver.png; only the connected
neutral background is made transparent. No other characters are regenerated.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw
from make_drive import build, head_shoulders

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / '素材' / '角色-driver.png'
DEST = ROOT / 'assets' / 'chars'


def isolate(source, box):
    # Coordinates refer to the supplied 1774x887 layout; scale if re-exported.
    sx, sy = source.width / 1774, source.height / 887
    crop = source.crop(tuple(round(v * (sx if i % 2 == 0 else sy)) for i, v in enumerate(box))).convert('RGBA')
    rgb = np.asarray(crop)[..., :3].astype(np.int16)
    neutral = ((rgb.max(axis=2) - rgb.min(axis=2)) < 32) & (rgb.min(axis=2) > 158)
    mask = Image.fromarray(np.where(neutral, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(mask, (0, 0), 128, thresh=0)
    outside = np.asarray(mask) == 128
    alpha = np.where(outside, 0, 255).astype(np.uint8)
    crop.putalpha(Image.fromarray(alpha))
    bbox = crop.getchannel('A').getbbox()
    if not bbox:
        raise ValueError('Empty driver extraction')
    return crop.crop(bbox)


def refresh_driver_assets():
    source = Image.open(SOURCE)
    views = {
        'driver_1': (580, 220, 910, 712),
        'driver_2': (1020, 220, 1285, 722),
        'driver_3': (1390, 220, 1720, 712),
    }
    output = {}
    for name, box in views.items():
        image = isolate(source, box)
        image.save(DEST / (name + '.png'))
        output[name] = image
    head_shoulders(output['driver_3'], .90).save(DEST / 'driver_head.png')
    build('driver', 'driver_1', 'driver_3', .90)
    report = {'source': str(SOURCE.relative_to(ROOT)), 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              'views': {key: {'crop': list(views[key]), 'size': list(im.size)} for key, im in output.items()}}
    out = ROOT / 'tools' / 'out'
    out.mkdir(exist_ok=True)
    (out / 'driver-refresh.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return output


if __name__ == '__main__':
    for name, image in refresh_driver_assets().items():
        print(name, image.size)
