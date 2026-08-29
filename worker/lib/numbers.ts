type IntegerBounds = {
  min?: number;
  max?: number;
};

export function boundedInteger(
  value: string | number | undefined,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER }: IntegerBounds = {},
): number {
  const candidate = typeof value === "string" && value.trim() === "" ? Number.NaN : Number(value);
  const parsed = Number.isSafeInteger(candidate) ? candidate : fallback;
  return Math.min(max, Math.max(min, parsed));
}
