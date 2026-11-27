/** Below this the transaction will likely revert on normal price moves. */
export const LOW_SLIPPAGE_BPS = 5;
/** Above this a bot can sandwich the transaction for a lot of what you allow. */
export const HIGH_SLIPPAGE_BPS = 500;
/** Anything above this is refused. */
export const MAX_SLIPPAGE_BPS = 5000;

export type SlippageWarning = "low" | "high";

/** "0.5%" from 50. */
export function formatSlippage(bps: number, locale?: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bps / 100)}%`;
}

/** Warning for a slippage setting, if any. */
export function slippageWarning(bps: number): SlippageWarning | undefined {
  if (bps < LOW_SLIPPAGE_BPS) {
    return "low";
  }
  if (bps > HIGH_SLIPPAGE_BPS) {
    return "high";
  }
  return undefined;
}

/** What a warning tells the person. */
export const slippageWarningText: Record<SlippageWarning, string> = {
  low: "Your transaction may fail if the price moves.",
  high: "High slippage: a bot could trade ahead of you and take the difference.",
};

/** A typed custom percent, read by `parseSlippageInput`. */
export type SlippageInput = { text?: string; bps?: number };

/**
 * Read a typed custom percent. `text` is undefined when the keystroke should
 * be refused (more than two digits either side of the point); `bps` is set
 * when the text is a usable setting, above 0 and at most 50%.
 */
export function parseSlippageInput(raw: string): SlippageInput {
  const text = raw.replace(",", ".");
  if (!/^\d{0,2}(\.\d{0,2})?$/.test(text)) {
    return {};
  }
  const bps = Math.round(Number(text) * 100);
  return {
    text,
    bps: text && Number.isFinite(bps) && bps > 0 && bps <= MAX_SLIPPAGE_BPS ? bps : undefined,
  };
}
