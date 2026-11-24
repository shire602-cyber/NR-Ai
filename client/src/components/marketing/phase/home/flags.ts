/**
 * Owner-controlled switches for the marketing homepage. Every flag defaults to the cautious
 * value: nothing here may be turned on without the owner confirming the claim is true.
 */

// TODO(owner): confirm. Shows "Placeholder - real customer quote coming" slots. On in dev builds
// only so marketing can see where real proof goes; always off in production builds.
export const SHOW_PROOF_PLACEHOLDERS: boolean = import.meta.env.DEV === true;

// TODO(owner): confirm. Only enable once data is actually stored in the UAE and the owner has
// signed off on the wording.
export const SHOW_DATA_RESIDENCY = false;

// TODO(owner): confirm. WhatsApp contact in the footer (needs a real number and the
// firm-management boundary in AGENTS.md reviewed before any public WhatsApp UI).
export const SHOW_WHATSAPP = false;

// TODO(owner): confirm. "We help you move, free of charge" on the migration section.
export const FREE_MIGRATION_HELP = false;

// TODO(owner): confirm. Accredited provider fees, if any, must not be described as zero until
// the owner confirms them. Keep false until then.
export const PROVIDER_FEES_CONFIRMED_ZERO = false;
