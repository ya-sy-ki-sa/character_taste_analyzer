import { test } from "@playwright/test";
import { entrySubmissionSchema } from "../../shared/contracts/entries";
// The driver is JS so it can also be resumed with a standalone browser harness.
// @ts-expect-error JS orchestration module intentionally has no declaration file.
import { run } from "./runner.mjs";

test("live persona evaluation (persistent real providers)", async ({ browser }) => {
  await run(browser, (input: unknown) => entrySubmissionSchema.parse(input));
});
