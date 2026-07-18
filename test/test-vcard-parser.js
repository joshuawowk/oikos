/**
 * test-vcard-parser.js - Parser fuer vCard-Import (public/utils/vcard.js)
 * Zweck: Split in Einzelkarten + Feldextraktion (inkl. Geburtstag), insb.
 *        Multi-Kontakt-Dateien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitVCards, parseVCard, parseVCards, parseBirthdayValue,
} from '../public/utils/vcard.js';

const CARD = (fn, tel) =>
  `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${fn}\r\nTEL:${tel}\r\nEND:VCARD`;

test('splitVCards trennt mehrere Karten', () => {
  const text = `${CARD('Ada Lovelace', '111')}\r\n${CARD('Alan Turing', '222')}`;
  const parts = splitVCards(text);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /Ada Lovelace/);
  assert.match(parts[1], /Alan Turing/);
});

test('splitVCards ohne BEGIN/END behandelt Gesamttext als eine Karte', () => {
  assert.deepEqual(splitVCards('FN:Solo'), ['FN:Solo']);
  assert.deepEqual(splitVCards('   '), []);
});

test('parseVCards liefert einen Kontakt pro Karte mit distinkten Feldern', () => {
  const text = `${CARD('Ada Lovelace', '111')}\r\n${CARD('Alan Turing', '222')}`;
  const list = parseVCards(text);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Ada Lovelace');
  assert.equal(list[0].phone, '111');
  assert.equal(list[1].name, 'Alan Turing');
  assert.equal(list[1].phone, '222');
});

test('parseVCard extrahiert FN, TEL, EMAIL, ADR, NOTE', () => {
  const text = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Grace Hopper',
    'TEL;TYPE=CELL:555-9', 'EMAIL:grace@navy.mil',
    'ADR;TYPE=HOME:;;123 Cobol St;Arlington;VA;22201;USA',
    'NOTE:Erfinderin', 'END:VCARD',
  ].join('\r\n');
  const c = parseVCard(text);
  assert.equal(c.name, 'Grace Hopper');
  assert.equal(c.phone, '555-9');
  assert.equal(c.email, 'grace@navy.mil');
  assert.equal(c.address, '123 Cobol St, Arlington, VA, 22201, USA');
  assert.equal(c.notes, 'Erfinderin');
});

test('parseVCard faellt bei fehlendem FN auf N zurueck, sonst name=null', () => {
  const withN = 'BEGIN:VCARD\r\nN:Doe;Jane;;;\r\nEND:VCARD';
  assert.equal(parseVCard(withN).name, 'Doe');
  const noName = 'BEGIN:VCARD\r\nTEL:1\r\nEND:VCARD';
  assert.equal(parseVCard(noName).name, null);
});

test('parseVCard entfaltet gefaltete Zeilen (RFC 6350)', () => {
  const folded = 'BEGIN:VCARD\r\nNOTE:Zeile eins\r\n  und zwei\r\nEND:VCARD';
  assert.equal(parseVCard(folded).notes, 'Zeile eins und zwei');
});

test('parseVCard nutzt resolveCategory, sonst fallbackCategory', () => {
  const text = 'BEGIN:VCARD\r\nFN:X\r\nCATEGORIES:Friends\r\nEND:VCARD';
  const resolved = parseVCard(text, {
    resolveCategory: (raw) => (raw.toLowerCase().includes('friends') ? 'friends' : null),
    fallbackCategory: 'misc',
  });
  assert.equal(resolved.category, 'friends');
  const fallback = parseVCard('BEGIN:VCARD\r\nFN:Y\r\nEND:VCARD', { fallbackCategory: 'misc' });
  assert.equal(fallback.category, 'misc');
});

test('parseBirthdayValue normalisiert diverse Formate auf ISO', () => {
  assert.equal(parseBirthdayValue('1990-07-18'), '1990-07-18');
  assert.equal(parseBirthdayValue('19900718'), '1990-07-18');
  assert.equal(parseBirthdayValue('1990'), '1990-01-01');
  // Zeitanteil wird nicht unterstuetzt (identisch zu CardDAV parseBirthday):
  // die Bereinigung laesst "1990-07-1800000000" -> kein Muster -> null.
  assert.equal(parseBirthdayValue('1990-07-18T00:00:00Z'), null);
  assert.equal(parseBirthdayValue('--0718'), null); // jahrlos: bewusst nicht unterstuetzt (wie CardDAV)
  assert.equal(parseBirthdayValue(''), null);
  assert.equal(parseBirthdayValue(null), null);
});

test('parseVCard extrahiert BDAY nach birthday (ISO)', () => {
  const iso = parseVCard('BEGIN:VCARD\r\nFN:B\r\nBDAY:1985-03-09\r\nEND:VCARD');
  assert.equal(iso.birthday, '1985-03-09');
  const compact = parseVCard('BEGIN:VCARD\r\nFN:B\r\nBDAY;VALUE=DATE:19850309\r\nEND:VCARD');
  assert.equal(compact.birthday, '1985-03-09');
  const none = parseVCard('BEGIN:VCARD\r\nFN:B\r\nEND:VCARD');
  assert.equal(none.birthday, null);
});

test('parseVCards traegt Geburtstag pro Karte separat', () => {
  const text = [
    'BEGIN:VCARD\r\nFN:Erste\r\nBDAY:2000-01-02\r\nEND:VCARD',
    'BEGIN:VCARD\r\nFN:Zweite\r\nEND:VCARD',
  ].join('\r\n');
  const list = parseVCards(text);
  assert.equal(list[0].birthday, '2000-01-02');
  assert.equal(list[1].birthday, null);
});
