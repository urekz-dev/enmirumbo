#!/usr/bin/env bash
# Checks the Worker configuration a build produced for one environment before
# anything changes (ADR 0008): the deploy workflows run it right after
# `CLOUDFLARE_ENV=<env> vp run build`, before they touch a database or
# Cloudflare. It reads the file `wrangler deploy` will deploy, not
# wrangler.jsonc, and reports every problem at once:
#   - the build targets <env>, with that environment's Worker name and vars;
#   - every deployed environment has workers.dev off and exactly one Custom
#     Domain for SITE_URL; Version/Preview URLs are off in every environment;
#   - Workers Logs and traces off, every key of them written false, so
#     Cloudflare keeps no request URL, which in the edit mode carries the key
#     to a card (docs/specs/deployment.md, "Workers Logs and traces stay off
#     in every environment (v2)");
#   - the hourly Cron Trigger on stage and prod, none on dev (ADR 0013);
#   - HYPERDRIVE and HYPERDRIVE_FRESH set to two different real Hyperdrive ids,
#     so a placeholder id never reaches Cloudflare;
#   - SITE_URL is an https origin;
#   - QUOTA_COUNTER bound to the QuotaCounter Durable Object, which `exports`
#     declares with SQLite storage, so the per-IP quotas count (ADR 0012);
#   - MEDIA bound to the public media bucket of the environment, the one of
#     production for prod and the one dev and stage share for them, and
#     MEDIA_URL an https origin (ADR 0011);
#   - TURNSTILE_SITE_KEY a real site key from Cloudflare's dashboard, never a
#     placeholder or one of Cloudflare's test keys (ADR 0012);
#   - secrets.required names every Worker secret the Worker reads, so the
#     deploy uploads each and stops when one is missing (ADR 0020):
#     TURNSTILE_SECRET_KEY, and MEDIA_ZONE_ID and MEDIA_CACHE_PURGE_TOKEN,
#     which purge a deleted photo from the cache of the media hostname,
#     and RESEND_API_KEY, which sends the daily admin email;
#   - the _headers file of the static assets gives every one of them the
#     security headers (a Content-Security-Policy that forbids framing,
#     plugins and posting to other sites, nosniff, X-Frame-Options: DENY and a
#     strict-origin referrer policy) and X-Robots-Tag: noindex, because
#     Cloudflare serves them (the prerendered legal pages, the CSS, the share
#     images) without the Worker that adds them to the rest
#     (src/integrations/static-headers.ts).
# An empty ACCESS_AUD is only a warning: the panel stays closed (403) until the
# Access application exists.
#
# Usage: scripts/deploy/check-build.sh <dev|stage|prod> [config]
#   config defaults to dist/server/wrangler.json (written by the Astro build).
# In GitHub Actions it also writes `site-url=<SITE_URL>` to $GITHUB_OUTPUT.
set -euo pipefail

usage() {
  echo "::error::check-build: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage "usage: check-build.sh <dev|stage|prod> [config]"
env_name="$1"
config="${2:-dist/server/wrangler.json}"

case "${env_name}" in
dev)
  worker="dev-enmirumbo"
  crons='[]'
  media_bucket="enmirumbo-media-dev"
  ;;
stage)
  worker="stage-enmirumbo"
  crons='["0 * * * *"]'
  media_bucket="enmirumbo-media-dev"
  ;;
prod)
  worker="enmirumbo"
  crons='["0 * * * *"]'
  media_bucket="enmirumbo-media"
  ;;
*) usage "environment must be dev, stage or prod (got '${env_name}')" ;;
esac

command -v jq >/dev/null || usage "jq is not on PATH"
[ -f "${config}" ] ||
  usage "${config} not found; build first with CLOUDFLARE_ENV=${env_name} vp run build"
jq -e 'type == "object"' "${config}" >/dev/null 2>&1 || usage "${config} is not a JSON object"

errors=0
error() {
  echo "::error::check-build (${env_name}): $*" >&2
  errors=$((errors + 1))
}

# Prints a value of the config as compact JSON (null when missing).
value() {
  jq -c "$1" "${config}"
}

[ "$(value '.targetEnvironment')" = "\"${env_name}\"" ] ||
  error "the build targets $(value '.targetEnvironment'), not \"${env_name}\"; build with CLOUDFLARE_ENV=${env_name}"
[ "$(value '.name')" = "\"${worker}\"" ] ||
  error "the Worker name is $(value '.name'), expected \"${worker}\""
[ "$(value '.vars.ENVIRONMENT')" = "\"${env_name}\"" ] ||
  error "ENVIRONMENT is $(value '.vars.ENVIRONMENT'), expected \"${env_name}\""
