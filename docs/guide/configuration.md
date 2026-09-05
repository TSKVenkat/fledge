# Configuration

Configuration is environment variables, parsed once at start-up. A bad value
stops the process immediately rather than failing on the first request that
happens to touch it.

Storage credentials and other secrets are **not** environment variables — they
are configured in the application and encrypted at rest under `SECRET_KEY`.

## Required

| Variable | What it is |
|---|---|
| `SECRET_KEY` | 32 bytes, base64. Encrypts secrets at rest and signs cookies. No default. Changing it makes existing encrypted values unreadable, and there is no rotation procedure yet. |
| `ADMIN_EMAIL` | The first administrator. Used only when the database has no users. |
| `ADMIN_PASSWORD` | Their initial password. Change it after first sign-in. |

## Addresses

| Variable | Default | What it is |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | Where a **browser** reaches the instance. Not the listen address. |
| `SANDBOX_URL` | `http://sandbox.localhost:8080` | Where the sandbox frame is served. **Must be a different host name** — see [Security](https://github.com/TSKVenkat/fledge/blob/main/SECURITY.md). |
| `WEB_PORT` | `8080` | Published port. A variable, so this can run beside something already on 8080. |

## Behaviour

| Variable | Default | What it is |
|---|---|---|
| `ALLOW_MICROPIP` | `false` | Let students install packages from PyPI at run time. Off by default: many school networks block PyPI, and a half-working install is worse than a clear "not available here". |
| `PASSWORD_MIN_LENGTH` | `10` | Minimum password length. Length does more for strength than character classes, so nothing else is enforced. |

## Database

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgres://fledge:fledge@postgres:5432/fledge` |
| `POSTGRES_PASSWORD` | `fledge` — change it for anything reachable from a network |

Projects and their files live in the database rather than in object storage, so
`pg_dump` is a complete backup of an instance: accounts, classes, assignments and
every student's work in one file.
