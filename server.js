require("dotenv").config();
const express = require("express");
const path = require("path");
const jira = require("./lib/jira");
const runner = require("./lib/claudeRunner");
const store = require("./lib/store");
const usage = require("./lib/usage");
const settings = require("./lib/settings");
const projects = require("./lib/projects");
const telegram = require("./lib/telegram");
const doctor = require("./lib/doctor");

// Models offered in the dropdown. There is no API to enumerate the models a
// subscription can access, so we list the known aliases; picking one the plan
// lacks simply surfaces as a task error from the CLI.
const MODELS = [
  { id: "default", label: "Plan default" },
  { id: "opus", label: "Claude Opus 5" },
  { id: "sonnet", label: "Claude Sonnet 5" },
  { id: "haiku", label: "Claude Haiku 4.5" },
  { id: "fable", label: "Claude Fable 5" },
];
const MODEL_IDS = new Set(MODELS.map((m) => m.id));

// Loopback by default: this server runs Claude with file-write/git powers, so
// it must not be reachable from the local network. Override HOST only if you
// really know what you're doing.
const PORT = process.env.PORT || 4177;
const HOST = process.env.HOST || "127.0.0.1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const IS_LOOPBACK = LOOPBACK_HOSTS.has(HOST);

// Only accept requests that genuinely come from the local dashboard. This
// blocks two attacks that matter for an unauthenticated local code-executor:
//  - CSRF: a random site you visit POSTing to http://localhost:4177 (its
//    requests carry a foreign Origin).
//  - DNS rebinding: a site resolving its own domain to 127.0.0.1 to reach us
//    (its requests carry a foreign Host).
//
// The allowlist is derived from the interface we actually bind. A non-loopback
// HOST used to be accepted by the listener but rejected by this guard, so the
// documented "override HOST if you know what you're doing" escape hatch produced
// a server that 403'd every request instead of one that worked.
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  `[::1]:${PORT}`,
]);
if (!IS_LOOPBACK) {
  ALLOWED_HOSTS.add(`${HOST}:${PORT}`);
  // 0.0.0.0 binds every interface, so no single Host value can be predicted.
  if (HOST === "0.0.0.0" || HOST === "::") {
    console.warn(
      `Warning: HOST=${HOST} binds all interfaces. Requests are only accepted with a Host header of ` +
        `localhost/127.0.0.1; set HOST to the specific address you will browse to if you need LAN access.`,
    );
  }
  console.warn(
    `Warning: HOST=${HOST} is not loopback. This server runs Claude with write access to your repos and ` +
      `has NO authentication — anyone who can reach this port can run code on this machine.`,
  );
}
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));

const app = express();

app.use((req, res, next) => {
  const { host, origin } = req.headers;
  if (host && !ALLOWED_HOSTS.has(host)) {
    return res
      .status(403)
      .json({ error: "Forbidden: unexpected Host header." });
  }
  // Origin is only sent by browsers on cross-origin (and CORS) requests; when
  // present it must be one of ours. Same-origin GETs omit it, which is fine.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res
      .status(403)
      .json({ error: "Forbidden: cross-origin request rejected." });
  }
  next();
});

// Iterate feedback and plans can be long, so allow more than the 100kb default.
app.use(express.json({ limit: "2mb" }));

// Body-parser failures (malformed JSON, oversized payload) would otherwise
// return an HTML error page, which the dashboard's `res.json()` then fails to
// parse — turning a clear "payload too large" into an unexplained crash.
app.use((err, req, res, next) => {
  if (err && (err.type || err.status) && req.path.startsWith("/api/")) {
    const tooLarge = err.type === "entity.too.large";
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? "That request was too large to process."
        : `Could not read the request body: ${err.message}`,
    });
  }
  return next(err);
});

// no-cache so an already-open tab always gets the latest JS/CSS on reload
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    setHeaders: (res) => res.set("Cache-Control", "no-store"),
  }),
);

