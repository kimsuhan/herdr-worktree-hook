# herdr-worktree-hook

A global git `post-checkout` hook that sets up new worktrees (copy ignored files from the main
checkout, run setup commands in the background), plus a Herdr app panel for it. Public repo, MIT.

## Layout

- `bin/herdr-worktree-hook`: the whole CLI and the hook, one python3 file, no dependencies.
- `app/`: the Herdr mod as herdr.dev/mods shares it: `mods/worktree-hook/`, `RECIPE.md`, `preview.png`.
- `test.sh`: real worktrees in a temp folder, isolated with `GIT_CONFIG_GLOBAL` and `XDG_*`.
- `README.md` and `README.ko.md` say the same thing in English and Korean. `docs/panel.png` is the
  real panel screenshot they show.

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
- `app/preview.png` is the gallery thumbnail: the name and two lines at the left, `docs/panel.png` at
  the right, generated from that screenshot with Codex image_gen. Both are public: show only public
  repos, with no private repo name or setting on screen. Retake both when the panel changes.
- Commit messages are in English.

## Versions

- Bump `VERSION` in `bin/herdr-worktree-hook` only when the config format, install paths or the CLI
  output the mod reads change. Then tag `vX.Y.Z` on `main` and run
  `gh release create vX.Y.Z --generate-notes`. Other changes ship from `main` untagged.

## Sharing the mod

- herdr.dev/mods lists a public GitHub repo with the topic `herdr-mod` within the hour of a push, so a
  push to `main` publishes `app/` as it is. A folder below the root is listed as `<repo>--<folder>`:
  `herdr.dev/mods/kimsuhan/herdr-worktree-hook--app`.
- `app/` holds exactly what a share is: `mods/worktree-hook/`, `RECIPE.md`, `preview.png`. No `layouts/`
  folder; a `keys.json` only if the mod starts expecting keys. CLI files stay out of it.
- `RECIPE.md` is the brief another agent builds the mod from with an empty folder. Keep the order
  Herdr's `~/.config/herdr-app/AGENTS.md` gives ("Layouts and mods other people made"): name, paragraph and preview, What you see,
  How it behaves, Built from, Watch out, Done when. Exact values, nothing the build doesn't do.
- Whoever adds the mod is told what it reaches: keep "Before you add it" true (programs it runs, files
  it reads outside its folder, no network), and "Built from" in step with `main.js`'s imports and icons.

## Known gaps

- If the CLI isn't found when the panel starts, it keeps the error until the mod reloads.
- Spaces on other machines aren't supported. CI runs `test.sh` on macOS and Ubuntu, so the CLI is
  tested on Linux; the panel isn't.
- `install` writes this clone's absolute path into `~/.gitconfig`: moving the clone needs `install` again.
