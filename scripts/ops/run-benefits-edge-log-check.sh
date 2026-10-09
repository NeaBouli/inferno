#!/bin/sh
# Owner runbook prerequisite: independent source review and scoped host GO/root.
# PyYAML SafeLoader must already be provisioned for Python >=3.11 by the owner.
# Do not run from Desktop, over SSH, or against production before separate GO.
# No install, sudo, Docker mutation, synthetic request or automatic retry.
set -eu
if [ "$#" -ne 1 ] || [ "$1" != '--owner-go' ]; then
    printf 'status=HOLD\nreason=OWNER_GO_REQUIRED\n'
    exit 2
fi
if [ "$(id -u 2>/dev/null)" != '0' ]; then
    printf 'status=HOLD\nreason=ROOT_REQUIRED\n'
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    printf 'status=HOLD\nreason=PYTHON_REQUIRED\n'
    exit 2
fi
# Discard shell/interpreter startup errors rather than exposing private paths.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || {
    printf 'status=HOLD\nreason=WRAPPER_FAILED\n'
    exit 2
}
if python3 -I -B "$script_dir/benefits-edge-log-check.py" --owner-go 2>/dev/null; then
    exit 0
else
    code=$?
fi
if [ "$code" -eq 2 ]; then
    exit 2
fi
printf 'status=HOLD\nreason=WRAPPER_OR_CHECK_FAILED\n'
exit 2
