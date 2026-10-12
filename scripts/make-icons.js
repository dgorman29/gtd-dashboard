// Renders the app icon (the loading-screen logo: a green circle with three
// waves on the sand background) to the PNGs the web app manifest points at.
//
//   node scripts/make-icons.js
//
// No dependencies: a tiny supersampled rasterizer plus a PNG encoder on zlib.
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var BG = [0xf5, 0xea, 0xd8];
var CIRCLE = [0x7a, 0x8a, 0x5e];
var WAVE = BG;

// Geometry in the logo's own 200x200 space (matches the SVG in index.html).
// Each wave is "M74 y q13-11 26 0 t26 0": two quadratic segments.
function waveSegments(y) {
  return [
    [[74, y], [87, y - 11], [100, y]],
    [[100, y], [113, y + 11], [126, y]]
  ];
}
var WAVES = [
  { y: 84, alpha: 0.6 },
  { y: 104, alpha: 1 },
  { y: 124, alpha: 0.6 }
].map(function (w) {
  var pts = [];
  waveSegments(w.y).forEach(function (s, i) {
    for (var k = i ? 1 : 0; k <= 24; k++) {
      var t = k / 24, u = 1 - t;
      pts.push([
        u * u * s[0][0] + 2 * u * t * s[1][0] + t * t * s[2][0],
        u * u * s[0][1] + 2 * u * t * s[1][1] + t * t * s[2][1]
      ]);
    }
  });
  return { pts: pts, alpha: w.alpha };
});

function distToPolyline(x, y, pts) {
  var best = Infinity;
  for (var i = 1; i < pts.length; i++) {
    var ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
    var dx = bx - ax, dy = by - ay;
    var t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    var ex = ax + t * dx - x, ey = ay + t * dy - y;
    best = Math.min(best, ex * ex + ey * ey);
  }
  return Math.sqrt(best);
}

// Color of one sample point in logo space.
function sample(x, y) {
  var c = BG.slice();
  var r = Math.hypot(x - 100, y - 100);
  if (r <= 52) {
    c = CIRCLE.slice();
    WAVES.forEach(function (w) {
      if (distToPolyline(x, y, w.pts) <= 3.5) {
        for (var i = 0; i < 3; i++) c[i] = c[i] * (1 - w.alpha) + WAVE[i] * w.alpha;
      }
    });
  }
  return c;
}

function render(size) {
  var SS = 4, px = Buffer.alloc(size * size * 3);
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var acc = [0, 0, 0];
      for (var sy = 0; sy < SS; sy++) {
        for (var sx = 0; sx < SS; sx++) {
          var c = sample((x + (sx + 0.5) / SS) * 200 / size, (y + (sy + 0.5) / SS) * 200 / size);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      var o = (y * size + x) * 3;
      for (var i = 0; i < 3; i++) px[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  return px;
}

var CRC = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  var raw = Buffer.alloc(size * (size * 3 + 1));
  for (var y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// The circle sits well inside the maskable safe zone, so one image serves
// both the "any" and "maskable" purposes.
var out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
[192, 512].forEach(function (size) {
  var name = 'icon-' + size + '.png';
  fs.writeFileSync(path.join(out, name), png(size, render(size)));
  console.log('Wrote icons/' + name);
});
