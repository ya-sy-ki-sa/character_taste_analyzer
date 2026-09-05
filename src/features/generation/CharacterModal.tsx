import type { ReactNode } from "react";
import type { AnyGeneratedCharacterCandidate } from "../../../shared/contracts/generation";
import { briefCoverageStatusLabel, briefTreatmentLabel } from "../../../shared/presentation-labels";
import { Modal } from "../../components/Ui";

export function CharacterModal({
  character,
  onClose,
  children,
  comparison,
}: {
  character: AnyGeneratedCharacterCandidate;
  onClose(): void;
  children?: ReactNode;
  comparison?: ReactNode;
}) {
  const sections = [
    ["外見", character.appearance],
    ["性格", character.personality],
    ["動機", character.motivations],
    ["能力と限界", character.abilitiesAndLimits],
  ] as const;
  return (
    <Modal title={character.identity.name} onClose={onClose} wide>
      <article className="character-sheet">
        <header>
          <p>{character.identity.oneLineConcept}</p>
          <small>{character.identity.origin}</small>
        </header>
        {comparison}
        <div className="sheet-grid">
          {sections.map(([title, section], index) => (
            <section className="sheet-section" key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{section.summary}</p>
                <ul>
                  {Array.from(new Map(section.traits.map((trait) => [JSON.stringify(trait), trait])).values()).map(
                    (trait) => (
                      <li key={JSON.stringify(trait)}>
                        <strong>{trait.label}</strong> — {trait.description}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </section>
          ))}
          <section className="sheet-section">
            <span>05</span>
            <div>
              <h3>価値観と道徳</h3>
              <p>{character.valuesAndMorality.moralRelationship}</p>
              <p>
                <strong>改心:</strong> {character.valuesAndMorality.redemption}
              </p>
              <p>
                <strong>隠れた善性:</strong> {character.valuesAndMorality.hiddenGoodness}
              </p>
            </div>
          </section>
          <section className="sheet-section">
            <span>06</span>
            <div>
              <h3>役割と変化</h3>
              <p>
                {character.narrativeRole.role} — {character.narrativeRole.function}
              </p>
              <p>
                {character.characterArc.start} → {character.characterArc.end}
              </p>
            </div>
          </section>
        </div>
        <section className="rationale">
          <p className="eyebrow">PREFERENCE BASIS</p>
          <h3>好みとの対応</h3>
          <div>
            {character.briefCoverage.map((item) => (
              <span key={item.profileSnapshotItemId}>
                <strong>
                  {briefTreatmentLabel(item.treatment)} ／ {briefCoverageStatusLabel(item.status)}
                </strong>
                <small>{item.explanation}</small>
              </span>
            ))}
          </div>
        </section>
        {character.schemaVersion === "dark-1.0" && (
          <section className="rationale dark-generation-detail">
            <p className="eyebrow">DARK STATE MODEL</p>
            <h3>ダーク状態・主体性・変化</h3>
            <p>{character.darkCore.narrativeFunction}</p>
            <p>
              <strong>主体性:</strong> {character.darkCore.agency.agencyOrigin} ／ <strong>同意:</strong>{" "}
              {character.darkCore.agency.consent} ／ <strong>責任:</strong> {character.darkCore.agency.responsibility}
            </p>
            <p>
              <strong>契機:</strong> {character.baselineAndTransition.trigger ?? "未確定"}
            </p>
            <p>{character.darkMorality.logic}</p>
            <p>{character.darkArc.possibleOutcome}</p>
          </section>
        )}
        {children}
      </article>
    </Modal>
  );
}
