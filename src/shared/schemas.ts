// Zod schemas: the single source of truth for every JSON file we load and every IPC message we accept.
// TypeScript types are derived from these (see types.ts), because types vanish at runtime and the
// shipped JSON is produced by a different language (Python).
import { z } from "zod";

/** A non-negative whole number (isolate counts, byte sizes). */
const count = z.number().int().nonnegative();
const nonEmpty = z.string().min(1);

/** One data source listed in the manifest (name, where from, which version, which licence). */
export const SourceSchema = z.object({
  name: nonEmpty,
  url: nonEmpty,
  version: nonEmpty,
  accessedAt: nonEmpty,
  license: nonEmpty,
  citation: nonEmpty,
});

/** manifest.json: what data this build contains, where it came from, and file checksums. */
export const ManifestSchema = z.object({
  dataVersion: nonEmpty,
  builtAt: z.iso.datetime(),
  sources: z.array(SourceSchema).min(1),
  counts: z.object({
    organisms: count,
    genes: count,
    drugClasses: count,
    isolates: count,
  }),
  thresholds: z
    .object({ minCellN: count, lowConfidenceN: count })
    .refine((t) => t.minCellN <= t.lowConfidenceN, {
      message: "minCellN must not be larger than lowConfidenceN",
    }),
  files: z
    .array(
      z.object({
        path: nonEmpty,
        bytes: count,
        sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters"),
      }),
    )
    .min(1),
});

// ---- IPC messages (renderer -> main). The main process re-validates every one of these. ----

/** Characters allowed in a suggested file name: no path separators, so it cannot escape a folder. */
const safeFileName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w .()-]+$/, "file name may only contain letters, digits, space and . _ ( ) -");

/** saveFile request: either CSV text or a base64-encoded PNG, plus a suggested file name. */
export const SaveFileRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("csv"),
    suggestedName: safeFileName.endsWith(".csv"),
    text: z.string().max(20_000_000),
  }),
  z.object({
    kind: z.literal("png"),
    suggestedName: safeFileName.endsWith(".png"),
    dataBase64: z
      .string()
      .max(40_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64"),
  }),
]);

/** openExternal request: one URL string; main decides whether it is allowed. */
export const OpenExternalRequestSchema = z.object({ url: z.string().min(1).max(2048) });

/** Builds a readable message that names the file and the field that failed validation. */
export function describeZodError(fileName: string, error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return `${fileName}: invalid data`;
  const field = first.path.length > 0 ? first.path.join(".") : "(top level)";
  const extra =
    error.issues.length > 1 ? ` (+${String(error.issues.length - 1)} more problems)` : "";
  return `${fileName}: field "${field}": ${first.message}${extra}`;
}
