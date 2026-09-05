import type { GenerationOption } from "../../../shared/contracts/generation-response";

export function CandidateComparison({
  options,
  activeId,
  pending,
  onView,
  onSelect,
}: {
  options: GenerationOption[];
  activeId?: string;
  pending: boolean;
  onView(option: GenerationOption): void;
  onSelect(option: GenerationOption): void;
}) {
  return (
    <section className="quality-controls" aria-label="生成案の比較">
      <h3>合格した {options.length} 案を比較</h3>
      <p>必須・禁止条件と類似度の検査を通過した案です。設定を確認し、採用する案を選んでください。</p>
      {options.length < 3 && <p>3案のうち、検査を通過した案だけを表示しています。</p>}
      {options.map((option) => (
        <article className="quality-option" key={option.id}>
          <h4>
            案 {option.ordinal} · {option.character.identity.name}
            {option.selected ? " · 採用済み" : ""}
          </h4>
          <dl>
            <dt>条件への適合</dt>
            <dd>{option.comparison.preferenceFit}</dd>
            <dt>設定の一貫性</dt>
            <dd>{option.comparison.coherence}</dd>
            <dt>他案との違い</dt>
            <dd>{option.comparison.difference}</dd>
          </dl>
          {option.comparison.tradeoffs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <div className="button-row">
            <button
              className="button"
              type="button"
              onClick={() => onView(option)}
              aria-pressed={activeId === option.id}
            >
              この案の設定を見る
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={pending || option.selected}
              onClick={() => onSelect(option)}
            >
              {option.selected ? "採用済み" : "この案を採用"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
