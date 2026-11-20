/** Binary .osr decoding and osu!mania note-start matching; no servers involved. */
const decoder = new TextDecoder('utf-8');

class BinaryReader {
  constructor(buffer) { this.data = new DataView(buffer); this.bytes = new Uint8Array(buffer); this.offset = 0; }
  need(n) { if (this.offset + n > this.data.byteLength) throw new Error('This replay is truncated or invalid.'); }
  u8() { this.need(1); return this.data.getUint8(this.offset++); }
  u16() { this.need(2); const v = this.data.getUint16(this.offset, true); this.offset += 2; return v; }
  u32() { this.need(4); const v = this.data.getUint32(this.offset, true); this.offset += 4; return v; }
  u64() { this.need(8); const v = this.data.getBigUint64(this.offset, true); this.offset += 8; return v; }
  string() {
    const flag = this.u8();
    if (flag === 0) return '';
    if (flag !== 11) throw new Error('Invalid osu! string in the replay header.');
    let size = 0; let shift = 0;
    for (;;) {
      const b = this.u8();
      size |= (b & 127) << shift;
      if (!(b & 128)) break;
      shift += 7;
      if (shift > 28) throw new Error('Invalid replay string length.');
    }
    this.need(size);
    const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + size));
    this.offset += size;
    return value;
  }
}

export function parseReplayHeader(buffer) {
  const r = new BinaryReader(buffer);
  const mode = r.u8();
  const version = r.u32();
  const beatmapMd5 = r.string();
  const player = r.string();
  const replayMd5 = r.string();
  const count300 = r.u16();
  const count100 = r.u16();
  const count50 = r.u16();
  const countMax = r.u16();
  const count200 = r.u16();
  const misses = r.u16();
  const score = r.u32();
  const combo = r.u16();
  const perfectCombo = !!r.u8();
  const mods = r.u32();
  r.string(); // life bar
  r.u64(); // timestamp
  const compressedLength = r.u32();
  if (!compressedLength) throw new Error('This .osr has no replay key events (metadata only).');
  if (compressedLength > 60_000_000) throw new Error('Replay exceeds the supported size limit.');
  r.need(compressedLength);
  const compressed = r.bytes.slice(r.offset, r.offset + compressedLength);
  if (mode !== 3) throw new Error('Only osu!mania replays are supported (mode 3).');
  return {mode, version, beatmapMd5, player, replayMd5, score, combo, perfectCombo,
    mods, countMax, count300, count200, count100, count50, misses, compressed};
}

/** LZMA-JS returns a string for UTF-8 input, otherwise a byte sequence. */
export function decompressReplay(compressed, decompress = globalThis.LZMA?.decompress) {
  if (!decompress) return Promise.reject(new Error('LZMA decoder failed to load. Check your connection and reload the page.'));
  return new Promise((resolve, reject) => {
    try {
      decompress(compressed, (output, error) => {
        if (error || output == null) { reject(new Error('Could not decompress replay events: ' + (error || 'unknown LZMA error'))); return; }
        if (typeof output === 'string') resolve(output);
        else resolve(decoder.decode(Uint8Array.from(output)));
      });
    } catch (error) { reject(error); }
  });
}

export function parseReplayFrames(text) {
  let time = 0;
  const frames = [];
  for (const entry of text.split(',')) {
    if (!entry) continue;
    const parts = entry.split('|');
    if (parts.length < 4) continue;
    const delta = Number(parts[0]);
    const keys = Number(parts[1]); // mania key bitmask is encoded in replay X, not Z
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || !Number.isFinite(keys) || delta === -12345) continue;
    time += delta;
    frames.push({time, keys: keys >>> 0});
  }
  if (!frames.length) throw new Error('No usable key frames were found in the replay.');
  return frames;
}

