#!/usr/bin/env bash
# Runs on the server (piped over ssh by CI): unpacks a release and switches `current` to it atomically.
# Layout: <target>/releases/<release>/ ... ; <target>/current -> releases/<release>; the last 3 releases are kept.
set -euo pipefail

target="$1"
release="$2"
archive="/tmp/kaleidra-$release.tgz"

mkdir -p "$target/releases/$release"
tar -xzf "$archive" -C "$target/releases/$release"
rm -f "$archive"
chown -R www-data:www-data "$target/releases/$release"

# rename(2) of a symlink is atomic: nginx serves either the old or the new release, never a mix.
ln -sfn "releases/$release" "$target/current.next"
mv -Tf "$target/current.next" "$target/current"

ls -1d "$target"/releases/*/ | sort | head -n -3 | xargs -r rm -rf
echo "active: $release"
