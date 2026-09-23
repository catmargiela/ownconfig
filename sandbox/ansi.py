"""Split ANSI-colored text (as produced by statusline.sh) into styled runs."""
import re

SGR = re.compile(r"\x1b\[([0-9;]*)m")
BASIC = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"]


def xterm256(n):
    """Hex color for an xterm 256-color index."""
    if n < 8:
        return BASIC[n]
    if n < 16:
        return BASIC[n - 8]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        r, g, b = steps[n // 36], steps[(n // 6) % 6], steps[n % 6]
        return "#%02x%02x%02x" % (r, g, b)
    level = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (level, level, level)


def runs(text):
    """Yield (chunk, fg_hex_or_None, bold, dim) for each styled run."""
    fg, bold, dim = None, False, False
    pos = 0
    for match in SGR.finditer(text):
        if match.start() > pos:
            yield text[pos:match.start()], fg, bold, dim
        codes = [int(c) for c in match.group(1).split(";") if c] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg, bold, dim = None, False, False
            elif c == 1:
                bold = True
            elif c == 2:
                dim = True
            elif 30 <= c <= 37:
                fg = BASIC[c - 30]
            elif c == 38 and i + 2 < len(codes) and codes[i + 1] == 5:
                fg = xterm256(codes[i + 2])
                i += 2
            i += 1
        pos = match.end()
    if pos < len(text):
        yield text[pos:], fg, bold, dim
