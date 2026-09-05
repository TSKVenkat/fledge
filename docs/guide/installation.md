# Installation

## With Docker

The supported way to run fledge. You need Docker and about 2 GB of disk.

```bash
git clone https://github.com/TSKVenkat/fledge.git
cd fledge
cp .env.example .env
```

Generate a key and put it in `.env` as `SECRET_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

It has no default deliberately. An instance that starts with a key everyone
knows is not secured by it. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` too — they
create the first administrator, and only when the database has no users at all,
so they cannot be used later to add one to a running instance.

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

Open <http://localhost:8080> and sign in.

## Before putting it on a network

**The sandbox needs its own host name.** Not a path, not a port — a host name.
Cookies ignore ports, so `example.org:8081` can read `example.org`'s cookies and
a second port provides no isolation whatsoever. Set:

```
PUBLIC_URL=https://fledge.example.org
SANDBOX_URL=https://fledge-sandbox.example.net
```

A separate registrable domain is better than a subdomain, for the same reason
user content sites use one: a cookie scoped to `.example.org` is readable by
every subdomain of it.

Then terminate TLS in front of both. `PUBLIC_URL` is where a **browser** reaches
the instance, not where the server listens — behind a reverse proxy these differ,
and getting it wrong produces share links that work for you and nobody else.

## Offline and slow networks

The Python runtime is about 12 MB. It is served from **your own instance**, not
from a CDN, and a service worker on the sandbox origin keeps it once a machine
has fetched it once -- so a laptop that booted Python on Monday boots it again
on Tuesday with the network down. A school with a filtered or intermittent
connection gets Python off its own LAN, or off the machine itself.

Package wheels — `matplotlib`, `numpy` and the rest — are a separate matter.
They are **not** bundled, because the full set is hundreds of megabytes and most
instances load none of it. By default they are fetched from a public CDN the
first time a program imports one.

If your network cannot reach that CDN, vendor the packages you need:

```bash
node apps/web/scripts/vendor-packages.mjs matplotlib
```

That resolves the dependency closure and downloads it — about 12 MB for
matplotlib and everything it needs. Then tell the sandbox to use them, by adding
this line to the `<head>` of `apps/web/frame.html` before building:

```html
<meta name="fledge-packages" content="/pyodide/">
```

After that the instance needs no internet access at all.

## From source

```bash
pnpm install
pnpm --filter @fledge/web dev
```

The application is served from `localhost` and the sandbox from `127.0.0.1` —
the same server on a different origin, so the security boundary exists in
development too rather than only in production.

## Upgrading

```bash
git pull
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

Migrations run automatically before the application starts. Read the changelog
before a major version; a change to the Python runtime version changes which
Python your students get.