[ "$(value '.workers_dev')" = "false" ] ||
  error "workers_dev is $(value '.workers_dev'), expected false for ${env_name}"
[ "$(value '.preview_urls')" = "false" ] ||
  error "preview_urls is $(value '.preview_urls'), expected false: Version URLs would bypass Access"
observability_off='{"enabled":false,"logs":{"enabled":false,"invocation_logs":false,"persist":false},"traces":{"enabled":false,"persist":false}}'
[ "$(value '.observability')" = "${observability_off}" ] ||
  error "observability is $(value '.observability'), expected ${observability_off}: Workers Logs and traces stay off, so no request URL is kept; declare it in env.${env_name} of wrangler.jsonc"
[ "$(value '.triggers.crons')" = "${crons}" ] ||
  error "the Cron Triggers are $(value '.triggers.crons'), expected ${crons}"

ids=()
for binding in HYPERDRIVE HYPERDRIVE_FRESH; do
  matches="$(jq --arg b "${binding}" '[.hyperdrive // [] | .[] | select(.binding == $b)] | length' "${config}")"
  if [ "${matches}" != "1" ]; then
    error "expected one ${binding} binding, found ${matches}"
    continue
  fi
  id="$(jq -r --arg b "${binding}" '.hyperdrive[] | select(.binding == $b) | .id' "${config}")"
  if [[ ! "${id}" =~ ^[0-9a-f]{32}$ ]] || [[ "${id}" =~ ^0+$ ]]; then
    error "${binding} still has the placeholder id '${id}'. Create the Hyperdrive config and put its id in env.${env_name}.hyperdrive of wrangler.jsonc"
    continue
  fi
  ids+=("${id}")
done
if [ "${#ids[@]}" -eq 2 ] && [ "${ids[0]}" = "${ids[1]}" ]; then
  error "HYPERDRIVE and HYPERDRIVE_FRESH share the id ${ids[0]}; HYPERDRIVE_FRESH needs its own config with caching disabled"
fi