export function parseBeatmap(text) {
  const sections = Object.create(null);
  let section = '';
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('//')) continue;
    if (/^\[[^\]]+\]$/.test(value)) { section = value.slice(1, -1); sections[section] ??= []; continue; }
    if (section) sections[section].push(value);
  }
  function kv(sectionName) {
    const obj = Object.create(null);
    for (const line of sections[sectionName] || []) {
      const at = line.indexOf(':');
      if (at >= 0) obj[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return obj;
  }
  const general = kv('General');
  const difficulty = kv('Difficulty');
  const metadata = kv('Metadata');
  if (general.Mode != null && Number(general.Mode) !== 3) throw new Error('The .osu file is not an osu!mania beatmap.');
  const keys = Number(difficulty.CircleSize);
  const od = Number(difficulty.OverallDifficulty);
  if (!Number.isInteger(keys) || keys < 1 || keys > 18) throw new Error('Invalid mania key count in the .osu file.');
  if (!Number.isFinite(od) || od < 0 || od > 10) throw new Error('Invalid overall difficulty in the .osu file.');
  const notes = [];
  let ignored = 0;
  for (const line of sections.HitObjects || []) {
    const fields = line.split(',');
    if (fields.length < 5) continue;
    const x = Number(fields[0]); const start = Number(fields[2]); const type = Number(fields[3]);
    if (![x,start,type].every(Number.isFinite)) { ignored++; continue; }
    const hold = !!(type & 128);
    if (!(type & 1) && !hold) { ignored++; continue; }
    const lane = Math.max(0, Math.min(keys - 1, Math.floor(x * keys / 512)));
    const end = hold ? Number((fields[5] || '').split(':')[0]) : start;
    notes.push({time: start, lane, hold, end: Number.isFinite(end) ? end : start});
  }
  if (!notes.length) throw new Error('No supported mania note starts found in this beatmap.');
  notes.sort((a,b) => a.time - b.time || a.lane - b.lane);
  return { keys, od, notes, ignored, artist: metadata.Artist || 'Unknown artist',
    title: metadata.Title || 'Untitled', difficulty: metadata.Version || 'Unknown',
    creator: metadata.Creator || '', mode: Number(general.Mode ?? 3)};
}

export function extractPresses(frames, keys) {
  const presses = [];
  let previous = 0;
  const mask = (1 << keys) - 1;
  for (const frame of frames) {
    const current = frame.keys & mask;
    const downs = (current & ~previous) >>> 0;
    for (let lane=0; lane<keys; lane++) if ((downs >>> lane) & 1) presses.push({time: frame.time, lane});
    previous = current;
  }
  return presses;
}

export function judgementWindows(od) {
  return {max: 16, '300': 64 - 3*od, '200': 97 - 3*od,
    '100': 127 - 3*od, '50': 151 - 3*od};
}
export function judgement(offset, windows) {
  const diff = Math.abs(offset);
  for (const label of ['max','300','200','100','50']) if (diff <= windows[label]) return label === 'max' ? 'MAX' : label;
  return 'Outside';
}
export function effectiveOd(od, mods) {
  if (mods & 2) return od / 2; // Easy
  if (mods & 16) return Math.min(10, od * 1.4); // Hard Rock
  return od;
}

function greedyMatch(notes, presses, window) {
  const matched = [], missing = [], extra = [];
  let i = 0, j = 0;
  while (i < notes.length && j < presses.length) {
    const delta = presses[j].time - notes[i].time;
    if (delta < -window) extra.push(presses[j++]);
    else if (delta > window) missing.push(notes[i++]);
    else { matched.push({note: notes[i++], press: presses[j++], offset: delta}); }
  }
  while (i < notes.length) missing.push(notes[i++]);
  while (j < presses.length) extra.push(presses[j++]);
  return {matched, missing, extra, simplified: true};
}

/** Order-preserving edit-distance matching, separately for each lane.
 *  Stores 1 byte per DP cell for traceback; only two floating-point cost rows. */
function matchLane(notes, presses, window) {
  const n = notes.length, m = presses.length, skip = 120;
  if (!n || !m || n*m > 12_000_000) return greedyMatch(notes, presses, window);
  const ops = new Uint8Array((n+1)*(m+1));
  for (let i=1;i<=n;i++) ops[i*(m+1)] = 1;
  for (let j=1;j<=m;j++) ops[j] = 2;
  let prev = new Float64Array(m+1), next = new Float64Array(m+1);
  for (let j=1;j<=m;j++) prev[j] = j * skip;
  for (let i=1;i<=n;i++) {
    next[0] = i*skip;
    const t = notes[i-1].time;
    const row = i*(m+1);
    for (let j=1;j<=m;j++) {
      let cost = prev[j] + skip, operation = 1;
      if (next[j-1] + skip < cost) { cost = next[j-1] + skip; operation = 2; }
      const delta = presses[j-1].time-t;
      if (Math.abs(delta) <= window && prev[j-1]+Math.abs(delta) <= cost) {
        cost = prev[j-1] + Math.abs(delta); operation = 0;
      }
      next[j] = cost; ops[row+j] = operation;
    }
    [prev,next] = [next,prev];
  }
  let i=n, j=m;
  const matched=[], missing=[], extra=[];
  while (i || j) {
    const operation = ops[i*(m+1)+j];
    if (i && j && operation === 0) {
      const note = notes[--i]; const press = presses[--j];
      matched.push({note, press, offset: press.time-note.time});
    } else if (i && (!j || operation === 1)) missing.push(notes[--i]);
    else extra.push(presses[--j]);
  }
  return {matched, missing, extra, simplified:false};
}

export function matchNotes(map, presses, mods=0) {
  const od = effectiveOd(map.od, mods);
  const windows = judgementWindows(od);
  const matched=[], missing=[], extra=[];
  let simplified = false;
  for (let lane=0;lane<map.keys;lane++) {
    const ns = map.notes.filter(n=>n.lane===lane);
    const ps = presses.filter(p=>p.lane===lane);
    const result = matchLane(ns, ps, windows['50']);
    matched.push(...result.matched); missing.push(...result.missing); extra.push(...result.extra);
    simplified ||= result.simplified;
  }
  matched.sort((a,b)=>a.note.time-b.note.time || a.note.lane-b.note.lane);
  matched.forEach((hit,i)=> {hit.id=i;hit.judgement=judgement(hit.offset,windows);});
  return {matched, missing, extra, windows, od, simplified};
}

export function stats(values) {
  if (!values.length) return {count:0, mean:NaN, median:NaN, std:NaN, early:0, late:0, exact:0, earlyPct:0, latePct:0};
  const sorted = [...values].sort((a,b)=>a-b), count=values.length;
  const mean = values.reduce((a,b)=>a+b,0)/count;
  const std = Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/count);
  const mid = count >> 1;
  const median = count%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
  const early = values.filter(v=>v<0).length, late=values.filter(v=>v>0).length;
  return {count,mean,median,std,early,late,exact:count-early-late,earlyPct:early/count*100,latePct:late/count*100};
}

