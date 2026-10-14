#!/usr/bin/env bash
# Pull the PodStream images back from quay.io — repos discovered automatically
# from your quay namespace via the quay API — and retag them for PodStream.
#
#   scripts/quay-pull.sh <quay-namespace> [repo-prefix] [distro]
#
#   scripts/quay-pull.sh myuser                    # every podstream-* repo
#   scripts/quay-pull.sh myuser podstream kali     # only the Kali image
#
# Public repos pull anonymously. Private repos need:
#   podman login quay.io
# (or robot-account credentials stored in ~/.config/containers/auth.json)
set -e

NS="${1:?usage: scripts/quay-pull.sh <quay-namespace> [repo-prefix] [distro]}"
PREFIX="${2:-podstream}"
DISTRO="${3:-all}"

AUTH=""
AUTH_FILE="${HOME}/.config/containers/auth.json"
if [ -f "$AUTH_FILE" ]; then
  AUTH=$(python3 - "$AUTH_FILE" <<'PY'
import json, sys
try:
    auth = json.load(open(sys.argv[1]))
    a = auth.get("auths", {}).get("quay.io") or auth.get("auths", {}).get("https://quay.io")
    if a and a.get("auth"):
        print(a["auth"])
except Exception:
    pass
PY
)
  [ -n "$AUTH" ] && AUTH="-H 'Authorization: Basic $AUTH'"
fi

# Discover podstream-* repositories in the namespace via the quay API
REPOS=$(curl -s ${AUTH:+-H "Authorization: Basic $AUTH"} \
  "https://quay.io/api/v1/repository?namespace=$NS&limit=100" |
  python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for r in d.get('repositories', []):
        print(r['name'])
except Exception:
    pass")

if [ -z "$REPOS" ]; then
  echo "no repositories found in namespace '$NS' (or the API needs authentication)"
  exit 1
fi

pulled=0
for repo in $REPOS; do
  name="${repo#$PREFIX-}"            # kali / parrot-htb / blackarch

  # distro filter: kali | parrot-htb | blackarch | all
  case "$DISTRO" in
    all) ;;
    "$name") ;;
    *) continue ;;
  esac

  # local image name: kali -> podstream-kali-full
  case "$name" in
    kali) local_name="podstream-kali-full" ;;
    *)     local_name="podstream-$name" ;;
  esac

  echo "== pulling quay.io/$NS/$repo:latest"
  podman pull "quay.io/$NS/$repo:latest"
  podman tag "quay.io/$NS/$repo:latest" "localhost/$local_name:latest"
  echo "== retagged → localhost/$local_name:latest ✓"
  pulled=$((pulled + 1))
done

echo
echo "Pulled and retagged $pulled image(s) — PodStream deploys them directly."
