#!/usr/bin/env node
// Throwaway asar reader for DSH research.
// asar format: 4-byte UInt32LE header-size pickle, then 4 bytes (header string size),
// then 4 bytes (json size), then a JSON directory. File offsets in the JSON are
// relative to the start of the data section = 16 + headerSize.
//
// Usage:
//   node asar-read.mjs list [<prefix>]            # list entries under prefix
//   node asar-read.mjs find <regex>               # list entries matching regex
//   node asar-read.mjs cat <path> [path2 ...]     # print file contents to stdout
//   node asar-read.mjs size <path>                # print size
import fs from 'node:fs'

const ASAR = process.env.ASAR_PATH ||
  'C:\\Users\\l3561\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
// pickle: [uint32 payloadSize=4][uint32 headerPickleLen] then the header pickle
// [uint32 jsonLen][json...]; JSON therefore starts at byte 16.
const headerSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, headerBuf, 0, jsonLen, 16)
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))
const dataStart = 16 + jsonLen

const entries = new Map() // path -> {size, offset, unpacked}
;(function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (value.files) walk(value, p)
    else entries.set(p, { size: value.size, offset: value.offset, unpacked: value.unpacked })
  }
})(header, '')

function read(p) {
  const e = entries.get(p)
  if (!e) return null
  if (e.offset === undefined) return null // directory
  const buf = Buffer.alloc(e.size)
  fs.readSync(fd, buf, 0, e.size, dataStart + Number(e.offset))
  return buf
}

const [, , cmd, ...args] = process.argv
if (cmd === 'list') {
  const prefix = args[0] || ''
  for (const p of [...entries.keys()].sort()) if (p.startsWith(prefix)) console.log(entries.get(p).size + '\t' + p)
} else if (cmd === 'find') {
  const re = new RegExp(args[0])
  for (const p of [...entries.keys()].sort()) if (re.test(p)) console.log(entries.get(p).size + '\t' + p)
} else if (cmd === 'cat') {
  for (const p of args) {
    const buf = read(p)
    if (!buf) { console.error('!! missing: ' + p); continue }
    console.log('===== ' + p + ' (' + buf.length + ' bytes) =====')
    process.stdout.write(buf.toString('utf8'))
    console.log('\n===== end ' + p + ' =====')
  }
} else if (cmd === 'grep') {
  const re = new RegExp(args[0])
  const limit = Number(args[1] || 40)
  let n = 0
  for (const p of [...entries.keys()].sort()) {
    const e = entries.get(p)
    if (e.size > 4_000_000) continue
    let buf
    try { buf = read(p) } catch { continue }
    if (!buf) continue
    const text = buf.toString('utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        console.log(p + ':' + (i + 1) + ': ' + lines[i].slice(0, 300))
        if (++n >= limit) process.exit(0)
      }
    }
  }
  console.error('-- ' + n + ' matches --')
} else {
  console.error('usage: asar-read.mjs list|find|cat|grep ...')
}
