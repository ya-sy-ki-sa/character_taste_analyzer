import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type {
  PreferenceHypothesis,
  PreferenceRefinement,
  RefinementContext,
} from "../../../shared/contracts/refinement";
import { responseChannelLabel } from "../../../shared/response-channels";
import { deriveUuid, nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import { prepareQuotaReservation } from "../../platform/quota/reservations";
import type { Env } from "../../types";
import * as repository from "./repositories/refinement";

export async function refinePreferenceInput(
  env: Env,
  ownerUserId: string,
  domain: AnalysisDomain,
  entryId: string,
  input: PreferenceRefinement,
  key: string,
) {
  const id = await deriveUuid(env.AUTH_PEPPER, `refinement:${ownerUserId}:${domain}:${entryId}:${key}`),
    hash = await sha256Hex(JSON.stringify(input));
  const existing = await first<{ request_hash: string }>(
    repository.selectPreferenceRefinements(env.DB, [id, ownerUserId]),
  );
  if (existing) {
    if (hash !== existing.request_hash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { id, replayed: true, outboxEventId: null };
  }
  const target = await first<{
    entry_revision_id: string;
    source_set_id: string | null;
    revision_number: number;
    job_id: string;
    analysis_run_id: string;
  }>(repository.selectAnalysisRuns(env.DB, [entryId, ownerUserId, domain]));
  if (!target?.analysis_run_id) throw new HTTPException(409, { message: "好みの確認画面を再読み込みしてください" });
  const context: RefinementContext = { schemaVersion: "2.1", baseAnalysisRunId: target.analysis_run_id };
  let answers = input.mode === "questions" ? input.answers : [];
  if (input.mode === "selection") {
    const batch = await first<{ id: string; context_json: string; hypotheses_json: string | null }>(
      repository.selectPreferenceRefinements2(env.DB, [ownerUserId, target.entry_revision_id]),
    );
    if (
      !batch?.hypotheses_json ||
      batch.id !== input.hypothesisBatchId ||
      JSON.parse(batch.context_json).baseAnalysisRunId !== target.analysis_run_id
    )
      throw new HTTPException(409, { message: "仮説候補が更新されています。最新の候補を選び直してください" });
    const candidates = JSON.parse(batch.hypotheses_json) as PreferenceHypothesis[];
    const selected = candidates.filter((item) => input.selectedHypothesisIds.includes(item.id));
    if (selected.length !== input.selectedHypothesisIds.length)
      throw new HTTPException(422, { message: "選択した仮説候補が見つかりません" });
    context.selectedHypotheses = selected;
    context.hypothesisBatchId = batch.id;
    answers = selected.map((item) => ({
      question: "この仮説は、あなたの好みに合っていますか？",
      answer: `選択した好み：${item.description}\n属性：${item.rawLabel}\n反応：${responseChannelLabel(item.responseChannel)}\n好悪：${item.polarity === "positive" ? "好き" : item.polarity === "negative" ? "苦手" : "混在"}\n条件：${item.scope || "特に限定しない"}`,
    }));
  }
  const now = nowIso(),
    step = `preferenceAnalysis:${id}`;
  const quota = await prepareQuotaReservation(env, ownerUserId, "analysis", `refinement:${id}`, hash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    target.job_id,
    3,
    {
      type: "analysis.start",
      params: {
        jobId: target.job_id,
        ownerUserId,
        entryId,
        stage: "preference",
        inputGeneration: target.revision_number,
        analysisDomain: domain,
        refinementId: id,
      },
    },
    `analysis:${target.job_id}:refinement:${id}`,
    id,
  );
  const guard = repository.guard();
  const statements: D1PreparedStatement[] = [
    repository.insertPreferenceRefinements(env.DB, [
      id,
      ownerUserId,
      target.entry_revision_id,
      input.mode === "hypotheses" ? "hypotheses" : "questions",
      JSON.stringify(answers),
      hash,
      now,
      JSON.stringify(context),
    ]),
    ...quota.statements,
    repository.updateUserCharacterEntries(env.DB, guard, [now, entryId, ownerUserId, id]),
    repository.updateJobs(env.DB, guard, [step, now, target.job_id, ownerUserId, id]),
    outbox.statement,
  ];
  if (answers.length && target.source_set_id)
    for (const [index, answer] of answers.entries()) {
      const sourceId = crypto.randomUUID(),
        pointer = `/preference/clarifications/${id}/${index}`;
      statements.push(
        repository.insertSources(env.DB, guard, [
          sourceId,
          ownerUserId,
          answer.question,
          new TextEncoder().encode(answer.answer).byteLength,
          await sha256Hex(answer.answer),
          JSON.stringify({ pointer }),
          answer.answer,
          Math.ceil(answer.answer.length / 3),
          now,
          now,
          id,
        ]),
        repository.insertSourceSetItems(env.DB, guard, [target.source_set_id, sourceId, id]),
      );
    }
  const results = await env.DB.batch(statements);
  if (results.some((item) => !item.success) || !results[0].meta.changes)
    throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { id, replayed: false, outboxEventId: outbox.id, jobId: target.job_id };
}
