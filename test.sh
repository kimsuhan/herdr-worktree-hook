#!/bin/sh
# Self-check: real git worktrees in a temp folder, isolated from your git config and herdr config.
set -eu
BIN=$(cd "$(dirname "$0")" && pwd)/bin/herdr-worktree-hook
T=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$T"' EXIT
# The system python first (3.9 on macOS), the oldest one this has to run on. Only python: the rest of
# /usr/bin would bring the system git too, which can be older than 2.54.
if [ -x /usr/bin/python3 ]; then mkdir "$T/bin"; ln -s /usr/bin/python3 "$T/bin/python3"; PATH="$T/bin:$PATH"; fi
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1 XDG_CONFIG_HOME="$T/config" XDG_STATE_HOME="$T/state" SHELL=/bin/sh
: > "$GIT_CONFIG_GLOBAL"
git config --global user.name t; git config --global user.email t@t
fail() { echo "FAIL: $*"; exit 1; }
wt() { git -C "$T/repo" -c hook.t.event=post-checkout -c "hook.t.command=$BIN post-checkout" worktree add -q "$@" 2>"$T/err" || { cat "$T/err"; exit 1; }; }
wait_run() { i=0; until "$BIN" history --json | grep -q '"status": "\(ok\|failed\)"'; do i=$((i+1)); [ $i -lt 100 ] || fail "run never finished"; sleep 0.1; done; }

# key_of
k() { git -C "$T/repo" remote set-url origin "$1"; [ "$("$BIN" key "$T/repo")" = "$2" ] || fail "key $1 -> $("$BIN" key "$T/repo")"; }
git init -q "$T/repo"
git -C "$T/repo" remote add origin x
k git@github.com:Acme/demo.git github.com/Acme/demo
k https://github.com/Acme/demo.git github.com/Acme/demo
k ssh://git@GitHub.com:22/Acme/demo/ github.com/Acme/demo
k ../up "$T/up"
git -C "$T/repo" remote set-url origin git@github.com:acme/demo.git

# The main checkout: .env, .config/ and node_modules/ ignored, AGENTS.md tracked.
cd "$T/repo"
printf '.env*\n.config/\nnode_modules/\n' > .gitignore
echo tracked > AGENTS.md
git add . && git commit -qm init
echo A=1 > .env; echo B=1 > .env.local; mkdir -p .config/sub node_modules; echo y > .config/sub/f; echo big > node_modules/x
echo untracked > notes.txt

# No config: the builtin copy list, no commands.
wt "$T/w1" -b w1
[ -f "$T/w1/.env" ] && [ -f "$T/w1/.env.local" ] || fail "builtin copy"
[ ! -e "$T/w1/notes.txt" ] && [ ! -e "$T/w1/node_modules" ] && [ ! -e "$T/w1/.config" ] || fail "copied what it shouldn't"
grep -q 'copied .env, .env.local$' "$T/err" || fail "summary: $(cat "$T/err")"

# "default" applies to every repo without its own entry.
printf '%s' '{"copy": [".config/"]}' | "$BIN" set default
wt "$T/w1b" -b w1b
[ -f "$T/w1b/.config/sub/f" ] && [ ! -e "$T/w1b/.env" ] || fail "default entry"
"$BIN" rm default

# A repo entry: its copy replaces the builtin one, commands run in the background with WT_* set.
printf '%s' '{"copy": ["node_modules/", ".env"], "run": ["echo \"$WT_BRANCH from $WT_REPO_ROOT\" > ran", "pwd >> ran"], "skip_run": ["review-*"]}' | "$BIN" set github.com/acme/demo
wt "$T/w2" -b w2
[ -f "$T/w2/node_modules/x" ] && [ ! -e "$T/w2/.config" ] && [ ! -e "$T/w2/.env.local" ] || fail "entry copy"
wait_run
[ "$(head -1 "$T/w2/ran")" = "w2 from $T/repo" ] || fail "WT_* env: $(cat "$T/w2/ran")"
"$BIN" history --json | grep -q '"status": "ok"' || fail "history"

