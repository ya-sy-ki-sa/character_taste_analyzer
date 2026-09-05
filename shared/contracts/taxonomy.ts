import { z } from "zod";
import { analysisDomainValues } from "../analysis-domain";
import { darkResponseChannelValues } from "../dark-response-channels";
import { responseChannelValues } from "../response-channels";

export const registrationTypeSchema = z.enum(["existing", "customized_existing", "original"]);

export type RegistrationType = z.infer<typeof registrationTypeSchema>;

export const analysisDomainSchema = z.enum(analysisDomainValues);

export const responseChannelSchema = z.enum(responseChannelValues);

export const darkResponseChannelSchema = z.enum(darkResponseChannelValues);

export const valueOrientationSchema = z.enum([
  "evil",
  "immoral",
  "indifferent_to_good",
  "transgressive",
  "self_defined",
  "good",
  "mixed",
]);

export const valueStanceSchema = z.enum(["affirm", "accept", "indifferent", "ambivalent", "reject", "unspecified"]);
