/**
 * The server process always runs in UTC.
 *
 * Most timestamp columns are `timestamp without time zone` (the schema's convention), and node-pg
 * reads them in the PROCESS time zone. Started with TZ=Asia/Dubai, every trial end and every
 * "chosen at" read 4 hours off. Dates shown to people are formatted explicitly (Asia/Dubai) where
 * a calendar date matters, so the process zone never needs to be anything but UTC.
 *
 * Imported first by server/index.ts (a side-effect import, after dotenv). Setting process.env.TZ
 * at runtime makes Node re-read the zone, so it also holds when the host sets another TZ.
 */
const SERVER_TIME_ZONE = "UTC";

/** Pins the process zone; returns the zone the host had asked for (null when it set none). */
function pinServerTimeZone(): string | null {
  const requested = process.env.TZ ?? null;
  process.env.TZ = SERVER_TIME_ZONE;
  return requested;
}

pinServerTimeZone();
