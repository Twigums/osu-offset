import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReplayHeader, parseBeatmap, parseReplayFrames, extractPresses, matchNotes, judgement, judgementWindows, stats, md5, effectiveOd } from '../src/analysis.js';

const exampleMap=`osu file format v14
[General]
Mode: 3
[Metadata]
Title: Synthetic map
Artist: Test
Version: 4K
[Difficulty]
CircleSize:4
OverallDifficulty:7.5
[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1010,1,0,0:0:0:0:
320,192,2000,128,0,2800:0:0:0:0:
`;

function makeReplay(){
  const chunks=[];
  const byte=n=>chunks.push(n&255);
  const short=n=>{byte(n);byte(n>>8)};
  const int=n=>{for(let i=0;i<4;i++)byte(n>>(8*i))};
  const long=n=>{for(let i=0;i<8;i++)byte(0)};
  const str=s=>{
    const bytes=Buffer.from(s);
    if(!s){byte(0);return;}
    byte(11);byte(bytes.length);chunks.push(...bytes);
  };
  byte(3);int(20260924);str('a'.repeat(32));str('Tester');str('b'.repeat(32));
  for(const v of [2,0,0,1,0,0])short(v);
  int(1234);short(3);byte(0);int(0);str('');long(0);int(4);chunks.push(1,2,3,4);
  return Uint8Array.from(chunks).buffer;
}

test('binary header decoding',()=>{
  const result=parseReplayHeader(makeReplay());
  assert.equal(result.player,'Tester');assert.equal(result.mode,3);assert.equal(result.countMax,1);
  assert.equal(result.count300,2);assert.equal(result.score,1234);assert.equal(result.compressed.length,4);
});
test('beatmap parser identifies lanes and hold notes',()=>{
  const map=parseBeatmap(exampleMap);
  assert.equal(map.keys,4);assert.equal(map.od,7.5);assert.equal(map.notes.length,3);
  assert.deepEqual(map.notes.map(n=>n.lane),[0,1,2]);
  assert.equal(map.notes[2].end,2800);assert.equal(map.notes[2].hold,true);
});
test('replay frame timestamps include negative deltas and X key bitmap',()=>{
  const input='0|0|0|0,-1|0|0|0,996|1|0|0,5|0|0|0,10|2|0|0,10|0|0|0,974|4|0|0,30|0|0|0,-12345|0|0|12,';
  const frames=parseReplayFrames(input);
  const presses=extractPresses(frames,4);
  assert.deepEqual(presses,[{time:995,lane:0},{time:1010,lane:1},{time:1994,lane:2}]);
});
test('lane matcher produces expected offsets and stable windows',()=>{
  const map=parseBeatmap(exampleMap);
  const presses=[{time:995,lane:0},{time:1010,lane:1},{time:1994,lane:2}];
  const result=matchNotes(map,presses);
  assert.deepEqual(result.matched.map(h=>h.offset),[-5,0,-6]);
  assert.deepEqual(result.matched.map(h=>h.judgement),['MAX','MAX','MAX']);
  assert.equal(result.missing.length,0);
  assert.deepEqual(judgementWindows(7.5),{max:16,'300':41.5,'200':74.5,'100':104.5,'50':128.5});
  assert.equal(judgement(35,judgementWindows(7.5)),'300');
  assert.equal(judgement(60,judgementWindows(7.5)),'200');
  assert.equal(judgement(98,judgementWindows(7.5)),'100');
  assert.equal(judgement(120,judgementWindows(7.5)),'50');
  assert.equal(effectiveOd(7.5,16),10);
});
test('summary stats and MD5 verification',()=>{
  const s=stats([-10,0,10,20]);
  assert.equal(s.mean,5);assert.equal(s.median,5);
  assert.equal(s.early,1);assert.equal(s.late,2);assert.equal(s.exact,1);
  const src=Buffer.from('hello');
  assert.equal(md5(src.buffer.slice(src.byteOffset,src.byteOffset+src.byteLength)),'5d41402abc4b2a76b9719d911017c592');
});
