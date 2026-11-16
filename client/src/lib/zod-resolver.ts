/**
 * react-hook-form resolver for zod 4 schemas, typed the way
 * @hookform/resolvers 3.x typed it: `Resolver<z.output<S>>`. Forms in this app
 * declare `useForm<z.infer<typeof schema>>`, so their field values are the
 * parsed (output) type even when the schema coerces or defaults. Runtime
 * behaviour is the upstream resolver's (submitted values are the parsed data).
 */
import { zodResolver as upstreamZodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";
import { localizeFieldErrors, zodErrorMap } from "./validation-messages";

export function zodResolver<S extends z.ZodType<FieldValues, unknown>>(
  schema: S
): Resolver<z.output<S>> {
  // F11: default issues are localised per parse (Arabic only; English keeps the shared defaults)
  // and catalog-key messages written in the schemas are resolved to the active language.
  const inner = upstreamZodResolver(
    schema as unknown as Parameters<typeof upstreamZodResolver>[0],
    { error: zodErrorMap } as never
  ) as unknown as Resolver<z.output<S>>;
  return (async (values, context, options) => {
    const result = await inner(values, context, options);
    if (result.errors) localizeFieldErrors(result.errors);
    return result;
  }) as Resolver<z.output<S>>;
}