site_url="$(jq -r '.vars.SITE_URL // ""' "${config}")"
[[ "${site_url}" =~ ^https://[a-z0-9.-]+$ ]] ||
  error "SITE_URL is '${site_url}', expected an https origin without a path or trailing slash"

route_count="$(jq '[.routes // [] | .[]] | length' "${config}")"
has_single_route="$(jq 'has("route")' "${config}")"
site_host="${site_url#https://}"
custom_domain_count="$(jq '[.routes // [] | .[] | select(.custom_domain == true)] | length' "${config}")"
if [ "${route_count}" != "1" ] || [ "${custom_domain_count}" != "1" ] || [ "${has_single_route}" = "true" ]; then
  error "expected exactly one Custom Domain route for SITE_URL host '${site_host}', found routes $(jq -c '.routes // []' "${config}") and route $(value '.route')"
else
  route_host="$(jq -r '.routes[0].pattern // ""' "${config}")"
  route_custom_domain="$(jq -r '.routes[0].custom_domain // false' "${config}")"
  if [ "${route_host}" != "${site_host}" ] || [ "${route_custom_domain}" != "true" ]; then
    error "Custom Domain route is $(jq -c '.routes[0]' "${config}"), expected pattern '${site_host}' with custom_domain true"
  fi
fi

[ -n "$(jq -r '.vars.ACCESS_TEAM_DOMAIN // ""' "${config}")" ] || error "ACCESS_TEAM_DOMAIN is empty"

quota_bindings="$(jq -c '[.durable_objects.bindings // [] | .[] | select(.name == "QUOTA_COUNTER")]' "${config}")"
[ "${quota_bindings}" = '[{"name":"QUOTA_COUNTER","class_name":"QuotaCounter"}]' ] ||
  error "expected QUOTA_COUNTER bound to the QuotaCounter Durable Object, found ${quota_bindings}; declare it in env.${env_name}.durable_objects of wrangler.jsonc"
[ "$(value '.exports.QuotaCounter')" = '{"type":"durable-object","storage":"sqlite"}' ] ||
  error "exports.QuotaCounter is $(value '.exports.QuotaCounter'), expected a Durable Object with SQLite storage; declare it in env.${env_name}.exports of wrangler.jsonc"

media_bindings="$(jq -c '[.r2_buckets // [] | .[] | select(.binding == "MEDIA") | {binding, bucket_name}]' "${config}")"
[ "${media_bindings}" = "[{\"binding\":\"MEDIA\",\"bucket_name\":\"${media_bucket}\"}]" ] ||
  error "expected MEDIA bound to the R2 bucket ${media_bucket}, found ${media_bindings}; declare it in env.${env_name}.r2_buckets of wrangler.jsonc"
media_url="$(jq -r '.vars.MEDIA_URL // ""' "${config}")"
[[ "${media_url}" =~ ^https://[a-z0-9.-]+$ ]] ||
  error "MEDIA_URL is '${media_url}', expected the https origin of the media hostname, without a path or trailing slash"

# Turnstile (ADR 0012): a real site key, `0x` and its characters; a test key
# (a digit, `x`, zeros and two capital letters) would make every token the
# dummy one, which no deployed Worker accepts.
site_key="$(jq -r '.vars.TURNSTILE_SITE_KEY // ""' "${config}")"
if [[ "${site_key}" =~ ^[0-9]x0+[A-Z]{2}$ ]]; then
  error "TURNSTILE_SITE_KEY is Cloudflare's test key '${site_key}'; put the site key of this environment's Turnstile widget in env.${env_name}.vars of wrangler.jsonc"
elif [[ ! "${site_key}" =~ ^0x[0-9A-Za-z_-]{10,}$ ]]; then
  error "TURNSTILE_SITE_KEY is '${site_key}', not a Turnstile site key; put the site key of this environment's Turnstile widget in env.${env_name}.vars of wrangler.jsonc"
fi
for secret in TURNSTILE_SECRET_KEY MEDIA_ZONE_ID MEDIA_CACHE_PURGE_TOKEN RESEND_API_KEY; do
  jq -e --arg s "${secret}" '(.secrets.required // []) | index($s) != null' "${config}" >/dev/null ||
    error "secrets.required does not name ${secret}; declare it in env.${env_name}.secrets of wrangler.jsonc"
done

# Whether a _headers file has a rule for /* with a header line that matches
# the extended regular expression $2, which is matched in lowercase.
has_every_asset_header() {
  awk -v pattern="$2" '
    /^[[:space:]]*(#|$)/ { next }
    /^[^[:space:]]/ { every = ($1 == "/*"); next }
    every && tolower($0) ~ pattern { found = 1 }
    END { exit !found }
  ' "$1"
}

# The security headers every static asset must carry, as "name|pattern".
security_headers=(
  "Content-Security-Policy|^[[:space:]]+content-security-policy:.*default-src 'self'"
  "Content-Security-Policy with frame-ancestors 'none'|^[[:space:]]+content-security-policy:.*frame-ancestors 'none'"
  "Content-Security-Policy with object-src 'none'|^[[:space:]]+content-security-policy:.*object-src 'none'"
  "Content-Security-Policy with form-action 'self'|^[[:space:]]+content-security-policy:.*form-action 'self'"
  "X-Content-Type-Options: nosniff|^[[:space:]]+x-content-type-options:[[:space:]]*nosniff[[:space:]]*$"
  "X-Frame-Options: DENY|^[[:space:]]+x-frame-options:[[:space:]]*deny[[:space:]]*$"
  "Referrer-Policy: strict-origin…|^[[:space:]]+referrer-policy:[[:space:]]*strict-origin"
)

assets="$(jq -r '.assets.directory // ""' "${config}")"
if [ -z "${assets}" ]; then
  error "the build declares no static assets directory (assets.directory)"
else
  headers="$(dirname "${config}")/${assets}/_headers"
  if [ ! -f "${headers}" ] ||
    ! has_every_asset_header "${headers}" '^[[:space:]]+x-robots-tag:[[:space:]]*noindex[[:space:]]*$'; then
    error "${headers} does not give every static asset X-Robots-Tag: noindex, so the prerendered pages would be indexable (src/integrations/static-headers.ts)"
  fi
  missing=()
  for entry in "${security_headers[@]}"; do
    if [ ! -f "${headers}" ] || ! has_every_asset_header "${headers}" "${entry#*|}"; then
      missing+=("${entry%%|*}")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    error "${headers} does not give every static asset its security headers; missing: $(
      IFS=,
      echo "${missing[*]}"
    ) (src/integrations/static-headers.ts)"
  fi
fi
if [ -z "$(jq -r '.vars.ACCESS_AUD // ""' "${config}")" ]; then
  echo "::warning::check-build (${env_name}): ACCESS_AUD is empty, so /admin answers 403 to everyone until it is set"
fi

if [ "${errors}" -gt 0 ]; then
  echo "check-build: ${errors} problem(s) in the ${env_name} build; nothing was deployed" >&2
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "site-url=${site_url}" >>"${GITHUB_OUTPUT}"
fi
echo "check-build: the ${env_name} build of ${worker} is ready to deploy to ${site_url}"
