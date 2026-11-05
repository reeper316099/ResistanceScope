// Loads and validates the shipped data files. Every file goes through its zod schema, because the
// JSON is produced by Python and TypeScript types do not exist at runtime.
import { ManifestSchema, describeZodError } from "../shared/schemas";
import { DATA_BASE_URL, type Loadable, type Manifest } from "../shared/types";

/** Fetches manifest.json and validates it; never throws, always returns "ready" or "error". */
export async function loadManifest(
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = DATA_BASE_URL,
): Promise<Loadable<Manifest>> {
  const file = "manifest.json";
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/${file}`);
  } catch {
    return { status: "error", message: `${file}: could not be read from the app's data folder.` };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `${file}: could not be loaded (HTTP ${String(response.status)}).`,
    };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: "error", message: `${file}: is not valid JSON.` };
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) return { status: "error", message: describeZodError(file, parsed.error) };
  return { status: "ready", data: parsed.data };
}
