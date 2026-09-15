#!/usr/bin/env node
// iOS App Store 아이콘 생성기.
// Apple 은 앱 아이콘에 알파 채널이 있으면 업로드를 거부합니다(ERROR ITMS-90717).
// 따라서 PNG 컬러 타입 2(RGB, 알파 채널 없음)로 직접 인코딩합니다.
// 알파 값을 255 로 채우는 것만으로는 부족하고, 채널 자체가 없어야 합니다.
// 또한 iOS 가 모서리를 자동으로 둥글게 처리하므로 원본은 정사각형(full-bleed)이어야 합니다.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SIZE = 1024;
const SS = 4; // 안티에일리어싱용 서브샘플 격자 (4x4)

// favicon.svg 와 동일한 그라디언트 (viewBox 64 기준을 16배 확대)
const FROM = [0x3b, 0x6e, 0xf6];
const TO = [0x7c, 0x5c, 0xf6];
const SCALE = SIZE / 64;
const BARS = [
  { x: 18 * SCALE, y: 24 * SCALE, w: 28 * SCALE, h: 5.5 * SCALE, r: 2.75 * SCALE },
  { x: 18 * SCALE, y: 34.5 * SCALE, w: 28 * SCALE, h: 5.5 * SCALE, r: 2.75 * SCALE },
];

// 둥근 사각형 내부 판정 (모서리는 원호로 처리)
function insideRoundedRect(px, py, b) {
  if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) return false;
  const cx = Math.min(Math.max(px, b.x + b.r), b.x + b.w - b.r);
  const cy = Math.min(Math.max(py, b.y + b.r), b.y + b.h - b.r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= b.r * b.r;
}

// 픽셀 1개의 흰색 막대 커버리지(0~1)를 서브샘플로 계산합니다.
function barCoverage(x, y) {
  let hits = 0;
  for (let sy = 0; sy < SS; sy += 1) {
    const py = y + (sy + 0.5) / SS;
    for (let sx = 0; sx < SS; sx += 1) {
      const px = x + (sx + 0.5) / SS;
      if (BARS.some((b) => insideRoundedRect(px, py, b))) hits += 1;
    }
  }
  return hits / (SS * SS);
}

// 스캔라인 앞에 필터 바이트(0 = None)를 붙인 RGB 원본 데이터를 만듭니다.
const stride = SIZE * 3;
const raw = Buffer.alloc((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (stride + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    // 대각선 그라디언트: (0,0) -> (SIZE,SIZE) 투영값
    const t = (x + 0.5 + y + 0.5) / (2 * SIZE);
    const cov = barCoverage(x, y);
    const o = rowStart + 1 + x * 3;
    for (let c = 0; c < 3; c += 1) {
      const base = FROM[c] + (TO[c] - FROM[c]) * t;
      // 흰색 막대를 커버리지만큼 합성합니다.
      raw[o + c] = Math.round(base + (255 - base) * cov);
    }
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // 비트 깊이
ihdr[9] = 2; // 컬러 타입 2 = Truecolor(RGB), 알파 채널 없음
ihdr[10] = 0; // 압축 방식
ihdr[11] = 0; // 필터 방식
ihdr[12] = 0; // 인터레이스 없음

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] || 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`[ios-icon] ${out} (${SIZE}x${SIZE}, PNG color type 2, ${png.length} bytes)`);
