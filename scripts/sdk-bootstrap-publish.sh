#!/usr/bin/env bash
# One-time manual bootstrap publish of ifr-sdk (T-288). Owner-run only, after an explicit action-time approval
# that names the version, the exact commit SHA, the seven-file package and the missing provenance.
#
# Usage (from a clean checkout of the reviewed main commit):
#   bash scripts/sdk-bootstrap-publish.sh <version> <full-commit-sha>
#
# Fail-closed credential handling:
#   - npm login writes a session credential into the npm user config. This script never uses the owner's
#     normal user config: it creates a private temporary one (NPM_CONFIG_USERCONFIG) and never reads,
#     changes or removes any other npm configuration.
#   - Any failure before the publish (approval mismatch, dirty tree, tests, temp file, login, wrong account)
#     forbids the publish.
#   - After a successful login (or whenever a credential is found in the temp config), npm logout runs on
#     every exit path (success, wrong account, publish failure, Ctrl-C).
#     npm logout ends the token session on the registry. The temp config is deleted only after a successful
#     logout AND a verified clean config. Otherwise the script ends with HOLD (non-zero) and keeps the
#     temp config so the session can be revoked on npmjs.com (Access Tokens) and the file removed by hand.
#   - Credentials are never printed.
set -euo pipefail
umask 077

PACKAGE_NAME="ifr-sdk"
EXPECTED_USER="ifr-protocol"
# npm stores registry credentials as //registry.npmjs.org/:<key>=<value>
CREDENTIAL_LINE='^[[:space:]]*//registry\.npmjs\.org/:(_authToken|_auth|_password|username)[[:space:]]*='

cfg=""
login_attempted=0
logged_in=0
published=0

say() { printf '%s\n' "$*" >&2; }
hold() { say "HOLD: $*"; exit 1; }

# Returns 0 = clean, 1 = credential present, 2 = cannot verify (missing, not a regular file, unreadable, grep error).
verify_clean() {
  local file="$1" rc=0
  [ -e "$file" ] || return 2
  [ -f "$file" ] && [ ! -L "$file" ] && [ -r "$file" ] || return 2
  grep -Eq -- "$CREDENTIAL_LINE" "$file" || rc=$?
  case "$rc" in
    0) return 1 ;;
    1) return 0 ;;
    *) return 2 ;;
  esac
}

finish() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  local pre=0
  if [ -n "$cfg" ] && [ "$login_attempted" = 1 ] && [ "$logged_in" = 0 ]; then
    # Login did not complete: log out only if a credential (or an unverifiable file) is present.
    verify_clean "$cfg" || pre=$?
  fi
  if [ -n "$cfg" ] && [ "$login_attempted" = 1 ] && { [ "$logged_in" = 1 ] || [ "$pre" != 0 ]; }; then
    if npm logout; then
      local v=0
      verify_clean "$cfg" || v=$?
      case "$v" in
        0)
          if rm -f -- "$cfg"; then
            say "Logged out; session ended on the registry; temporary npm config removed."
          else
            say "HOLD: logged out, but the temporary npm config could not be removed: $cfg"
            [ "$rc" = 0 ] && rc=1
          fi
          ;;
        1)
          say "HOLD: npm logout reported success but a credential line is still in $cfg (kept)."
          say "      Revoke the session on npmjs.com -> Access Tokens, then delete that file."
          [ "$rc" = 0 ] && rc=1
          ;;
        *)
          say "HOLD: cannot verify the temporary npm config after logout (missing or unreadable): $cfg"
          say "      Check npmjs.com -> Access Tokens and revoke any session from this bootstrap."
          [ "$rc" = 0 ] && rc=1
          ;;
      esac
    else
      say "HOLD: npm logout failed; the session token may still be valid."
      say "      Kept the temporary npm config: $cfg"
      say "      Revoke the session on npmjs.com -> Access Tokens first, then delete that file."
      [ "$rc" = 0 ] && rc=1
    fi
  elif [ -n "$cfg" ]; then
    # No login, or a login that left no credential behind: the file must be verifiably clean.
    local v=0
    verify_clean "$cfg" || v=$?
    if [ "$v" = 0 ]; then
      rm -f -- "$cfg" || { say "HOLD: could not remove $cfg"; [ "$rc" = 0 ] && rc=1; }
    else
      say "HOLD: unexpected state of the temporary npm config (kept): $cfg"
      [ "$rc" = 0 ] && rc=1
    fi
  fi
  if [ "$rc" = 0 ]; then
    say "OK: ${PACKAGE_NAME} published and the bootstrap session is closed."
  elif [ "$published" = 1 ]; then
    say "NOTE: the package WAS published; only the session cleanup above needs attention."
  fi
  exit "$rc"
}
trap finish EXIT
trap 'say "Interrupted."; exit 130' INT TERM

