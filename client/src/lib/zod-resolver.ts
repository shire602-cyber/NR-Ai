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

export function zodResolver<S extends z.ZodType<FieldValues, unknown>>(
  schema: S
): Resolver<z.output<S>> {
  return upstreamZodResolver(
    schema as unknown as Parameters<typeof upstreamZodResolver>[0]
  ) as unknown as Resolver<z.output<S>>;
}
