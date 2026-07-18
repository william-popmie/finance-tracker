// Deterministic pre-pass over BNP Paribas Fortis descriptors. Pure functions,
// no I/O, safe to import from client components.
//
// Card payments look like (one field per line in the PDF extraction, but the
// same text may arrive whitespace-joined):
//
//   Betaling met debetkaart
//   Nummer 4871 04XX XXXX 7886
//   IKEA ZAVENTEM-FOOD
//   ZAVENTEM
//   18-02-2026 [HH:MM]
//   Visa Debit / Bancontact
//   Contactloos
//   Bankreferentie : 2602191412393769

export type BnpParse = {
  merchantCandidate: string | null; // e.g. "IKEA ZAVENTEM-FOOD"
  bankReference: string | null;
  cleaned: string | null; // short display string until AI provides a better one
};

const CARD_PREFIX = /^(betaling met debetkaart|paiement avec (?:la )?carte de d[ée]bit)/i;
const CARD_NUMBER_LINE = /^(nummer|num[ée]ro)\s+(?:[0-9X]{4}\s+){3}[0-9X]{4}\s*$/i;
const DATE_LINE = /^\d{2}-\d{2}-\d{4}(\s+\d{2}:\d{2})?\s*$/;
// Whitespace-joined fallback: text between the masked card number and the date.
const CARD_INLINE =
  /(?:nummer|num[ée]ro)\s+(?:[0-9X]{4}\s+){3}[0-9X]{4}\s+(.+?)\s+\d{2}-\d{2}-\d{4}/i;
const BANK_REF = /(?:bankreferentie|r[ée]f[ée]rence banque)\s*:?\s*(\S+)/i;

function stripTrailingCity(parts: string[]): string {
  // Merchant descriptors end with an all-caps city token ("... ZAVENTEM").
  // Only strip when something meaningful remains.
  if (parts.length >= 2 && /^[A-ZÀ-Ü' .-]+$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join(" ");
  }
  return parts.join(" ");
}

export function parseBnpDescriptor(raw: string): BnpParse {
  const bankReference = BANK_REF.exec(raw)?.[1] ?? null;

  let merchantCandidate: string | null = null;

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (CARD_PREFIX.test(lines[0] ?? "")) {
    // Line-wise: merchant is the line(s) between "Nummer ..." and the date.
    const numberIdx = lines.findIndex((l) => CARD_NUMBER_LINE.test(l));
    const dateIdx = lines.findIndex((l) => DATE_LINE.test(l));
    if (numberIdx !== -1 && dateIdx > numberIdx + 1) {
      const between = lines.slice(numberIdx + 1, dateIdx);
      // Last line before the date is the city; drop it when more remains.
      const merchant =
        between.length >= 2 ? between.slice(0, -1).join(" ") : between.join(" ");
      merchantCandidate = merchant || null;
    } else {
      // Whitespace-joined variant of the same descriptor.
      const inline = CARD_INLINE.exec(raw.replace(/\s+/g, " "));
      if (inline) merchantCandidate = stripTrailingCity(inline[1].split(" ")) || null;
    }
  }

  return {
    merchantCandidate,
    bankReference,
    cleaned: merchantCandidate,
  };
}
