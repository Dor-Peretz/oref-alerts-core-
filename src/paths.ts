import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory that contains package.json, whether running from src/ or dist/. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate package.json from the module path.");
}

export function schemaPath(): string {
  return join(packageRoot(), "schema", "v1.schema.json");
}

export function areasPath(): string {
  return join(packageRoot(), "data", "areas.json");
}
