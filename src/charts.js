const NS='http://www.w3.org/2000/svg';
const palette={early:'#82b7f9',late:'#f5a574',axis:'#74829b',grid:'#25334a',text:'#94a2b7',green:'#98eacb'};
const element=(tag,props={},text)=>{
  const e=document.createElementNS(NS,tag);
  for (const [k,v] of Object.entries(props)) e.setAttribute(k,String(v));
  if (text!==undefined) e.textContent=String(text);
  return e;
};
const add=(parent,tag,props,text)=>{const e=element(tag,props,text);parent.append(e);return e;};
const fmt=(v)=>v>0?`+${v}`:String(v);
function baseChart(svg, title){
  svg.replaceChildren();svg.setAttribute('viewBox','0 0 960 328');svg.setAttribute('role','img');
  svg.setAttribute('aria-label',title);
  add(svg,'title',{},title);
}
function noData(svg){add(svg,'text',{x:480,y:167,'text-anchor':'middle',fill:palette.text,'font-size':15},'No hits in this selection');}

export function histogram(svg,hits,windows,binSize=4){
  baseChart(svg,'Histogram of signed hit offsets in milliseconds');
  const {left,right,top,bottom}={left:56,right:936,top:24,bottom:279};
  const span=Math.max(140, Math.ceil(windows['50']/20)*20);
  const x=offset=>left+(offset+span)/(2*span)*(right-left);
  const binsCount=Math.ceil((2*span)/binSize);
  const bins=new Array(binsCount).fill(0);
  for(const h of hits){const i=Math.floor((h.offset+span)/binSize);if(i>=0&&i<binsCount)bins[i]++;}
  const peak=Math.max(1,...bins);
  const maxY=Math.ceil(peak/10)*10||10;
  const y=count=>bottom-count/maxY*(bottom-top);
  const bands=[['50', '#342e3b'],['100','#342e37'],['200','#32343c'],['300','#263b4d'],['max','#23453f']];
  for(const [name,color] of bands){const bound=windows[name];add(svg,'rect',{x:x(-bound),y:top,width:x(bound)-x(-bound),height:bottom-top,fill:color,opacity:0.64});}
  const yStep=Math.max(1,Math.ceil(maxY/5));
  for(let count=0;count<=maxY;count+=yStep){
    const yy=y(count);add(svg,'line',{x1:left,y1:yy,x2:right,y2:yy,stroke:palette.grid,'stroke-width':1});
    add(svg,'text',{x:left-14,y:yy+4,fill:palette.text,'font-size':12,'text-anchor':'end'},count);
  }
  if(!hits.length)noData(svg);
  for(let i=0;i<binsCount;i++){
    if(!bins[i])continue;
    const lo=-span+i*binSize,center=lo+binSize/2;
    const bar=add(svg,'rect',{x:x(lo)+0.5,y:y(bins[i]),width:Math.max(1,x(lo+binSize)-x(lo)-1),height:bottom-y(bins[i]),fill:center<0?palette.early:palette.late,rx:1.6,opacity:.96});
    add(bar,'title',{},`${fmt(lo)} to ${fmt(lo+binSize)} ms: ${bins[i]} hits`);
  }
  for(const [name,bound] of Object.entries(windows)){
    if(name==='50')continue;
    for(const sign of [-1,1])add(svg,'line',{x1:x(sign*bound),y1:top,x2:x(sign*bound),y2:bottom,stroke:'#708295','stroke-dasharray':'3 6','stroke-width':1,opacity:.65});
  }
  add(svg,'line',{x1:x(0),y1:top,x2:x(0),y2:bottom,stroke:'#f0f3ff','stroke-width':1.5,opacity:.9});
  for(let tick=-span;tick<=span;tick+=20){
    add(svg,'text',{x:x(tick),y:bottom+24,'text-anchor':'middle','font-size':12,fill:tick===0?'#f0f3ff':palette.text},fmt(tick));
  }
  add(svg,'text',{x:left,y:321,fill:palette.early,'font-size':12,'font-weight':'600'},'EARLY  <');
  add(svg,'text',{x:(left+right)/2,y:321,fill:palette.text,'font-size':12,'text-anchor':'middle'},'Offset from note start (ms)');
  add(svg,'text',{x:right,y:321,fill:palette.late,'font-size':12,'font-weight':'600','text-anchor':'end'},'>  LATE');
}

