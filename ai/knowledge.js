'use strict';
const normalize=s=>String(s).toLowerCase().normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'');
const stop=new Set('من في على الى الي ما هو هي هذا هذه عن مع هل ان او و the a an is are of to in and for'.split(' '));
const tokens=s=>[...new Set(normalize(s).match(/[\p{L}\p{N}]{2,}/gu)||[])].filter(x=>!stop.has(x));
function chunks(source){const text=source.content;const out=[];for(let start=0,i=1;start<text.length;start+=1400,i++)out.push({id:source.id+':'+i,source_id:source.id,title:source.title,section:i,text:text.slice(start,start+1700)});return out}
function retrieve(sources,question,mode){const words=tokens(question);const rows=sources.flatMap(chunks).map((c,index)=>({...c,score:words.reduce((sum,w)=>sum+(normalize(c.text).includes(w)?1:0)+(normalize(c.title).includes(w)?2:0),0),index}));
 const ranked=rows.filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
 if(!ranked.length&&['summary','practice','generate'].includes(mode)){// Representative excerpts, not an implied full-document summary.
 const seen=new Set();for(const c of rows){if(!seen.has(c.source_id)){ranked.push(c);seen.add(c.source_id)}}
 }return ranked.slice(0,6).map(({score,index,...c})=>c)}
module.exports={retrieve,chunks};
