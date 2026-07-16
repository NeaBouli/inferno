#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-hetzner}"
REMOTE_VOLUME="${REMOTE_VOLUME:-/mnt/HC_Volume_106164848}"
LIMIT="${LIMIT:-12}"

remote() {
  ssh "$SSH_HOST" "$@"
}

remote "LIMIT='$LIMIT' REMOTE_VOLUME='$REMOTE_VOLUME' bash -s" <<'REMOTE'
set -euo pipefail

echo "== Disk =="
df -h "$REMOTE_VOLUME"
echo

echo "== Docker summary =="
docker system df
echo

echo "== Top active images by docker inspect size =="
docker ps --format '{{.Image}}' \
  | sort -u \
  | while read -r image; do
      [ -n "$image" ] || continue
      size=$(docker image inspect "$image" --format '{{.Size}}' 2>/dev/null || echo 0)
      containers=$(docker ps --filter "ancestor=$image" --format '{{.ID}}' | wc -l | tr -d ' ')
      awk -v bytes="$size" -v containers="$containers" -v image="$image" '
        function human(n) {
          split("B KB MB GB TB", u, " ");
          i=1;
          while (n >= 1024 && i < 5) { n/=1024; i++ }
          return sprintf(i == 1 ? "%.0f%s" : "%.2f%s", n, u[i]);
        }
        BEGIN { print bytes "\t" human(bytes) "\t" containers "\t" image }
      '
    done \
  | sort -nr \
  | head -n "$LIMIT" \
  | cut -f2-
echo

echo "== Top volumes by size =="
docker system df -v \
  | awk '
      BEGIN { in_volumes=0 }
      /^Local Volumes space usage:/ { in_volumes=1; next }
      /^Build cache usage:/ { in_volumes=0 }
      in_volumes && $1 != "VOLUME" && NF >= 3 {
        print $3 "\t" $2 "\t" $1
      }
    ' \
  | sort -hr \
  | head -n "$LIMIT"
echo

echo "== Containers not healthy/running cleanly =="
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' \
  | awk 'BEGIN { found=0 } !/healthy|Up [0-9]|Up About|Up Less/ || /unhealthy|Restarting/ { found=1; print } END { if (!found) print "none" }'
echo

echo "== Reclaimable build cache =="
docker system df -v \
  | awk '
      /^Build cache usage:/ { in_cache=1; next }
      in_cache && $1 != "CACHE" && NF >= 3 {
        print $3 "\t" $1
      }
    ' \
  | sort -hr \
  | head -n "$LIMIT"
REMOTE
