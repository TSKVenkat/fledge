# turtle support

`turtle` is not part of Pyodide, and the standard library's implementation draws
into Tk. fledge ships its own module that draws onto a canvas instead.

It covers the vocabulary school worksheets use rather than the whole interface.
**Anything not listed below raises `NotImplementedError` naming itself**, so a
teacher meets a clear sentence rather than a traceback from inside the runtime:

```
NotImplementedError: turtle.onkey() is not available here yet.
```

## Supported

**Movement** — `forward` / `fd`, `backward` / `bk` / `back`, `right` / `rt`,
`left` / `lt`, `goto` / `setpos` / `setposition`, `setheading` / `seth`, `home`,
`circle`

**Pen** — `penup` / `pu` / `up`, `pendown` / `pd` / `down`, `pensize` / `width`,
`pencolor`, `fillcolor`, `color`, `begin_fill`, `end_fill`, `dot`, `stamp`,
`write`

**State** — `position`, `xcor`, `ycor`, `heading`, `distance`, `speed`,
`hideturtle` / `ht`, `showturtle` / `st`, `isdown`, `clear`, `reset`

**Screen** — `Screen()`, `bgcolor`, `title`, `setup`, `tracer`, `update`,
`done` / `mainloop`, `exitonclick`

Colours may be given as a name (`"red"`), as a hex string (`"#ff0000"`), or as
an RGB triple. Both styles work: `turtle.forward(100)` at module level, and
`t = turtle.Turtle()` for one or many turtles.

### `circle()`

`circle` approximates an arc with a regular polygon whose step count grows with
the radius, which is what the standard library documents. A simpler
implementation diverges visibly from the picture a textbook shows, which matters
when a child is comparing their screen to a worksheet.

## Not supported

**Events** — `onkey`, `onkeypress`, `onclick`, `onscreenclick`, `ontimer`,
`listen`. These need input to reach a suspended interpreter, which is only
possible on the isolated tier; supporting them would mean a feature that works
in the editor and fails in every embed.

**Dialogs** — `numinput`, `textinput`. Use `input()`.

**Tk internals** — `getcanvas`, `getscreen`, `register_shape`, `addshape`,
`shape`.

If a worksheet you use needs something on this list, open an issue and say which
worksheet. That is far more useful than a general request.
