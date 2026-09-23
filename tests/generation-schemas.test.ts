import { describe, expect, it } from "vitest";
import { z } from "zod";
import { candidateSchemasForBrief, validationSchemaForBrief } from "../worker/features/generation/schemas";
import { GENERATION_POLICY_CHECKS } from "../worker/features/generation/validation";

const selectedItemIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const mistypedId = "11111111-1111-4111-8111-111111111113";

describe("generation schemas bound to a brief", () => {
  it.each(["standard", "dark"] as const)("restricts %s coverage to selected IDs", (domain) => {
    const schema = candidateSchemasForBrief("33333333-3333-4333-8333-333333333333", selectedItemIds)[domain];
    const idSchema = schema.shape.briefCoverage.element.shape.profileSnapshotItemId;

    expect(idSchema.safeParse(selectedItemIds[0]).success).toBe(true);
    expect(idSchema.safeParse(mistypedId).success).toBe(false);
    expect(z.toJSONSchema(idSchema, { target: "draft-7" })).toMatchObject({ enum: selectedItemIds });
  });

  it("restricts validation checks to selected IDs and policy checks", () => {
    const schema = validationSchemaForBrief(selectedItemIds);
    const idSchema = schema.shape.checks.element.shape.constraintId;

    expect(idSchema.safeParse(selectedItemIds[1]).success).toBe(true);
    expect(idSchema.safeParse(GENERATION_POLICY_CHECKS[0]).success).toBe(true);
    expect(idSchema.safeParse(mistypedId).success).toBe(false);
    expect(z.toJSONSchema(idSchema, { target: "draft-7" })).toMatchObject({
      enum: [...selectedItemIds, ...GENERATION_POLICY_CHECKS],
    });
  });
});
