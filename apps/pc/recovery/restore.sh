#!/bin/sh
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
cd "$1"
artifact=$(cat artifact)
expected=$(cat sha256)
mode=$(cat mode)
if [ "$mode" = mac ]; then
  actual=$(/usr/bin/shasum -a 256 "$artifact" | cut -d ' ' -f 1)
else
  actual=$(/usr/bin/sha256sum "$artifact" | cut -d ' ' -f 1)
fi
[ "$actual" = "$expected" ] || exit 20
install=$(cat install-path)
if [ "$mode" = mac ]; then
  stage=$(cat stage)
  failed=$(cat failed-path)
  if [ ! -e "$failed" ] && [ ! -f swap-ready ]; then
    # Extraction interrupted before publication: recreate this private staging directory.
    /bin/rm -rf "$stage"
    /bin/mkdir "$stage"
    /usr/bin/ditto -x -k "$artifact" "$stage"
  fi
  old="$stage/Novel Editor.app"
  if [ -e "$failed" ] && [ -d "$install" ] && [ ! -e "$old" ]; then old="$install"; fi
  requirement=$(cat signature-requirement)
  /usr/bin/codesign --verify --deep --strict -R "$requirement" "$old"
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$old/Contents/Info.plist")" = "$(cat previous)" ]
  : > swap-ready
  # Stop only the executable at this installation path, including a pre-JS hang.
  executable=$(cat executable)
  /bin/ps -ax -o pid= -o comm= | while read -r pid command; do
    if [ "$command" = "$executable" ]; then /bin/kill -TERM "$pid" 2>/dev/null || true; fi
  done
  sleep 2
  /bin/ps -ax -o pid= -o comm= | while read -r pid command; do
    if [ "$command" = "$executable" ]; then /bin/kill -KILL "$pid" 2>/dev/null || true; fi
  done
  /bin/sh "$PWD/publish-mac.sh" "$stage/Novel Editor.app" "$install" "$failed"
  /usr/bin/open -n "$install" 9>&-
elif [ "$mode" = appimage ]; then
  # The new image may hang before it can publish a PID. Match the immutable
  # APPIMAGE launch environment; guardian itself has this variable removed.
  for environment in /proc/[0-9]*/environ; do
    if [ -r "$environment" ] && tr '\000' '\n' < "$environment" 2>/dev/null | grep -Fqx -- "APPIMAGE=$install"; then
      pid=${environment#/proc/}; pid=${pid%/environ}
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 2
  for environment in /proc/[0-9]*/environ; do
    if [ -r "$environment" ] && tr '\000' '\n' < "$environment" 2>/dev/null | grep -Fqx -- "APPIMAGE=$install"; then
      pid=${environment#/proc/}; pid=${pid%/environ}
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  stage=$(cat stage)
  /bin/cp "$artifact" "$stage"
  /bin/chmod 755 "$stage"
  # Rename keeps currently mapped binaries intact and is atomic on this volume.
  /bin/mv -f "$stage" "$install"
  "$install" >/dev/null 2>&1 9>&- &
elif [ "$mode" = deb ]; then
  # The desktop's polkit agent requests authorization; cancellation is failure.
  /usr/bin/pkexec /usr/bin/dpkg --install "$artifact"
  executable=$(cat executable)
  for link in /proc/[0-9]*/exe; do
    current=$(readlink "$link" 2>/dev/null || true)
    if [ "$current" = "$executable" ] || [ "$current" = "$executable (deleted)" ]; then
      pid=${link#/proc/}; pid=${pid%/exe}
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 2
  for link in /proc/[0-9]*/exe; do
    current=$(readlink "$link" 2>/dev/null || true)
    if [ "$current" = "$executable" ] || [ "$current" = "$executable (deleted)" ]; then
      pid=${link#/proc/}; pid=${pid%/exe}
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  "$executable" >/dev/null 2>&1 9>&- &
else
  exit 22
fi