# skip_run matches the folder name of a detached worktree.
wt --detach "$T/review-7" HEAD
grep -q 'run skipped' "$T/err" || fail "skip_run: $(cat "$T/err")"

# A failing command is recorded as failed and stops the rest.
printf '%s' '{"run": ["false", "touch nope"]}' | "$BIN" set github.com/acme/demo
rm -rf "$XDG_STATE_HOME"
wt "$T/w3" -b w3
wait_run
"$BIN" history --json | grep -q '"exit": 1' || fail "failed run"
[ ! -e "$T/w3/nope" ] || fail "ran past a failure"

# Leaving an unborn branch looks like a new worktree to git: the hook still runs once per worktree.
git -C "$T/w3" switch -q --orphan o
git -C "$T/w3" -c hook.t.event=post-checkout -c "hook.t.command=$BIN post-checkout" checkout -q w3 2>"$T/err"
[ ! -s "$T/err" ] || fail "ran again after an orphan branch: $(cat "$T/err")"

# A file that can't be read is reported; the rest is copied and the commands still run.
"$BIN" rm github.com/acme/demo
"$BIN" rm nope 2>/dev/null && fail "rm of a missing entry"
printf '%s' '{"run": ["true"]}' | "$BIN" set default
chmod 000 "$T/repo/.env"
wt "$T/w3b" -b w3b
chmod 600 "$T/repo/.env"
[ -f "$T/w3b/.env.local" ] && [ ! -e "$T/w3b/.env" ] || fail "copy stopped at an unreadable file"
grep -q 'could not copy .env (Permission denied); running 1 command' "$T/err" || fail "copy failure: $(cat "$T/err")"

# run sets an existing worktree up again: what's missing is copied, what's there is kept.
echo mine > "$T/w3b/.env.local"
"$BIN" run "$T/w3b" | grep -q 'copied .env;' || fail "run"
[ "$(cat "$T/w3b/.env.local")" = mine ] || fail "run overwrote a file"

# A hand-edited config with a wrong type stops the setup, not git.
echo '{"default": {"run": "echo hi"}}' > "$XDG_CONFIG_HOME/herdr/plugins/config/kimsuhan.worktree-hook/config.json"
wt "$T/w3c" -b w3c
grep -q 'default: run must be a list' "$T/err" || fail "wrong type in config: $(cat "$T/err")"

# A broken config never fails git worktree add.
echo '{' > "$XDG_CONFIG_HOME/herdr/plugins/config/kimsuhan.worktree-hook/config.json"
wt "$T/w4" -b w4
grep -q 'not valid JSON' "$T/err" || fail "broken config: $(cat "$T/err")"

# Plain checkouts and the main checkout do nothing; run refuses the main checkout.
git -C "$T/w4" checkout -q -b other 2>"$T/err"; [ ! -s "$T/err" ] || fail "branch checkout ran"
"$BIN" run "$T/repo" 2>/dev/null && fail "run on main checkout"

# Entries are checked before they're saved (with the broken config gone, so it's the entry that's refused).
rm "$XDG_CONFIG_HOME/herdr/plugins/config/kimsuhan.worktree-hook/config.json"
printf '%s' '{"copy": ["../x"]}' | "$BIN" set a 2>/dev/null && fail "accepted ../"
printf '%s' '{"cmd": []}' | "$BIN" set a 2>/dev/null && fail "accepted unknown field"
"$BIN" history -n 2>/dev/null && fail "history -n without a number"

# install and uninstall write only the (isolated) global git config.
"$BIN" install >/dev/null; "$BIN" ls | grep -q '"installed": true' || fail "install"
"$BIN" uninstall >/dev/null; "$BIN" ls | grep -q '"installed": false' || fail "uninstall"
echo ok
