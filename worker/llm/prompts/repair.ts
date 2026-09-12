export const FORMAT_REPAIR_INSTRUCTION = `[TASK:FORMAT_REPAIR]
入力: 直前のJSONと検証エラー。
処理: 検証エラーに従って直前のJSONを修復する。事実を追加しない。
出力: 指定JSON Schemaに適合する修復済みJSONのみ。説明文・Markdownを付加しない。`;