# 1. Action-time approval binding: version and exact commit.
[ "$#" -eq 2 ] || hold "usage: $0 <version> <full-commit-sha>"
approved_version="$1"
approved_sha="$2"
# Every captured value that feeds a decision is assigned on its own line so a failing command stops the run
# (an exit status inside `[ ... "$(cmd)" ]` would be lost).
script_dir="$(dirname -- "$0")" || hold "cannot resolve the script directory"
root="$(git -C "$script_dir" rev-parse --show-toplevel)" || hold "not inside the repository"
[ -n "$root" ] || hold "empty repository root"
cd "$root/apps/sdk" || hold "apps/sdk missing"
head_sha="$(git rev-parse HEAD)" || hold "cannot read HEAD"
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || hold "unexpected HEAD value"
[ "$head_sha" = "$approved_sha" ] || hold "HEAD $head_sha is not the approved commit $approved_sha"
status_out="$(git status --porcelain)" || hold "git status failed; cannot prove a clean checkout"
[ -z "$status_out" ] || hold "working tree is not clean"
version="$(node -p "require('./package.json').version")" || hold "cannot read package version"
name="$(node -p "require('./package.json').name")" || hold "cannot read package name"
[ -n "$version" ] && [ -n "$name" ] || hold "empty package name or version"
[ "$name" = "$PACKAGE_NAME" ] || hold "package name $name is not $PACKAGE_NAME"
[ "$version" = "$approved_version" ] || hold "package version $version is not the approved $approved_version"

# 2. Private temporary npm user config. Created and checked before it is exported.
cfg="$(mktemp "${TMPDIR:-/tmp}/ifr-npm-bootstrap.XXXXXX")" || { cfg=""; hold "mktemp failed"; }
[ -n "$cfg" ] && [ -f "$cfg" ] && [ ! -L "$cfg" ] && [ -O "$cfg" ] || hold "temporary npm config is not a private regular file"
chmod 600 "$cfg" || hold "cannot restrict the temporary npm config"
export NPM_CONFIG_USERCONFIG="$cfg"
say "Temporary npm config (owner-only, holds the session credential until logout): $cfg"

# 3. Package checks (no credentials involved yet).
npm ci || hold "npm ci failed"
npm test || hold "npm test failed"
npm run test:package || hold "package check failed"
npm pack --dry-run --ignore-scripts || hold "npm pack dry run failed"

# 4. Login and identity. From here on, finish() always runs npm logout.
login_attempted=1
npm login --auth-type=web || hold "npm login failed; nothing was published"
logged_in=1
[ -s "$cfg" ] && [ -f "$cfg" ] && [ ! -L "$cfg" ] && [ -O "$cfg" ] || hold "temporary npm config is not a non-empty private regular file after login"
perms="$(ls -l "$cfg" | cut -c1-10)" || hold "cannot read the permissions of the temporary npm config"
[ "$perms" = "-rw-------" ] || hold "temporary npm config is not owner-only ($perms)"
user="$(npm whoami)" || hold "npm whoami failed; nothing was published"
[ "$user" = "$EXPECTED_USER" ] || hold "signed in as '$user', expected '$EXPECTED_USER'; nothing was published"

# 5. Publish (first-version exception: no provenance outside GitHub Actions).
publish_rc=0
npm publish --access public --provenance=false --ignore-scripts || publish_rc=$?
if [ "$publish_rc" != 0 ]; then
  say "HOLD: npm publish failed (exit $publish_rc)."
  exit "$publish_rc"
fi
published=1
exit 0
