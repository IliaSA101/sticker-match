# Собирает иконки приложения из art/icon-source.png: python tools/make-icons.py
#
# Android показывает у адаптивной иконки только центральные 2/3 плитки (маска круга или
# сквиркла срезает края), поэтому картинка вписывается в безопасную зону, а поля заливаются
# цветом фона, взятым из углов исходника.

from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'icon-source.png'
RES = ROOT / 'app' / 'src' / 'main' / 'res'

SAFE_SCALE = 0.86          # доля плитки, которую занимает картинка
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def trim(im, tolerance=24):
    """Срезает однородное поле вокруг картинки (модель часто рисует плитку на белом листе)."""
    corner = im.getpixel((2, 2))
    mask = Image.new('L', im.size, 0)
    pixels = im.load()
    mask_pixels = mask.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            p = pixels[x, y]
            if max(abs(p[i] - corner[i]) for i in range(3)) > tolerance:
                mask_pixels[x, y] = 255
    box = mask.getbbox()
    if box is None:
        return im
    left, top, right, bottom = box
    # приводим к квадрату, чтобы не искажать пропорции
    side = max(right - left, bottom - top)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    left = max(0, min(w - side, cx - side // 2))
    top = max(0, min(h - side, cy - side // 2))
    return im.crop((left, top, left + side, top + side))


def background_color(im):
    """Цвет плитки берём с середин сторон: углы у скруглённой плитки уже не её."""
    w, h = im.size
    inset = max(2, int(w * 0.04))
    points = [(w // 2, inset), (w // 2, h - inset), (inset, h // 2), (w - inset, h // 2)]
    colors = sorted(im.getpixel(p) for p in points)
    return colors[len(colors) // 2]


def fill_corners(im, color, radius_ratio=0.22):
    """Заливает скруглённые углы плитки цветом фона, чтобы они не выделялись."""
    out = Image.new('RGB', im.size, color)
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                           radius=int(im.size[0] * radius_ratio), fill=255)
    out.paste(im, (0, 0), mask)
    return out


def fitted_tile(im, color, size=1024):
    tile = Image.new('RGB', (size, size), color)
    art = int(size * SAFE_SCALE)
    tile.paste(im.resize((art, art), Image.LANCZOS), ((size - art) // 2, (size - art) // 2))
    return tile


def rounded(im, radius_ratio=0.22):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                           radius=int(im.size[0] * radius_ratio), fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def main():
    source = trim(Image.open(SRC).convert('RGB'))
    color = background_color(source)
    tile = fitted_tile(fill_corners(source, color), color)

    for density, size in FOREGROUND.items():
        folder = RES / f'mipmap-{density}'
        folder.mkdir(parents=True, exist_ok=True)
        tile.resize((size, size), Image.LANCZOS).save(folder / 'ic_launcher_fg.png')

    # запасной вариант для лаунчеров, которые не умеют адаптивные иконки
    for density, size in LEGACY.items():
        folder = RES / f'mipmap-{density}'
        rounded(tile.resize((size, size), Image.LANCZOS)).save(folder / 'ic_launcher.png')

    hex_color = '#%02X%02X%02X' % color
    (RES / 'values' / 'colors.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="bg">#0F1420</color>\n'
        f'    <color name="icon_bg">{hex_color}</color>\n'
        '</resources>\n', encoding='utf-8')

    print('фон иконки:', hex_color)
    print('готово:', ', '.join(sorted(FOREGROUND)))


if __name__ == '__main__':
    main()
