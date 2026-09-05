import type { DarkContext } from "../../../shared/contracts/entries";
import type { FormState } from "./form-state";

export const darkArchetypeOptions: Array<{ value: DarkContext["archetypeHints"][number]; label: string }> = [
  { value: "villain", label: "ヴィラン" },
  { value: "villain_protagonist", label: "ヴィラン主人公" },
  { value: "antagonistic_rival", label: "悪役ライバル" },
  { value: "antihero", label: "アンチヒーロー" },
  { value: "dark_hero", label: "ダークヒーロー" },
  { value: "morally_gray", label: "モラリー・グレー" },
  { value: "fallen_hero", label: "堕落した英雄" },
  { value: "controlled_hero", label: "支配された勇者" },
  { value: "manipulated_former_ally", label: "操作された元味方" },
  { value: "betraying_ally", label: "裏切った協力者" },
  { value: "other_dark", label: "その他のダーク状態" },
];

export function DarkContextFields({
  form,
  update,
}: {
  form: FormState;
  update<K extends keyof FormState>(key: K, value: FormState[K]): void;
}) {
  return (
    <>
      <label className="full dark-focus-field">
        <span>
          注目するダーク状態・役割 <b>必須</b>
        </span>
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={form.focusDescription}
          onChange={(event) => update("focusDescription", event.target.value)}
          placeholder="例：敵に洗脳され、元の仲間へ剣を向ける間。自我と正義感は残り、内側では抵抗している"
        />
      </label>
      <fieldset className="full identity-resolution dark-archetypes">
        <legend>アーキタイプ候補（任意）</legend>
        <div className="channel-grid">
          {darkArchetypeOptions.map((option) => (
            <label className="check-row" key={option.value}>
              <input
                type="checkbox"
                checked={form.archetypeHints.includes(option.value)}
                onChange={(event) =>
                  update(
                    "archetypeHints",
                    event.target.checked
                      ? [...form.archetypeHints, option.value]
                      : form.archetypeHints.filter((item) => item !== option.value),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {(
        [
          ["beforeState", "変化前・通常時", "元の役割、守っていたもの、主体性、関係性"],
          ["transitionTrigger", "闇化・敵対化の契機", "誘惑、敗北、契約、思想転向、洗脳開始など"],
          ["controllerOrInfluence", "支配者・影響源", "操作者、憑依者、呪い、力、思想など"],
          ["controlMechanism", "支配・変化の機構", "洗脳方法、命令、拘束、同意の有無など"],
          ["awarenessAndResistance", "認識・抵抗・自我", "本人は認識しているか、抵抗や自我は残るか"],
          ["relationshipChange", "関係の変化", "元味方、支配者、宿敵との変化前後"],
          ["responsibilityNote", "責任の捉え方", "行為の責任を本人・支配者へどう帰属させるか"],
          ["desiredOutcome", "望む結末", "回復、闇の維持・深化、無改心、勝利など"],
          ["contentBoundaries", "内容境界", "分析・生成で避けたい内容"],
        ] as const
      ).map(([key, label, placeholder]) => (
        <label className="full" key={key}>
          <span>{label}（任意）</span>
          <textarea
            rows={3}
            maxLength={
              key === "relationshipChange" || key === "beforeState" || key === "transitionTrigger" ? 4000 : 2000
            }
            value={form[key]}
            onChange={(event) => update(key, event.target.value)}
            placeholder={placeholder}
          />
        </label>
      ))}
    </>
  );
}
