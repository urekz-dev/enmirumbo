#!/usr/bin/env bash
# Availability check of a deployed site (ADR 0016): the home page answers 200,
# following its redirects within https, and /health answers 200 "ok", which
# means the Worker reached the database. Each check is retried a few times
# before it counts as failed, so one dropped request does not raise an alarm.
#
# Usage: scripts/monitor/check-site.sh <https origin>
#   for example scripts/monitor/check-site.sh https://enmirumbo.com
# Optional: MONITOR_ATTEMPTS (default 3), MONITOR_DELAY (seconds, default 20).
set -euo pipefail

readonly ATTEMPTS="${MONITOR_ATTEMPTS:-3}"
readonly DELAY="${MONITOR_DELAY:-20}"

fail() {
  echo "::error::check-site: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: check-site.sh <https origin>"
origin="$1"
[[ "${origin}" =~ ^https://[a-z0-9.-]+$ ]] || fail "'${origin}' is not an https origin"
[[ "${ATTEMPTS}" =~ ^[1-9][0-9]*$ ]] && [[ "${DELAY}" =~ ^[0-9]+$ ]] ||
  fail "MONITOR_ATTEMPTS must be a positive whole number and MONITOR_DELAY whole seconds"
command -v curl >/dev/null || fail "curl is not on PATH"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# fetch <url> [curl options...]: writes the body to ${work}/body; prints the
# status of the last response.
fetch() {
  local url="$1" status
  shift
  rm -f "${work}/body"
  status="$(curl --silent --show-error --max-time 20 --proto '=https' "$@" \
    --output "${work}/body" --write-out '%{http_code}' "${url}")" || true
  touch "${work}/body"
  echo "${status:-000}"
}

# check_home and check_health print why they failed, if they did.
check_home() {
  local status
  status="$(fetch "${origin}/" --location --max-redirs 5 --proto-redir '=https')"
  [ "${status}" = "200" ] || echo "GET / answered ${status}, expected 200"
}

check_health() {
  local status
  status="$(fetch "${origin}/health")"
  if [ "${status}" != "200" ]; then
    echo "GET /health answered ${status}, expected 200"
  elif [ "$(tr -d '\r\n' <"${work}/body")" != "ok" ]; then
    echo "GET /health answered 200 without 'ok'"
  fi
}

failures=()
for check in check_home check_health; do
  attempt=1
  while :; do
    problem="$(${check})"
    [ -n "${problem}" ] || break
    if [ "${attempt}" -ge "${ATTEMPTS}" ]; then
      echo "::error::check-site: ${origin}: ${problem} (after ${ATTEMPTS} attempts)" >&2
      failures+=("${problem}")
      break
    fi
    echo "check-site: ${problem}; retrying in ${DELAY}s (attempt ${attempt} of ${ATTEMPTS})"
    attempt=$((attempt + 1))
    sleep "${DELAY}"
  done
done

[ "${#failures[@]}" -eq 0 ] || exit 1
echo "check-site: ${origin} answers 200 and /health reaches the database"
