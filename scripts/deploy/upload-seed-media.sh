#!/usr/bin/env bash
# Uploads the photos of the fictitious seed to the media bucket of dev and
# stage (ADR 0011; docs/specs/data-model.md, "The demo seed leaves cards with a
# photo to see the directory as the resident will see it"). `vp run db:seed`
# with ENVIRONMENT dev or stage draws them into SEED_MEDIA_DIR with a manifest
# (scripts/seed-media.ts); this step, the only one with the R2 token, puts
# each object through R2's S3 API at its key, with its media type, its
# caching and its Content-MD5, and checks that R2 then holds its size. The
# keys are fixed, so a later run overwrites the same objects and leaves none
# behind. Never production: seeds never run there.
#
# Usage: scripts/deploy/upload-seed-media.sh <dev|stage> <directory> [config]
#   config defaults to dist/server/wrangler.json, the build being deployed,
#   whose MEDIA binding names the bucket.
#
# Environment (the dev and stage GitHub Environments hold the secrets):
#   MEDIA_R2_ACCESS_KEY_ID      an R2 token with Object Read & Write on the media
#   MEDIA_R2_SECRET_ACCESS_KEY  bucket of dev and stage only
#   CLOUDFLARE_ACCOUNT_ID  the account of the bucket
set -euo pipefail

fail() {
  echo "::error::upload-seed-media: $*" >&2
  exit 1
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || fail "usage: upload-seed-media.sh <dev|stage> <directory> [config]"
env_name="$1"
directory="$2"
config="${3:-dist/server/wrangler.json}"
case "${env_name}" in
dev | stage) ;;
*) fail "the seed's photos go to dev or stage only (got '${env_name}')" ;;
esac

for name in MEDIA_R2_ACCESS_KEY_ID MEDIA_R2_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID; do
  [ -n "${!name:-}" ] || fail "${name} is not set"
done
[[ "${CLOUDFLARE_ACCOUNT_ID}" =~ ^[0-9a-f]{32}$ ]] || fail "CLOUDFLARE_ACCOUNT_ID is not a Cloudflare account id"
for tool in aws jq; do
  command -v "${tool}" >/dev/null || fail "${tool} is not on PATH"
done

[ -f "${config}" ] || fail "${config} not found; build first with CLOUDFLARE_ENV=${env_name} vp run build"
[ "$(jq -r '.targetEnvironment // ""' "${config}")" = "${env_name}" ] ||
  fail "${config} is not a build for ${env_name}"
bucket="$(jq -r '[.r2_buckets // [] | .[] | select(.binding == "MEDIA") | .bucket_name] | if length == 1 then .[0] else "" end' "${config}")"
[[ "${bucket}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] ||
  fail "the ${env_name} build binds no MEDIA bucket (found '${bucket}')"

manifest="${directory}/manifest.json"
[ -f "${manifest}" ] || fail "${manifest} not found; run vp run db:seed with SEED_MEDIA_DIR=${directory} first"
jq -e 'type == "array"' "${manifest}" >/dev/null 2>&1 || fail "${manifest} is not a list of objects"

endpoint="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="${MEDIA_R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${MEDIA_R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="auto"
export AWS_EC2_METADATA_DISABLED="true"
export AWS_PAGER=""
# Only the checksums S3 requires, plus our Content-MD5: R2 does not take every
# checksum newer AWS CLIs add on their own.
export AWS_REQUEST_CHECKSUM_CALCULATION="when_required"
export AWS_RESPONSE_CHECKSUM_VALIDATION="when_required"

count=0
while IFS=$'\t' read -r key file content_type cache_control bytes md5; do
  [[ "${key}" =~ ^[a-z0-9/._-]+$ ]] && [[ "${key}" != *..* ]] || fail "'${key}' is not a media key"
  [[ "${file}" != /* ]] && [[ "${file}" != *..* ]] || fail "'${file}' is not a file of ${directory}"
  [ -f "${directory}/${file}" ] || fail "${directory}/${file} is missing"
  aws s3api put-object --endpoint-url "${endpoint}" --bucket "${bucket}" --key "${key}" \
    --body "${directory}/${file}" --content-md5 "${md5}" --content-type "${content_type}" \
    --cache-control "${cache_control}" >/dev/null || fail "the upload of ${key} failed"
  stored="$(aws s3api head-object --endpoint-url "${endpoint}" --bucket "${bucket}" \
    --key "${key}" --query ContentLength --output text)" || fail "${key} is not in ${bucket}"
  [ "${stored}" = "${bytes}" ] || fail "${bucket} holds ${stored} bytes of ${key}, the seed drew ${bytes}"
  count=$((count + 1))
done < <(jq -r '.[] | [.key, .file, .contentType, .cacheControl, (.bytes | tostring), .md5] | @tsv' "${manifest}")

echo "upload-seed-media: ${count} objects of the fictitious seed uploaded to ${bucket} (${env_name})"
