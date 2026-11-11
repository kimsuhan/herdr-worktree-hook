# herdr-worktree-hook

A global git `post-checkout` hook that sets up new worktrees (copy ignored files from the main
checkout, run setup commands in the background), plus a Herdr app panel for it. Public repo, MIT.

## Layout

- `bin/herdr-worktree-hook`: the whole CLI and the hook, one python3 file, no dependencies.
- `app/`: the Herdr mod as herdr.dev/mods shares it: `mods/worktree-hook/`, `RECIPE.md`, `preview.png`.
- `test.sh`: real worktrees in a temp folder, isolated with `GIT_CONFIG_GLOBAL` and `XDG_*`.
- `README.md` and `README.ko.md` say the same thing in English and Korean.

## Rules

- Runs on macOS's `/usr/bin/python3` (3.9): no `match`, no `X | None` at runtime, no `tomllib`, no
  third-party modules. That's also why the config is JSON.
- The hook must never fail or slow `git worktree add`: it always exits 0, copies synchronously, and
  starts `run` commands detached (`start_new_session`, output to the log file, no inherited pipes).
- Settings are read only from the home folder, never from the repo, so a checked-out branch or PR
  can't choose what runs. Keep it that way.
- Each field resolves repo entry, then `default`, then `BUILTIN`. Keep `BUILTIN` minimal
  (`.env`, `.env.*`); personal lists belong in a user's `default`, not in the code.
- Paths follow Herdr's plugin convention with the id `kimsuhan.worktree-hook`:
  `~/.config/herdr/plugins/config/<id>/config.json`, `~/.local/state/herdr/plugins/<id>/runs/`.
- The mod never writes files: it calls the CLI (`ls`, `show`, `history --json`, `set`, `rm`, `run`,
  `install`). `exec` has no stdin, so `set` goes through `sh -c 'printf %s "$2" | "$1" set "$3"'`.
  A CLI output change must keep the mod and `app/RECIPE.md` in step.

## After a change

- CLI: `./test.sh` (prints `ok`). Add a case for new behavior.
- Mod: the installed copy isn't linked. Copy and check it:
  `cp -R app/mods/worktree-hook ~/.config/herdr-app/mods/ && herdr-app check ~/.config/herdr-app/mods/worktree-hook`,
  then `herdr-app status` for errors. The mod API is in `~/.config/herdr-app/AGENTS.md` and its `.d.ts`
  files. `herdr-app shot` shows the window.
- Docs: change both READMEs; change `app/RECIPE.md` when the panel's look or behavior changes.
- `preview.png` is public: it must show only public repos. The panel lists every configured repo, so
  crop or pick a moment where no private repo name or setting is on screen.

## Known gaps

- If the CLI isn't found when the panel starts, it keeps the error until the mod reloads.
- Buttons inside the `raised` repo block are `raised` too and barely stand out.
- Spaces on other machines aren't supported; Linux is untested.
- `install` writes this clone's absolute path into `~/.gitconfig`: moving the clone needs `install` again.
