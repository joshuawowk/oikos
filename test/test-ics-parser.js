import { unfoldLines, unescapeICSText, parseICS, expandRRULE } from '../server/services/ics-parser.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n[ICS-Parser-Test]\n');

test('unfoldLines entfaltet Zeilenfortsetzungen', () => {
  const result = unfoldLines('SUMMARY:Hallo\r\n Welt');
  assert(result === 'SUMMARY:HalloWelt', `got: ${result}`);
});

test('parseICS: einfaches Ganztags-Event', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:test-1@x\r\nSUMMARY:Geburtstag\r\nDTSTART;VALUE=DATE:20260501\r\nDTEND;VALUE=DATE:20260502\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const events = parseICS(ics);
  assert(events.length === 1, `expected 1, got ${events.length}`);
  assert(events[0].uid === 'test-1@x', 'uid');
  assert(events[0].dtstart === '2026-05-01', `dtstart: ${events[0].dtstart}`);
  assert(events[0].dtend   === '2026-05-01', `dtend: ${events[0].dtend}`);
  assert(events[0].allDay  === true, 'allDay');
});

test('parseICS: Event ohne UID wird übersprungen', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Ohne UID\r\nDTSTART:20260601T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert(parseICS(ics).length === 0, 'should skip event without UID');
});

test('parseICS: UTC datetime', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:utc@x\r\nSUMMARY:Meeting\r\nDTSTART:20260615T140000Z\r\nDTEND:20260615T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const [ev] = parseICS(ics);
  assert(ev.dtstart === '2026-06-15T14:00:00Z', `dtstart: ${ev.dtstart}`);
  assert(ev.allDay  === false, 'allDay');
});

test('expandRRULE: WEEKLY 3-Wochen-Fenster', () => {
  const vevent = {
    uid: 'weekly@x', summary: 'Wöchentlich', description: null, location: null,
    dtstart: '2026-04-13', dtend: '2026-04-13', rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO', allDay: true,
  };
  const occ = expandRRULE(vevent, '2026-04-13', '2026-05-04');
  assert(occ.length >= 3, `expected >=3, got ${occ.length}`);
  assert(occ[0].uid === 'weekly@x__2026-04-13', `uid: ${occ[0].uid}`);
  assert(occ[0].rrule === null, 'expanded events have null rrule');
});

test('unescapeICSText: unescapes special sequences', () => {
  assert(unescapeICSText('Main Street\\, London') === 'Main Street, London', 'comma');
  assert(unescapeICSText('Notes\\;Details') === 'Notes;Details', 'semicolon');
  assert(unescapeICSText('Line1\\nLine2') === 'Line1\nLine2', 'newline');
  assert(unescapeICSText('C:\\\\path') === 'C:\\path', 'backslash');
  assert(unescapeICSText(null) === null, 'null passthrough');
});

test('parseICS: unescape text fields', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:esc@x\r\nSUMMARY:Dinner\\, Party\r\nLOCATION:Main St\\, City\r\nDTSTART:20260615T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const [ev] = parseICS(ics);
  assert(ev.summary === 'Dinner, Party', `summary: ${ev.summary}`);
  assert(ev.location === 'Main St, City', `location: ${ev.location}`);
});

test('expandRRULE: null rrule → leeres Array', () => {
  const v = { uid: 'x', summary: 'x', description: null, location: null,
              dtstart: '2026-04-20', dtend: null, rrule: null, allDay: true };
  assert(expandRRULE(v, '2026-01-01', '2026-12-31').length === 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
