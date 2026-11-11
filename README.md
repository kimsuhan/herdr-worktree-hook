# herdr-worktree-hook

[한국어](README.ko.md)

A new git worktree is a clean checkout: no `.env`, no `node_modules`, nothing git ignores.
herdr-worktree-hook sets each new worktree up for you, however it was made (`git worktree add`, your
editor, an agent, [Herdr](https://herdr.dev)):

1. copies local files such as `.env` from the main checkout, and
2. runs setup commands such as `yarn install` in the background, so `git worktree add` returns at once.

What to copy and run is set per repo, in your home folder. Nothing goes into the repo, and a branch or
pull request you check out can't change what runs.

## Requirements

- git 2.54 or newer (hooks set in git config)
- python3
- macOS or Linux (tested on macOS)

## Install

```sh
git clone https://github.com/kimsuhan/herdr-worktree-hook
ln -s "$PWD/herdr-worktree-hook/bin/herdr-worktree-hook" ~/.local/bin/
herdr-worktree-hook install
```

`install` adds a global `post-checkout` hook to `~/.gitconfig`; your other hooks, including Husky's,
keep working. `herdr-worktree-hook uninstall` removes it.

Try it in any repo:

```sh
git worktree add ../try-it -b try-it
# herdr-worktree-hook: github.com/you/app: copied .env
```

## Settings

`~/.config/herdr/plugins/config/kimsuhan.worktree-hook/config.json`
(`$XDG_CONFIG_HOME` is honored):

```json
{
  "default": {
    "copy": [".env", ".env.*", ".vscode/"]
  },
  "repos": {
    "github.com/acme/api": {
      "run": ["yarn install --frozen-lockfile", "npx prisma generate"],
      "skip_run": ["review-*"]
    }
  }
}
```

Each field is looked up in order, and the first that has it wins:

1. the repo's own entry under `repos`
2. `default`: every repo without its own value
3. built in: `copy` is `.env` and `.env.*`, `run` and `skip_run` are empty

So above, `acme/api` copies `.env`, `.env.*` and `.vscode/` from `default` and runs its own commands.
Without a config file, every repo copies `.env` and `.env.*` and runs nothing.

| Field | What it does |
| --- | --- |
| `copy` | Paths in the main checkout. Globs work; end a folder with `/`. Only files git ignores are copied, and nothing already in the worktree is overwritten. |
| `run` | Commands run in order in the new worktree, with your login shell's `PATH` (so nvm, asdf and the like work). The first failure stops the rest. Each gets `WT_PATH`, `WT_REPO_ROOT` (the main checkout) and `WT_BRANCH`. |
| `skip_run` | Patterns for the branch or the worktree's folder name that skip `run`, such as `review-*`. |

A repo's key is its `origin` remote without the scheme and `.git` (`github.com/acme/api`, whether
the remote is https or ssh), or the main checkout's path when there's no `origin`.

Edit the file by hand, or from the command line:

```sh
herdr-worktree-hook key                       # this repo's key
herdr-worktree-hook show                      # what a new worktree of this repo gets
echo '{"run": ["yarn install"]}' | herdr-worktree-hook set github.com/acme/api
herdr-worktree-hook rm github.com/acme/api
```

## Commands

| Command | |
| --- | --- |
| `install`, `uninstall` | Add or remove the global git hook. |
| `run [path]` | Set up an existing worktree again. |
| `history [-n N] [--json]` | Recent runs with their status and log file. |
| `show [path]`, `key [path]` | A repo's settings in effect, its key. |
| `ls`, `set KEY`, `rm KEY` | All settings as JSON; save or remove one entry (`default` included). |

Logs are under `~/.local/state/herdr/plugins/kimsuhan.worktree-hook/runs/` (`$XDG_STATE_HOME` is
honored). If a command can't be found, check that your login shell puts it on `PATH`.

## Herdr panel (optional)

For the [Herdr app](https://herdr.dev), a side panel shows the settings in effect for the repo of the
space you're in, edits them, sets a worktree up again, and lists recent runs with their logs. A failed
run posts a notification.

```sh
cp -R herdr-worktree-hook/app/mods/worktree-hook ~/.config/herdr-app/mods/
```

Herdr docks it on the right the first time it sees it; after that, your layout decides where it is.
It finds the CLI on `PATH` or in `~/.local/bin`. Spaces on other machines aren't supported yet.

## Development

`./test.sh` creates real worktrees in a temp folder, isolated from your git and Herdr settings.

## License

MIT
