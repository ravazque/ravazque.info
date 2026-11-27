#!/usr/bin/env bash
# Run another branch's dev beside this one, to compare them (make dev-build-<branch>, dev-real-<branch>,
# dev-live-<branch>, dev-down-<branch>, branches). Each branch gets a git worktree in .branches/<branch> (this checkout is
# left alone), its own compose project and its own ports: https://localhost:8443+N and Vite on 5173+N, N a slot kept in
# .branches/<branch>/.dev-slot. They share the root .env, the local certificates and web/preview's profiles; the
# branch you have checked out here keeps 443 and 5173 (the plain make dev-* targets).
# usage: tools/branch-dev.sh build|real|live|down <branch>   ·   tools/branch-dev.sh list
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
chrome=${CHROME:-google-chrome-stable}
level=${1:-}; branch=${2:-}

project() { echo "ravazque-info-br-$1"; }
slug() { echo "$1" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9]/-/g'; }

if [ "$level" = list ]; then
  found=0
  for d in .branches/*/; do
    [ -f "$d.dev-slot" ] || continue
    found=1; s=$(basename "$d"); n=$(cat "$d.dev-slot")
    state=$(docker inspect -f '{{.State.Status}}' "$(project "$s")-api-1" 2>/dev/null | tr -d '\n'); [ -n "$state" ] || state=stopped
    printf "  %-24s https://localhost:%s  vite :%s  (%s, %s)\n" "$(git -C "$d" branch --show-current)" $((8443 + n)) $((5173 + n)) "$state" "$d"
  done
  [ $found = 1 ] || echo "  no other branch set up yet: make dev-build-<branch>"
  exit 0
fi

case "$level" in build|real|live|down) ;; *) echo "usage: $0 build|real|live|down <branch> | list" >&2; exit 2 ;; esac
[ -n "$branch" ] || { echo "which branch? make dev-$level-<branch>" >&2; exit 2; }

# the branch checked out here: the plain targets, on the usual ports
if [ "$branch" = "$(git branch --show-current)" ]; then
  [ "$level" = down ] && exec make dev-down
  exec make "dev-$level"
fi

s=$(slug "$branch"); dir=".branches/$s"; proj=$(project "$s")
compose() { docker compose -p "$proj" --project-directory "$dir" -f "$dir/compose.yaml" -f "$dir/compose.dev.yaml" -f "$dir/compose.branch.yaml" "$@"; }

if [ "$level" = down ]; then
  [ -d "$dir" ] || { echo "$branch has no dev here"; exit 0; }
  compose down
  echo "Stopped $branch (its worktree stays in $dir: git worktree remove $dir to delete it)"
  exit 0
fi

if ! git show-ref -q --verify "refs/heads/$branch" && ! git show-ref -q --verify "refs/remotes/origin/$branch"; then
  echo "No branch '$branch' here or on origin. Branches:" >&2
  git branch -a --format='  %(refname:short)' | grep -v HEAD >&2
  exit 1
fi

# the worktree: made once, then left as it is (you may work in it; it is on the branch itself)
if [ ! -d "$dir" ]; then
  mkdir -p .branches
  git worktree add -q "$dir" "$branch"
  echo "Worktree for $branch in $dir"
fi
echo "$branch at $(git -C "$dir" log --oneline -1 | cut -c1-90)"

# its slot: the smallest free one from 1
if [ ! -f "$dir/.dev-slot" ]; then
  n=1; while grep -qx "$n" .branches/*/.dev-slot 2>/dev/null; do n=$((n + 1)); done
  echo "$n" > "$dir/.dev-slot"
fi
n=$(cat "$dir/.dev-slot"); https=$((8443 + n)); vite=$((5173 + n))

# what it shares with this checkout (all git-ignored): the .env, the local certificates, the saved profiles, node_modules
[ -f .env ] || { echo "No root .env: make dev-build here creates it first" >&2; exit 1; }
ln -sfn "$root/.env" "$dir/.env"
mkdir -p "$dir/web"
mkdir -p "$dir/web/certs"; cp -n "$root"/web/certs/*.pem "$dir/web/certs/" 2>/dev/null || true # copies: a link would point outside the container
[ -e "$dir/web/preview" ] || ln -s "$root/web/preview" "$dir/web/preview"
[ -f web/Caddyfile.local ] || make -s web/Caddyfile.local
[ -d "$dir/web/Caddyfile.local" ] && rmdir "$dir/web/Caddyfile.local" # docker made it a folder when it was missing
[ -e "$dir/web/Caddyfile.local" ] || ln -s "$root/web/Caddyfile.local" "$dir/web/Caddyfile.local"
if [ ! -e "$dir/web/node_modules" ]; then
  if cmp -s web/package-lock.json "$dir/web/package-lock.json"; then ln -s "$root/web/node_modules" "$dir/web/node_modules"
  else (cd "$dir/web" && npm ci --no-audit --no-fund --silent); fi
fi
cat > "$dir/compose.branch.yaml" <<EOF
# made by tools/branch-dev.sh: $branch on its own port
services:
  caddy:
    ports: !override ["$https:443"]
  api:
    environment:
      BASE_URL: https://localhost:$https
EOF
# the worktree's own files stay out of its git status (info/exclude is shared by every worktree)
ex="$(git rev-parse --git-common-dir)/info/exclude"
for f in compose.branch.yaml .dev-slot .dev-data web/node_modules web/preview web/certs/*.pem web/Caddyfile.local; do grep -qx "$f" "$ex" 2>/dev/null || echo "$f" >> "$ex"; done

case "$level" in build) profiles="/preview/test-*.json" ;; *) profiles="/preview/test-*.json /preview/real-*.json" ;; esac
[ -n "$(ls web/preview/test-*.json 2>/dev/null)" ] || echo "No test profiles in web/preview yet: make dev-build here makes them"
DEV_PROFILES="$profiles" compose up -d --build
timeout 90 sh -c "until curl -sfk -o /dev/null https://localhost:$https/healthz; do sleep 1; done" || { echo "$branch did not answer: docker compose -p $proj logs api" >&2; exit 1; }

# the first time, the campus count and the holy graph drawn in this checkout's dev, so 42 Madrid compares too
api="$proj-api-1"; mine="ravazque-info-dev-api-1"
if docker inspect "$mine" >/dev/null 2>&1 && [ ! -f "$dir/.dev-data" ]; then
  tmp=$(mktemp -d); got=0
  for f in campus.json holygraph.json; do
    if docker cp -a "$mine:/data/$f" "$tmp/$f" 2>/dev/null; then docker cp -a "$tmp/$f" "$api:/data/$f" && got=1; fi
  done
  rm -rf "$tmp"; touch "$dir/.dev-data"
  if [ $got = 1 ]; then docker restart "$api" >/dev/null; timeout 60 sh -c "until curl -sfk -o /dev/null https://localhost:$https/healthz; do sleep 1; done"; fi
fi

echo "Up: $branch at https://localhost:$https (this checkout: https://localhost) · stop it with make dev-down-$branch"
if [ "$level" = live ]; then
  cd "$dir/web"
  API="https://localhost:$https" BROWSER="$chrome" exec node_modules/.bin/vite --port "$vite" --strictPort --open
else
  nohup "$chrome" "https://localhost:$https" >/dev/null 2>&1 &
fi
