import { preferenceContextEntries } from "../../../shared/preference-context";

export function PreferenceContext({ value }: { value: unknown }) {
  const entries = preferenceContextEntries(value);
  if (!entries.length) return null;
  return (
    <dl className="preference-context">
      {entries.map(([label, text]) => (
        <div key={`${label}:${text}`}>
          <dt>{label}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}