/** MD5 is used only to identify the matching .osu file, not for security. */
export function md5(buffer) {
  const source=new Uint8Array(buffer), originalLength=source.length;
  const paddedLength=Math.ceil((originalLength+9)/64)*64;
  const data=new Uint8Array(paddedLength);data.set(source);data[originalLength]=128;
  let length=BigInt(originalLength)*8n;
  for (let i=0;i<8;i++) {data[paddedLength-8+i]=Number(length&255n);length>>=8n;}
  const shifts=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const k=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296));
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476;
  const view=new DataView(data.buffer);
  for (let base=0;base<paddedLength;base+=64) {
    let a=h0,b=h1,c=h2,d=h3;
    for (let i=0;i<64;i++) {
      let f,g;
      if (i<16) {f=(b&c)|((~b)&d);g=i;}
      else if (i<32) {f=(d&b)|((~d)&c);g=(5*i+1)%16;}
      else if (i<48) {f=b^c^d;g=(3*i+5)%16;}
      else {f=c^(b|(~d));g=(7*i)%16;}
      const x=(a+f+k[i]+view.getUint32(base+g*4,true))|0;
      const rotate=(x<<shifts[i])|(x>>>(32-shifts[i]));
      [a,b,c,d]=[d,(b+rotate)|0,b,c];
    }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;
  }
  return [h0,h1,h2,h3].map(h=>[0,8,16,24].map(s=>((h>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
}
