import { randomUUID } from "node:crypto";
import { preserveJson, readJson, sameInput, saveJson } from "./storage.mjs";

// Three deliberate phases allow Codex to inspect the newly generated output
// before choosing edits. No baseline file is modified by these operations.
export async function correct({
  page,
  persona,
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
}) {
  const plan = readJson(`${root}/correction-plan.json`);
  const selectedIds = process.env.LIVE_CASES?.split(",");
  const additional = (plan.additionalReanalysisCases ?? []).map((caseId) => ({
    caseId,
    personaId: dataset.cases.find((c) => c.id === caseId)?.personaId,
  }));
  const selected = [...plan.cases, ...additional].find(
    (c) => c.personaId === persona.id && (!selectedIds || selectedIds.includes(c.caseId)),
  );
  if (!selected) throw new Error(`No representative for ${persona.id}`);
  const c = dataset.cases.find((c) => c.id === selected.caseId);
  const folder = `${root}/corrections/${c.id}`;
  state.corrections ??= {};
  const s = state.corrections;
  s[c.id] ??= { entryId: state.cases[c.id].entryId };
  const progress = s[c.id];
  if (progress.completed) return;
  progress.artifactFolder = folder;
  const save = (name, value) => preserveJson(`${folder}/${name}.json`, value);
  const unavailable = () => {
    if (!["failed", "held"].includes(progress.status)) return false;
    saveJson(`${folder}/verification.json`, {
      caseId: c.id,
      finalStatus: progress.status,
      error: progress.error,
      completedAt: new Date().toISOString(),
      correctionApplied: false,
    });
    return true;
  };
  if (unavailable()) return;
  if (phase === "correction-start") {
    if (
      dataset.cases.some(
        (x) => !["complete", "failed", "held", "submission_failed"].includes(state.cases[x.id]?.status),
      ) ||
      dataset.personas.some((p) => !readJson(`${root}/exports/${p.id}-baseline.json`, null)) ||
      !readJson(`${root}/${plan.baselineManifest ?? "baseline-evidence-manifest.json"}`, null)
    )
      throw new Error("Freeze the baseline manifest, all outcomes and four exports before corrections");
    if (progress.started) {
      const resumed = await waitStage(page, c, progress, ["understanding_review", "analysis_review", "active"]);
      if (unavailable()) return;
      if (resumed.entry.status === "understanding_review") save("understanding-regenerated", resumed);
      return;
    }
    const entry = (await api(page, "/entries")).entries.find((e) => e.id === progress.entryId);
    if (!entry) throw new Error("Representative entry missing");
    const detail = await api(page, `/entries/${entry.id}`);
    save("baseline-before-reanalysis", detail);
    if (!sameInput(detail.entry.draft, c.input)) throw new Error("Representative input changed");
    progress.reanalysisKey ??= randomUUID();
    progress.baselineRevision ??= entry.activeRevisionNumber;
    checkpoint();
    // Reconcile after a response was lost instead of submitting a second reanalysis.
    if (entry.activeRevisionNumber > progress.baselineRevision) {
      progress.jobId = entry.job.id;
    } else {
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
      await page.route(`**/entries/${entry.id}/reanalysis`, async (route) => {
        if (!sameInput(route.request().postDataJSON().draft, c.input)) {
          await route.abort();
          throw new Error("Correction input mismatch");
        }
        return route.continue({ headers: { ...route.request().headers(), "Idempotency-Key": progress.reanalysisKey } });
      });
      const pending = page.waitForResponse(
        (r) => r.url().endsWith(`/entries/${entry.id}/reanalysis`) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "入力を保存して再分析" }).click();
      const response = await pending;
      const body = await response.json();
      if (!response.ok()) throw new Error(`Correction reanalysis ${response.status()}`);
      progress.jobId = body.data.jobId;
      save("reanalysis-submission", { input: response.request().postDataJSON(), result: body });
    }
    progress.started = new Date().toISOString();
    checkpoint();
    const fresh = await waitStage(page, c, progress, ["understanding_review"]);
    if (unavailable()) return;
    save("understanding-regenerated", fresh);
    event("correction_reanalyzed", { caseId: c.id });
    return;
  }
  const edits = readJson(`${folder}/edits.json`);
  if (!edits) throw new Error(`Missing reviewed correction actions ${c.id}`);
  if (phase === "correction-understanding") {
    let detail = await api(page, `/entries/${progress.entryId}`);
    if (detail.entry.status === "understanding_review") {
      save("understanding-regenerated", detail);
      await openEntry(page, c);
      const card = page
        .getByRole("dialog")
        .locator(".card")
        .filter({ has: page.getByRole("heading", { name: "キャラクター像", exact: true }) });
      for (const action of edits.understanding) {
        if (progress[action.key]) continue;
        detail = await api(page, `/entries/${progress.entryId}`);
        const item = detail.understanding.assertions.find((a) => a.id === action.targetId);
        const replacement = detail.understanding.assertions.find(
          (a) => a.raw_label === action.rawLabel && a.value_text === action.valueText,
        );
        if (action.action === "update" && replacement) {
          progress[action.key] = replacement.id;
          checkpoint();
          continue;
        }
        if (action.action === "delete" && !item) {
          progress[action.key] = true;
          checkpoint();
          continue;
        }
        if (
          action.action === "update" &&
          item?.raw_label === action.rawLabel &&
          item?.value_text === action.valueText
        ) {
          progress[action.key] = true;
          checkpoint();
          continue;
        }
        if (!item) throw new Error(`Missing assertion for ${action.key}`);
        const article = card
          .locator(".assertion-list > article")
          .filter({ has: page.getByText(item.raw_label, { exact: true }) });
        const pending = page.waitForResponse(
          (r) => r.url().includes("/understanding-snapshots/") && r.request().method() === "POST",
        );
        if (action.action === "delete") {
          page.once("dialog", (d) => d.accept());
          await article.getByRole("button", { name: "削除", exact: true }).click();
        } else {
          await article.getByRole("button", { name: "修正", exact: true }).click();
          await article.getByLabel(/^属性名/).fill(action.rawLabel);
          await article.getByLabel(/^内容/).fill(action.valueText);
          await article.getByRole("button", { name: "修正を保存", exact: true }).click();
        }
        const response = await pending;
        if (!response.ok()) throw new Error(`Understanding correction ${response.status()}`);
        const after = await api(page, `/entries/${progress.entryId}`);
        save(`after-${action.key}`, after);
        const updated = after.understanding.assertions.find((a) =>
          action.action === "delete"
            ? a.id === action.targetId
            : a.raw_label === action.rawLabel && a.value_text === action.valueText,
        );
        if (action.action === "delete" ? Boolean(updated) : updated?.value_text !== action.valueText)
          throw new Error(`Correction not persisted ${action.key}`);
        progress[action.key] = updated?.id ?? true;
        checkpoint();
      }
      save("understanding-corrected", await api(page, `/entries/${progress.entryId}`));
      await page.getByRole("button", { name: "この理解を確認して好み分析へ" }).click();
    }
    detail = await waitStage(page, c, progress, ["analysis_review"]);
    if (unavailable()) return;
    save("preference-regenerated", detail);
    event("correction_understanding_done", { caseId: c.id });
    return;
  }
  if (phase === "correction-preference") {
    let detail = await api(page, `/entries/${progress.entryId}`);
    if (detail.entry.status === "analysis_review") {
      save("preference-regenerated", detail);
      await openEntry(page, c);
      const card = page
        .getByRole("dialog")
        .locator(".card")
        .filter({ has: page.getByRole("heading", { name: "この登録から読み取った「好き」", exact: true }) });
      await card.waitFor();
      for (const action of edits.preference) {
        if (progress[action.key]) continue;
        detail = await api(page, `/entries/${progress.entryId}`);
        if (action.action === "add") {
          const matches = detail.preferenceAnalysis.assertions.filter(
            (a) =>
              a.raw_label === action.rawLabel &&
              a.response_channel === action.responseChannel &&
              a.polarity === action.polarity,
          );
          if (matches.length > 1) throw new Error(`Ambiguous added preference ${action.key}`);
          if (!matches.length) {
            await card.getByRole("button", { name: "＋ 好みの候補を手動追加", exact: true }).click();
            const form = card.locator(".manual-add-form").last();
            await form.getByLabel(/^好みの属性名/).fill(action.rawLabel);
            await form
              .getByRole("combobox", { name: "Ontology属性", exact: true })
              .selectOption(action.stableKey ?? "");
            await form
              .getByRole("combobox", { name: "反応経路", exact: true })
              .selectOption(action.responseChannel ?? "");
            await form.getByRole("combobox", { name: "支持", exact: true }).selectOption(action.polarity);
            const pending = page.waitForResponse(
              (r) => r.url().includes("/preference-analysis-runs/") && r.request().method() === "POST",
            );
            await form.getByRole("button", { name: "好みの候補を追加", exact: true }).click();
            const response = await pending;
            if (!response.ok()) throw new Error(`Preference add ${response.status()}`);
          }
          detail = await api(page, `/entries/${progress.entryId}`);
          const added = detail.preferenceAnalysis.assertions.find(
            (a) =>
              a.raw_label === action.rawLabel &&
              a.response_channel === action.responseChannel &&
              a.polarity === action.polarity,
          );
          if (!added) throw new Error(`Added preference missing ${action.key}`);
          save(`after-${action.key}`, detail);
          progress[action.key] = added.id;
          checkpoint();
          continue;
        }
        const existing = detail.preferenceAnalysis.assertions.find((a) => a.id === action.targetId);
        const expectedLabel = action.expectedDisplayLabel ?? action.rawLabel;
        const replacement = detail.preferenceAnalysis.assertions.find(
          (a) =>
            a.status === "corrected" &&
            a.raw_label === expectedLabel &&
            a.response_channel === action.responseChannel &&
            a.polarity === action.polarity &&
            (action.stableKey === undefined || a.stable_key === action.stableKey),
        );
        if (action.action === "update" && replacement) {
          progress[action.key] = replacement.id;
          checkpoint();
          continue;
        }
        if (
          (action.action === "reject" && (!existing || existing.status === "rejected")) ||
          (action.action === "update" &&
            existing?.raw_label === action.rawLabel &&
            existing?.response_channel === action.responseChannel &&
            existing?.polarity === action.polarity &&
            (action.stableKey === undefined || existing?.stable_key === action.stableKey))
        ) {
          progress[action.key] = true;
          checkpoint();
          continue;
        }
        if (!existing) throw new Error(`Missing preference target ${action.targetId}`);
        const article = card
          .locator(".preference-attribute-group")
          .filter({ has: page.getByRole("heading", { name: action.groupLabel, exact: true }) })
          .locator("article")
          .filter({ has: page.getByText(action.channelLabel, { exact: true }) })
          .nth(action.occurrence ?? 0);
        const submit = async (button) =>
          (
            await Promise.all([
              page.waitForResponse(
                (r) => r.url().includes("/preference-analysis-runs/") && r.request().method() === "POST",
              ),
              button.click(),
            ])
          )[0];
        let response;
        if (action.action === "reject") {
          page.once("dialog", (d) => d.accept());
          response = await submit(article.getByRole("button", { name: "削除", exact: true }));
        } else {
          await article.getByRole("button", { name: "編集", exact: true }).click();
          await article.getByLabel(/^好みの属性名/).fill(action.rawLabel);
          if (action.stableKey !== undefined)
            await article
              .getByRole("combobox", { name: "Ontology属性", exact: true })
              .selectOption(action.stableKey ?? "");
          await article
            .getByRole("combobox", { name: "反応経路", exact: true })
            .selectOption(action.responseChannel ?? "");
          await article.getByRole("combobox", { name: "支持", exact: true }).selectOption(action.polarity);
          response = await submit(article.getByRole("button", { name: "修正を保存", exact: true }));
        }
        if (!response.ok()) throw new Error(`Preference correction ${response.status()}`);
        detail = await api(page, `/entries/${progress.entryId}`);
        save(`after-${action.key}`, detail);
        const updated = detail.preferenceAnalysis.assertions.find((a) =>
          action.action === "reject"
            ? a.id === action.targetId
            : a.raw_label === expectedLabel &&
              a.response_channel === action.responseChannel &&
              a.polarity === action.polarity,
        );
        if (
          action.action === "reject"
            ? updated && updated.status !== "rejected"
            : updated?.raw_label !== expectedLabel ||
              updated?.response_channel !== action.responseChannel ||
              updated?.polarity !== action.polarity
        )
          throw new Error(`Preference correction not persisted ${action.key}`);
        progress[action.key] = updated?.id ?? true;
        checkpoint();
      }
      save("preference-corrected", await api(page, `/entries/${progress.entryId}`));
      await page.screenshot({ path: `${folder}/corrected-review.png`, fullPage: true });
      await page.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
    }
    detail = await waitStage(page, c, progress, ["active"]);
    if (unavailable()) return;
    save("final", detail);
    progress.completed = new Date().toISOString();
    checkpoint();
    await projection(page, plan.cases.some((x) => x.caseId === c.id) ? "corrected" : `reanalysis-${c.id}`, persona);
    saveJson(`${folder}/verification.json`, {
      caseId: c.id,
      completedAt: progress.completed,
      edits,
      finalStatus: detail?.entry.status,
    });
    event("correction_complete", { caseId: c.id });
  }
}
