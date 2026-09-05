import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";

export function rebuildConfirmedUnderstandingSummary(
  original: UnderstandingCandidate["summary"],
  assertions: Array<{ raw_label: string; value_text: string; stable_key: string | null }>,
): UnderstandingCandidate["summary"] {
  const values = (patterns: RegExp[]) =>
    assertions
      .filter((item) => patterns.some((pattern) => pattern.test(item.stable_key ?? "")))
      .map((item) => item.value_text)
      .slice(0, 50);
  return {
    identity: original.identity,
    narrativeRole: values([/(^|\.)role\./u, /\.archetype\./u]),
    moralityOrientation: values([/(^|\.)morality\./u, /(^|\.)goodness\./u, /(^|\.)evil\./u, /\.harm\./u]),
    goals: values([/(^|\.)motivation\./u]),
    values: values([/(^|\.)value\./u, /\.morality\./u]),
    behavior: assertions.map((item) => item.value_text).slice(0, 50),
    relationships: values([/(^|\.)relationship\./u]),
    expression: values([/(^|\.)aesthetic\./u, /\.expression\./u, /\.competence\./u]),
  };
}
