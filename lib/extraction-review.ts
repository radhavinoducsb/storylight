import {isQuestionText} from './ocr-quality';
export type Box={x:number;y:number;w:number;h:number};
export type OCRPage={engine:'tesseract';language:'eng'|'tam+eng'|'chi_sim+eng'|'msa+eng'|'eng+tam+chi_sim'|'eng+tam+chi_sim+msa';readerVersion?:number;failureReason?:string;width:number;height:number;regions:{id:string;text:string;box:Box;words:{text:string;score:number}[];visual:boolean}[]};
export type TextReviewRegion={id:string;text:string;originalText:string;box?:Box;score:number|null;confidence:'high'|'medium'|'low'|'unknown';acceptedBy?:'human'|'automatic';acceptedAt?:string;kind:'text'|'question'|'diagram';words?:{text:string;score:number}[];reviewReason?:string;matcherVersion?:number;};
const exact=(s:string)=>s.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/gu,' ').trim();
const tokens=(s:string)=>new Set(s.replace(/[\u200B-\u200D\uFEFF]/g,'').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)||[]);
function overlap(a:string,b:string){const x=tokens(a),y=tokens(b);return x.size+y.size?[...x].filter(w=>y.has(w)).length*2/(x.size+y.size):0;}
export const REVIEW_MATCHER_VERSION=2;
function unionBoxes(boxes:Box[]):Box|undefined{if(!boxes.length)return;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return{x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
// Match corresponding content across line wrapping, retaining every saved line and ID.
// Only whitespace and invisible formatting are ignored; wording, signs and digits must match.
export function reviewTranscript(text:string,ocr:OCRPage|null):TextReviewRegion[]{
 if(ocr?.failureReason)ocr=null;
 const lines=text.split(/\n+/).filter(x=>x.trim()),normalized=lines.map(exact),whole=normalized.join(' '),starts:number[]=[];let offset=0;
 for(const line of normalized){starts.push(offset);offset+=line.length+1;}
 const spans:{start:number;end:number;region:OCRPage['regions'][number]}[]=[];
 for(const region of ocr?.regions||[]){if(region.visual)continue;const needle=exact(region.text);if(!needle)continue;let from=0,index=-1;
  while((index=whole.indexOf(needle,from))>=0){const end=index+needle.length,boundaries=(index===0||whole[index-1]===' ')&&(end===whole.length||whole[end]===' '),occupied=spans.some(s=>index<s.end&&end>s.start);if(boundaries&&!occupied){spans.push({start:index,end,region});break;}from=index+1;}
 }
 const exactUsed=new Set(spans.map(s=>s.region.id)),fallbackUsed=new Set<string>();
 return lines.map((line,i)=>{const start=starts[i],end=start+normalized[i].length,matched=spans.filter(s=>s.start<end&&s.end>start).sort((a,b)=>a.start-b.start);let cursor=start,complete=true;
  for(const span of matched){if(span.start>cursor&&whole.slice(cursor,span.start).trim())complete=false;cursor=Math.max(cursor,span.end);}if(cursor<end)complete=false;
  let evidence=complete&&matched.length?matched.map(s=>s.region):[];let differs=false;
  if(!evidence.length){let best:OCRPage['regions'][number]|undefined,similarity=0;for(const r of ocr?.regions||[]){if(r.visual||exactUsed.has(r.id)||fallbackUsed.has(r.id))continue;const n=overlap(line,r.text);if(n>similarity){best=r;similarity=n;}}if(best&&similarity>=.5){evidence=[best];fallbackUsed.add(best.id);differs=true;}}
  const words=evidence.flatMap(r=>r.words),values=words.map(w=>w.score),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,minimum=values.length?Math.min(...values):0;
  const confidence=mean===null?'unknown':differs?'low':mean>=95&&minimum>=90?'high':mean>=80&&minimum>=60?'medium':'low';
  const reviewReason=mean===null?'Confidence check unavailable for this text.':differs?'The two readings differ. Compare this wording with the original.':confidence!=='high'?'Some words were read uncertainly. Compare this part with the original.':undefined;
  return{id:`text-${i}`,text:line,originalText:line,box:unionBoxes(evidence.map(r=>r.box)),words,score:mean===null?null:Math.round(mean*10)/10,confidence,kind:isQuestionText(line)?'question':'text',reviewReason,matcherVersion:REVIEW_MATCHER_VERSION};
 });
}
// The transcript remains authoritative if old retry records and positions disagree.
export function regionsForSavedText(text:string,previous:TextReviewRegion[]=[]){
 if(exact(text)===exact(previous.map(r=>r.text).join('\n')))return previous;
 return preserveTextReviews(reviewTranscript(text,null),previous);
}
export function duplicateQuestionWarning(text:string){const labels=Array.from(text.matchAll(/(?:^|\n)\s*Q(?:uestion)?\s*(\d{1,3})(?=[.\s:：)])/giu),m=>m[1]);const repeated=[...new Set(labels.filter((x,i)=>labels.indexOf(x)!==i))];return repeated.length?`Repeated question labels (${repeated.map(n=>'Q'+n).join(', ')}). This page may contain duplicate extractions; compare the full page before accepting it.`:'';}
export function acceptHigh(regions:TextReviewRegion[],auto:boolean){return regions.map(r=>auto&&r.confidence==='high'&&!r.acceptedBy?{...r,acceptedBy:'automatic' as const,acceptedAt:new Date().toISOString()}:r);}
export function allTextAccepted(regions?:TextReviewRegion[]){return !!regions?.length&&regions.every(r=>!!r.acceptedBy);}
export function coverageWarnings(text:string,ocr:OCRPage|null){
 if(ocr?.failureReason)return [ocr.failureReason];
 if(!ocr)return ['OCR evidence was unavailable. Check the full page for missing text and question order.'];
 const warnings:string[]=[];
 for(const r of ocr.regions){if(r.visual){warnings.push('A visual area is present. Check its labels and link to the question.');continue;}if(r.text.length<22||/^(?:name|class|date|marks|school)\s*[:：_]/iu.test(r.text.trim()))continue;if(!exact(text).includes(exact(r.text))&&!text.split(/\n+/).some(line=>overlap(line,r.text)>.72)&&overlap(text,r.text)<.4)warnings.push(`Possible omitted text: “${r.text.slice(0,90)}”. Compare with the full page.`);}
 return [...new Set(warnings)].slice(0,12);
}

export function extractionFailure(item:{ocrFailure?:string;ocrReaderVersion?:number;reviewRegions?:TextReviewRegion[]}){
 if(allTextAccepted(item.reviewRegions))return '';
 if(item.ocrFailure)return item.ocrFailure;
 const pending=(item.reviewRegions||[]).filter(r=>!r.acceptedBy&&r.score!==null);
 if(!item.ocrReaderVersion&&pending.length&&pending.reduce((n,r)=>n+r.score!,0)/pending.length<55)return 'The earlier reader could not read this page reliably. Read the saved original again.';
 return '';
}
export function preserveTextReviews(next:TextReviewRegion[],previous:TextReviewRegion[]=[]){
 const used=new Set<number>();
 return next.map(r=>{const index=previous.findIndex((p,i)=>!used.has(i)&&p.text===r.text&&p.acceptedBy==='human');if(index<0)return r;used.add(index);const old=previous[index];return{...r,originalText:old.originalText,acceptedBy:old.acceptedBy,acceptedAt:old.acceptedAt};});
}
export function needsConfidenceRefresh(regions?:TextReviewRegion[]){return !regions?.length||regions.some(r=>!r.acceptedBy&&r.matcherVersion!==REVIEW_MATCHER_VERSION);}
