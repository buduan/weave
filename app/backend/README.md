# Backend identity and access module

The NestJS backend provides user accounts, authentication, Redis-backed sessions, the default
Workspace, role-based authorization, direct allow or deny grants, and append-only audit records.
PostgreSQL stores durable identity and authorization facts. Redis stores only expiring sessions,
verification state, WebAuthn challenges, TOTP enrollment state, and rate-limit counters.

## Prerequisites

Use Node.js 22 or newer and pnpm 10. Copy the repository environment template, set local database
credentials, and start PostgreSQL and Redis before starting the backend.

```bash
cp .env.example .env
pnpm start:db
pnpm dev:backend
```

Swagger UI is available at `/docs`, while `/docs-json` and `/docs-yaml` expose the generated
OpenAPI contract. Protected endpoints accept `Authorization: Bearer <access-token>`.

## Database migration

The migration `20260726000000_add_user_auth_permissions` adds the complete identity, Workspace,
role, permission, Passkey, system administrator, and audit schema. Its preflight block stops when
legacy `User` rows do not contain the required email, username, and nickname mapping.

Run Prisma generation and migration deployment after reviewing the target database.

```bash
pnpm --filter @weave/backend prisma:generate
pnpm migrate
```

The repository currently contains two empty, untracked historical migration directories:
`20260718115331_identity_and_access` and `20260724093000_add_better_auth_jwks`. Prisma treats an
empty migration directory as invalid, so remove or restore those local directories before using
`prisma migrate deploy`. The new migration itself has been applied to a disposable PostgreSQL
database and produces no schema difference from `schema.prisma`.

## First administrator

The bootstrap command creates the first active user, default Workspace with numeric ID `1`, owner
membership, default member role, `workspace_admin`, and `system_admin` in one transaction. The
command reads username, nickname, and password interactively, hides password input, rejects password
CLI arguments, and applies the same password policy as the HTTP API.

```bash
pnpm bootstrap:admin --email=admin@example.com
```

For production or other non-interactive environments, pass `--non-interactive` and provide all
administrator details through environment variables. Do not store `BOOTSTRAP_ADMIN_PASSWORD` in a
checked-in file; inject it from the deployment secret store.

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_USERNAME=admin \
BOOTSTRAP_ADMIN_NAME='System Administrator' \
BOOTSTRAP_ADMIN_NICKNAME=Admin \
BOOTSTRAP_ADMIN_PASSWORD='use-a-strong-secret' \
pnpm bootstrap:admin --non-interactive
```

The production container runs the same non-interactive bootstrap after migration. On the first
deployment, inject all `BOOTSTRAP_ADMIN_*` values through the deployment secret store. Once a
system administrator exists, the command exits without reading those values or changing
credentials, ownership, or grants; conflicting partial data still fails for manual review.

## Authentication configuration

The backend validates JWT, HMAC, TOTP encryption, WebAuthn RP, and authentication lifetime settings
at startup. Production mode rejects development fallback secrets, non-HTTPS WebAuthn origins, and
implicit TTL values.

The confirmed production authentication lifetimes are:

- Access Token: 15 minutes.
- Refresh Session: 30 days.
- Email and SMS OTP: 10 minutes.
- MFA, Passkey, and TOTP enrollment challenge: 5 minutes.
- TOTP: 30-second period with one adjacent period accepted on each side.

Set `JWT_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_SECONDS`, `AUTH_OTP_TTL_SECONDS`,
`AUTH_CHALLENGE_TTL_SECONDS`, and `TOTP_PERIOD_SECONDS` explicitly before a production start. The
application rejects implicit production values.

## Notification mocks

`NotificationsService` contains deliberate no-op email and SMS methods. The authentication layer
still creates cryptographically random codes, stores only HMAC digests in Redis, applies expiry and
attempt limits, and returns generic accepted responses. The mock methods never return or log codes.

Do not enable email-code login, password recovery, email MFA, SMS MFA, or phone binding in a
production environment until real providers replace both mock methods. TOTP and Passkey do not
depend on those delivery providers.

## Verification

Run the focused security tests and standard workspace checks before review.

```bash
pnpm --filter @weave/backend test
pnpm lint
pnpm typecheck
pnpm build
```

The focused tests cover normalization, optional passwords, password boundaries, verified-phone
lookup, OTP single use, Refresh Token replay, MFA factor separation, TOTP replay, permission
precedence, administrator bypass, Workspace isolation, last-administrator concurrency, and mock
notification leakage.
