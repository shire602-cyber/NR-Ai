/**
 * zod 4 global error messages, kept identical to the zod 3 English defaults
 * this app shipped with (R17-27). API validation responses (`fields`,
 * `errors`, `formErrors`) and form errors show these strings, and clients and
 * tests match on them ("Required", "Invalid uuid", "String must contain at
 * least 1 character(s)", ...). Messages passed to a schema (`.min(1, "...")`,
 * `{ error }`) still win: zod 4 consults this map only when the schema did not
 * set one.
 *
 * Importing this module installs the map (idempotent). It is imported first by
 * the server entry, the client entry, the shared validators and the test
 * setup files.
 */
import { z } from "zod";

type RawIssue = z.core.$ZodRawIssue;

/** zod 3's ZodParsedType for an input value. */
function parsedType(input: unknown): string {
  switch (typeof input) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(input) ? "nan" : "number";
    case "boolean":
    case "function":
    case "bigint":
    case "symbol":
      return typeof input;
    case "object":
      if (input === null) return "null";
      if (Array.isArray(input)) return "array";
      if (
        typeof (input as { then?: unknown }).then === "function" &&
        typeof (input as { catch?: unknown }).catch === "function"
      )
        return "promise";
      if (input instanceof Map) return "map";
      if (input instanceof Set) return "set";
      if (input instanceof Date) return "date";
      return "object";
    default:
      return "unknown";
  }
}

/** zod 4 `expected` names that zod 3 spelled differently. */
const EXPECTED_V3: Record<string, string> = { record: "object", tuple: "array" };

const FORMAT_V3: Record<string, string> = { guid: "uuid" };

/** Issue codes that made a zod 3 parse abort (status INVALID, not "dirty"). */
const ABORTING_CODES = new Set<string>(["invalid_type", "invalid_value", "invalid_union"]);

function quoteOption(v: unknown): string {
  return typeof v === "string" ? `'${v}'` : String(v);
}

function dateOf(v: unknown): Date {
  return new Date(Number(v));
}

export function zodV3Message(iss: RawIssue): string | undefined {
  switch (iss.code) {
    case "invalid_type": {
      if (iss.input === undefined) return "Required";
      if (iss.expected === "int") return "Expected integer, received float";
      if (iss.expected === "date" && iss.input instanceof Date) return "Invalid date";
      if (iss.expected === "number" && typeof iss.input === "number" && !Number.isNaN(iss.input))
        return "Number must be finite";
      const expected = EXPECTED_V3[iss.expected] ?? iss.expected;
      return `Expected ${expected}, received ${parsedType(iss.input)}`;
    }
    case "invalid_value": {
      const isLiteral = iss.inst instanceof z.ZodLiteral;
      if (isLiteral && iss.values.length === 1)
        return `Invalid literal value, expected ${JSON.stringify(iss.values[0])}`;
      const options = iss.values.map(quoteOption).join(" | ");
      // zod 3 type-checked string enums first: a non-string was invalid_type.
      if (typeof iss.input !== "string" && iss.values.every((v) => typeof v === "string"))
        return iss.input === undefined
          ? "Required"
          : `Expected ${options}, received ${parsedType(iss.input)}`;
      return `Invalid enum value. Expected ${options}, received '${String(iss.input)}'`;
    }
    case "invalid_format": {
      switch (iss.format) {
        case "regex":
          return "Invalid";
        case "starts_with":
          return `Invalid input: must start with "${(iss as { prefix?: string }).prefix}"`;
        case "ends_with":
          return `Invalid input: must end with "${(iss as { suffix?: string }).suffix}"`;
        case "includes":
          return `Invalid input: must include "${(iss as { includes?: string }).includes}"`;
        default:
          return `Invalid ${FORMAT_V3[iss.format] ?? iss.format}`;
      }
    }
    case "too_small": {
      const { minimum, inclusive, exact, origin } = iss;
      if (origin === "array")
        return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${minimum} element(s)`;
      if (origin === "string")
        return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${minimum} character(s)`;
      if (origin === "number" || origin === "int" || origin === "bigint")
        return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${minimum}`;
      if (origin === "date")
        return `Date must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${dateOf(minimum)}`;
      return "Invalid input";
    }
    case "too_big": {
      const { maximum, inclusive, exact, origin } = iss;
      if (origin === "array")
        return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${maximum} element(s)`;
      if (origin === "string")
        return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${maximum} character(s)`;
      if (origin === "number" || origin === "int" || origin === "bigint")
        return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
      if (origin === "date")
        return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${dateOf(maximum)}`;
      return "Invalid input";
    }
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${iss.keys.map((k) => `'${k}'`).join(", ")}`;
    case "invalid_union": {
      const union = iss as { note?: string; options?: unknown[]; errors?: RawIssue[][] };
      if (union.note === "No matching discriminator" && Array.isArray(union.options))
        return `Invalid discriminator value. Expected ${union.options.map((o) => `'${String(o)}'`).join(" | ")}`;
      // zod 3 reported the first option that failed only on checks (refine,
      // length, format) rather than on its type, e.g. "TRN must be numeric".
      const dirty = union.errors?.find(
        (list) => list.length > 0 && list.every((i) => !ABORTING_CODES.has(i.code))
      );
      return dirty?.[0]?.message ?? "Invalid input";
    }
    case "not_multiple_of":
      return `Number must be a multiple of ${iss.divisor}`;
    case "invalid_key":
    case "invalid_element":
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
}

z.config({ customError: zodV3Message });
