#!/usr/bin/env bash
# Tag and push all local PodStream images to quay.io — one repository per
# distro, discovered automatically from the local image store.
#
#   scripts/quay-push.sh <quay-namespace> [repo-prefix] [distro]
#
#   scripts/quay-push.sh myuser                    # every localhost/podstream-* image
#   scripts/quay-push.sh myuser podstream kali     # only the Kali image
#
# Any new image you build as localhost/podstream-<name> is picked up
# automatically (its quay repo becomes <prefix>-<name>, with a trailing
# "-full" stripped). Requires:  podman login quay.io
set -e

NS="${1:?usage: scripts/quay-push.sh <quay-namespace> [repo-prefix] [distro]}"
PREFIX="${2:-podstream}"
DISTRO="${3:-all}"

# Discover local PodStream images automatically
mapfile -t LOCAL < <(podman images --format '{{.Repository}}:{{.Tag}}' | grep '^localhost/podstream-' | sort -u)
if [ "${#LOCAL[@]}" -eq 0 ]; then
  echo "no localhost/podstream-* images found — nothing to push"
  exit 1
fi

pushed=0
for ref in "${LOCAL[@]}"; do
  base="${ref#localhost/}"          # podstream-kali-full:latest
  base="${base%%:*}"                # podstream-kali-full
  name="${base#podstream-}"         # kali-full
  name="${name%-full}"              # kali
  tag="${ref##*:}"

  # distro filter: kali | parrot-htb | blackarch | all
  case "$DISTRO" in
    all) ;;
    "$name") ;;
    *) continue ;;
  esac

  repo="$PREFIX-$name"
  remote="quay.io/$NS/$repo:$tag"
  echo "== tagging $ref"
  podman tag "$ref" "$remote"
  echo "== pushing $remote (GB-scale — this takes a while)"
  podman push "$remote"
  echo "== pushed ✓  (pull: podman pull $remote)"
  pushed=$((pushed + 1))
done

echo
echo "Pushed $pushed image(s)."
