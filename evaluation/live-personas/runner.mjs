import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { correct } from "./corrections.mjs";
import { digest, preserveJson, readJson, sameInput, saveJson, selectResumeEntry } from "./storage.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function run(browser, validateInput) {
  process.umask(0o077);
  const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
  const phase = process.env.LIVE_PHASE ?? "pilot";
  const base = "http://localhost:5173";
  const dataset = readJson(`${root}/dataset.json`);
  if (digest(dataset) !== readJson(`${root}/dataset-manifest.json`).sha256)
    throw new Error("Frozen dataset hash mismatch");
  for (const c of dataset.cases) validateInput(c.input);
  const state = readJson(`${root}/progress.json`, { cases: {}, accounts: {} });
  const accounts = readJson(`${root}/accounts.json`, {});
  const checkpoint = () => saveJson(`${root}/progress.json`, state);
  const event = (type, detail = {}) => {
    appendFileSync(`${root}/events.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), type, ...detail })}\n`, {
      mode: 0o600,
    });
    console.log(type, detail.caseId ?? detail.personaId ?? "");
  };
  const health = await fetch(`${base}/api/v1/health/ready`).then((r) => r.json());
  if (
    health.data?.status !== "ready" ||
    health.data.llmProvider !== "openai" ||
    health.data.embeddingProvider !== "openai"
  )
    throw new Error("Real provider readiness required");
  preserveJson(`${root}/readiness.json`, health);

  async function api(page, path) {
    const response = await page.request.get(`${base}/api/v1${path}`, { timeout: 60_000 });
    const body = await response.json();
    if (!response.ok()) throw new Error(`GET ${path}: ${response.status()} ${JSON.stringify(body)}`);
    return body.data;
  }
  async function waitTurnstile(page) {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('input[name="cf-turnstile-response"]')).some((el) => el.value),
      {},
      { timeout: 60_000 },
    );
  }
  async function login(page, p) {
    await page.goto(base);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "観測記録を開く" });
    await dialog.getByLabel("ユーザー名").fill(accounts[p.id].username);
    await dialog.getByLabel("ログインキー").fill(accounts[p.id].accessKey);
    await waitTurnstile(page);
    await dialog.getByRole("button", { name: "ログイン", exact: true }).click();
    await page.waitForURL("**/app/profile", { timeout: 60_000 });
  }
  async function account(page, p) {
    if (accounts[p.id]?.active) return login(page, p);
    state.accounts[p.id] ??= {
      username: `live-0905-${p.id.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      registrationKey: randomUUID(),
    };
    const a = state.accounts[p.id];
    checkpoint();
    await page.route("**/api/v1/users", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      return route.continue({
        headers: { ...route.request().headers(), "Idempotency-Key": a.registrationKey },
        postData: JSON.stringify({ ...body, idempotencyKey: a.registrationKey }),
      });
    });
    await page.goto(base);
    await page.getByRole("button", { name: "新規ユーザ作成" }).click();
    await page.getByLabel("ユーザー名").fill(a.username);
    await page.getByRole("button", { name: "利用上の注意を確認する" }).click();
    await page.getByRole("button", { name: "登録画面に戻る" }).click();
    await page.getByLabel("利用上の注意を確認し、同意します").check();
    await waitTurnstile(page);
    const responsePromise = page.waitForResponse(
      (r) => r.url() === `${base}/api/v1/users` && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "アクセスキーを発行" }).click();
    const response = await responsePromise;
    const body = await response.json();
    if (!response.ok()) throw new Error(`Account registration failed: ${response.status()}`);
    accounts[p.id] = {
      personaId: p.id,
      username: a.username,
      userId: body.data.user.id,
      accessKey: body.data.accessKey,
      baseURL: base,
      active: false,
    };
    saveJson(`${root}/accounts.json`, accounts);
    await page.getByLabel("アクセスキーを安全な場所に保存しました").check();
    const activated = page.waitForResponse((r) => r.url().endsWith(`/users/${body.data.user.id}/activate`));
    await page.getByRole("button", { name: "保存を確認してユーザーを作成" }).click();
    if (!(await activated).ok()) throw new Error("Account activation failed");
    accounts[p.id].active = true;
    saveJson(`${root}/accounts.json`, accounts);
    await page.unroute("**/api/v1/users");
    event("account_created", { personaId: p.id });
    await login(page, p);
  }
  async function reconcile(page, c) {
    const list = (await api(page, "/entries")).entries;
    const matches = [];
    for (const e of list.filter((e) => e.title === c.input.characterName)) {
      const detail = await api(page, `/entries/${e.id}`);
      if (sameInput(detail.entry.draft, c.input)) matches.push({ entryId: e.id, jobId: e.job?.id });
    }
    return selectResumeEntry(matches);
  }
  async function openEntry(page, c) {
    await page.goto(`${base}/app/entries`);
    await page
      .getByRole("button", { name: new RegExp(escaped(c.input.characterName)) })
      .first()
      .click();
  }
  async function submit(page, c, s) {
    const existing = await reconcile(page, c);
    if (existing) {
      Object.assign(s, existing);
      checkpoint();
      event("submission_reconciled", { caseId: c.id });
      return;
    }
    s.submissionKey ??= randomUUID();
    s.startedAt ??= new Date().toISOString();
    checkpoint();
    await page.route("**/api/v1/entries", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (!sameInput(route.request().postDataJSON(), c.input)) {
        await route.abort();
        throw new Error(`PREFLIGHT_INPUT_MISMATCH ${c.id}`);
      }
      return route.continue({ headers: { ...route.request().headers(), "Idempotency-Key": s.submissionKey } });
    });
    await page.goto(`${base}/app/entries`);
    await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
    const dialog = page.getByRole("dialog", { name: "キャラクターを登録", exact: true });
    const input = c.input;
    await dialog.getByLabel("作品名 必須", { exact: true }).fill(input.workTitle);
    await dialog.getByLabel("キャラクター名 必須", { exact: true }).fill(input.characterName);
    await dialog.getByLabel("媒体・版", { exact: true }).fill(input.mediaType);
    await dialog.getByLabel("特に好きな時期・場面・状態（任意）").fill(input.preferenceContext);
    if (input.userCharacterView) await dialog.getByLabel(/あなた自身のキャラクター/).fill(input.userCharacterView);
    await dialog.getByLabel("好きな理由", { exact: true }).fill(input.preference.likedReasons);
    if (input.preference.dislikedReasons)
      await dialog
        .getByLabel("苦手な要素・このキャラで好きではない点", { exact: true })
        .fill(input.preference.dislikedReasons);
    for (const checkbox of await dialog.locator('.channel-picker input[type="checkbox"]:checked').all())
      await checkbox.uncheck();
    const responsePromise = page.waitForResponse(
      (r) => r.url() === `${base}/api/v1/entries` && r.request().method() === "POST",
      { timeout: 300_000 },
    );
    await dialog.getByRole("button", { name: "保存して理解抽出を開始" }).click();
    const response = await responsePromise;
    const body = await response.json();
    if (!response.ok()) {
      preserveJson(`${root}/cases/${c.id}/submission-error.json`, body);
      throw new Error(`SUBMISSION_HTTP_${response.status()}`);
    }
    const sent = response.request().postDataJSON();
    Object.assign(s, { entryId: body.data.entryId, jobId: body.data.jobId, submittedAt: new Date().toISOString() });
    checkpoint();
    if (!sameInput(sent, input)) throw new Error(`INPUT_MISMATCH ${c.id}`);
    preserveJson(`${root}/cases/${c.id}/submitted-input.json`, sent);
    Object.assign(s, { entryId: body.data.entryId, jobId: body.data.jobId, submittedAt: new Date().toISOString() });
    checkpoint();
    await page.unroute("**/api/v1/entries");
    event("submitted", { caseId: c.id });
  }
  async function waitStage(page, c, s, wanted) {
    let progress = "",
      changed = Date.now(),
      heartbeat = 0;
    for (;;) {
      const detail = await api(page, `/entries/${s.entryId}`);
      const job = s.jobId ? (await api(page, `/jobs/${s.jobId}`)).job : null;
      const signature = JSON.stringify([detail.entry.status, job?.status, job?.current_step, job?.progress_current]);
      if (signature !== progress) {
        progress = signature;
        changed = signature === s.progressSignature ? Date.parse(s.progressChangedAt) : Date.now();
        s.progressSignature = signature;
        s.progressChangedAt = new Date(changed).toISOString();
        s.lastJob = job;
        checkpoint();
        event("stage", { caseId: c.id, status: detail.entry.status, step: job?.current_step, job });
      }
      if (Date.now() - heartbeat > 45_000) {
        heartbeat = Date.now();
        console.log("waiting", c.id, detail.entry.status, job?.current_step);
      }
      if (wanted.includes(detail.entry.status)) return detail;
      if (detail.entry.status === "failed" || job?.status === "failed") {
        preserveJson(`${s.artifactFolder ?? `${root}/cases/${c.id}`}/failure-${s.retries ?? 0}.json`, { detail, job });
        if (job?.retryable && !(s.retries >= 1)) {
          s.retries = (s.retries ?? 0) + 1;
          checkpoint();
          await page.goto(`${base}/app/entries`);
          const retry = page
            .locator(".entry-card")
            .filter({ hasText: c.input.characterName })
            .getByRole("button", { name: "解析を再実行" });
          const pending = page.waitForResponse(
            (r) => r.url().endsWith(`/jobs/${s.jobId}/retry`) && r.request().method() === "POST",
          );
          await retry.click();
          const response = await pending;
          const body = await response.json();
          if (!response.ok()) {
            s.status = "failed";
            s.error = `RETRY_HTTP_${response.status()}`;
            checkpoint();
            return null;
          }
          s.jobId = body.data.jobId;
          checkpoint();
          event("retried", { caseId: c.id });
          continue;
        }
        s.status = "failed";
        s.error = job?.error_code ?? "ANALYSIS_FAILED";
        checkpoint();
        return null;
      }
      if (Date.now() - changed > 60 * 60_000) {
        s.status = "held";
        s.error = "NO_PROGRESS_60_MINUTES";
        checkpoint();
        return null;
      }
      await sleep(2500);
    }
  }
  async function projection(page, label, p) {
    let current;
    const started = Date.now();
    do {
      current = await api(page, "/profile");
      if (current.freshness.status !== "rebuilding") break;
      await sleep(2000);
    } while (Date.now() - started < 60 * 60_000);
    const graph = await api(page, "/profile/graph");
    const folder = `${root}/profiles/${p.id}`;
    mkdirSync(folder, { recursive: true });
    preserveJson(`${folder}/${label}.json`, { profile: current, graph, capturedAt: new Date().toISOString() });
    await page.goto(`${base}/app/profile`);
    await page.getByRole("heading", { name: "好み分析結果" }).waitFor();
    await page.screenshot({ path: `${folder}/${label}.png`, fullPage: true });
    event("profile_saved", { personaId: p.id, label, freshness: current.freshness.status });
  }
  async function baseline(page, c, _p) {
    state.cases[c.id] ??= {};
    const s = state.cases[c.id];
    if (["complete", "failed", "held", "submission_failed"].includes(s.status)) return;
    try {
      if (!s.entryId) await submit(page, c, s);
      let detail = await waitStage(page, c, s, ["understanding_review", "analysis_review", "active"]);
      if (!detail) return;
      if (detail.entry.status === "understanding_review") {
        preserveJson(`${root}/cases/${c.id}/understanding-before.json`, detail);
        s.understandingAt ??= new Date().toISOString();
        checkpoint();
        await openEntry(page, c);
        await page.getByRole("button", { name: "この理解を確認して好み分析へ" }).click();
        detail = await waitStage(page, c, s, ["analysis_review", "active"]);
        if (!detail) return;
      }
      if (detail.entry.status === "analysis_review") {
        preserveJson(`${root}/cases/${c.id}/preference-before.json`, detail);
        s.preferenceAt ??= new Date().toISOString();
        checkpoint();
        await openEntry(page, c);
        await page.screenshot({ path: `${root}/cases/${c.id}/review-before.png`, fullPage: true });
        await page.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
        detail = await waitStage(page, c, s, ["active"]);
        if (!detail) return;
      }
      preserveJson(`${root}/cases/${c.id}/baseline-final.json`, detail);
      s.status = "complete";
      s.completedAt = new Date().toISOString();
      checkpoint();
      event("complete", { caseId: c.id });
    } catch (e) {
      s.error = String(e.message).slice(0, 2000);
      s.status = /^SUBMISSION_HTTP_/.test(s.error) ? "submission_failed" : "driver_error";
      checkpoint();
      event("case_error", { caseId: c.id, error: s.error });
      if (s.status !== "submission_failed") throw e;
    }
  }
  async function exportAccount(page, p, label) {
    await page.goto(`${base}/app/settings`);
    const button = page.getByRole("button", { name: "JSONをダウンロード", exact: true });
    await button.waitFor();
    const promise = page.waitForResponse(
      (r) => r.url() === `${base}/api/v1/account/exports` && r.request().method() === "POST",
    );
    await button.click();
    const response = await promise;
    const body = await response.json();
    if (!response.ok()) throw new Error(`Export ${response.status()}`);
    const id = body.data.exportId;
    let out;
    for (let n = 0; n < 1800; n++) {
      out = (await api(page, `/account/exports/${id}`)).export;
      if (out.status === "ready") break;
      if (out.status === "failed") throw new Error("EXPORT_FAILED");
      await sleep(2000);
    }
    const download = await page.request.get(`${base}/api/v1/account/exports/${id}/download`);
    if (!download.ok()) throw new Error("EXPORT_DOWNLOAD_FAILED");
    preserveJson(`${root}/exports/${p.id}-${label}.json`, await download.json());
    event("export_saved", { personaId: p.id, label });
  }
  for (const p of dataset.personas) {
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    try {
      await account(page, p);
      if (phase === "export-smoke") {
        if (p.id === "A") await exportAccount(page, p, "smoke");
        continue;
      }
      if (phase.startsWith("correction-")) {
        await correct({
          page,
          persona: p,
          dataset,
          state,
          root,
          base,
          phase,
          api,
          checkpoint,
          waitStage,
          openEntry,
          projection,
          event,
        });
        continue;
      }
      if (phase === "repair-pilot") {
        if (p.id !== "A") continue;
        const c = dataset.cases.find((c) => c.id === "A01");
        const s = state.cases[c.id];
        const entry = (await api(page, "/entries")).entries.find((e) => e.title === c.input.characterName);
        Object.assign(s, { entryId: entry.id, jobId: entry.job.id, status: "repairing" });
        checkpoint();
        if (sameInput((await api(page, `/entries/${s.entryId}`)).entry.draft, c.input)) {
          await baseline(page, c, p);
          await projection(page, "pilot", p);
          continue;
        }
        const detail = await waitStage(page, c, s, ["understanding_review", "analysis_review", "active", "failed"]);
        preserveJson(`${root}/excluded/A01-default-channel-${entry.activeRevisionNumber}.json`, {
          reason:
            "Driver did not clear default person_liking checkbox. Excluded from baseline; same entry reanalyzed with frozen input.",
          detail,
          job: await api(page, `/jobs/${s.jobId}`),
        });
        await page.goto(`${base}/app/entries`);
        await page
          .locator(".entry-card")
          .filter({ hasText: c.input.characterName })
          .getByRole("button", { name: "入力を見直して再分析" })
          .click();
        await page
          .getByRole("dialog")
          .getByLabel(/^好きな理由/)
          .waitFor();
        for (const checkbox of await page
          .getByRole("dialog")
          .locator('.channel-picker input[type="checkbox"]:checked')
          .all())
          await checkbox.uncheck();
        await page.route(`**/entries/${s.entryId}/reanalysis`, async (route) => {
          if (!sameInput(route.request().postDataJSON().draft, c.input)) {
            await route.abort();
            throw new Error("REPAIR_PREFLIGHT_MISMATCH");
          }
          return route.continue();
        });
        const responsePromise = page.waitForResponse(
          (r) => r.url().endsWith(`/entries/${s.entryId}/reanalysis`) && r.request().method() === "POST",
        );
        await page.getByRole("button", { name: "入力を保存して再分析" }).click();
        const response = await responsePromise;
        const body = await response.json();
        if (!response.ok()) throw new Error("PILOT_REPAIR_FAILED");
        const sent = response.request().postDataJSON().draft;
        if (!sameInput(sent, c.input)) throw new Error("REPAIR_INPUT_MISMATCH");
        preserveJson(`${root}/cases/${c.id}/submitted-input.json`, sent);
        Object.assign(s, {
          jobId: body.data.jobId,
          status: "submitted",
          startedAt: new Date().toISOString(),
          submittedAt: new Date().toISOString(),
          excludedRevisions: [1, 2],
        });
        delete s.error;
        checkpoint();
        await baseline(page, c, p);
        await projection(page, "pilot", p);
        continue;
      }
      if (phase === "export") {
        await exportAccount(page, p, "baseline");
        continue;
      }
      if (phase === "verify") {
        await projection(page, "final", p);
        const entries = await api(page, "/entries");
        const selected = readJson(`${root}/correction-plan.json`).cases.find((c) => c.personaId === p.id);
        const representative = await api(page, `/entries/${state.cases[selected.caseId].entryId}`);
        if (entries.entries.length !== 15) throw new Error(`Unexpected entry count for ${p.id}`);
        saveJson(`${root}/final-${p.id}.json`, {
          verifiedAt: new Date().toISOString(),
          count: entries.entries.length,
          entries: entries.entries,
          representativeCaseId: selected.caseId,
          representative,
        });
        await exportAccount(page, p, "final");
        continue;
      }
      if (!["pilot", "baseline"].includes(phase)) throw new Error(`Unsupported phase ${phase}`);
      const selected = dataset.cases.filter((c) => c.personaId === p.id && (phase !== "pilot" || c.ordinal === 1));
      for (const c of selected) {
        await baseline(page, c, p);
        if (c.ordinal % 5 === 0 && !readJson(`${root}/profiles/${p.id}/${c.ordinal}.json`, null))
          await projection(page, String(c.ordinal), p);
      }
      if (phase === "pilot") await projection(page, "pilot", p);
    } finally {
      await context.close();
    }
  }
  event("phase_finished", { phase });
}
