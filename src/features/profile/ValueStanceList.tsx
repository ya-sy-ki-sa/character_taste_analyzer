import type { ProfileView } from "../../../shared/contracts/profile-response";
import { preferenceContextEntries } from "../../../shared/preference-context";
import { valueOrientationLabel, valueStanceLabel } from "../../../shared/value-stance-labels";

type ValueStance = ProfileView["valueStances"][number];

export function ValueStanceList({ items }: { items: ProfileView["valueStances"] }) {
  if (!items.length) return null;
  const groups = new Map<string, ValueStance[]>();
  for (const item of items) {
    const heading = valueOrientationLabel(item.orientation);
    const group = groups.get(heading) ?? [];
    group.push(item);
    groups.set(heading, group);
  }
  return (
    <section className="section-block value-stances" aria-labelledby="value-stances-title">
      <div className="section-title">
        <div>
          <p className="eyebrow">VALUE STANCES</p>
          <h2 id="value-stances-title">価値・善悪との関わり方</h2>
        </div>
        <small className="value-stance-help">人物への好意や道徳的支持とは別系列</small>
      </div>
      <div className="value-stance-groups">
        {[...groups].map(([heading, group]) => (
          <details className="value-stance-group" key={heading}>
            <summary className="value-stance-group-summary">
              <h3>
                <span className="value-stance-group-title">
                  {heading}
                  <span className="value-stance-group-count">{group.length}件</span>
                </span>
                <span className="value-stance-toggle">詳細</span>
              </h3>
            </summary>
            <ul className="value-stance-list">
              {group.map((item) => (
                <li
                  key={`${item.orientation}:${item.stance}:${item.targetRef ?? ""}:${JSON.stringify(item.scope ?? {})}`}
                >
                  <ValueStanceRow item={item} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

function ValueStanceRow({ item }: { item: ValueStance }) {
  const entries = preferenceContextEntries(item.scope);
  const targets = entries.filter(([label]) => label === "対象人物" || label === "対象範囲");
  const overview = (
    <>
      <span className="value-stance-position">
        {valueStanceLabel(item.stance)}・{item.count}件
      </span>
      <span className="value-stance-overview">
        {item.labels.length > 0 && <strong>{item.labels.join("、")}</strong>}
        {targets.map(([label, text]) => (
          <span className="value-stance-target" key={`${label}:${text}`}>
            <span className="value-stance-label">{label}</span>
            <span>{text}</span>
          </span>
        ))}
      </span>
    </>
  );
  if (!entries.length) return <div className="value-stance-summary">{overview}</div>;
  return (
    <details className="value-stance-details">
      <summary className="value-stance-summary">
        {overview}
        <span className="value-stance-toggle">詳細</span>
      </summary>
      <dl className="value-stance-context">
        {entries.map(([label, text]) => (
          <div key={`${label}:${text}`}>
            <dt>{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
