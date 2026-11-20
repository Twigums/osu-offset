import {parseReplayHeader,decompressReplay,parseReplayFrames,parseBeatmap,extractPresses,matchNotes,stats,md5} from './analysis.js';
import {histogram,timeline,saveSvg} from './charts.js';

const $=id=>document.getElementById(id);
const elements={replay:$('replay-input'),beatmap:$('beatmap-input'),status:$('status'),run:$('analyze-button'),results:$('results')};
const selected={replay:null,beatmap:null};
let analysis=null;
let lane='all', type='all';
const count=n=>n.toLocaleString('en-US');
const signed=(x,d=1)=>Number.isFinite(x)?`${x>0?'+':''}${x.toFixed(d)} ms`:'--';
const percent=v=>Number.isFinite(v)?`${v.toFixed(1)}%`:'--';

function setStatus(message,error=false){
  elements.status.classList.toggle('error',error);
  elements.status.lastChild.textContent=message;
}
function setFile(kind,file){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith(kind==='replay'?'.osr':'.osu')){
    setStatus(`Expected a ${kind==='replay'?'.osr':'.osu'} file.`,true);return;
  }
  selected[kind]=file;
  analysis=null;elements.results.classList.add('hidden');
  $(kind==='replay'?'replay-description':'beatmap-description').textContent=file.name;
  $(kind==='replay'?'replay-dropzone':'beatmap-dropzone').classList.add('file-loaded');
  elements.run.disabled=!(selected.replay&&selected.beatmap);
  setStatus(elements.run.disabled?'Select the other file to continue.':'Ready. Analyze whenever you are.');
}
for(const [kind,input] of [['replay',elements.replay],['beatmap',elements.beatmap]]){
  input.addEventListener('change',()=>setFile(kind,input.files?.[0]));
  const zone=$(kind==='replay'?'replay-dropzone':'beatmap-dropzone');
  zone.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}
  });
  for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.add('drag-over');});
  for(const name of ['dragleave','drop'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('drag-over');});
  zone.addEventListener('drop',e=>{
    const file=e.dataTransfer?.files?.[0];if(file)setFile(kind,file);
  });
}

function text(id,value){$(id).textContent=value;}
function labelNode(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=value;return el;}
function addNotice(message){$('notices').append(labelNode('div','notice',message));}
function modNames(mods){
  const known=[[1,'NF'],[2,'EZ'],[8,'HD'],[16,'HR'],[32,'SD'],[64,'DT'],[256,'HT'],[512,'NC'],[1024,'FL'],[16384,'PF'],[536870912,'SV2']];
  const names=known.filter(([bit])=>(mods&bit)!==0).map(([,name])=>name);
  return names.length?names.join(' '):'NM';
}
function laneButtons(){
  const parent=$('lane-filters');parent.replaceChildren();
  for(const value of ['all',...Array.from({length:analysis.map.keys},(_,i)=>String(i))]){
    const button=labelNode('button',value===lane?'active':'',value==='all'?'All lanes':`K${Number(value)+1}`);
    button.type='button';button.setAttribute('aria-pressed',String(value===lane));
    button.addEventListener('click',()=>{lane=value;laneButtons();renderFiltered();});
    parent.append(button);
  }
}
function filtered(){return analysis.matches.matched.filter(h=> (lane==='all'||h.note.lane===Number(lane)) && (type==='all'||(type==='hold' ? h.note.hold : !h.note.hold)));}
function renderFiltered(){
  const hits=filtered(),s=stats(hits.map(h=>h.offset));
  text('stat-mean',signed(s.mean));text('stat-median',signed(s.median));
  text('stat-std',Number.isFinite(s.std)?`${s.std.toFixed(1)} ms`:'--');
  text('stat-hits',count(s.count));
  text('mean-context',s.mean>1?'Average: late':s.mean< -1?'Average: early':'Average: centered');
  text('matched-context',`${Math.round(s.count/analysis.map.notes.length*100)}% of map note starts`);
  histogram($('histogram'),hits,analysis.matches.windows,Number($('bin-select').value));
  timeline($('timeline'),hits,analysis.matches.windows,analysis.map.notes[analysis.map.notes.length-1].time);
  text('early-percent',percent(s.earlyPct));text('late-percent',percent(s.latePct));
  text('early-count',`${count(s.early)} hits`);text('late-count',`${count(s.late)} hits`);
  $('early-bar').style.width=`${s.earlyPct}%`;
  $('late-bar').style.width=`${s.latePct}%`;
  $('exact-bar').style.width=`${s.count?s.exact/s.count*100:0}%`;
  text('exact-count',`${count(s.exact)} exactly on time (0 ms). ${count(analysis.matches.missing.length)} beatmap note starts unmatched across all lanes.`);
  renderLaneTable(hits);
}
function renderLaneTable(hits){
  const tbody=$('lane-tbody');tbody.replaceChildren();
  for(let k=0;k<analysis.map.keys;k++){
    const offsets=hits.filter(h=>h.note.lane===k).map(h=>h.offset);const s=stats(offsets);
    const tr=document.createElement('tr');
    const values=[`K${k+1}`,count(s.count),signed(s.mean),signed(s.std),percent(s.latePct)];
    values.forEach(v=>tr.append(labelNode('td','',v)));tbody.append(tr);
  }
}
function renderWindows(){
  const parent=$('judgement-guide');parent.replaceChildren();
  for(const label of ['max','300','200','100','50']){
    const bound=analysis.matches.windows[label];
    const chip=document.createElement('span');chip.className='cutoff-chip';
    chip.append(labelNode('b','',label==='max'?'MAX':label));
    chip.append(document.createTextNode(`  +/-${bound.toFixed(bound%1?1:0)} ms`));
    parent.append(chip);
  }
}
function renderOfficial(){
  const parent=$('judgements-grid');parent.replaceChildren();
  const h=analysis.header;
  for(const [label,value] of [['MAX',h.countMax],['300',h.count300],['200',h.count200],['100',h.count100],['50',h.count50],['MISS',h.misses]]){
    const tile=labelNode('div','judgement-tile','');
    tile.append(labelNode('span','',label),labelNode('strong','',count(value)));parent.append(tile);
  }
  text('replay-meta',`Score ${count(h.score)}  /  Max combo ${count(h.combo)}  /  Mods ${modNames(h.mods)}  /  Client version ${h.version}`);
}
function renderResult(){
  const {map,header,matches,digest,presses}=analysis;
  text('map-title',`${map.artist} - ${map.title} [${map.difficulty}]`);
  text('map-detail',`${map.keys}K  /  OD ${map.od}  /  ${count(map.notes.length)} notes  /  ${count(map.notes.filter(n=>n.hold).length)} holds  /  ${header.player||'Anonymous'}`);
  text('map-kicker','MATCHED MAP AND REPLAY');
  const matchedFile=digest.toLowerCase()===header.beatmapMd5.toLowerCase();
  const badge=$('map-auth');badge.classList.toggle('mismatch',!matchedFile);
  badge.textContent=matchedFile?'CHECKSUM VERIFIED':'MAP HASH MISMATCH';
  $('notices').replaceChildren();
  if(!matchedFile)addNotice('The replay and beatmap MD5 hashes do not match. These hit offsets are unreliable; select the exact difficulty used for this replay.');
  if(matches.matched.length/map.notes.length<.65)addNotice('Fewer than 65% of note starts were matched. Check that you selected the exact beatmap and that the replay has a supported key layout.');
  if(matches.simplified)addNotice('A very large lane used simplified matching to avoid excessive browser memory use. A few ambiguous notes may be assigned differently.');
  if(map.ignored)addNotice(`${map.ignored} non-mania or unrecognized hit objects were excluded.`);
  if(header.mods&(64|256|512))addNotice('This replay has DT/NC/HT. Note timestamps are interpreted in beatmap time; timing may be incorrect for replay formats that store real-time rather than beatmap-time events.');
  if(header.mods&(536870912))addNotice('ScoreV2 may score hold heads and tails separately; this report only analyzes note starts.');
  renderWindows();renderOfficial();lane='all';type='all';
  document.querySelectorAll('[data-type]').forEach(button=>button.classList.toggle('switch-active',button.dataset.type==='all'));
  laneButtons();renderFiltered();
  elements.results.classList.remove('hidden');
  elements.results.scrollIntoView({behavior:'smooth',block:'start'});
}

