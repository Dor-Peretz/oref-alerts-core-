import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../src/paths.js";

export function fixture(name: string): string {
  return readFileSync(join(packageRoot(), "data", "fixtures", name), "utf8");
}
