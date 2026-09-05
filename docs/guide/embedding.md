# Embedding

::: warning Not implemented yet
This page documents the intended design. The deployment, accounts and embed
features it describes are not built. See the status section in the README for
what actually works today.
:::

An embed is a runnable snippet inside a page you already have — a worksheet, a
blog post, a virtual learning environment. The hosting page needs to change
nothing: no headers, no configuration, no co-operation.

## Putting one in a page

Create a share link for a project, then use its token:

```html
<iframe src="https://fledge-sandbox.example.net/embed/TOKEN"
        style="width:100%;height:420px;border:1px solid #ddd;border-radius:8px"
        title="Python example"></iframe>
```

## What a reader gets

Everything runs in the reader's own browser. They can edit the code and run it
again; nothing they do is saved, and nothing reaches your instance.

The one thing that varies is `input()`:

- **Chrome, Edge, Firefox** — `input()` prompts and waits, exactly as in the
  editor.
- **Safari** — the embed shows an **Input** box to fill in before pressing Run,
  and the program reads its lines in order.

This is a browser capability difference, not a setting. The embed states which
mode it is in, and offers a **Run interactively** link that opens the program on
your instance, where it is fully interactive in every browser.

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