async function analyze(){
  if(!selected.replay||!selected.beatmap)return;
  elements.run.disabled=true;elements.run.textContent='Analyzing...';
  setStatus('Reading files and decoding your replay...');
  try{
    // Release UI before CPU-intensive parsing.
    await new Promise(resolve=>setTimeout(resolve,30));
    const [osr,osu]=await Promise.all([selected.replay.arrayBuffer(),selected.beatmap.arrayBuffer()]);
    if(osu.byteLength>40_000_000)throw new Error('The .osu file is too large (max 40 MB).');
    const header=parseReplayHeader(osr);
    const map=parseBeatmap(new TextDecoder('utf-8').decode(osu));
    const digest=md5(osu);
    const replayText=await decompressReplay(header.compressed);
    const frames=parseReplayFrames(replayText);
    const presses=extractPresses(frames,map.keys);
    const matches=matchNotes(map,presses,header.mods);
    analysis={header,map,digest,matches,presses};
    renderResult();
    setStatus(`Analyzed ${count(matches.matched.length)} matched hits. Files remained on your device.`);
  }catch(error){console.error(error);setStatus(error?.message||'Could not analyze these files.',true);}
  finally{elements.run.disabled=false;elements.run.replaceChildren(document.createTextNode('Analyze replay '),labelNode('span','',String.fromCodePoint(8594)));}
}
elements.run.addEventListener('click',analyze);
$('bin-select').addEventListener('change',()=>{if(analysis)renderFiltered();});
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{
  type=button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('switch-active',b===button));
  if(analysis)renderFiltered();
}));
function downloadText(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
$('csv-button').addEventListener('click',()=>{
  if(!analysis)return;
  const rows=[['note_time_ms','keypress_time_ms','lane','offset_ms','note_type','estimated_head_window'],
    ...filtered().map(h=>[h.note.time,h.press.time,h.note.lane+1,h.offset,h.note.hold?'hold':'tap',h.judgement])];
  const csv=rows.map(row=>row.map(c=>`"${String(c).replaceAll('"','""')}"`).join(',')).join('\r\n');
  downloadText('mania-hit-offsets.csv',csv,'text/csv;charset=utf-8');
});
$('svg-button').addEventListener('click',()=>{if(analysis)saveSvg($('histogram'),'mania-hit-distribution.svg');});
