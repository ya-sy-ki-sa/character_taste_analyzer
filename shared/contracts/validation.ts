import { z } from "zod";

export function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return (point <= 0x1f && point !== 0x09 && point !== 0x0a) || point === 0x7f;
  });
}

export const text = (maximum: number, message = "入力してください") =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(maximum)
    .refine((value) => !containsForbiddenControl(value), "制御文字は使用できません");

export const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);
