// Worktree Hook: the panel for herdr-worktree-hook. What a new worktree of the shown space's repo gets
// (files copied, commands run), editing it, and the recent runs with their logs.
//
// Everything goes through the herdr-worktree-hook CLI: this mod never writes config.json itself.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { exec, home, theme, settings, spaces, notify, readTextFile, watchFolder } from "herdr";

const BIN = "herdr-worktree-hook";
const FIELDS = [
  ["copy", "COPY", "Paths in the main checkout, one per line. Globs work, a trailing / copies a folder. Only git-ignored files, never overwriting."],
  ["run", "RUN", "Commands, one per line, run in order in the new worktree. The first failure stops the rest."],
  ["skip_run", "SKIP RUN", "Branch or folder patterns that skip RUN, such as review-*."],
];
const COLOR = { ok: "ansi2", failed: "ansi1", running: "working", lost: "dim" };

const tilde = (p) => (p && p.startsWith(home()) ? "~" + p.slice(home().length) : p ?? "");
function ago(sec) {
  const s = Date.now() / 1000 - sec;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default class WorktreeHook extends View {
  init(_props, cx) {
    this.list = null; // `ls`
    this.runs = []; // `history --json`
    this.repo = null; // `show` of the shown space's folder
    this.folder = undefined;
    this.view = "main"; // main | form
    this.open = null; // the run whose log is shown
    this.known = null; // run ids already seen, to toast only new failures
    cx.spawn(async (cx) => {
      this.bin = await this.locate();
      await this.refresh(cx);
      this.watch(cx);
    });
  }

  // The CLI on PATH, else where the README links it.
  async locate() {
    try { if ((await exec(BIN, ["version"])).code === 0) return BIN; } catch {}
    return `${home()}/.local/bin/${BIN}`;
  }

  async cli(args) {
    const r = await exec(this.bin, args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().replace(/^herdr-worktree-hook: /, ""));
    return r.stdout;
  }

  async refresh(cx) {
    if (!this.bin) return;
    try {
      this.list = JSON.parse(await this.cli(["ls"]));
      this.runs = JSON.parse(await this.cli(["history", "--json", "-n", "30"]));
      this.error = null;
      this.announce();
      if (this.open) this.open.log = await this.tail(this.open.run);
    } catch (e) { this.error = String(e.message ?? e); }
    await this.show(cx);
  }

  async show(cx) {
    const sp = spaces().find((s) => s.active);
    this.folder = sp && !sp.machine ? sp.folder || home() : null;
    this.remote = Boolean(sp?.machine);
    try { this.repo = this.folder && this.bin ? JSON.parse(await this.cli(["show", this.folder])) : null; } catch { this.repo = null; }
    cx.notify();
  }

  // Settings and runs live under these; a change there is a change to show. Missing yet: poll instead.
  watch(cx) {
    for (const dir of [this.list?.config?.replace(/\/[^/]+$/, ""), this.list?.state]) {
      if (!dir) continue;
      cx.spawn(async (cx) => {
        for (;;) {
          try { await watchFolder(dir); } catch { return cx.timer.every(5000, (cx) => this.refresh(cx)); }
          await this.refresh(cx);
        }
      });
    }
  }

  // A failed run finds you: toast the ones that failed since this copy started.
  announce() {
    const ids = new Set(this.runs.filter((r) => r.status !== "running").map((r) => r.id));
    if (this.known) for (const r of this.runs) {
      if (r.status !== "failed" || this.known.has(r.id)) continue;
      notify({ title: `Worktree setup failed: ${r.branch || r.path.split("/").pop()}`, body: `exit ${r.exit} · ${r.repo}`, level: "error" });
    }
    this.known = ids;
  }

  async tail(r) {
    const text = (await readTextFile(r.log)) ?? "";
    return text.split("\n").slice(-80).join("\n").trimEnd();
  }

  act(cx, args, then) {
    this.note = null;
    cx.spawn(async (cx) => {
      try { await this.cli(args); then?.(); } catch (e) { this.note = String(e.message ?? e); }
      await this.refresh(cx);
    });
  }

  // ---- form ----

  edit(key, cx) {
    const own = key === "default" ? this.list?.default : this.list?.repos?.[key];
    const inherited = key === "default" ? this.list?.builtin : { ...this.list?.builtin, ...this.list?.default };
    this.form = { key, note: null };
    for (const [f] of FIELDS) {
      const s = TextareaState.new({ value: (own?.[f] ?? []).join("\n"), placeholder: (inherited?.[f] ?? []).join("\n") || "(none)" });
      s.set_auto_grow(2, 10);
      this.form[f] = s;
    }
    this.view = "form";
    cx.notify();
  }

  // An empty field is left out, so it follows the default.
  save(cx) {
    const f = this.form, entry = {};
    for (const [k] of FIELDS) {
      const lines = f[k].value().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) entry[k] = lines;
    }
    cx.spawn(async (cx) => {
      // exec has no stdin: hand the JSON over through the shell.
      const r = await exec("sh", ["-c", 'printf %s "$2" | "$1" set "$3"', "sh", this.bin, JSON.stringify(entry), f.key]);
      if (r.code !== 0) f.note = (r.stderr || r.stdout).trim().replace(/^herdr-worktree-hook: /, "");
      else { this.view = "main"; this.form = null; }
      await this.refresh(cx);
    });
  }

  // ---- render ----

  render(cx) {
    const t = theme();
    const sp = spaces().find((s) => s.active);
    const folder = sp && !sp.machine ? sp.folder || home() : null;
    if (this.bin && folder !== this.folder) { this.folder = folder; cx.spawn(async (cx) => this.show(cx)); }
    return v_flex().id("worktree-hook").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(this.header(t))
      .when(Boolean(this.list && !this.list.installed), (el) => el.child(this.banner(t)))
      .when(Boolean(this.error || this.note), (el) => el.child(div().px(14).py(6).text_size(12).text_color(t.ansi1).child(this.error || this.note)))
      .child(div().id("worktree-hook-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(this.view === "form" && this.form ? this.renderForm(t) : this.renderMain(t)));
  }

  button(id, label, t, onClick, opts = {}) {
    return h_flex().id(id).h(opts.h ?? 26).px(opts.px ?? 9).flex_none().items_center().justify_center().rounded(7).text_size(12)
      .bg(opts.solid ? t.solid : t.raised).text_color(opts.solid ? t.solid_foreground : opts.danger ? t.ansi1 : t.foreground)
      .border_1().border_color(opts.solid ? t.solid : t.border).cursor_pointer().hover((s) => s.opacity(0.85))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx)).child(label);
  }

  header(t) {
    const back = this.view !== "main";
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(back, (el) => el.child(this.button("back", "‹", t, (cx) => { this.view = "main"; this.form = null; cx.notify(); }, { px: 7 })))
      .child(div().font_semibold().child("Worktree Hook"))
      .child(div().flex_1())
      .when(Boolean(this.list), (el) => el.child(div().text_size(11).text_color(this.list.installed ? t.dim : t.blocked)
        .child(this.list.installed ? `git ${this.list.git}` : "not installed")));
  }

  banner(t) {
    return h_flex().px(14).py(8).gap(8).items_center().bg(t.blocked + "22").border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_size(12).child("The git hook isn't installed: new worktrees aren't set up."))
      .child(this.button("install", "Install", t, (cx) => this.act(cx, ["install"]), { solid: true }));
  }

  section(label, t) {
    return div().px(14).pt(12).pb(4).text_size(11).font_semibold().text_color(t.dim).child(label);
  }

  renderMain(t) {
    if (!this.list) return div().p(14).text_color(t.dim).child(this.error ? "" : "Loading…");
    const col = v_flex().pb(10);
    col.child(this.section("THIS REPO", t)).child(this.renderRepo(t));
    col.child(this.section("RECENT RUNS", t));
    if (!this.runs.length) col.child(div().px(14).py(4).text_size(12).text_color(t.dim).child("No runs yet."));
    for (const r of this.runs) col.child(this.runRow(r, t));
    const keys = Object.keys(this.list.repos ?? {}).filter((k) => k !== this.repo?.key);
    col.child(this.section("SETTINGS", t))
      .child(this.keyRow("default", "Every repo without its own", t))
      .children(keys.map((k) => this.keyRow(k, (this.list.repos[k].run ?? []).join(" && ") || "copy only", t)));
    return col;
  }

  renderRepo(t) {
    const r = this.repo;
    if (this.remote) return div().px(14).py(4).text_size(12).text_color(t.dim).child("Spaces on other machines aren't supported yet.");
    if (!r) return div().px(14).py(4).text_size(12).text_color(t.dim).child("The shown space isn't in a git checkout.");
    const e = r.entry, line = (k, v) => h_flex().gap(8).text_size(12).items_start()
      .child(div().w(64).flex_none().text_color(t.dim).child(k))
      .child(v_flex().flex_1().min_w(0).gap(2).children(v.length ? v.map((x) => div().truncate().font_family(settings().font_family).text_size(11.5).child(x)) : [div().text_color(t.dim).child("—")]));
    return v_flex().mx(8).px(8).py(6).gap(6).rounded(7).bg(t.raised)
      .child(v_flex().gap(1)
        .child(div().font_semibold().truncate().child(r.key))
        .child(div().text_size(11).text_color(t.muted).truncate()
          .child(`${r.linked ? "worktree" : "main checkout"}${r.branch ? " · " + r.branch : ""} · ${r.own ? "own settings" : "default settings"}`)))
      .child(line("copy", e.copy)).child(line("run", e.run)).child(line("skip run", e.skip_run))
      .child(h_flex().gap(6).flex_wrap().pt(2)
        .child(this.button("edit", r.own ? "Edit" : "Customize", t, (cx) => this.edit(r.key, cx)))
        .when(r.linked, (el) => el.child(this.button("rerun", "Set up again", t, (cx) => this.act(cx, ["run", r.top]))))
        .when(Boolean(r.own), (el) => el.child(this.button("rm", this.removing ? "Confirm reset" : "Reset to default", t, (cx) => {
          if (!this.removing) { this.removing = true; cx.notify(); return; }
          this.removing = false;
          this.act(cx, ["rm", r.key]);
        }, { danger: true }))));
  }

  runRow(r, t) {
    const color = t[COLOR[r.status] ?? "dim"], open = this.open?.run.id === r.id;
    return v_flex()
      .child(h_flex().id(`run-${r.id}`).mx(8).px(8).py(5).gap(7).rounded(7).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (open) { this.open = null; return cx.notify(); }
          cx.spawn(async (cx) => { this.open = { run: r, log: await this.tail(r) }; cx.notify(); });
        })
        .child(r.status === "running" ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(color).spin(900)
          : div().size(7).rounded(4).flex_none().bg(color))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().child(r.branch || r.path.split("/").pop()))
          .child(div().text_size(11).text_color(t.dim).truncate().child(r.repo)))
        .child(div().flex_none().text_size(11).text_color(color).child(r.status === "failed" ? `exit ${r.exit}` : r.status))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.started))))
      .when(open, (el) => el.child(v_flex().mx(8).mb(4).p(8).gap(4).rounded(7).bg(t.raised)
        .child(div().text_size(11).text_color(t.dim).truncate().child(tilde(r.path)))
        .child(div().font_family(settings().font_family).text_size(11).text_color(t.muted).child(this.open.log || "(empty log)"))));
  }

  keyRow(key, sub, t) {
    return v_flex().id(`key-${key}`).mx(8).px(8).py(5).gap(1).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.edit(key, cx))
      .child(div().truncate().child(key))
      .child(div().text_size(11).text_color(t.dim).truncate().child(sub));
  }

  renderForm(t) {
    const f = this.form;
    return v_flex().p(14).gap(4)
      .child(div().text_size(15).font_semibold().truncate().child(f.key === "default" ? "Default settings" : f.key))
      .child(div().text_size(11).text_color(t.dim).child(f.key === "default"
        ? "Repos without settings of their own get these. An empty field keeps the built-in value shown in grey."
        : "An empty field follows the default settings, shown in grey."))
      .children(FIELDS.map(([k, label, help]) => v_flex().gap(3).pt(8)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(label))
        .child(div().id(`f-${k}`).p(8).rounded(7).border_1().border_color(t.input)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Textarea.new(f[k]).w_full().text_size(12).font_family(settings().font_family)))
        .child(div().text_size(11).text_color(t.dim).child(help))))
      .when(Boolean(f.note), (el) => el.child(div().pt(6).text_size(12).text_color(t.ansi1).child(f.note)))
      .child(h_flex().pt(10).gap(8).justify_end()
        .child(this.button("f-cancel", "Cancel", t, (cx) => { this.view = "main"; this.form = null; cx.notify(); }))
        .child(this.button("f-save", "Save", t, (cx) => this.save(cx), { solid: true })));
  }
}