app.get("/api/tickets", async (req, res) => {
  try {
    const tickets = await jira.getMyTickets();
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets/:key", async (req, res) => {
  try {
    const ticket = await jira.getTicket(req.params.key);
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  const { key, model, referenceFiles } = req.body;
  if (!key) return res.status(400).json({ error: "Missing ticket key" });
  if (!settings.get().repoPath) {
    return res
      .status(400)
      .json({ error: "Select a project in Settings before implementing." });
  }
  // Treat 'default' / unknown as "no override" so the CLI uses the plan default.
  const chosenModel =
    model && model !== "default" && MODEL_IDS.has(model) ? model : null;
  const refs = Array.isArray(referenceFiles)
    ? referenceFiles
        .filter((f) => typeof f === "string" && f.trim())
        .map((f) => f.trim())
        .slice(0, 20)
    : [];
  try {
    const ticket = await jira.getTicket(key);
    const taskId = runner.startTask(ticket, chosenModel, refs);
    res.json({ taskId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search tracked files in the selected repo, for the reference-file picker.
app.get("/api/repo-files", async (req, res) => {
  const s = settings.get();
  if (!s.repoPath) return res.json({ files: [] });
  try {
    res.json({
      files: await projects.searchRepoFiles(
        s.repoPath,
        (req.query.q || "").toString(),
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/models", (req, res) => {
  res.json(MODELS);
});

app.get("/api/me", (req, res) => {
  res.json({ email: settings.get().jiraEmail || null });
});

// Setup diagnostics — Claude CLI/login, git, Jira, project, network exposure —
// so a teammate's own dashboard can tell them what's wrong instead of them
// hitting it as a confusing failure inside a task. Same checks the startup
// console summary runs.
app.get("/api/doctor", async (req, res) => {
  try {
    res.json(await doctor.runDoctor());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The token is never sent back to the client — only whether one is set.
function publicConfig() {
  const s = settings.get();
  const commands = settings.commandsFor(s.repoPath);
  return {
    jiraDomain: s.jiraDomain || "",
    jiraEmail: s.jiraEmail || "",
    jiraTokenSet: Boolean(s.jiraToken),
    projectsRoot: s.projectsRoot || "",
    repoPath: s.repoPath || "",
    baseBranch: s.baseBranch || "main",
    telegramChatId: s.telegramChatId || "",
    telegramBotTokenSet: Boolean(s.telegramBotToken),
    telegramEnabled: Boolean(s.telegramEnabled),
    telegramConfigured: telegram.isConfigured(),
    commentOnJira: Boolean(s.commentOnJira),
    lintCommand: commands.lint,
    testCommand: commands.test,
    port: PORT,
  };
}

app.get("/api/config", (req, res) => {
  res.json(publicConfig());
});

// Branch names for the Settings base-branch picker, plus the auto-detected
// default so the UI can offer a "use detected" shortcut.
app.get("/api/branches", async (req, res) => {
  const repoPath =
    typeof req.query.repoPath === "string" && req.query.repoPath
      ? req.query.repoPath
      : settings.get().repoPath;
  if (!repoPath) return res.json({ branches: [], detected: "" });
  try {
    const [branches, detected] = await Promise.all([
      projects.listBranches(repoPath),
      projects.detectBaseBranch(repoPath),
    ]);
    res.json({ branches, detected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save settings from the UI. Only fields present in the body are changed; an
// empty token is ignored so it isn't wiped by a blank field.
app.post("/api/config", async (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const k of [
    "jiraDomain",
    "jiraEmail",
    "projectsRoot",
    "repoPath",
    "baseBranch",
    "telegramChatId",
  ]) {
    if (typeof body[k] === "string") patch[k] = body[k].trim();
  }
  if (typeof body.jiraToken === "string" && body.jiraToken.trim()) {
    patch.jiraToken = body.jiraToken.trim();
  }
  if (
    typeof body.telegramBotToken === "string" &&
    body.telegramBotToken.trim()
  ) {
    patch.telegramBotToken = body.telegramBotToken.trim();
  }
  // Explicit opt-in for outbound notifications. Only ever changed when the
  // client actually sends the field, so saving other settings can't flip it.
  if (typeof body.telegramEnabled === "boolean") {
    patch.telegramEnabled = body.telegramEnabled;
  }
  // Same reasoning as Telegram: a comment lands on a ticket everyone watching
  // it can see, so it needs its own explicit switch, off by default.
  if (typeof body.commentOnJira === "boolean") {
    patch.commentOnJira = body.commentOnJira;
  }

  // Reject a repo path that isn't a git repository rather than saving it and
  // failing opaquely inside a task later.
  if (patch.repoPath) {
    const check = await projects.validateRepoPath(patch.repoPath);
    if (!check.ok) return res.status(400).json({ error: check.error });
  }

  // Turning notifications on without credentials would look enabled but send
  // nothing, so say so instead of accepting a setting that cannot work.
  if (patch.telegramEnabled === true) {
    const current = settings.get();
    const token = patch.telegramBotToken || current.telegramBotToken;
    const chat = patch.telegramChatId ?? current.telegramChatId;
    if (!token || !chat) {
      return res.status(400).json({
        error:
          "Add a bot token and chat ID before enabling Telegram notifications.",
      });
    }
  }
  if (patch.commentOnJira === true) {
    const current = settings.get();
    const domain = patch.jiraDomain || current.jiraDomain;
    const email = patch.jiraEmail || current.jiraEmail;
    const token = patch.jiraToken || current.jiraToken;
    if (!domain || !email || !token) {
      return res.status(400).json({
        error: "Connect Jira before enabling comment-back.",
      });
    }
  }

  // When a project is (re)selected without an explicit base branch, detect it.
  let detectedBaseBranch = null;
  if (patch.repoPath && !patch.baseBranch) {
    try {
      detectedBaseBranch = await projects.detectBaseBranch(patch.repoPath);
      patch.baseBranch = detectedBaseBranch;
    } catch {
      /* leave base branch as-is if detection fails */
    }
  }

  try {
    settings.update(patch);
    // Verification commands are stored per repo, so they are saved against the
    // project they belong to (the one being selected, if that's in this patch).
    if (
      typeof body.lintCommand === "string" ||
      typeof body.testCommand === "string"
    ) {
      const repo = patch.repoPath || settings.get().repoPath;
      if (!repo) {
        return res
          .status(400)
          .json({ error: "Select a project before saving its commands." });
      }
      const current = settings.commandsFor(repo);
      const lint =
        typeof body.lintCommand === "string" ? body.lintCommand : current.lint;
      const test =
        typeof body.testCommand === "string" ? body.testCommand : current.test;
      // These values become Bash(...) grants, so reject anything that could end
      // the pattern early, split the tool list, or chain a second command.
      for (const [label, cmd] of [
        ["Lint", lint],
        ["Test", test],
      ]) {
        if (cmd && !runner.bashPattern(cmd)) {
          return res.status(400).json({
            error:
              `${label} command contains characters that can't be granted safely ` +
              `(quotes, and any of , ( ) & | ; \` $ < > %). Use a plain command such as "npm test".`,
          });
        }
      }
      settings.setCommandsFor(repo, { lint, test });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ ...publicConfig(), detectedBaseBranch });
});

// List the git projects inside a parent folder.
app.get("/api/projects", async (req, res) => {
  const root = (req.query.root || "").toString().trim();
  if (!root) return res.status(400).json({ error: "Folder path is required." });
  try {
    res.json({ projects: await projects.listProjects(root) });
  } catch (err) {
    const notFound = err.code === "ENOENT" || err.code === "ENOTDIR";
    res
      .status(400)
      .json({ error: notFound ? "Folder not found." : err.message });
  }
});

app.get("/api/usage", async (req, res) => {
  res.json(await usage.getUsage());
});

// Send a one-off test message so the user can confirm bot token + chat id
// are wired up correctly without waiting for a real task to finish.
//
// Sent with { force: true }: pressing this button is itself an explicit request,
// so it works while notifications are still switched off — which is exactly the
// order you'd want, verifying the credentials before opting in.
app.post("/api/telegram/test", async (req, res) => {
  if (!telegram.isConfigured()) {
    return res
      .status(400)
      .json({ error: "Set a bot token and chat ID first." });
  }
  const result = await telegram.sendMessage(
    "👋 Graft is connected — you'll get updates here.",
    { force: true },
  );
  if (!result.ok)
    return res.status(502).json({ error: result.error || "Failed to send." });
  res.json({ ok: true });
});

// Tasks still running (used by the UI to reconnect after a page reload).
app.get("/api/active-tasks", (req, res) => {
  res.json(runner.listActive());
});

app.get("/api/tasks/:id", (req, res) => {
  const task = runner.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Unknown task" });
  res.json(runner.snapshot(task));
});

// Server-Sent Events: live progress for a task.
//
// One full snapshot on connect, then incremental messages: {kind:'log'} per log
// line and {kind:'update'} for state changes. The log used to ride inside every
// update, so a long run re-sent its entire history hundreds of times.
const SSE_HEARTBEAT_MS = 25000;

app.get("/api/tasks/:id/stream", (req, res) => {
  const task = runner.getTask(req.params.id);
  if (!task) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (payload) => {
    // A client that has gone away mid-write must not take the server with it.
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      cleanup();
    }
  };

  const onUpdate = (meta) => send({ kind: "update", task: meta });
  const onLog = (entry) => send({ kind: "log", entry });
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, SSE_HEARTBEAT_MS);

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    task.emitter.off("update", onUpdate);
    task.emitter.off("log", onLog);
  }

  task.emitter.on("update", onUpdate);
  task.emitter.on("log", onLog);
  req.on("close", cleanup);
  res.on("error", cleanup);

  send({ kind: "snapshot", task: runner.snapshot(task) });
});

// Approve a drafted plan -> start the actual implementation.
app.post("/api/tasks/:id/approve", async (req, res) => {
  try {
    const result = await runner.approveTask(req.params.id);
    if (result.error)
      return res.status(result.code || 409).json({ error: result.error });
    res.json(runner.snapshot(result.task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a task (e.g. reject the plan before implementation).
app.post("/api/tasks/:id/cancel", (req, res) => {
  const task = runner.cancelTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Unknown task" });
  res.json(runner.snapshot(task));
});

// Stop a task outright (drafting or implementing). Not resumable.
app.post("/api/tasks/:id/stop", async (req, res) => {
  try {
    const task = await runner.stopTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Unknown task" });
    res.json(runner.snapshot(task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause active work; the Claude session is retained for later resumption.
app.post("/api/tasks/:id/pause", (req, res) => {
  const task = runner.pauseTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Unknown task" });
  res.json(runner.snapshot(task));
});

// Resume a paused task, continuing the same Claude session.
app.post("/api/tasks/:id/resume", (req, res) => {
  const task = runner.resumeTask(req.params.id);
  if (!task) return res.status(409).json({ error: "Task is not paused." });
  res.json(runner.snapshot(task));
});

// Iterate on a finished run: feed reviewer feedback back into the same session.
app.post("/api/tasks/:id/iterate", async (req, res) => {
  const feedback = (
    req.body && req.body.feedback ? String(req.body.feedback) : ""
  ).trim();
  if (!feedback)
    return res.status(400).json({ error: "Feedback is required." });
  try {
    const result = await runner.iterateTask(req.params.id, feedback);
    if (result.error)
      return res.status(result.code || 400).json({ error: result.error });
    res.json(runner.snapshot(result.task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revise a drafted plan with reviewer feedback before approving it.
app.post("/api/tasks/:id/revise-plan", async (req, res) => {
  const feedback = (
    req.body && req.body.feedback ? String(req.body.feedback) : ""
  ).trim();
  if (!feedback)
    return res.status(400).json({ error: "Feedback is required." });
  try {
    const result = await runner.revisePlan(req.params.id, feedback);
    if (result.error)
      return res.status(result.code || 400).json({ error: result.error });
    res.json(runner.snapshot(result.task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/diff", async (req, res) => {
  const task = runner.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Unknown task" });
  try {
    res.json({ diff: await runner.getDiff(task) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/open-vscode", (req, res) => {
  const task = runner.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Unknown task" });
  runner.openInVSCode(task);
  res.json({ ok: true });
});

// ---- Worktrees ---------------------------------------------------------

// Every worktree this app created for the selected project, flagged with
// whether its branch has already landed in the base branch.
app.get("/api/worktrees", async (req, res) => {
  try {
    res.json({ worktrees: await runner.listWorktrees() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a run's worktree once you're done with it. Refuses to discard
// uncommitted work unless ?force=1 is passed.
app.delete("/api/worktrees", async (req, res) => {
  const worktreePath = (req.query.path || "").toString();
  if (!worktreePath)
    return res.status(400).json({ error: "A worktree path is required." });
  try {
    const result = await runner.removeWorktree({
      worktreePath,
      force: req.query.force === "1",
    });
    if (!result.removed) {
      return res
        .status(result.reason === "dirty" ? 409 : 400)
        .json({ error: result.error || "Could not remove that worktree." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Implemented-ticket history (persisted to disk) ----

app.get("/api/implementations", (req, res) => {
  res.json(store.list());
});

app.get("/api/implementations/:id", (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown implementation" });
  res.json(rec);
});

app.delete("/api/implementations/:id", (req, res) => {
  const ok = store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Unknown implementation" });
  res.json({ ok: true });
});

// Open a past run in VS Code. Opens the worktree that run actually used — the
// old task-independent version always opened whatever project was configured
// now, which is the wrong directory as soon as you switch projects.
app.post("/api/implementations/:id/open-vscode", (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: "Unknown implementation" });
  const result = runner.openDir(rec.worktreePath || rec.repoPath);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, path: result.path });
});

// Open the currently configured project.
app.post("/api/open-vscode", (req, res) => {
  const result = runner.openDir(null);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, path: result.path });
});

// Anything unhandled reaching here is a bug in a route; report it as JSON
// instead of express's default HTML page.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

// Run the setup diagnostics before binding, so the console tells a teammate
// what's wrong with their own setup (missing Jira token, no project selected,
// `claude` not on PATH, no login) before "server running" appears — not as a
// confusing failure the first time they click Implement.
let server = null;
(async () => {
  const { checks, hasBlocking } = await doctor.runDoctor();
  const lines = doctor.summaryLines({ checks });
  if (lines.length) {
    console.warn("Setup check found things to review:");
    for (const line of lines) console.warn(`  ${line}`);
    console.warn(
      hasBlocking
        ? "  The dashboard will start, but no run will work until the above is fixed.\n"
        : "  The dashboard works, but some features are unavailable until fixed — open Settings to review.\n",
    );
  } else {
    console.log("Setup check passed — all good.\n");
  }

  server = app.listen(PORT, HOST, () => {
    console.log(
      `Graft running at http://localhost:${PORT} (bound to ${HOST})`,
    );
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nPort ${PORT} is already in use — is another Graft instance (or something else) already running?\n` +
          `Set PORT in your .env to use a different one.`,
      );
    } else {
      console.error(`\nFailed to start: ${err.message}`);
    }
    process.exit(1);
  });
})();

// Quitting the server used to leave orphaned `claude` processes still editing
// files, with no dashboard left to observe or stop them. Park every live run
// (killing its child, keeping its session id) so it can be resumed instead.
let shuttingDown = false;
async function gracefulExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — stopping active runs...`);
  try {
    const parked = await runner.shutdown();
    if (parked.length) {
      console.log(
        `Parked ${parked.length} active run(s); press Continue in the dashboard to resume them.`,
      );
    }
  } catch (err) {
    console.warn(`Problem while stopping runs: ${err.message}`);
  }
  // A signal arriving in the brief window before the doctor check finishes
  // (see above) would otherwise call .close() on a server that doesn't exist yet.
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
  // Don't hang forever on lingering keep-alive/SSE connections.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => gracefulExit("SIGINT"));
process.on("SIGTERM", () => gracefulExit("SIGTERM"));
