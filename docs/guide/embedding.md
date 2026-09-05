# Embedding

An embed is a runnable snippet inside a page you already have — a worksheet, a
blog post, a virtual learning environment. The hosting page needs to change
nothing: no headers, no configuration, no co-operation.

## Putting one in a page

Create a share link for a project, then use its token:

```html
<script src="https://fledge-sandbox.example.net/embed.js"
        data-fledge="TOKEN" data-height="380"></script>
```

That script is under a kilobyte and has no dependencies. It inserts the iframe
and resizes it to fit the example. If your page cannot run scripts, write the
iframe yourself and give it a fixed height:

```html
<iframe src="https://fledge-sandbox.example.net/embed/TOKEN"
        style="width:100%;height:420px;border:1px solid #ddd;border-radius:8px"
        title="Python example"></iframe>
```

## What a reader gets

Everything runs in the reader's own browser. They can edit the code and run it
again; nothing they do is saved, and nothing reaches your instance.

On every current browser — Chrome, Edge, Firefox and Safari — `input()` prompts
and waits, exactly as in the editor.

On an older browser without the capability that makes that possible, the embed
shows an **Input** box to fill in before pressing Run, reads its lines in order,
says so, and offers a **Run interactively** link that opens the program on your
instance. You can see that mode on any browser by adding `?tier=batch` to an
embed's URL.

## Sizing

An embed reports its content height to the hosting page, so a container that
listens can size itself. If your page cannot run scripts, give the iframe a
fixed height; 420px suits a short example with a console.

## What an embed cannot do

- Reach the hosting page's cookies, storage or DOM. It is a different origin.
- Read anything about the reader.
- Write to your instance. An embed is read-only; editing is local to that tab.

## Removing one

Revoke the share link. Revocation is immediate, and a revoked, expired, deleted
or never-existing link are indistinguishable from outside — so a dead embed
cannot be used to probe which projects exist.
