import { z } from "zod";
import { understandingAspects } from "../understanding-aspects";
import { understandingCandidateSchema } from "./understanding";

const referenceIndexes = z.array(z.number().int().nonnegative()).max(100);
const aspectAssessmentSchema = z.object({
  kind: z.enum(["concrete", "label_only", "attribution_only", "unknown"]),
  reason: z.string().trim().min(1).max(1_000),
  summaryIndexes: referenceIndexes,
  assertionIndexes: referenceIndexes,
});
export const aspectAssessmentsSchema = z.strictObject({
  narrativeRole: aspectAssessmentSchema,
  moralityOrientation: aspectAssessmentSchema,
  goals: aspectAssessmentSchema,
  values: aspectAssessmentSchema,
  behavior: aspectAssessmentSchema,
  relationships: aspectAssessmentSchema,
  expression: aspectAssessmentSchema,
});
export type AspectAssessments = z.infer<typeof aspectAssessmentsSchema>;

/** Only the standard audit requires this assessment; generation and dark contracts stay independent. */
export const understandingAuditSchema = understandingCandidateSchema
  .extend({ aspectAssessments: aspectAssessmentsSchema })
  .superRefine((candidate, context) => {
    for (const aspect of understandingAspects) {
      const assessment = candidate.aspectAssessments[aspect];
      const summary = candidate.summary[aspect];
      const hasContent = summary.some((text) => text.trim());
      const issue = (message: string) =>
        context.addIssue({ code: "custom", path: ["aspectAssessments", aspect], message });
      if (hasContent === (assessment.kind === "unknown")) issue("空の項目だけをunknownにしてください");
      for (const [key, values] of [
        ["summaryIndexes", summary],
        ["assertionIndexes", candidate.assertions.map((item) => item.valueText)],
      ] as const) {
        const indexes = assessment[key];
        if (new Set(indexes).size !== indexes.length || indexes.some((index) => !values[index]?.trim()))
          issue(`${key}は改訂後の内容を指す、重複のない有効な参照番号が必要です`);
      }
      if (hasContent && !assessment.summaryIndexes.length) issue("内容のある要約への参照が必要です");
      if (assessment.kind === "concrete" && !assessment.assertionIndexes.length)
        issue("具体的な人物描写に対応する属性への参照が必要です");
      if (assessment.kind === "unknown" && assessment.assertionIndexes.length)
        issue("不明な項目に属性の参照を付けないでください");
    }
  });
export type UnderstandingAudit = z.infer<typeof understandingAuditSchema>;

export const understandingInformationQualitySchema = z.object({
  policyVersion: z.string(),
  assessedAt: z.literal("analysis"),
  status: z.enum(["limited", "not_flagged"]),
  contentAspectCount: z.number().int().min(0).max(7),
  concreteAspectCount: z.number().int().min(0).max(7),
  completionAttempted: z.boolean(),
  reasons: z.array(z.string().max(1_000)).max(10),
  aspects: aspectAssessmentsSchema,
});
export type UnderstandingInformationQuality = z.infer<typeof understandingInformationQualitySchema>;