export function timeline(svg,hits,windows,endTime){
  baseChart(svg,'Timeline of hit offsets over the course of the beatmap');
  const left=56,right=936,top=24,bottom=278;
  const span=Math.max(140, Math.ceil(windows['50']/20)*20);
  const duration=Math.max(1000,endTime);
  const x=t=>left+t/duration*(right-left);
  const y=off=>bottom-(off+span)/(2*span)*(bottom-top);
  const maxBound=windows['50'];
  add(svg,'rect',{x:left,y:y(maxBound),width:right-left,height:y(-maxBound)-y(maxBound),fill:'#1c313c',opacity:.44});
  for(let tick=-span;tick<=span;tick+=40){
    const yy=y(tick);
    add(svg,'line',{x1:left,y1:yy,x2:right,y2:yy,stroke:tick===0?'#e4eaff':palette.grid,'stroke-width':tick===0?1.4:1,opacity:tick===0?.8:1});
    add(svg,'text',{x:left-12,y:yy+4,fill:palette.text,'text-anchor':'end','font-size':12},fmt(tick));
  }
  const timeStep=duration<=40000?5000:duration<=160000?20000:duration<=400000?60000:120000;
  for(let t=0;t<=duration;t+=timeStep){
    const xx=x(t);add(svg,'line',{x1:xx,y1:top,x2:xx,y2:bottom,stroke:palette.grid});
    const seconds=Math.round(t/1000);const display=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    add(svg,'text',{x:xx,y:bottom+23,fill:palette.text,'font-size':12,'text-anchor':'middle'},display);
  }
  if(!hits.length)noData(svg);
  for(const h of hits){
    const dot=add(svg,'circle',{cx:x(h.note.time),cy:y(h.offset),r:2.25,fill:h.offset<0?palette.early:palette.late,opacity:.55});
    add(dot,'title',{},`Lane ${h.note.lane+1} | note ${(h.note.time/1000).toFixed(2)} s | offset ${fmt(h.offset)} ms`);
  }
  if(hits.length>=12){
    const ordered=[...hits].sort((a,b)=>a.note.time-b.note.time);
    const points=[];
    const half=Math.min(25,Math.floor(ordered.length/8));
    const step=Math.max(4,Math.floor(ordered.length/65));
    for(let i=0;i<ordered.length;i+=step){
      const window=ordered.slice(Math.max(0,i-half),Math.min(ordered.length,i+half+1));
      const vals=window.map(v=>v.offset).sort((a,b)=>a-b);
      const median=vals[Math.floor(vals.length/2)];
      points.push(`${x(ordered[i].note.time).toFixed(1)},${y(median).toFixed(1)}`);
    }
    add(svg,'polyline',{points:points.join(' '),fill:'none',stroke:palette.green,'stroke-width':2.6,opacity:.95,'stroke-linecap':'round','stroke-linejoin':'round'});
  }
  add(svg,'text',{x:left,y:321,fill:palette.text,'font-size':12},'Song time');
  add(svg,'text',{x:right,y:321,fill:palette.green,'font-size':12,'text-anchor':'end'},'Rolling median (green)');
}

export function saveSvg(svg,filename){
  const copy=svg.cloneNode(true);
  copy.setAttribute('xmlns',NS);
  copy.setAttribute('width','1200');copy.setAttribute('height','410');
  copy.setAttribute('style','background:#121c2b;font-family:system-ui,sans-serif');
  const blob=new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
