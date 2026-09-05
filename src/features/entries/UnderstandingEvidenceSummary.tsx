import type { UnderstandingEvidenceSummary as EvidenceSummary } from "../../../shared/contracts/understanding-evidence";
import { understandingEvidenceExplanation, understandingEvidenceLabels } from "../../../shared/understanding-evidence";

export function UnderstandingEvidenceSummary({ summary }: { summary: EvidenceSummary }) {
  return (
    <section className="understanding-evidence-summary" aria-label="現在の属性に付いている根拠の内訳">
      <p>
        現在の属性：{summary.assertionCount}件／根拠が付いていない属性：{summary.assertionsWithoutEvidence}件
      </p>
      <details>
        <summary>現在の属性に付いている根拠の内訳</summary>
        <dl>
          {Object.entries(understandingEvidenceLabels).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{summary.counts[key as keyof typeof summary.counts]}件</dd>
            </div>
          ))}
        </dl>
        <p className="section-help">{understandingEvidenceExplanation}</p>
      </details>
    </section>
  );
}
