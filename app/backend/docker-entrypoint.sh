#!/bin/sh
set -e

node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] \
  || [ -n "${BOOTSTRAP_ADMIN_USERNAME:-}" ] \
  || [ -n "${BOOTSTRAP_ADMIN_NAME:-}" ] \
  || [ -n "${BOOTSTRAP_ADMIN_NICKNAME:-}" ] \
  || [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  node dist/bootstrap-admin.js --non-interactive
fi

exec node dist/main.js
