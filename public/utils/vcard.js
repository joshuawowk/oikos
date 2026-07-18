/**
 * Modul: vCard-Parser (public/utils/vcard.js)
 * Zweck: Reine, DOM-freie Extraktion von Kontaktdaten aus vCard-3.0/4.0-Text.
 *        Unterstuetzt Dateien mit mehreren Kontakten (Multi-Card) und das
 *        Geburtsdatum (BDAY -> contacts.birthday, ISO YYYY-MM-DD).
 * Abhaengigkeiten: keine (bewusst import-frei -> direkt in Node testbar).
 */

/** Entpackt vCard-Escapes (\n \, \; \\). */
function unescapeVCard(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * Normalisiert einen vCard-BDAY-Wert auf ISO YYYY-MM-DD.
 * Spiegelt server/services/cardav-sync.js#parseBirthday (Layer-Boundary
 * verbietet den direkten Import von Server-Code im Frontend). Verhalten muss
 * mit dem CardDAV-Sync identisch bleiben, damit contacts.birthday einheitlich
 * ist und der #518-Geburtstags-Import beide Quellen gleich behandelt.
 * @param {string} value - Roher BDAY-Wert (z. B. "1990-01-01", "19900101", "1990")
 * @returns {string|null} ISO-Datum oder null, wenn nicht verwertbar
 */
export function parseBirthdayValue(value) {
  if (!value) return null;

  // Alle Zeichen ausser Ziffern und Bindestrich entfernen (TZ-Suffixe etc.)
  const cleaned = String(value).replace(/[^\d-]/g, '');

  // ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // Kompakt (YYYYMMDD)
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }

  // Nur Jahr
  if (/^\d{4}$/.test(cleaned)) return `${cleaned}-01-01`;

  return null;
}

/**
 * Zerlegt einen vCard-Text in einzelne BEGIN:VCARD..END:VCARD-Bloecke.
 * Ohne Markup wird der Gesamttext als eine Karte behandelt.
 * @param {string} text
 * @returns {string[]}
 */
export function splitVCards(text) {
  const src = String(text || '');
  const matches = src.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi);
  if (matches && matches.length) return matches;
  return src.trim() ? [src] : [];
}

/**
 * Parst eine einzelne vCard.
 * @param {string} text - Eine vCard (ein BEGIN..END-Block).
 * @param {{ resolveCategory?: (rawCategories: string) => (string|null), fallbackCategory?: string }} [opts]
 * @returns {{ name: string|null, phone: string|null, email: string|null,
 *             address: string|null, notes: string|null, birthday: string|null,
 *             category: string }}
 */
export function parseVCard(text, opts = {}) {
  const { resolveCategory, fallbackCategory = 'misc' } = opts;

  // Zeilenfortsetzungen entfalten (RFC 6350 3.2)
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '');

  const get = (prop) => {
    const re = new RegExp(`^${prop}(?:;[^:]*)?:(.*)$`, 'im');
    const m = re.exec(unfolded);
    return m ? unescapeVCard(m[1].trim()) : null;
  };

  const name = get('FN') || get('N')?.split(';')[0] || null;
  const phone = get('TEL') || null;
  const email = get('EMAIL') || null;

  // ADR: ;;street;city;region;postal;country
  const adrRaw = get('ADR');
  let address = null;
  if (adrRaw) {
    const parts = adrRaw.split(';').map((p) => p.trim()).filter(Boolean);
    address = parts.join(', ') || null;
  }

  const notes = get('NOTE') || null;
  const birthday = parseBirthdayValue(get('BDAY'));
  const catRaw = get('CATEGORIES') || '';
  const category = (resolveCategory && resolveCategory(catRaw)) || fallbackCategory;

  return { name, phone, email, address, notes, birthday, category };
}

/**
 * Parst alle Kontakte einer (moeglicherweise mehrfachen) vCard-Datei.
 * @param {string} text
 * @param {Parameters<typeof parseVCard>[1]} [opts]
 * @returns {ReturnType<typeof parseVCard>[]}
 */
export function parseVCards(text, opts = {}) {
  return splitVCards(text).map((card) => parseVCard(card, opts));
}
