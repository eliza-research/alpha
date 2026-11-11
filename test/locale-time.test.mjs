import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const L = await import('../apps/app/src/prototype/locale-time.ts');
const afternoon = new Date(2026, 9, 7, 15, 4); // Wednesday 7 October 2026, 15:04 local

test('en-GB uses the device 24-hour cycle, day-first dates and English names', () => {
  L.setLocalePreferences({locale: 'en-GB', hourCycle: 'h23'});
  assert.equal(L.formatTime(afternoon), '15:04');
  assert.equal(L.formatClock(afternoon), '15:04');
  assert.equal(L.formatHours(14.5), '14:30');
  assert.equal(L.formatHours(9, {compact: true}), '09');
  assert.equal(L.formatShortDate(afternoon), 'Wed 7 Oct');
  assert.equal(L.formatMonthDay(afternoon), '7 Oct');
  assert.equal(L.WEEKDAYS[afternoon.getDay()], 'Wednesday');
  assert.equal(L.MONTHS[9], 'October');
  assert.deepEqual(L.localePreferences(), {locale: 'en-GB', hourCycle: 'h23'});
});
test('en-GB with the 12-hour device setting keeps the locale and switches only the hour cycle', () => {
  L.setLocalePreferences({locale: 'en-GB', hourCycle: 'h12'});
  assert.match(L.formatTime(afternoon), /^3:04 pm$/i);
  assert.equal(L.formatClock(afternoon), '3:04');
});
test('de-DE renders German names and 24-hour times, and the live name tables follow', () => {
  L.setLocalePreferences({locale: 'de-DE'});
  assert.equal(L.formatTime(afternoon), '15:04');
  assert.equal(L.formatClock(afternoon), '15:04');
  assert.equal(L.weekdayName(afternoon), 'Mittwoch');
  assert.equal(L.formatShortDate(afternoon), 'Mi., 7. Okt.');
  assert.equal(L.formatMonthTitle(afternoon), 'Oktober');
  assert.equal(L.WEEKDAYS[0], 'Sonntag');
  assert.equal(L.MONTHS[2], 'März');
  assert.equal(L.formatHours(18), '18:00');
});
test('en-US day periods use plain spaces and invalid preferences fall back to the runtime default', () => {
  L.setLocalePreferences({locale: 'en-US'});
  assert.equal(L.formatTime(afternoon), '3:04 PM');
  assert.equal(L.formatHours(24, {compact: true}), '12 AM');
  assert.equal(L.formatHours(9.999), '10:00 AM');
  L.setLocalePreferences({locale: 'not a locale!', hourCycle: 'h99'});
  assert.equal(typeof L.formatTime(afternoon), 'string');
  assert.ok(['h12', 'h23'].includes(L.localePreferences().hourCycle));
  L.setLocalePreferences({});
});
test('time ranges share a trailing day period only when both ends have the same one', () => {
  L.setLocalePreferences({locale: 'en-US'});
  assert.equal(L.formatHoursRange(15, 16), '3:00 – 4:00 PM');
  assert.equal(L.formatHoursRange(11, 13), '11:00 AM – 1:00 PM');
  L.setLocalePreferences({locale: 'en-GB', hourCycle: 'h23'});
  assert.equal(L.formatHoursRange(15, 16), '15:00 – 16:00');
  assert.equal(L.formatHoursRange(9.5, 10), `${L.formatHours(9.5)} – 10:00`);
  assert.doesNotMatch(L.formatHoursRange(9.5, 10), /^\d+ –/, 'never truncates a 24-hour start time');
  L.setLocalePreferences({locale: 'de-DE'});
  assert.equal(L.formatHoursRange(15, 16.5), '15:00 – 16:30');
  L.setLocalePreferences({});
});
test('formatDateTime keeps the date and follows the device hour cycle without seconds', () => {
  L.setLocalePreferences({locale: 'en-US', hourCycle: 'h23'});
  assert.equal(L.formatDateTime(afternoon), 'Oct 7, 2026, 15:04');
  L.setLocalePreferences({locale: 'en-US', hourCycle: 'h12'});
  assert.equal(L.formatDateTime(afternoon), 'Oct 7, 2026, 3:04 PM');
  L.setLocalePreferences({locale: 'en-GB', hourCycle: 'h12'});
  assert.match(L.formatDateTime(afternoon), /^7 Oct 2026,? 3:04 pm$/i);
  L.setLocalePreferences({});
});
test('model.js has no hard-coded weekday, month or 12-hour clock code paths', () => {
  const model = readFileSync(new URL('../apps/app/src/prototype/model.js', import.meta.url), 'utf8');
  assert.doesNotMatch(model, /\["Sunday", "Monday"/);
  assert.doesNotMatch(model, /\["January", "February"/);
  assert.doesNotMatch(model, /% 12 \|\| 12/);
  assert.doesNotMatch(model, /\? " AM" : " PM"|"PM" : "AM"|"AM" : "PM"/);
  assert.doesNotMatch(model, /(?:DAYS|MONS)\[[^\]]+\]\.slice\(0, 3\)/);
  assert.doesNotMatch(model, /\.slice\(-2\) === [a-z]+\.slice\(-2\)/, 'no AM/PM suffix slicing');
});

test('full message dates retain seconds and follow the device hour cycle', () => {
  assert.equal(L.formatFullDateTime(new Date('')), 'Date unavailable');
  L.setLocalePreferences({locale: 'en-US', hourCycle: 'h23'});
  assert.match(L.formatFullDateTime(afternoon), /Wednesday, October 7, 2026/);
  assert.match(L.formatFullDateTime(afternoon), /15:04:00/);
  L.setLocalePreferences({locale: 'en-US', hourCycle: 'h12'});
  assert.match(L.formatFullDateTime(afternoon), /3:04:00 PM/);
  L.setLocalePreferences({});
});

test('cached formatters follow a changed device zone and retain the chosen hour cycle',()=>{
  const previous=process.env.TZ;
  try{
    L.setLocalePreferences({locale:'en-US',hourCycle:'h23'});
    const instant=new Date('2026-11-11T18:00:00Z');
    process.env.TZ='America/Los_Angeles';assert.equal(L.formatTime(instant),'10:00');
    process.env.TZ='America/New_York';assert.equal(L.formatTime(instant),'13:00');
    assert.match(L.formatDateTime(instant,'de-DE'),/13:00/);
  }finally{
    if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;
    L.setLocalePreferences({});
  }
});
