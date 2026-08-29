export async function first<T>(statement: D1PreparedStatement): Promise<T | null> {
  return (await statement.first<T>()) ?? null;
}

export async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  if (!result.success) throw new Error(result.error || "D1 query failed");
  return result.results;
}

export async function run(statement: D1PreparedStatement): Promise<D1Result<unknown>> {
  const result = await statement.run();
  if (!result.success) throw new Error(result.error || "D1 statement failed");
  return result;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
