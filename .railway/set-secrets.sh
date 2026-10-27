#!/bin/sh
# Generates the secrets LearnHouse needs and stores them on the Railway service.
# Run once, after `railway config apply` and `railway domain`. Keys that already
# have a value are left alone, so re-running never rotates a live secret.
#
# Usage: .railway/set-secrets.sh <admin-email> [service-name]
set -eu

ADMIN_EMAIL="${1:?usage: $0 <admin-email> [service-name]}"
SERVICE="${2:-learnhouse}"

# The first boot creates the organization before the admin, and every later boot
# skips install once an organization exists. An email the API rejects therefore
# leaves a healthy instance nobody can sign in to, so refuse one up front.
case "$ADMIN_EMAIL" in
  *@*.*) ;;
  *) echo "'$ADMIN_EMAIL' is not an email address" >&2; exit 1 ;;
esac
case "$(printf '%s' "${ADMIN_EMAIL##*.}" | tr '[:upper:]' '[:lower:]')" in
  arpa | invalid | local | localhost | onion | test)
    echo "'$ADMIN_EMAIL' uses a reserved domain the API refuses" >&2; exit 1 ;;
esac

command -v railway >/dev/null || { echo "railway CLI not found" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }

existing=$(railway variable list --service "$SERVICE" --kv)

has_value() {
  printf '%s\n' "$existing" | grep -q "^$1=."
}

if ! has_value RAILWAY_PUBLIC_DOMAIN; then
  echo "warning: $SERVICE has no public domain yet. Run 'railway domain --service $SERVICE --port 80' first, or the app will build its URLs from an empty host." >&2
fi

new_password=""
set --
if ! has_value LEARNHOUSE_AUTH_JWT_SECRET_KEY; then
  set -- "$@" "LEARNHOUSE_AUTH_JWT_SECRET_KEY=$(openssl rand -hex 32)"
fi
if ! has_value COLLAB_INTERNAL_KEY; then
  set -- "$@" "COLLAB_INTERNAL_KEY=$(openssl rand -hex 32)"
fi
if ! has_value LEARNHOUSE_INITIAL_ADMIN_EMAIL; then
  set -- "$@" "LEARNHOUSE_INITIAL_ADMIN_EMAIL=$ADMIN_EMAIL"
fi
if ! has_value LEARNHOUSE_INITIAL_ADMIN_PASSWORD; then
  # LearnHouse passwords need an upper, a lower, a digit and a special character.
  new_password="Lh-$(openssl rand -hex 12)-A9"
  set -- "$@" "LEARNHOUSE_INITIAL_ADMIN_PASSWORD=$new_password"
fi

if [ $# -eq 0 ]; then
  echo "All secrets are already set on $SERVICE. Nothing changed."
  exit 0
fi

count=$#
railway variable set "$@" --service "$SERVICE"
echo "Set $count variable(s) on $SERVICE. Railway is redeploying it."

if [ -n "$new_password" ]; then
  printf '\nFirst sign-in (the admin is created on the first successful boot):\n  email:    %s\n  password: %s\nChange the password after you sign in.\n' \
    "$(printf '%s\n' "$existing" | sed -n 's/^LEARNHOUSE_INITIAL_ADMIN_EMAIL=//p' | grep . || echo "$ADMIN_EMAIL")" \
    "$new_password"
fi
