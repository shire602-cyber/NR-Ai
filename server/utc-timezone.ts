// Pins the process timezone to UTC. Import this first (before dotenv, pg and everything else): node-pg parses DATE
// columns as local midnight, which JSON renders as the previous UTC day on any host whose timezone is not UTC.
process.env.TZ = "UTC";
