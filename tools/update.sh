#!/usr/bin/env bash
# Keeps the pinned versions current without a bot: base images (Dockerfile, compose.yaml), the web app's npm packages
# and the GitHub Actions of the workflows.
#   tools/update.sh check     what could be updated (the make dev* targets show it, asked at most once a day)
#   tools/update.sh apply     apply patch and minor updates (make update); major versions are only listed
#   tools/update.sh selftest  offline tests of the parsing helpers (make test)
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=.update-check            # last check's summary, git-ignored; make dev* prints it, make update clears it
HOLD="typescript"              # vue-tsc does not run on TypeScript 7 yet: lift this once it does
FILES_IMAGES="Dockerfile compose.yaml"
WORKFLOWS=".github/workflows/*.yml"

APPLY=()   # "kind|file-or-dir|old|new|label"
MAJOR=()   # labels of newer major versions, to decide by hand

ver_gt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }
major() { local v=${1#v}; echo "${v%%.*}"; }

# "name:tag@sha256:…" → "name|tag|digest" (tag empty when the reference has none)
parse_ref() {
  [[ $1 =~ ^([a-z0-9][a-z0-9./_-]*)(:([A-Za-z0-9._-]+))?@(sha256:[0-9a-f]{64})$ ]] || return 1
  echo "${BASH_REMATCH[1]}|${BASH_REMATCH[3]:-}|${BASH_REMATCH[4]}"
}

# the tag one step ahead on its last number: 26-alpine → 27-alpine, 1.27-alpine → 1.28-alpine, 2.11 → 2.12
next_tag() {
  [[ $1 =~ ^([0-9.]*\.)?([0-9]+)(-.*)?$ ]] || return 1
  echo "${BASH_REMATCH[1]}$((BASH_REMATCH[2] + 1))${BASH_REMATCH[3]}"
}

hub_repo() { case $1 in */*) echo "$1" ;; *) echo "library/$1" ;; esac; }
is_hub() { [[ ${1%%/*} != *.* ]]; }   # no registry host in front: Docker Hub

digest_of() {   # name tag
  if is_hub "$1"; then
    curl -sf -m 10 "https://hub.docker.com/v2/repositories/$(hub_repo "$1")/tags/$2" | jq -er .digest
  else
    timeout 20 docker buildx imagetools inspect "$1:$2" --format '{{json .Manifest}}' 2>/dev/null | jq -er .digest
  fi
}

hub_tag_exists() { curl -sf -m 10 -o /dev/null "https://hub.docker.com/v2/repositories/$(hub_repo "$1")/tags/$2"; }

# "commit tag" of every vX.Y.Z tag of a GitHub repository, annotated tags resolved to their commit
action_tags() {
  timeout 20 git ls-remote --tags "https://github.com/$1" 'v*' | awk '
    { t = $2; sub("refs/tags/", "", t); peeled = sub(/\^\{\}$/, "", t)
      if (t !~ /^v[0-9]+\.[0-9]+\.[0-9]+$/) next
      if (peeled || !(t in sha)) sha[t] = $1 }
    END { for (t in sha) print sha[t], t }' | sort -k2 -V
}

check_images() {
  local f ref name tag digest new latest nt
  for f in $FILES_IMAGES; do
    for ref in $(grep -oE '[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}' "$f" | sort -u); do
      IFS='|' read -r name tag digest <<<"$(parse_ref "$ref")"
      if [ "$name" = cloudflare/cloudflared ]; then   # one tag per release (YYYY.M.P): follow the newest
        latest=$(curl -sf -m 10 "https://hub.docker.com/v2/repositories/$name/tags?page_size=50&ordering=last_updated" \
          | jq -r '.results[].name' | grep -E '^[0-9]{4}\.[0-9]+\.[0-9]+$' | sort -V | tail -1) || return 1
        if ver_gt "$latest" "$tag"; then
          new=$(digest_of "$name" "$latest") || return 1
          APPLY+=("image|$f|$ref|$name:$latest@$new|$name $tag → $latest")
        fi
        continue
      fi
      new=$(digest_of "$name" "${tag:-latest}") || return 1
      [ "$new" = "$digest" ] || APPLY+=("image|$f|$ref|$name${tag:+:$tag}@$new|$name${tag:+:$tag} (security patches)")
      if [ -n "$tag" ] && is_hub "$name" && nt=$(next_tag "$tag") && hub_tag_exists "$name" "$nt"; then
        MAJOR+=("$name:$nt")
      fi
    done
  done
}

check_npm() {
  local json pkg cur wanted latest
  command -v npm >/dev/null || return 0
  json=$(cd web && timeout 60 npm outdated --json 2>/dev/null || true)
  [ -n "$json" ] || return 1
  for pkg in $(jq -r 'keys[]' <<<"$json"); do
    cur=$(jq -r --arg p "node_modules/$pkg" '.packages[$p].version // empty' web/package-lock.json)
    wanted=$(jq -r --arg p "$pkg" '.[$p].wanted' <<<"$json")
    latest=$(jq -r --arg p "$pkg" '.[$p].latest' <<<"$json")
    [ -n "$cur" ] || continue
    ver_gt "$wanted" "$cur" && APPLY+=("npm|web|$pkg|$wanted|$pkg $cur → $wanted")
    if [ "$(major "$latest")" -gt "$(major "$cur")" ]; then
      case " $HOLD " in *" $pkg "*) ;; *) MAJOR+=("$pkg $latest") ;; esac
    fi
  done
}

check_actions() {
  local line repo sha cur tags same newest seen=" "
  while read -r line; do
    [[ $line =~ uses:\ *([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(/[^@]*)?@([0-9a-f]{40})\ *#\ *(v[0-9][0-9.]*) ]] || continue
    repo=${BASH_REMATCH[1]} sha=${BASH_REMATCH[3]} cur=${BASH_REMATCH[4]}
    case $seen in *" $repo@$sha "*) continue ;; esac
    seen+="$repo@$sha "
    tags=$(action_tags "$repo") && [ -n "$tags" ] || return 1
    same=$(awk -v m="v$(major "$cur")." 'index($2, m) == 1' <<<"$tags" | tail -1)
    newest=$(tail -1 <<<"$tags")
    if [ -n "$same" ] && ver_gt "${same#* v}" "${cur#v}"; then
      APPLY+=("action|$repo|$sha # $cur|${same% *} # ${same#* }|$repo $cur → ${same#* }")
    fi
    if [ "$(major "${newest#* }")" -gt "$(major "$cur")" ]; then MAJOR+=("$repo ${newest#* }"); fi
  done < <(cat $WORKFLOWS)
}

summary() {
  local m
  if [ ${#APPLY[@]} -gt 0 ]; then
    echo "${#APPLY[@]} updates available, make update applies them:"
    for m in "${APPLY[@]}"; do echo "  - ${m##*|}"; done
  fi
  if [ ${#MAJOR[@]} -gt 0 ]; then
    echo "Newer major versions, to decide by hand:"
    for m in "${MAJOR[@]}"; do echo "  - $m"; done
  fi
  return 0
}

gather() { check_images && check_npm && check_actions; }

case ${1:-check} in
  check)
    command -v jq >/dev/null && command -v curl >/dev/null || exit 0
    if [ ! -f "$STAMP" ] || [ -n "$(find "$STAMP" -mmin +1440)" ]; then
      gather || exit 0   # offline or a source failed: say nothing, ask again next time
      summary > "$STAMP.tmp" && mv "$STAMP.tmp" "$STAMP"
    fi
    [ -s "$STAMP" ] && sed 's/^/  /' "$STAMP"
    exit 0 ;;
  apply)
    command -v jq >/dev/null || { echo "jq is needed" >&2; exit 1; }
    gather || { echo "a source did not answer (offline?): nothing changed" >&2; exit 1; }
    npm_done=
    for m in "${APPLY[@]}"; do
      IFS='|' read -r kind where old new label <<<"$m"
      echo "  $label"
      case $kind in
        image)  sed -i "s|$old|$new|g" "$where" ;;
        action) for f in $WORKFLOWS; do sed -i "s|${where}\(/[^@]*\)\?@${old}|${where}\1@${new}|g" "$f"; done ;;
        npm)    [ -n "$npm_done" ] || { (cd web && npm update --no-audit --no-fund --silent); npm_done=1; } ;;
      esac
    done
    [ ${#APPLY[@]} -gt 0 ] || echo "  Everything is current."
    if [ ${#MAJOR[@]} -gt 0 ]; then echo "Newer major versions, to decide by hand:"; printf '  - %s\n' "${MAJOR[@]}"; fi
    echo "npm audit (production dependencies):"
    (cd web && npm audit --omit=dev 2>&1 | tail -3) || true
    echo "govulncheck (server):"
    (cd server && go run golang.org/x/vuln/cmd/govulncheck@latest ./... 2>&1 | tail -3) || true
    rm -f "$STAMP" ;;
  selftest)
    fail=0; t() { if [ "$2" = "$3" ]; then :; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi; }
    d=sha256:$(printf '%064d' 0)
    t parse "$(parse_ref "node:26-alpine@$d")" "node|26-alpine|$d"
    t parse-host "$(parse_ref "gcr.io/distroless/static-debian12@$d")" "gcr.io/distroless/static-debian12||$d"
    t parse-bad "$(parse_ref "node:26-alpine" || echo no)" "no"
    t next1 "$(next_tag 26-alpine)" "27-alpine"
    t next2 "$(next_tag 1.27-alpine)" "1.28-alpine"
    t next3 "$(next_tag 2.11)" "2.12"
    t next4 "$(next_tag latest || echo no)" "no"
    t gt1 "$(ver_gt 2026.11.0 2026.10.4 && echo y)" "y"
    t gt2 "$(ver_gt 3.5.9 3.5.10 && echo y || echo n)" "n"
    t gt3 "$(ver_gt 7.0.1 7.0.1 && echo y || echo n)" "n"
    t major "$(major v7.1.0)" "7"
    t hub "$(hub_repo node) $(hub_repo cloudflare/cloudflared)" "library/node cloudflare/cloudflared"
    t is-hub "$(is_hub caddy && echo y) $(is_hub gcr.io/distroless/x || echo n)" "y n"
    line="      - uses: github/codeql-action/init@$(printf 'a%.0s' {1..40}) # v4.39.1"
    out=$(sed "s|github/codeql-action\(/[^@]*\)\?@$(printf 'a%.0s' {1..40}) # v4.39.1|github/codeql-action\1@$(printf 'b%.0s' {1..40}) # v4.40.0|g" <<<"$line")
    t action-sed "$out" "      - uses: github/codeql-action/init@$(printf 'b%.0s' {1..40}) # v4.40.0"
    [ $fail = 0 ] && echo "update.sh selftest: ok"; exit $fail ;;
  *) echo "usage: $0 check|apply|selftest" >&2; exit 2 ;;
esac
