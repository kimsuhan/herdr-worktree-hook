# herdr-worktree-hook

Sets up every new git worktree, however it was made (Herdr's New worktree, `git worktree add`,
an agent): copies local files such as `.env` from the main checkout, then runs setup commands such as
`yarn install` in the background, so `git worktree add` returns at once.

Settings live in your home folder, not in the repo, keyed by the repo's origin. A branch or a PR you
check out can't change what runs.

## Install

Needs git 2.54 or newer (hooks set in git config) and python3.

```sh
git clone https://github.com/kimsuhan/herdr-worktree-hook
ln -s "$PWD/herdr-worktree-hook/bin/herdr-worktree-hook" ~/.local/bin/
herdr-worktree-hook install     # adds hook.herdr-worktree-hook to ~/.gitconfig
```

`herdr-worktree-hook uninstall` removes it.

### The Herdr app panel (optional)

```sh
cp -R app/mods/worktree-hook ~/.config/herdr-app/mods/
```

It shows what a new worktree of the shown space's repo gets, edits it, sets a worktree up again, and
lists recent runs with their logs; a failed run posts a notification. It finds the CLI on PATH or in
`~/.local/bin`. Give it a slot: a `worktree-hook` block in your layout's panel stack and a button in
your tab bar, as for [Automations](https://github.com/DnzzL/herdr-automations). Only spaces on this
computer for now.

## Settings

`~/.config/herdr/plugins/config/kimsuhan.worktree-hook/config.json`:

```json
{
  "default": { "copy": [".env", ".env.*", ".config/"] },
  "repos": {
    "github.com/acme/api": {
      "run": ["yarn install --frozen-lockfile", "npx prisma generate"],
      "skip_run": ["review-*"]
    }
  }
}
```

- `copy`: paths in the main checkout, globs allowed, a trailing `/` for a folder. Only what git
  ignores is copied, and nothing the worktree already has is overwritten.
- `run`: commands run in order in the new worktree with your login shell's PATH; the first failure
  stops the rest. They get `WT_PATH`, `WT_REPO_ROOT` (the main checkout) and `WT_BRANCH`.
- `skip_run`: patterns for the branch or the worktree's folder name that skip `run`.

A repo's entry overrides `default` field by field; without either, `copy` is
`.env`, `.env.*`, `CLAUDE.md`, `AGENTS.md`, `.local/`, `.config/`, `.codex/`, `.wiki/` and nothing runs.
Find a repo's key with `herdr-worktree-hook key`, edit with `herdr-worktree-hook set <key> < entry.json`.

## Runs

`herdr-worktree-hook history` lists recent runs and their logs, under
`~/.local/state/herdr/plugins/kimsuhan.worktree-hook/runs/`. `herdr-worktree-hook run [path]` sets up
an existing worktree again.

## Test

`./test.sh` builds real worktrees in a temp folder, isolated from your git and herdr config.
