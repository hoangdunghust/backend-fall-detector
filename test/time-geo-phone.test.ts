import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceTsToDate, effectiveAgeS, formatAgeVi } from '../src/common/time.util';
import { isUsableFix, toGpsFields } from '../src/common/geo.util';
import { maskPhone, normalizePhone } from '../src/common/phone.util';

test('ts_ms=0 hoặc vô lý => null; giá trị hợp lý => Date', () => {
  assert.equal(deviceTsToDate(0), null);
  assert.equal(deviceTsToDate(null), null);
  assert.equal(deviceTsToDate(NaN), null);
  assert.equal(deviceTsToDate(1000), null);
  assert.equal(deviceTsToDate(Date.UTC(2200, 0, 1)), null);
  assert.equal(deviceTsToDate(1788962000000)?.toISOString(), '2026-09-09T13:53:20.000Z');
});

test('effectiveAgeS cộng thời gian đã trôi qua', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-01-01T00:03:00Z');
  assert.equal(effectiveAgeS(5, at, now), 185);
  assert.equal(effectiveAgeS(null, at, now), null);
  assert.equal(effectiveAgeS(5, now, at), 5); // đồng hồ lệch không âm
});

test('formatAgeVi', () => {
  assert.equal(formatAgeVi(5), '5 giây');
  assert.equal(formatAgeVi(60), '1 phút');
  assert.equal(formatAgeVi(7200), '2 giờ');
  assert.equal(formatAgeVi(172800), '2 ngày');
  assert.equal(formatAgeVi(-3), '0 giây');
});

test('(0,0) là "chưa từng có fix", không phải vị trí', () => {
  assert.equal(isUsableFix(0, 0), false);
  assert.equal(isUsableFix(21.0285, 105.8048), true);
  assert.equal(isUsableFix(91, 0), false);
  assert.equal(isUsableFix(0, 181), false);
  assert.equal(isUsableFix(NaN, 1), false);
  assert.equal(isUsableFix(0, 105.8), true); // trên xích đạo vẫn hợp lệ
});

test('toGpsFields', () => {
  assert.deepEqual(toGpsFields(undefined), { lat: null, lon: null, gpsValid: false, gpsAgeS: null });
  assert.deepEqual(toGpsFields({ valid: false, lat: 0, lon: 0 }), { lat: null, lon: null, gpsValid: false, gpsAgeS: null });
  assert.deepEqual(toGpsFields({ valid: true, lat: 21.1, lon: 105.2, ageS: 4 }), {
    lat: 21.1,
    lon: 105.2,
    gpsValid: true,
    gpsAgeS: 4,
  });
});

test('normalizePhone khớp quy tắc firmware', () => {
  assert.equal(normalizePhone('+84901234567'), '+84901234567');
  assert.equal(normalizePhone(' +84 901-234.567 '), '+84901234567');
  assert.equal(normalizePhone('(+84) 901 234 567'), '+84901234567');
  assert.equal(normalizePhone('0901234567'), '0901234567');
  assert.equal(normalizePhone('12345'), null); // < 6 chữ số
  assert.equal(normalizePhone('+1234567890123456'), null); // > 15 chữ số
  assert.equal(normalizePhone('09012a4567'), null);
  assert.equal(normalizePhone('+84"\r\nAT+CMGF=1'), null); // chống chèn lệnh AT
  assert.equal(normalizePhone('84+901234567'), null);
  assert.equal(normalizePhone(12345678), null);
});

test('maskPhone', () => {
  assert.equal(maskPhone('+84901234567'), '********4567');
  assert.equal(maskPhone('123'), '****');
});
