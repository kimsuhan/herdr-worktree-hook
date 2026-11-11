// Worktree Hook: the panel for herdr-worktree-hook. What a new worktree of the shown space's repo gets
// (files copied, commands run), editing it, and the recent runs with their logs.
//
// Everything goes through the herdr-worktree-hook CLI: this mod never writes config.json itself.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { exec, home, theme, settings, spaces, panes, focused, notify, readTextFile, watchFolder } from "herdr";

const BIN = "herdr-worktree-hook";
const FIELDS = [
  ["copy", "COPY", "Paths in the main checkout, one per line. Globs work, a trailing / copies a folder. Only git-ignored files, never overwriting."],
  ["run", "RUN", "Commands, one per line, run in order in the new worktree. The first failure stops the rest."],
  ["skip_run", "SKIP RUN", "Branch or folder patterns that skip RUN, such as review-*."],
];
const COLOR = { ok: "ansi2", failed: "ansi1", running: "working", lost: "dim" };

const ICON = (name) => `mods/workspace-chrome/${name}.svg`; // shipped with Herdr
// "github.com/acme/api" is shown as "api" under "github.com/acme".
const split = (key) => { const i = key.lastIndexOf("/"); return i > 0 ? [key.slice(0, i), key.slice(i + 1)] : ["", key]; };
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
    this.runs = []; // `history --json`, every repo's: a failure anywhere is announced
    this.repo = null; // `show` of the shown space's folder
    this.folder = undefined;
    this.seen = {}; // space id: the last terminal folder focused in it
    this.seq = 0;
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
      this.runs = JSON.parse(await this.cli(["history", "--json", "-n", "100"]));
      this.error = null;
      this.announce();
      if (this.open) this.open.log = await this.tail(this.open.run);
    } catch (e) { this.error = String(e.message ?? e); }
    await this.show(cx);
  }

  // Where the shown space is now. Its stored folder is only where it was made, so the focused terminal
  // comes first, then the last one focused in it (clicking this panel takes the focus), then its first.
  here() {
    const sp = spaces().find((s) => s.active);
    if (!sp || sp.machine) return { remote: Boolean(sp?.machine), folder: null };
    const cwd = focused()?.cwd;
    if (cwd) this.seen[sp.id] = cwd;
    const tabs = new Set(sp.tabs.map((c) => c.id));
    const first = () => panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd;
    return { remote: false, folder: this.seen[sp.id] || first() || sp.folder || home() };
  }

  async show(cx) {
    const { remote, folder } = this.here(), seq = ++this.seq;
    this.folder = folder;
    let repo = null;
    try { repo = folder && this.bin ? JSON.parse(await this.cli(["show", folder])) : null; } catch {}
    // An older answer arriving late must not replace a newer one.
    if (seq !== this.seq) return;
    this.remote = remote;
    this.repo = repo;
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
          // A run writing its log is a stream of changes: at most one refresh a second.
          await cx.sleep(1000);
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
    this.form = { key, note: null, own };
    for (const [f] of FIELDS) {
      const s = TextareaState.new({ value: (own?.[f] ?? []).join("\n"), placeholder: (own?.[f] ? "" : (inherited?.[f] ?? []).join("\n")) || "(none)" });
      s.set_auto_grow(2, 10);
      this.form[f] = s;
    }
    this.view = "form";
    cx.notify();
  }

  // An empty field is left out, so it follows the default. One saved as an empty list (only the CLI
  // or the file can) stays one: it's how a repo turns the default's commands off.
  save(cx) {
    const f = this.form, entry = {};
    for (const [k] of FIELDS) {
      const lines = f[k].value().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length || f.own?.[k]) entry[k] = lines;
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
    if (this.bin && this.here().folder !== this.folder) cx.spawn(async (cx) => this.show(cx));
    return v_flex().id("worktree-hook").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(this.header(t))
      .when(Boolean(this.list && !this.list.installed), (el) => el.child(this.banner(t)))
      .when(Boolean(this.error || this.note), (el) => el.child(div().mx(8).mt(8).px(10).py(7).rounded(7).bg(t.ansi1 + "1c")
        .text_size(12).text_color(t.ansi1).child(this.error || this.note)))
      .child(div().id("worktree-hook-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(this.view === "form" && this.form ? this.renderForm(t) : this.renderMain(t)));
  }

  back(cx) {
    this.view = "main";
    this.form = null;
    cx.notify();
  }

  // On `background`, so it stands out on the panel and on a `raised` block alike.
  button(id, label, t, onClick, opts = {}) {
    const color = opts.solid ? t.solid_foreground : opts.danger ? t.ansi1 : t.foreground;
    return h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().justify_center().rounded(7).text_size(12)
      .bg(opts.solid ? t.solid : t.background).text_color(color)
      .border_1().border_color(opts.solid ? t.solid : opts.danger ? t.ansi1 + "55" : t.border).cursor_pointer()
      .hover((s) => (opts.solid ? s.opacity(0.85) : s.bg(t.hover)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx))
      .when(Boolean(opts.icon), (el) => el.child(svg(ICON(opts.icon)).size(12).flex_none().text_color(color)))
      .child(label);
  }

  pill(label, t, color) {
    return div().px(6).py(1).flex_none().rounded(5).text_size(10.5).border_1()
      .bg(color ? color + "22" : t.background).border_color(color ? color + "44" : t.border).text_color(color ?? t.muted).child(label);
  }

  header(t) {
    const ok = this.list?.installed;
    return h_flex().h(42).flex_none().pl(this.view === "main" ? 14 : 8).pr(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(this.view === "main" ? svg("mods/worktree-hook/worktree-hook.svg").size(15).flex_none().text_color(t.muted)
        : h_flex().id("back").size(26).flex_none().items_center().justify_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => this.back(cx))
          .child(svg(ICON("chevron-left")).size(14).text_color(t.muted)))
      .child(div().font_semibold().child("Worktree Hook"))
      .child(div().flex_1())
      .when(Boolean(this.list), (el) => el.child(h_flex().gap(6).items_center().text_size(11).text_color(ok ? t.dim : t.blocked)
        .child(div().size(6).rounded(3).flex_none().bg(ok ? t.ansi2 : t.blocked))
        .child(ok ? `git ${this.list.git}` : "not installed")));
  }

  banner(t) {
    return h_flex().px(14).py(8).gap(8).items_center().bg(t.blocked + "22").border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_size(12).child("The git hook isn't installed: new worktrees aren't set up."))
      .child(this.button("install", "Install", t, (cx) => this.act(cx, ["install"]), { solid: true }));
  }

  section(label, t) {
    return div().px(14).pt(14).pb(6).text_size(10.5).font_semibold().text_color(t.dim).child(label);
  }

  hint(text, t) {
    return div().px(14).py(4).text_size(12).text_color(t.dim).child(text);
  }

  renderMain(t) {
    if (!this.list) return div().p(14).text_color(t.dim).child(this.error ? "" : "Loading…");
    const col = v_flex().pb(12);
    col.child(this.section("THIS REPO", t)).child(this.renderRepo(t));
    col.child(this.section("RECENT RUNS", t));
    // The shown repo's runs; outside a checkout there's no repo to pick, so every repo's.
    const runs = (this.repo ? this.runs.filter((r) => r.repo === this.repo.key) : this.runs).slice(0, 30);
    if (!runs.length) col.child(this.hint("No runs yet.", t));
    for (const r of runs) col.child(this.runRow(r, t));
    const keys = Object.keys(this.list.repos ?? {}).filter((k) => k !== this.repo?.key);
    col.child(this.section("SETTINGS", t))
      .child(this.keyRow("default", "Default", "Every repo without its own", t))
      .children(keys.map((k) => {
        const [where, name] = split(k);
        return this.keyRow(k, name, [where, (this.list.repos[k].run ?? []).join(" && ") || "copy only"].filter(Boolean).join(" · "), t);
      }));
    return col;
  }

  // Paths and patterns: short, many, order doesn't matter.
  chips(values, t) {
    if (!values.length) return div().text_size(12).text_color(t.dim).child("None");
    return h_flex().flex_wrap().gap(4).children(values.map((v) => div().min_w(0).px(6).py(2).rounded(5).truncate()
      .bg(t.background).border_1().border_color(t.border).font_family(settings().font_family).text_size(11).child(v)));
  }

  // Commands: run top to bottom, so numbered.
  steps(values, t) {
    if (!values.length) return div().text_size(12).text_color(t.dim).child("None");
    return v_flex().px(8).py(6).gap(4).rounded(6).bg(t.background).border_1().border_color(t.border)
      .font_family(settings().font_family).text_size(11)
      .children(values.map((v, i) => h_flex().gap(8)
        .child(div().flex_none().text_color(t.dim).child(String(i + 1)))
        .child(div().flex_1().min_w(0).truncate().child(v))));
  }

  renderRepo(t) {
    const r = this.repo;
    if (this.remote) return this.hint("Spaces on other machines aren't supported yet.", t);
    if (!r) return this.hint("The shown space isn't in a git checkout.", t);
    const [where, name] = split(r.key), e = r.entry;
    const field = (label, body) => v_flex().gap(5).child(div().text_size(10.5).font_semibold().text_color(t.dim).child(label)).child(body);
    return v_flex().mx(8).rounded(9).bg(t.raised).border_1().border_color(t.border).overflow_hidden()
      .child(v_flex().px(12).pt(10).pb(11).gap(7)
        .child(v_flex().gap(1)
          .when(Boolean(where), (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(where)))
          .child(div().text_size(14).font_semibold().truncate().child(name)))
        .child(h_flex().gap(6).items_center()
          .when(Boolean(r.branch), (el) => el.child(h_flex().min_w(0).gap(4).items_center().text_size(11.5).text_color(t.muted)
            .child(svg(ICON("git-branch")).size(12).flex_none().text_color(t.dim))
            .child(div().min_w(0).truncate().child(r.branch))))
          .child(this.pill(r.linked ? "worktree" : "main checkout", t))
          .child(this.pill(r.own ? "own settings" : "default settings", t, r.own ? t.accent : null))))
      .child(v_flex().px(12).py(11).gap(11).border_t(1).border_color(t.border)
        .child(field("COPY", this.chips(e.copy, t)))
        .child(field("RUN", this.steps(e.run, t)))
        .when(e.skip_run.length > 0, (el) => el.child(field("SKIP RUN", this.chips(e.skip_run, t)))))
      .child(h_flex().px(12).py(9).gap(6).border_t(1).border_color(t.border)
        .child(this.button("edit", r.own ? "Edit" : "Customize", t, (cx) => this.edit(r.key, cx), { icon: "square-pen" }))
        .when(r.linked, (el) => el.child(this.button("rerun", "Set up again", t, (cx) => this.act(cx, ["run", r.top])))));
  }

  runRow(r, t) {
    const color = t[COLOR[r.status] ?? "dim"], open = this.open?.run.id === r.id;
    return v_flex()
      .child(h_flex().id(`run-${r.id}`).mx(8).px(8).py(6).gap(8).rounded(7).items_center().cursor_pointer()
        .when(open, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (open) { this.open = null; return cx.notify(); }
          cx.spawn(async (cx) => { this.open = { run: r, log: await this.tail(r) }; cx.notify(); });
        })
        .child(h_flex().size(14).flex_none().items_center().justify_center()
          .child(r.status === "running" ? svg(ICON("spinner")).size(11).text_color(color).spin(900) : div().size(7).rounded(4).bg(color)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().child(r.branch || r.path.split("/").pop()))
          .child(div().text_size(11).text_color(t.dim).truncate().child(`${split(r.repo)[1]} · ${ago(r.started)}`)))
        .child(div().flex_none().text_size(11).text_color(color).child(r.status === "failed" ? `exit ${r.exit}` : r.status))
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim)))
      .when(open, (el) => el.child(v_flex().mx(8).mt(3).mb(6).rounded(7).bg(t.raised).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().px(10).py(6).gap(6).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
          .child(svg(ICON("folder")).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().child(tilde(r.path))))
        .child(div().px(10).py(8).font_family(settings().font_family).text_size(11).text_color(t.muted).child(this.open.log || "(empty log)"))));
  }

  keyRow(key, name, sub, t) {
    return h_flex().id(`key-${key}`).mx(8).px(8).py(6).gap(8).rounded(7).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.edit(key, cx))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().child(name))
        .child(div().text_size(11).text_color(t.dim).truncate().child(sub)))
      .child(svg(ICON("chevron-right")).size(12).flex_none().text_color(t.dim));
  }

  renderForm(t) {
    const f = this.form, [where, name] = f.key === "default" ? ["", "Default settings"] : split(f.key);
    return v_flex().p(14).gap(4)
      .when(Boolean(where), (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(where)))
      .child(div().text_size(15).font_semibold().truncate().child(name))
      .child(div().text_size(11).text_color(t.dim).child(f.key === "default"
        ? "Repos without settings of their own get these. An empty field keeps the built-in value shown in grey."
        : "An empty field follows the default settings, shown in grey."))
      .children(FIELDS.map(([k, label, help]) => v_flex().gap(4).pt(10)
        .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(label))
        .child(div().id(`f-${k}`).p(8).rounded(7).bg(t.raised).border_1().border_color(t.input)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Textarea.new(f[k]).w_full().text_size(12).font_family(settings().font_family)))
        .child(div().text_size(11).text_color(t.dim).child(help))))
      .when(Boolean(f.note), (el) => el.child(div().pt(6).text_size(12).text_color(t.ansi1).child(f.note)))
      .child(h_flex().pt(12).gap(8).items_center()
        .when(Boolean(f.own), (el) => el.child(this.button("f-reset", f.removing ? "Confirm reset" : "Reset to default", t, (cx) => {
          if (!f.removing) { f.removing = true; return cx.notify(); }
          this.act(cx, ["rm", f.key], () => { this.view = "main"; this.form = null; });
        }, { danger: true })))
        .child(div().flex_1())
        .child(this.button("f-cancel", "Cancel", t, (cx) => this.back(cx)))
        .child(this.button("f-save", "Save", t, (cx) => this.save(cx), { solid: true })));
  }
}
