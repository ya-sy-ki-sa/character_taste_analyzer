import { type FormEvent, useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { type DarkResponseChannel, darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import { type ResponseChannel, responseChannelCatalog } from "../../../shared/response-channels";
import type { PreferenceMutationHandler } from "./review-types";

export function PreferenceAssertionForm({
  initial,
  domain,
  ontologyAttributes,
  disabled,
  submitLabel,
  onCancel,
  onMutate,
}: {
  initial?: {
    id: string;
    raw_label: string;
    stable_key: string | null;
    polarity: string;
    response_channel: string;
    strength: number;
  };
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  submitLabel: string;
  onCancel(): void;
  onMutate: PreferenceMutationHandler;
}) {
  const channels = domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog;
  const [rawLabel, setRawLabel] = useState(initial?.raw_label ?? "");
  const [attributeStableKey, setAttributeStableKey] = useState(initial?.stable_key ?? "");
  const [polarity, setPolarity] = useState<"positive" | "negative" | "mixed">(
    initial?.polarity === "negative" || initial?.polarity === "mixed" ? initial.polarity : "positive",
  );
  const [responseChannel, setResponseChannel] = useState(initial?.response_channel ?? channels[0].value);
  const [strength, setStrength] = useState(initial?.strength ?? 0.8);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const common = {
      rawLabel,
      attributeStableKey: attributeStableKey || null,
      polarity,
      responseChannel: responseChannel as ResponseChannel | DarkResponseChannel,
      strength,
    };
    const saved = initial
      ? await onMutate({ action: "update_preference", targetId: initial.id, ...common })
      : await onMutate({ action: "add_preference", ...common });
    if (saved) onCancel();
  }
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <label>
        <span>好みの属性名</span>
        <input required maxLength={200} value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} />
      </label>
      <label>
        <span>Ontology属性</span>
        <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
          <option value="">未対応</option>
          {ontologyAttributes.map((item) => (
            <option key={item.stableKey} value={item.stableKey}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>反応経路</span>
        <select value={responseChannel} onChange={(event) => setResponseChannel(event.target.value)}>
          {channels.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>支持</span>
        <select value={polarity} onChange={(event) => setPolarity(event.target.value as typeof polarity)}>
          <option value="positive">好き・肯定的</option>
          <option value="negative">苦手・否定的</option>
          <option value="mixed">両価的</option>
        </select>
      </label>
      <label>
        <span>強さ {Math.round(strength * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={strength}
          onChange={(event) => setStrength(Number(event.target.value))}
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function PreferenceAssertionEditControl(props: {
  item: {
    id: string;
    raw_label: string;
    stable_key: string | null;
    polarity: string;
    response_channel: string;
    strength: number;
  };
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <PreferenceAssertionForm
      initial={props.item}
      domain={props.domain}
      ontologyAttributes={props.ontologyAttributes}
      disabled={props.disabled}
      submitLabel="修正を保存"
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" disabled={props.disabled} onClick={() => setOpen(true)}>
      編集
    </button>
  );
}

export function AddPreferenceAssertionControl(props: {
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <PreferenceAssertionForm
      domain={props.domain}
      ontologyAttributes={props.ontologyAttributes}
      disabled={props.disabled}
      submitLabel="好みの候補を追加"
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" className="manual-add-button" disabled={props.disabled} onClick={() => setOpen(true)}>
      ＋ 好みの候補を手動追加
    </button>
  );
}
