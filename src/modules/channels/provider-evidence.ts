const SYNTHETIC_EVIDENCE_PREFIXES = [
  "wa.success.",
  "wamid.success.",
  "stale-sent-",
  "email.e.",
  "obs-",
  "anchor-msg-",
  "email-lifecycle-msg-",
  "evt_deliv_",
  "evt_bounce_",
  "evt_email.",
] as const;

export type EvidenceSource = "PROVIDER" | "SIMULATED";

export const isSyntheticProviderEvidenceId = (value?: string | null) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return SYNTHETIC_EVIDENCE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
};

export const evidenceSourceFromIds = (
  ...values: Array<string | null | undefined>
): EvidenceSource => {
  return values.some((value) => isSyntheticProviderEvidenceId(value))
    ? "SIMULATED"
    : "PROVIDER";
};

export const normalizeE164Phone = (input?: string | null) => {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutFormatting = trimmed.replace(/[\s\-().]/g, "");
  const asPlus = withoutFormatting.startsWith("00")
    ? `+${withoutFormatting.slice(2)}`
    : withoutFormatting;

  if (!/^\+?[0-9]+$/.test(asPlus)) return null;

  const normalized = asPlus.startsWith("+") ? asPlus : `+${asPlus}`;

  // E.164 allows 8 to 15 digits after + and disallows leading zero country code.
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) return null;

  return normalized;
};

export const maskSensitiveId = (value?: string | null, visible = 4) => {
  if (!value) return null;
  if (value.length <= visible * 2) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
};
