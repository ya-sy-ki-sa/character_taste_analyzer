import { z } from "zod";
import { groundedUnderstandingAuditSchema } from "../../../shared/contracts/semantic-audit";
import { aspectAssessmentsSchema } from "../../../shared/contracts/understanding-quality";
import { understandingAspects } from "../../../shared/understanding-aspects";
import { UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION } from "../../llm/prompts/understanding";
import type { StructuredLlmRequest } from "../../llm/types";

/** Spend the existing repair attempt on assessments, keeping the entire revised body immutable. */
export const repairUnderstandingAssessments: NonNullable<StructuredLlmRequest<unknown>["repairStrategy"]> = (
  raw,
  issues,
) => {
  if (!issues.length || issues.some((issue) => issue.path[0] !== "aspectAssessments")) return null;
  const { aspectAssessments: _assessments, ...shape } = groundedUnderstandingAuditSchema.shape;
  const bodySchema = z.object(shape);
  const body = bodySchema.safeParse(raw);
  if (!body.success) return null;
  const schema = z.strictObject({ aspectAssessments: aspectAssessmentsSchema });
  const numbered = {
    summary: Object.fromEntries(
      understandingAspects.map((aspect) => [aspect, body.data.summary[aspect].map((text, index) => ({ index, text }))]),
    ),
    assertions: body.data.assertions.map((assertion, index) => ({ index, ...assertion })),
  };
  return {
    schemaName: "understanding_assessments_repair",
    schemaVersion: "1.0",
    schema,
    jsonSchema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>,
    messages: [
      {
        role: "system",
        content: UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION,
      },
      {
        role: "user",
        content: JSON.stringify({
          numbered,
          previousAssessments: (raw as Record<string, unknown>).aspectAssessments,
          issues,
        }),
      },
    ],
    merge: (repair) => ({ ...body.data, ...(repair as { aspectAssessments: unknown }) }),
  };
};
