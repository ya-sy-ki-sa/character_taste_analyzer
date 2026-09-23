import { describe, expect, it } from "vitest";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { responseChannelPrompt } from "../shared/response-channels";
import { selectExportUnderstandingSnapshots } from "../worker/features/account/repositories/exports";
import { loadEntryReview } from "../worker/features/entries/review";
import { mutateUnderstandingReview } from "../worker/features/entries/understanding-review";
import { UNDERSTANDING_COMPLETION_INSTRUCTION } from "../worker/llm/prompts/understanding";
import explicitFixtures from "./fixtures/explicit-preferences.json";
import sparseFixtures from "./fixtures/sparse-understanding.json";
import { rebuild, setup } from "./support/preference-pipeline";
import { frozenAudit } from "./support/understanding-audit";

describe("understanding information quality storage and continuation", () => {
  it("resolves the registered subject in code and leaves generic relationship targets untouched", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const understanding = frozenAudit(fixture);
    const examples = [
      "笑顔で来てくれる頼れる人物として行動する。",
      "仲間が失敗しても再挑戦できるよう助ける。",
      "相手を守るために自分から動く。",
      "弟が危機にあるとき、救助を優先する。",
    ];
    understanding.assertions = examples.map((valueText, index) => ({
      ...understanding.assertions[index],
      rawLabel: `登録主体の人物描写${index + 1}`,
      valueText,
    }));
    const t = await setup("standard", { ...explicitFixtures[0], understanding });
    const requests = t.judgmentRequests.filter((request) => request.context.stage === "target:assertion");
    expect(requests).toHaveLength(examples.length);
    expect(
      requests.every((request) => !Object.keys(request.questions).some((id) => id.endsWith("_scope_subject"))),
    ).toBe(true);
    expect(requests.map((request) => (request.state as { applicationContext?: unknown }).applicationContext)).toEqual(
      examples.map(() =>
        expect.objectContaining({
          registeredCharacter: "固定応答テスト",
          subjectResolvedByRegistrationContract: true,
          genericRelationshipTargetsRemainGeneric: true,
        }),
      ),
    );
  });

  it("asks Jev about subject scope only when a distinct person is explicit", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const understanding = frozenAudit(fixture);
    understanding.assertions = [
      {
        ...understanding.assertions[0],
        rawLabel: "別人物の行為",
        valueText: "太宰治が仲間を助ける。",
      },
    ];
    const t = await setup("standard", { ...explicitFixtures[0], understanding });
    const request = t.judgmentRequests.find((item) => item.context.stage === "target:assertion");
    expect(request?.questions).toHaveProperty("assertion_0_scope_subject");
    expect(request?.state).toMatchObject({
      applicationContext: {
        registeredCharacter: "固定応答テスト",
        subjectResolvedByRegistrationContract: false,
        competingSubjects: ["太宰治"],
      },
    });
  });

  it.each([true, false])(
    "completes after grounding removes apparently sufficient content (recovers=%s)",
    async (recovers) => {
      const fixture = sparseFixtures.find((item) => item.caseId === "D03");
      if (!fixture) throw new Error("D03 fixture missing");
      const candidate = frozenAudit(fixture);
      const originalValues = candidate.assertions.map((item) => item.valueText);
      const t = await setup("standard", {
        ...explicitFixtures[0],
        understanding: candidate,
        understandingAuditOverride(value, auditNumber) {
          if (auditNumber === 1 || !recovers)
            for (const assertion of value.assertions) {
              assertion.evidence[0].supportAssessment.verdict = "unsupported";
              assertion.evidence[0].supportAssessment.reason = "高確信で支持されない固定判定";
            }
          return value;
        },
      });
      const calls = t.requests.filter((request) =>
        ["customization_delta", "character_understanding", "understanding_audit"].includes(request.operation),
      );
      expect(calls).toHaveLength(2);
      expect(new Set(calls.map((request) => request.idempotencyKey)).size).toBe(2);
      const completion = calls[1].messages.find((item) =>
        item.content.startsWith(UNDERSTANDING_COMPLETION_INSTRUCTION),
      )?.content;
      expect(completion).toContain("欠落項目");
      expect(completion).toContain('"modelTotalRemaining":4');
      expect(completion).toContain('"modelPerMissingAspect":1');
      expect(completion).toContain("保持済み候補");
      expect(completion).toContain("利用可能な出典");
      expect(completion).toContain('"assertions":[]');
      expect(completion).not.toContain("assertion_0:");
      expect(completion).not.toContain("高確信で支持されない固定判定");
      for (const value of originalValues) expect(completion).not.toContain(value);
      const quality = t.detail.understanding?.informationQuality;
      expect(quality).toMatchObject({
        completionAttempted: true,
        status: recovers ? "not_flagged" : "limited",
        concreteAspectCount: recovers ? 4 : 0,
      });
      // D03's recovered fixture contains model-only evidence. The new global
      // budget retains four assertions, each assigned to its own explicit aspect.
      expect(t.detail.understanding?.assertions).toHaveLength(recovers ? 4 : 0);
      expect(t.analysis.assertions.length).toBeGreaterThan(0);
      const rows = t.db.database
        .prepare(
          "SELECT operation,output_hash FROM model_run_metadata WHERE operation IN ('customization_delta','character_understanding','understanding_audit')",
        )
        .all();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => typeof row.output_hash === "string" && row.output_hash.length === 64)).toBe(true);
      const snapshot = t.db.database
        .prepare(
          "SELECT s.source_assessment_json, m.output_hash FROM character_understanding_snapshots s JOIN model_run_metadata m ON m.id=s.model_run_metadata_id",
        )
        .get();
      const rawAudit = JSON.parse(String(snapshot?.source_assessment_json)).semanticAudit.original;
      expect(rawAudit.assertions).toHaveLength(candidate.assertions.length);
      expect(snapshot?.output_hash).toMatch(/^[a-f0-9]{64}$/u);
    },
  );

  it("does not add completion calls when grounded content is sufficient", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const t = await setup("standard", { ...explicitFixtures[0], understanding: frozenAudit(fixture) });
    expect(
      t.requests.filter((request) =>
        ["customization_delta", "character_understanding", "understanding_audit"].includes(request.operation),
      ),
    ).toHaveLength(1);
    expect(t.detail.understanding?.informationQuality).toMatchObject({
      status: "not_flagged",
      completionAttempted: false,
      concreteAspectCount: 4,
    });
    expect(t.detail.understanding?.assertions).toHaveLength(4);
  });

  it("keeps a physically grounded aspect ahead of the model knowledge budget", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const candidate = frozenAudit(fixture);
    const valueText = "冷酷な知略で支配する人物。";
    candidate.assertions[12] = {
      ...candidate.assertions[12],
      rawLabel: "行動",
      valueText,
      explicitness: "user_explicit",
      evidence: [
        {
          sourceRef: "input:/characterBasicInfo",
          sourceUrl: null,
          inputPointer: "/characterBasicInfo",
          quote: valueText,
          inferenceType: "direct",
        },
      ],
    };
    candidate.summary.behavior = [valueText];
    candidate.aspectAssessments.behavior = {
      kind: "concrete",
      reason: "ユーザー入力の原文に接地した行動",
      summaryIndexes: [0],
      assertionIndexes: [12],
    };
    const t = await setup("standard", { ...explicitFixtures[0], understanding: candidate });
    const assertion = t.detail.understanding?.assertions.find((item) => item.value_text === valueText);
    expect(assertion).toMatchObject({
      explicitness: "user_explicit",
      evidence: [expect.objectContaining({ verificationStatus: "verified_quote", evidenceOrigin: "user_input" })],
    });
    expect(t.detail.understanding?.informationQuality?.aspects.behavior.kind).toBe("concrete");
    expect(
      t.detail.understanding?.assertions.filter((item) => item.explicitness === "model_knowledge").length,
    ).toBeLessThanOrEqual(4);
  });

  it("completes when quotes fail verification even though the model marks them supported", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const t = await setup("standard", {
      ...explicitFixtures[0],
      understanding: frozenAudit(fixture),
      understandingAuditOverride(value) {
        for (const assertion of value.assertions) {
          const ref = {
            sourceRef: "user_input",
            sourceUrl: null,
            inputPointer: "/preference/likedReasons",
            quote: "入力原文に存在しない人物描写",
            inferenceType: "direct" as const,
          };
          assertion.scopeAssessment.anchors = [ref];
          assertion.evidence = [{ ...ref, supportAssessment: { verdict: "supported", reason: "固定した誤判定" } }];
        }
        return value;
      },
    });
    expect(t.requests.filter((request) => request.operation === "understanding_audit")).toHaveLength(0);
    expect(t.detail.understanding?.assertions).toHaveLength(0);
    expect(t.detail.understanding?.informationQuality).toMatchObject({
      status: "limited",
      completionAttempted: true,
      concreteAspectCount: 0,
    });
  });

  it("preserves sparse quality through confirmation, export and profile without losing explicit preferences", async () => {
    const t = await setup("standard", { ...explicitFixtures[0], understanding: frozenAudit(sparseFixtures[0]) });
    const quality = t.detail.understanding?.informationQuality;
    expect(quality).toMatchObject({
      assessedAt: "analysis",
      status: "limited",
      completionAttempted: true,
      contentAspectCount: 0,
      concreteAspectCount: 0,
    });
    const exported = await selectExportUnderstandingSnapshots(t.db.DB, t.owner).all<{
      source_assessment_json: string;
    }>();
    expect(JSON.parse(exported.results[0].source_assessment_json).informationQuality).toEqual(quality);
    expect(
      t.requests.filter((request) =>
        ["customization_delta", "character_understanding", "understanding_audit"].includes(request.operation),
      ),
    ).toHaveLength(2);
    const preferenceCalls = t.requests.filter((request) => request.operation.startsWith("preference_"));
    expect(preferenceCalls).toHaveLength(1);
    for (const call of preferenceCalls) {
      expect(call.messages[0].content).toContain(responseChannelPrompt());
      expect(
        call.messages
          .map((item) => item.content)
          .join("\n")
          .split(responseChannelPrompt()),
      ).toHaveLength(2);
    }
    expect(preferenceCalls.every((request) => !JSON.stringify(request.messages).includes('"informationQuality"'))).toBe(
      true,
    );
    expect(t.analysis.assertions).toHaveLength(explicitFixtures[0].expectedAssertions.length);
    expect(t.analysis.assertions.every((item) => item.evidence.length > 0)).toBe(true);
    expect((await rebuild(t, "standard"))?.dimensions.length).toBeGreaterThan(0);
    const metadata = t.db.database
      .prepare(
        "SELECT prompt_version,schema_version,effective_settings_json FROM model_run_metadata WHERE operation IN ('character_understanding','customization_delta')",
      )
      .all();
    expect(metadata).toHaveLength(2);
    for (const row of metadata) expect(row.schema_version).toBe("1.0");
  });

  it("keeps the analysis-time assessment after a manual understanding edit", async () => {
    let initialQuality: unknown;
    const t = await setup(
      "standard",
      { ...explicitFixtures[0], understanding: frozenAudit(sparseFixtures[0]) },
      true,
      async (env, owner, snapshotId) => {
        await mutateUnderstandingReview(
          env,
          owner,
          "standard",
          snapshotId,
          {
            action: "add_assertion",
            attributeStableKey: null,
            rawLabel: "仲間との関係",
            valueText: "幼馴染とは互いに困りごとを相談する",
          },
          crypto.randomUUID(),
        );
        const row = await env.DB.prepare(
          "SELECT source_assessment_json FROM character_understanding_snapshots WHERE id=?",
        )
          .bind(snapshotId)
          .first<{ source_assessment_json: string }>();
        initialQuality = JSON.parse(row?.source_assessment_json ?? "{}").informationQuality;
      },
    );
    expect(initialQuality).toMatchObject({ status: "limited", completionAttempted: true });
    expect(t.detail.understanding?.informationQuality).toEqual(initialQuality);
    expect(
      t.detail.understanding?.assertions.some((item) => item.value_text === "幼馴染とは互いに困りごとを相談する"),
    ).toBe(true);
  });

  it("leaves older snapshots unassessed instead of treating them as sufficient", async () => {
    const t = await setup("standard");
    t.db.database
      .prepare(
        "UPDATE character_understanding_snapshots SET source_assessment_json=json_remove(source_assessment_json,'$.informationQuality') WHERE owner_user_id=?",
      )
      .run(t.owner);
    const detail = reviewDetailSchema.parse(await loadEntryReview(t.env, t.owner, "standard", t.params.entryId));
    expect(detail.understanding?.informationQuality).toBeUndefined();
  });

  it("does not add standard audit requirements to dark analysis", async () => {
    const t = await setup("dark");
    expect(t.detail.understanding?.informationQuality).toMatchObject({ status: "not_flagged" });
    expect(t.requests.filter((request) => request.operation === "dark_character_understanding")).toHaveLength(3);
    expect(t.requests.some((request) => request.operation === "understanding_audit")).toBe(false);
    for (const request of t.requests) {
      expect(request.messages[0].content).not.toMatch(/aspectAssessments|wishful_identification|通常版の反応経路/u);
    }
  });
});
