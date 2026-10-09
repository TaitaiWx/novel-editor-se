#!/bin/sh
# Complete one already-verified bundle swap. Filesystem state is the journal:
# failed exists only after displacement; staged disappears only on publication.
# Caller must verify the staged (or already-published) signed bundle first.
set -eu
staged=$1
installed=$2
failed=$3
if [ ! -e "$failed" ]; then
  [ -d "$staged" ] && [ -d "$installed" ] || exit 30
  /bin/mv "$installed" "$failed"
fi
if [ ! -e "$installed" ]; then
  if ! /bin/mv "$staged" "$installed"; then
    # Preserve an application path even when publication fails; keep diagnostics.
    /bin/mv "$failed" "$installed"
    exit 31
  fi
fi
[ -d "$installed" ] && [ ! -e "$staged" ] || exit 32
