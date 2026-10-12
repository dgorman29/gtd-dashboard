// Packs src/app.dc.html into index.html's __bundler/template block.
//
// index.html is a self-unpacking bundle: React, the dc-runtime and fonts live
// in the __bundler/manifest block and never change. The app itself (markup +
// the Component class) is the template, stored as an escaped JSON string.
//
//   node scripts/bundle.js            src/app.dc.html -> index.html
//   node scripts/bundle.js --extract  index.html -> src/app.dc.html
//
// No dependencies; needs Node 16+.
'use strict';
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var INDEX = path.join(root, 'index.html');
var SRC = path.join(root, 'src', 'app.dc.html');
var OPEN = '<script type="__bundler/template">';

// Same escaping the bundler used: "</" -> "</" so "</script>" inside
// the app can't close the template tag.
function encode(text) {
  return JSON.stringify(text).replace(/<\//g, '<\\u002F');
}
function locate(html) {
  var start = html.indexOf(OPEN);
  if (start < 0) throw new Error('index.html: template block not found');
  var bodyStart = start + OPEN.length;
  var bodyEnd = html.indexOf('</script>', bodyStart);
  var raw = html.slice(bodyStart, bodyEnd);
  var lead = raw.match(/^\s*/)[0];
  var trail = raw.match(/\s*$/)[0];
  return { bodyStart: bodyStart, bodyEnd: bodyEnd, lead: lead, trail: trail, json: raw.trim() };
}

var html = fs.readFileSync(INDEX, 'utf8');
var loc = locate(html);

if (process.argv.indexOf('--extract') >= 0) {
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  fs.writeFileSync(SRC, JSON.parse(loc.json));
  console.log('Wrote ' + path.relative(root, SRC));
} else {
  var src = fs.readFileSync(SRC, 'utf8');
  var out = html.slice(0, loc.bodyStart) + loc.lead + encode(src) + loc.trail + html.slice(loc.bodyEnd);
  fs.writeFileSync(INDEX, out);
  console.log('Packed ' + path.relative(root, SRC) + ' into index.html (' + src.length + ' chars)');
}
