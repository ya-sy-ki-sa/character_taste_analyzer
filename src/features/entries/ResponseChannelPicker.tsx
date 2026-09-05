import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { type DarkResponseChannel, darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import {
  type ResponseChannel,
  responseChannelCatalog,
  responseChannelCategories,
} from "../../../shared/response-channels";

export const popularChannelOptions = responseChannelCatalog.filter((item) => item.tier === "popular");

export const detailedChannelOptions = responseChannelCatalog.filter((item) => item.tier === "detail");

export function ResponseChannelOption({
  option,
  selected,
  onChange,
}: {
  option: (typeof responseChannelCatalog)[number] | (typeof darkResponseChannelCatalog)[number];
  selected: boolean;
  onChange(value: ResponseChannel | DarkResponseChannel, selected: boolean): void;
}) {
  return (
    <label className="check-row channel-option">
      <input type="checkbox" checked={selected} onChange={(event) => onChange(option.value, event.target.checked)} />
      <span className="channel-option-copy">
        <b>{option.label}</b>
        <small>{option.description}</small>
      </span>
    </label>
  );
}

export function ResponseChannelPicker({
  domain,
  selected,
  onChange,
}: {
  domain: AnalysisDomain;
  selected: Array<ResponseChannel | DarkResponseChannel>;
  onChange(value: ResponseChannel | DarkResponseChannel, selected: boolean): void;
}) {
  if (domain === "dark")
    return (
      <fieldset className="full channel-picker dark-channel-picker">
        <legend>ダークな状態の、どこに惹かれるか</legend>
        <p className="channel-picker-intro">専用の反応経路です。人物への好意と、行為への道徳的支持は別に扱われます。</p>
        <div className="channel-grid">
          {darkResponseChannelCatalog.map((option) => (
            <ResponseChannelOption
              key={option.value}
              option={option}
              selected={selected.includes(option.value)}
              onChange={onChange}
            />
          ))}
        </div>
      </fieldset>
    );
  return (
    <fieldset className="full channel-picker">
      <legend>どういう意味で好きか</legend>
      <p className="channel-picker-intro">当てはまるものを複数選べます。よく使われる項目を先に表示しています。</p>
      <div className="channel-grid">
        {popularChannelOptions.map((option) => (
          <ResponseChannelOption
            key={option.value}
            option={option}
            selected={selected.includes(option.value)}
            onChange={onChange}
          />
        ))}
      </div>
      <div className="channel-accordions">
        {responseChannelCategories.map((category) => {
          const options = detailedChannelOptions.filter((item) => item.category === category.key);
          const selectedCount = options.filter((item) => selected.includes(item.value)).length;
          return (
            <details className="channel-accordion" key={category.key}>
              <summary>
                <span>
                  <b>{category.label}</b>
                  <small>{category.description}</small>
                </span>
                <span className="channel-accordion-count">
                  {selectedCount ? `${selectedCount}件選択` : "詳細を表示"}
                </span>
              </summary>
              <div className="channel-grid channel-detail-grid">
                {options.map((option) => (
                  <ResponseChannelOption
                    key={option.value}
                    option={option}
                    selected={selected.includes(option.value)}
                    onChange={onChange}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </fieldset>
  );
}
