"""Generate PNG app icons with the standard library only (no Pillow needed)."""
import struct, zlib, math, pathlib

OUT = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "icons"
BLUE, WHITE = (11, 79, 209), (255, 255, 255)


def png(path, size, maskable):
    ss = 2  # supersample
    n = size * ss
    scale = n / 512
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    px, py = (x * ss + sx) / scale, (y * ss + sy) / scale
                    col = shade(px, py, maskable)
                    for i in range(4):
                        acc[i] += col[i]
            row += bytes(int(round(c / (ss * ss))) for c in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def in_round_rect(x, y, r):
    if x < 0 or y < 0 or x > 512 or y > 512:
        return False
    cx = min(max(x, r), 512 - r)
    cy = min(max(y, r), 512 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y, maskable):
    if not maskable and not in_round_rect(x, y, 112):
        return (0, 0, 0, 0)
    k = 0.72 if maskable else 1.0  # keep glyph inside the maskable safe zone
    ux, uy = 256 + (x - 256) / k, 256 + (y - 256) / k
    d = math.hypot(ux - 256, uy - 176)
    if d <= 30:
        return (*BLUE, 255)
    if d <= 72:
        return (*WHITE, 255)
    # shoulders: stroked arc y = 264.. of ellipse
    ex, ey = (ux - 256) / 152, (uy - 400) / 136
    r = math.hypot(ex, ey)
    stroke = 22 / 140
    if uy <= 400 and abs(r - 1) <= stroke:
        return (*WHITE, 255)
    return (*BLUE, 255)


if __name__ == "__main__":
    png(OUT / "icon-192.png", 192, False)
    png(OUT / "icon-512.png", 512, False)
    png(OUT / "icon-maskable-512.png", 512, True)
    print("icons written")
