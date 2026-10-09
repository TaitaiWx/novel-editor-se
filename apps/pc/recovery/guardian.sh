#!/bin/sh
# Runs under the OS shell, never the application runtime. The private transaction
# directory and its recovery action are created by the verified, healthy release.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 077
cd "$1"
transaction=$PWD
phase() { printf '%s\n' "$1" > phase.tmp; mv phase.tmp phase; }
case "$(cat phase 2>/dev/null || true)" in healthy|recovered|failed|cancelled) exit 0;; esac
# Kernel locks have no PID lease, stale-directory reclamation, or ABA window.
# FD 9 remains open in this shell; never unlink the inode used by contenders.
exec 9> guardian.lock
if [ -x /usr/bin/lockf ]; then
  /usr/bin/lockf -s -t 0 9 || exit 0
elif [ -x /usr/bin/flock ]; then
  /usr/bin/flock -n 9 || exit 0
else
  exit 1
fi
boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || /usr/sbin/sysctl -n kern.boottime)
nonce=$(cat nonce)
target=$(cat target)
previous=$(cat previous)
timeout=$(cat timeout)
case "$timeout" in ''|*[!0-9]*) exit 1;; esac
healthy() {
  [ "$(cat healthy 2>/dev/null || true)" = "$nonce:$1" ] ||
  [ "$(cat decision 2>/dev/null || true)" = "healthy:$nonce:$1" ]
}
await_restored() {
  phase restored-awaiting-health
  if [ ! -f recovery-deadline ]; then printf '%s' "$(( $(date +%s) + timeout ))" > recovery-deadline; fi
  end=$(cat recovery-deadline)
  while [ "$(date +%s)" -lt "$end" ]; do
    if healthy "$previous"; then phase recovered; exit 0; fi
    sleep 0.2 9>&-
  done
  phase failed
  exit 1
}
# The decision payload is published by atomic hard link, so a crash before the
# next phase still leaves a fully classified restore claim that can be resumed.
if [ "$(cat decision 2>/dev/null || true)" = "restore:$nonce" ] && [ ! -d attempted ]; then
  mkdir attempted
  phase recovering
  if ! /bin/sh "$transaction/recover.sh" "$transaction"; then phase failed; exit 1; fi
  await_restored
fi
# Resume the same verified mac directory publication, never rerun native installers.
if [ -d attempted ]; then
  if healthy "$previous"; then phase recovered; exit 0; fi
  if [ "$(cat mode 2>/dev/null || true)" = mac ] && [ "$(cat phase 2>/dev/null || true)" != restored-awaiting-health ]; then
    phase recovering
    if ! /bin/sh "$transaction/recover.sh" "$transaction" --resume; then phase failed; exit 1; fi
  fi
  await_restored
fi
if [ ! -f armed-boot ]; then printf '%s' "$boot" > armed-boot; fi
phase ready
parent_deadline=$(( $(date +%s) + 300 ))
while :; do
  if [ -e cancel ]; then phase cancelled; exit 0; fi
  if [ -f commit ]; then
    parent=$(cat commit)
    case "$parent" in ''|*[!0-9]*) phase failed; exit 1;; esac
    if [ "$(cat armed-boot)" != "$boot" ] || ! kill -0 "$parent" 2>/dev/null; then break; fi
  fi
  # A failed install handoff must not leave an armed watcher indefinitely.
  if [ "$(date +%s)" -ge "$parent_deadline" ]; then phase cancelled; exit 0; fi
  sleep 0.2 9>&-
done
phase watching
if [ ! -f deadline ]; then printf '%s' "$(( $(date +%s) + timeout ))" > deadline; fi
end=$(cat deadline)
case "$end" in ''|*[!0-9]*) phase failed; exit 1;; esac
while [ "$(date +%s)" -lt "$end" ]; do
  if [ -e cancel ]; then phase cancelled; exit 0; fi
  if healthy "$target"; then phase healthy; exit 0; fi
  sleep 0.2 9>&-
done
if healthy "$target"; then phase healthy; exit 0; fi
# Exactly one of the target's health acknowledgement and recovery owns this decision.
printf '%s' "restore:$nonce" > "decision-restore-$$"
if ! ln "decision-restore-$$" decision 2>/dev/null; then
  if healthy "$target"; then phase healthy; exit 0; fi
  # A health writer may have just won the lock but not completed its atomic write.
  sleep 1 9>&-
  if healthy "$target"; then phase healthy; else phase failed; fi
  exit 0
fi
rm -f "decision-restore-$$"
mkdir attempted || exit 0
phase recovering
if ! /bin/sh "$transaction/recover.sh" "$transaction"; then phase failed; exit 1; fi
await_restored
