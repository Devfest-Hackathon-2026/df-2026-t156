#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${GCP_PROJECT:-hobby-256508}"
REGION="asia-northeast1"
SERVICE="orbit-salvage-prototype"
REPOSITORY="orbit-salvage-prototype"
GCLOUD="${GCLOUD:-$HOME/.local/bin/gcloud}"
DEPLOY_ARGS=()
if [[ "${GCP_NO_TRAFFIC:-0}" == 1 ]]; then DEPLOY_ARGS+=(--no-traffic); fi
if [[ -n "${GCP_REVISION_TAG:-}" ]]; then
  [[ "$GCP_REVISION_TAG" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || { echo 'Invalid revision tag.' >&2; exit 1; }
  DEPLOY_ARGS+=(--tag="$GCP_REVISION_TAG")
fi
[[ -f "$ROOT/build-web/index.html" && -f "$ROOT/server/index.js" && -f "$ROOT/Unity/Assets/Resources/valley.json" ]] || { echo 'Build client, server and shared valley first.' >&2; exit 1; }
STAGE="$(mktemp -d /tmp/orbit-salvage-deploy.XXXXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT
mkdir "$STAGE/server"
cp "$ROOT/Dockerfile" "$STAGE/"
cp "$ROOT/server/"{index.js,game.js,station-use.js,static.js,valley.js,motion.js,melee.js,crossbow.js,stream.js,scenery-shape.js,scenery-mining.js,feedback.js,archive.js,package.json,package-lock.json} "$STAGE/server/"
cp "$ROOT/Unity/Assets/Resources/SceneryRock.json" "$STAGE/server/scenery-rock.json"
cp "$ROOT/Unity/Assets/Resources/valley.json" "$STAGE/valley.json"
cp -R "$ROOT/build-web" "$STAGE/build-web"
# Include saved page/runtime sources, not local restored binary caches or QA files.
while IFS= read -r -d '' file; do
  case "$file" in public/history-play/assets/*|public/history-play/chunks/*) continue ;; esac
  relative="${file#public/}"
  mkdir -p "$STAGE/build-web/$(dirname "$relative")"
  cp -- "$ROOT/$file" "$STAGE/build-web/$relative"
done < <(git -C "$ROOT" ls-files -z -- public)
python3 "$ROOT/scripts/precompress-webgl.py" "$STAGE/build-web"
# Upload only the runtime and compiled WebGL client, never Unity source/cache.
printf '.git\nnode_modules\n*.log\n.env*\n' > "$STAGE/.gcloudignore"
if ! "$GCLOUD" artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  "$GCLOUD" artifacts repositories create "$REPOSITORY" --repository-format=docker --location="$REGION" --project="$PROJECT" --description='Orbit Salvage prototype only' --quiet
fi
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPOSITORY/app:$(date -u +%Y%m%d-%H%M%S)"
"$GCLOUD" builds submit "$STAGE" --tag="$IMAGE" --project="$PROJECT" --timeout=600 --quiet
"$GCLOUD" run deploy "$SERVICE" --image="$IMAGE" --project="$PROJECT" --region="$REGION" --platform=managed --port=8080 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=1 --concurrency=80 --timeout=3600 --allow-unauthenticated --update-env-vars="FEEDBACK_BUCKET=${FEEDBACK_BUCKET:-${PROJECT}_cloudbuild},FEEDBACK_OBJECT=${FEEDBACK_OBJECT:-orbit-salvage/feedback/v1.json},HISTORY_ASSET_BUCKET=${HISTORY_ASSET_BUCKET:-${PROJECT}_cloudbuild}" --quiet "${DEPLOY_ARGS[@]}"
if [[ "${GCP_NO_TRAFFIC:-0}" != 1 ]]; then
  # A previous no-traffic deployment pins the old revision; deploy alone can
  # preserve that split. Normal publication explicitly promotes the candidate.
  "$GCLOUD" run services update-traffic "$SERVICE" --to-latest --project="$PROJECT" --region="$REGION" --quiet
fi
"$GCLOUD" run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)'
