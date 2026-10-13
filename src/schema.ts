import { readFileSync } from "node:fs";
import { Ajv2020 as Ajv, type ValidateFunction } from "ajv/dist/2020.js";
import { schemaPath } from "./paths.js";
import { FeedError } from "./types.js";

export interface JsonSchemaDocument {
  $id?: string;
  $defs?: Record<string, unknown>;
  [key: string]: unknown;
}

let cached: JsonSchemaDocument | undefined;
let ajv: Ajv | undefined;
const validators = new Map<string, ValidateFunction>();

export function loadSchemaDocument(): JsonSchemaDocument {
  if (!cached) {
    cached = JSON.parse(readFileSync(schemaPath(), "utf8")) as JsonSchemaDocument;
  }
  return cached;
}

function compiler(): Ajv {
  if (!ajv) {
    const instance = new Ajv({ allErrors: true, strict: false });
    instance.addSchema(loadSchemaDocument());
    ajv = instance;
  }
  return ajv;
}

export function validateDocument(defName: string, value: unknown): void {
  let validate = validators.get(defName);
  if (!validate) {
    const schema = loadSchemaDocument();
    const id = schema.$id;
    if (!id) throw new Error("Schema document is missing $id.");
    const compiled = compiler().getSchema(`${id}#/$defs/${defName}`);
    if (!compiled) throw new Error(`Schema definition ${defName} was not found.`);
    validate = compiled;
    validators.set(defName, compiled);
  }
  if (!validate(value)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
      .join("; ");
    throw new FeedError("malformed", `Normalized ${defName} failed schema v1: ${detail}`);
  }
}
