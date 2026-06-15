#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Users/harshdave/Documents/PickLedgerPro"
PYTHON_BIN="${REPO_ROOT}/.venv/bin/python"
GH_BIN="/opt/homebrew/bin/gh"
DATE_ISO="$(date +%F)"
TEMP_ROOT="$(mktemp -d /tmp/pickledger-scores24.XXXXXX)"
TEMP_REPO="${TEMP_ROOT}/repo"
GENERATED_CACHE="${TEMP_ROOT}/scores24-latest.json"

cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

REMOTE_URL="$(git -C "${REPO_ROOT}" remote get-url origin)"
GIT_NAME="$(git -C "${REPO_ROOT}" config user.name)"
GIT_EMAIL="$(git -C "${REPO_ROOT}" config user.email)"

git clone --quiet --depth 1 "${REMOTE_URL}" "${TEMP_REPO}"
git -C "${TEMP_REPO}" config user.name "${GIT_NAME}"
git -C "${TEMP_REPO}" config user.email "${GIT_EMAIL}"

SCORES24_BROWSER_FALLBACK=false \
SCORES24_CAMOUFOX_FALLBACK=false \
"${PYTHON_BIN}" "${TEMP_REPO}/scripts/refresh_external_feeds.py" \
  --date "${DATE_ISO}" \
  --feeds "scores24_wnba,scores24_mlb,scores24_fifa_world_cup" \
  --sports "mlb,wnba,fifa_world_cup" \
  --skip-firestore

cp "${TEMP_REPO}/data/model_cache/latest.json" "${GENERATED_CACHE}"

for attempt in 1 2 3; do
  git -C "${TEMP_REPO}" fetch --quiet origin main
  git -C "${TEMP_REPO}" reset --hard --quiet origin/main
  MERGE_RESULT="$(
    cd "${TEMP_REPO}"
    "${PYTHON_BIN}" scripts/merge_external_feed_cache_payload.py "${GENERATED_CACHE}"
  )"
  echo "${MERGE_RESULT}"
  DEPLOYABLE="$("${PYTHON_BIN}" -c 'import json,sys; print(str(json.load(sys.stdin)["latestUpdated"]).lower())' <<< "${MERGE_RESULT}")"
  git -C "${TEMP_REPO}" add data/model_cache
  if git -C "${TEMP_REPO}" diff --cached --quiet; then
    echo "Scores24 cache already current for ${DATE_ISO}."
    exit 0
  fi
  git -C "${TEMP_REPO}" commit -m "chore(feeds): refresh Scores24 feeds for ${DATE_ISO}"
  if git -C "${TEMP_REPO}" push origin HEAD:main; then
    if [[ "${DEPLOYABLE}" == "true" ]]; then
      "${GH_BIN}" workflow run deploy-pages.yml --repo Harsh4873/PickLedgerPro --ref main
    else
      echo "Skipped Pages deploy until the full ${DATE_ISO} team-model cache is available."
    fi
    echo "Published Scores24 feeds for ${DATE_ISO}."
    exit 0
  fi
  echo "Scores24 push attempt ${attempt} failed; retrying from latest main."
done

echo "Unable to publish Scores24 feeds after three attempts." >&2
exit 1
