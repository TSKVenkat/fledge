"""A turtle that draws onto a canvas instead of into Tk.

Scope is deliberately the vocabulary school worksheets use, not the whole of
CPython's turtle. Anything unsupported raises a NotImplementedError naming
itself, because a teacher hitting `onkey` deserves to be told it is missing
rather than handed a traceback from inside our bootstrap.

`circle` follows CPython's approach — a regular polygon approximation whose step
count grows with the radius — because a naive implementation diverges visibly
from what the textbook picture shows.
"""
import math

from _fledge_draw import emit as _emit


def _col(c):
    """Accept 'red', '#ff0000' and (r, g, b) as CPython's turtle does."""
    if isinstance(c, (tuple, list)):
        r, g, b = (int(v * 255) if isinstance(v, float) and v <= 1 else int(v) for v in c[:3])
        return "#%02x%02x%02x" % (r, g, b)
    return str(c)


class Turtle:
    def __init__(self):
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._down = True
        self._pen = "#111111"
        self._fill = "#111111"
        self._width = 2.0
        self._visible = True
        self._speed = 6
        self._filling = None
        self._degrees = 360.0

    # -- movement -----------------------------------------------------------
    def forward(self, distance):
        rad = math.radians(self._heading * (360.0 / self._degrees))
        nx = self._x + math.cos(rad) * distance
        ny = self._y + math.sin(rad) * distance
        self.goto(nx, ny)

    def backward(self, distance):
        self.forward(-distance)

    def right(self, angle):
        self._heading -= angle

    def left(self, angle):
        self._heading += angle

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        if self._down:
            _emit({"op": "line", "x1": self._x, "y1": self._y, "x2": x, "y2": y,
                   "color": self._pen, "width": self._width})
        if self._filling is not None:
            self._filling.append(x)
            self._filling.append(y)
        self._x, self._y = float(x), float(y)

    def setheading(self, angle):
        self._heading = angle

    def home(self):
        self.goto(0, 0)
        self._heading = 0.0

    def circle(self, radius, extent=None, steps=None):
        # CPython picks the step count from the extent so a small arc is not
        # over-tessellated and a full circle still looks round.
        if extent is None:
            extent = self._degrees
        if steps is None:
            frac = abs(extent) / self._degrees
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = extent / steps
        w2 = 0.5 * w
        length = 2.0 * radius * math.sin(math.radians(w2 * (360.0 / self._degrees)))
        if radius < 0:
            length, w, w2 = -length, -w, -w2
        self.left(w2)
        for _ in range(steps):
            self.forward(length)
            self.left(w)
        self.right(w2)

    # -- pen ----------------------------------------------------------------
    def penup(self):
        self._down = False

    def pendown(self):
        self._down = True

    def pensize(self, width=None):
        if width is None:
            return self._width
        self._width = float(width)

    def pencolor(self, *c):
        if not c:
            return self._pen
        self._pen = _col(c[0] if len(c) == 1 else c)

    def fillcolor(self, *c):
        if not c:
            return self._fill
        self._fill = _col(c[0] if len(c) == 1 else c)

    def color(self, *c):
        if not c:
            return (self._pen, self._fill)
        self.pencolor(c[0])
        self.fillcolor(c[1] if len(c) > 1 else c[0])

    def begin_fill(self):
        self._filling = [self._x, self._y]

    def end_fill(self):
        if self._filling and len(self._filling) >= 6:
            _emit({"op": "poly", "points": list(self._filling), "fill": self._fill})
        self._filling = None

    def dot(self, size=None, *color):
        r = (size or max(self._width + 4, self._width * 2)) / 2.0
        _emit({"op": "dot", "x": self._x, "y": self._y, "r": r,
               "color": _col(color[0]) if color else self._pen})

    def stamp(self):
        self.dot(self._width * 4)

    def write(self, arg, move=False, align="left", font=("Arial", 12, "normal")):
        _emit({"op": "text", "x": self._x, "y": self._y, "text": str(arg),
               "color": self._pen, "font": "%dpx %s" % (int(font[1]), font[0])})

    # -- state --------------------------------------------------------------
    def position(self):
        return (self._x, self._y)

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        return self._heading % self._degrees

    def distance(self, x, y=None):
        if hasattr(x, "position"):
            x, y = x.position()
        elif y is None:
            x, y = x
        return math.hypot(x - self._x, y - self._y)

    def speed(self, s=None):
        if s is None:
            return self._speed
        self._speed = s

    def hideturtle(self):
        self._visible = False

    def showturtle(self):
        self._visible = True

    def isdown(self):
        return self._down

    def clear(self):
        _emit({"op": "clear"})

    def reset(self):
        self.clear()
        self.__init__()

    # Aliases CPython provides and worksheets use.
    fd, bk, back, rt, lt = forward, backward, backward, right, left
    up, down, pu, pd = penup, pendown, penup, pendown
    setpos, setposition, seth = goto, goto, setheading
    width, ht, st = pensize, hideturtle, showturtle


class _Screen:
    def bgcolor(self, *c):
        if c:
            _emit({"op": "bg", "color": _col(c[0] if len(c) == 1 else c)})

    def title(self, *_a):
        pass

    def setup(self, *_a, **_k):
        pass

    def tracer(self, *_a, **_k):
        pass

    def update(self):
        pass

    def exitonclick(self):
        pass

    def mainloop(self):
        pass

    done = mainloop

    def __getattr__(self, name):
        def _missing(*_a, **_k):
            raise NotImplementedError(
                "turtle.Screen().%s() is not available here yet." % name)
        return _missing


_screen = _Screen()


def Screen():
    return _screen


_t = Turtle()

# Module-level functional API: turtle.forward(100) as well as t.forward(100).
_EXPORT = [n for n in dir(Turtle) if not n.startswith("_")]
for _name in _EXPORT:
    globals()[_name] = getattr(_t, _name)

bgcolor = _screen.bgcolor
done = _screen.mainloop
mainloop = _screen.mainloop
exitonclick = _screen.exitonclick
tracer = _screen.tracer
update = _screen.update


def _unsupported(name):
    def _missing(*_a, **_k):
        raise NotImplementedError("turtle.%s() is not available here yet." % name)
    return _missing


for _name in ("onkey", "onkeypress", "onclick", "onscreenclick", "ontimer",
              "listen", "numinput", "textinput", "getcanvas", "getscreen",
              "register_shape", "addshape", "shape"):
    globals()[_name] = _unsupported(_name)
