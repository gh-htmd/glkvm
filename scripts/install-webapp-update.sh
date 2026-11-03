#!/bin/sh
# Install a GLKVM webapp-only update (e.g. the foldable laptop mode)
# onto a GLKVM device, from an extracted release tarball.
#
# This is NOT a firmware upgrade and the device's built-in Upgrade UI
# will not install it: that UI expects a signed GL.iNet update.img
# (see kvmd/apps/kvmd/api/upgrade.py). This script only replaces the
# static web files nginx serves from /usr/share/kvmd/web, which is
# exactly what a web-only change needs. No kvmd restart is required;
# nginx serves these files with no-store/no-cache, so a browser reload
# picks the new version up.
#
# Layout expected next to this script (as shipped in the release
# tarball):
#   web/kvm/index.html
#   web/share/js/kvm/fold.js
#   web/share/js/kvm/hid.js
#   web/share/js/kvm/session.js
#   web/share/css/kvm/fold.css
#
# Usage (on the device, as root, from the extracted tarball):
#   ./install.sh
#
# Rollback: this script backs the whole web tree up first and prints
# the backup path. Restore with:
#   cp -a <backup>/kvm/index.html /usr/share/kvmd/web/kvm/
#   cp -a <backup>/share/js/kvm/fold.js <backup>/share/js/kvm/hid.js \
#         <backup>/share/js/kvm/session.js /usr/share/kvmd/web/share/js/kvm/
#   cp -a <backup>/share/css/kvm/fold.css /usr/share/kvmd/web/share/css/kvm/
# (or simply: cp -a <backup>/. /usr/share/kvmd/web/)

set -eu

WEB_ROOT="${WEB_ROOT:-/usr/share/kvmd/web}"

# Resolve the tarball directory even when invoked via a relative path.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -d "$WEB_ROOT/kvm" ]; then
	echo "Error: web root not found at $WEB_ROOT" >&2
	echo "Check the device's nginx config (upstream: /usr/share/kvmd/web)" >&2
	echo "and re-run with WEB_ROOT=<actual path> $0" >&2
	exit 1
fi

for f in \
	"web/kvm/index.html" \
	"web/share/js/kvm/fold.js" \
	"web/share/js/kvm/hid.js" \
	"web/share/js/kvm/session.js" \
	"web/share/css/kvm/fold.css" \
; do
	if [ ! -f "$SCRIPT_DIR/$f" ]; then
		echo "Error: missing file in tarball: $f" >&2
		exit 1
	fi
done

# Back up the whole served web tree before touching anything.
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP="/usr/share/kvmd/web-backup-$STAMP"
if ! cp -a "$WEB_ROOT" "$BACKUP" 2>/dev/null; then
	BACKUP="/tmp/web-backup-$STAMP"
	cp -a "$WEB_ROOT" "$BACKUP"
	echo "Note: backup went to $BACKUP (on tmpfs; it will not survive a reboot)" >&2
fi
echo "Backup: $BACKUP"

# Copy all files first, verify afterwards, so a half-copied set is
# never what a browser reload sees halfway through (session.js now
# imports fold.js, so these files must land together).
cp "$SCRIPT_DIR/web/kvm/index.html" "$WEB_ROOT/kvm/index.html"
cp "$SCRIPT_DIR/web/share/js/kvm/fold.js" \
   "$SCRIPT_DIR/web/share/js/kvm/hid.js" \
   "$SCRIPT_DIR/web/share/js/kvm/session.js" \
   "$WEB_ROOT/share/js/kvm/"
cp "$SCRIPT_DIR/web/share/css/kvm/fold.css" "$WEB_ROOT/share/css/kvm/"

# Verify the landed files.
test -s "$WEB_ROOT/kvm/index.html"
test -s "$WEB_ROOT/share/js/kvm/fold.js"
test -s "$WEB_ROOT/share/js/kvm/hid.js"
test -s "$WEB_ROOT/share/js/kvm/session.js"
test -s "$WEB_ROOT/share/css/kvm/fold.css"
grep -q "fold-keyboard" "$WEB_ROOT/kvm/index.html"
grep -q "FoldSplit" "$WEB_ROOT/share/js/kvm/fold.js"
grep -q "emitKey" "$WEB_ROOT/share/js/kvm/hid.js"
grep -q "FoldSplit" "$WEB_ROOT/share/js/kvm/session.js"

echo "OK: webapp updated."
echo "No restart is needed. Reload the KVM page in your browser"
echo "(hard reload if anything looks stale) and check"
echo "System -> Web UI settings for the foldable laptop switches."
echo "Rollback backup: $BACKUP"
