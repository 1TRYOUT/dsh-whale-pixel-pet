/**
 * 读 WebP 尺寸（不依赖任何库）：VP8 / VP8L / VP8X 三种头都解。
 * 用途：给插画立绘算缩放与居中偏移。
 * 用法：node tools/webp-size.mjs <目录或文件...>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function u24le(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }

export function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const p = off + 8;
    if (fourcc === 'VP8X') {
      return { w: u24le(buf, p + 4) + 1, h: u24le(buf, p + 7) + 1, kind: 'VP8X' };
    }
    if (fourcc === 'VP8 ') {
      // 帧头：3 字节 tag，然后 9d 01 2a 起始码
      if (buf[p + 3] === 0x9d && buf[p + 4] === 0x01 && buf[p + 5] === 0x2a) {
        return {
          w: (buf[p + 6] | (buf[p + 7] << 8)) & 0x3fff,
          h: (buf[p + 8] | (buf[p + 9] << 8)) & 0x3fff,
          kind: 'VP8'
        };
      }
      return null;
    }
    if (fourcc === 'VP8L') {
      const bits = buf.readUInt32LE(p + 1);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, kind: 'VP8L' };
    }
    off = p + size + (size % 2);
  }
  return null;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('用法: node tools/webp-size.mjs <目录或文件...>');
  process.exit(0);
}

const files = [];
for (const a of args) {
  const st = statSync(a);
  if (st.isDirectory()) {
    for (const f of readdirSync(a)) if (f.endsWith('.webp')) files.push(path.join(a, f));
  } else files.push(a);
}

const rows = [];
for (const f of files.sort()) {
  const s = webpSize(readFileSync(f));
  const kb = Math.round(statSync(f).size / 1024);
  rows.push({ name: path.basename(f, '.webp'), w: s ? s.w : '?', h: s ? s.h : '?', kind: s ? s.kind : '?', kb, ratio: s ? +(s.w / s.h).toFixed(2) : '?' });
}
const widest = Math.max(...rows.map((r) => String(r.name).length));
console.log('name'.padEnd(widest) + '   w x h        ratio  kind   KB');
for (const r of rows) {
  console.log(String(r.name).padEnd(widest) + `  ${String(r.w).padStart(4)}x${String(r.h).padEnd(5)} ${String(r.ratio).padStart(5)}  ${r.kind.padEnd(5)} ${String(r.kb).padStart(4)}`);
}
const wset = [...new Set(rows.map((r) => `${r.w}x${r.h}`))];
console.log('\n出现的尺寸种类: ' + wset.join(', '));
