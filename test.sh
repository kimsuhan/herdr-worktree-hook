#!/bin/sh
# Self-check: real git worktrees in a temp folder, isolated from your git config and herdr config.
set -eu
BIN=$(cd "$(dirname "$0")" && pwd)/bin/herdr-worktree-hook
T=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$T"' EXIT
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
[ -f "$T/w1/.env" ] && [ -f "$T/w1/.env.local" ] && [ -f "$T/w1/.config/sub/f" ] || fail "builtin copy"
[ ! -e "$T/w1/notes.txt" ] && [ ! -e "$T/w1/node_modules" ] || fail "copied what it shouldn't"
grep -q 'copied .env, .env.local, .config/' "$T/err" || fail "summary: $(cat "$T/err")"

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

# A broken config never fails git worktree add.
echo '{' > "$XDG_CONFIG_HOME/herdr/plugins/config/kimsuhan.worktree-hook/config.json"
wt "$T/w4" -b w4
grep -q 'not valid JSON' "$T/err" || fail "broken config: $(cat "$T/err")"

# Plain checkouts and the main checkout do nothing; run refuses the main checkout.
git -C "$T/w4" checkout -q -b other 2>"$T/err"; [ ! -s "$T/err" ] || fail "branch checkout ran"
"$BIN" run "$T/repo" 2>/dev/null && fail "run on main checkout"

# Entries are checked before they're saved.
printf '%s' '{"copy": ["../x"]}' | "$BIN" set a 2>/dev/null && fail "accepted ../"
printf '%s' '{"cmd": []}' | "$BIN" set a 2>/dev/null && fail "accepted unknown field"
echo ok
