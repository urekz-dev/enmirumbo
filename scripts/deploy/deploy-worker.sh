#!/usr/bin/env bash
# Deploys the Worker a build produced, with its Worker secrets (ADR 0020): the
# Deploy step of each deploy workflow, after check-build.sh. Every secret the
# build names in secrets.required must be set, and not empty, in the step's
# environment, where the workflow passes each one from the GitHub Environment
# through the step's own `env:`. The script writes them as JSON to a file in
# the runner's temporary directory that only its owner can read, takes them
# out of the environment of Wrangler, deploys with
# `wrangler deploy --secrets-file`, and removes the file however the deploy
# ends. No secret value is ever an argument or printed.
#
# Usage: scripts/deploy/deploy-worker.sh <dev|stage|prod> [wrangler deploy arguments]
#   The build is dist/server/wrangler.json (BUILD_CONFIG overrides it), and
#   Wrangler the project's (WRANGLER overrides it).
set -euo pipefail

usage() {
  echo "::error::deploy-worker: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] || usage "usage: deploy-worker.sh <dev|stage|prod> [wrangler deploy arguments]"
env_name="$1"
shift
case "${env_name}" in
dev | stage | prod) ;;
*) usage "environment must be dev, stage or prod (got '${env_name}')" ;;
esac

config="${BUILD_CONFIG:-dist/server/wrangler.json}"
wrangler="${WRANGLER:-./node_modules/.bin/wrangler}"

command -v jq >/dev/null || usage "jq is not on PATH"
[ -f "${config}" ] ||
  usage "${config} not found; build first with CLOUDFLARE_ENV=${env_name} vp run build"
target="$(jq -r '.targetEnvironment // ""' "${config}")"
[ "${target}" = "${env_name}" ] ||
  usage "the build targets '${target}', not '${env_name}'; nothing was deployed"

names=()
while IFS= read -r name; do
  [[ "${name}" =~ ^[A-Z][A-Z0-9_]*$ ]] ||
    usage "secrets.required names '${name}', which is not a secret name; nothing was deployed"
  names+=("${name}")
done < <(jq -r '(.secrets.required // [])[]' "${config}")

missing=()
for name in ${names[@]+"${names[@]}"}; do
  [ -n "${!name:-}" ] || missing+=("${name}")
done
[ "${#missing[@]}" -eq 0 ] ||
  usage "missing Worker secret(s) ${missing[*]}: add each to the GitHub Environment ${env_name} and to the env: of this step; nothing was deployed"

secrets_args=()
if [ "${#names[@]}" -gt 0 ]; then
  umask 077
  secrets_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/worker-secrets.XXXXXX")"
  trap 'rm -f "${secrets_file}"' EXIT
  # jq reads each value from the environment, so none is an argument.
  jq -nc '$ARGS.positional | map({ key: ., value: $ENV[.] }) | from_entries' \
    --args "${names[@]}" >"${secrets_file}"
  unset "${names[@]}"
  secrets_args=(--secrets-file "${secrets_file}")
fi

"${wrangler}" deploy ${secrets_args[@]+"${secrets_args[@]}"} "$@"
