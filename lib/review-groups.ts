import type {Box,TextReviewRegion} from './extraction-review';
export type ReviewGroup=TextReviewRegion & {memberIds:string[];label:string};
const question=(s:string)=>s.trim().match(/^(?:Q(?:uestion)?\s*(\d{1,3})[.)：:]?\s*|(\d{1,3})[.)]\s+)(?!\s*$)/iu);
function questionStart(r:TextReviewRegion){return /^Q(?:uestion)?\s*\d{1,3}(?:[.)：:]|\s)/iu.test(r.text.trim())||r.kind==='question'||(!!question(r.text)&&/[?？]|_{2,}|என்ன|ஏன்|எப்படி|எழுது|தேர்ந்தெடு|填空|为什么|选择|回答/iu.test(r.text));}
function union(regions:TextReviewRegion[]):Box|undefined{if(!regions.length||regions.some(r=>!r.box))return;const x=Math.min(...regions.map(r=>r.box!.x)),y=Math.min(...regions.map(r=>r.box!.y)),right=Math.max(...regions.map(r=>r.box!.x+r.box!.w)),bottom=Math.max(...regions.map(r=>r.box!.y+r.box!.h));return{x,y,w:right-x,h:bottom-y};}
// Group the existing records for review. Never rewrite saved source text merely to change layout.
export function groupReviewRegions(regions:TextReviewRegion[]):ReviewGroup[]{
 const groups:TextReviewRegion[][]=[];
 for(const region of regions){const group=groups.at(-1),last=group?.at(-1),q=questionStart(region),currentQuestion=group?.some(questionStart);
 const paragraphEnd=last&&/[.!?。！？]$/.test(last.text.trim())&&last.text.length>70;
 const paragraphGap=last?.box&&region.box&&region.box.y-last.box.y-last.box.h>.025;
 const boundary=!group||q||region.kind==='diagram'||last?.kind==='diagram'||(!currentQuestion&&(paragraphEnd||paragraphGap));
 if(boundary)groups.push([region]);else group.push(region);
 }
 return groups.map((members,index)=>{const first=members[0],q=members.find(questionStart),number=q?.text.match(/^(?:Q(?:uestion)?\s*)?(\d{1,3})/iu)?.[1],accepted=members.every(r=>r.acceptedBy),confidence=members.some(r=>r.confidence==='unknown')?'unknown':members.some(r=>r.confidence==='low')?'low':members.some(r=>r.confidence==='medium')?'medium':'high';return{...first,reviewReason:members.find(r=>!r.acceptedBy&&r.reviewReason)?.reviewReason,id:first.id,memberIds:members.map(r=>r.id),label:q?`Question ${number||index+1}`:first.kind==='diagram'?'Diagram':index===0&&members.every(r=>r.text.length<150)?'Heading and instructions':`Paragraph ${index+1}`,kind:q?'question':first.kind,text:members.map(r=>r.text).join('\n'),originalText:members.map(r=>r.originalText).join('\n'),box:union(members),words:members.flatMap(r=>r.words||[]),confidence,score:members.every(r=>r.score!==null)?Math.min(...members.map(r=>r.score!)):null,acceptedBy:accepted?(members.every(r=>r.acceptedBy==='automatic')?'automatic':'human'):undefined};});
}
export function replaceReviewedGroup(regions:TextReviewRegion[],ids:string[],text:string,at=new Date().toISOString(),box?:Box):TextReviewRegion[]{
 const selected=regions.filter(r=>ids.includes(r.id));if(!ids.length||selected.length!==ids.length)throw Error('This text changed. Reload it before saving.');const start=regions.findIndex(r=>r.id===selected[0].id);if(regions.slice(start,start+ids.length).some(r=>!ids.includes(r.id)))throw Error('The selected text must be one continuous part of the page.');
 if(selected.map(r=>r.text).join('\n')===text)return regions.map(r=>ids.includes(r.id)?{...r,acceptedBy:'human',acceptedAt:at}:r);
 const replacement:TextReviewRegion={...selected[0],text,originalText:selected.map(r=>r.originalText).join('\n'),box:box||union(selected),words:undefined,score:null,confidence:'unknown',acceptedBy:'human',acceptedAt:at};return [...regions.slice(0,start),replacement,...regions.slice(start+ids.length)];
}
export function replacementScope(box:Box|undefined,adding=false):'page'|'block'|'addition'{return adding?'addition':box?'block':'page';}
export function pendingDocumentIds(entries:{documentId:string;regions:TextReviewRegion[];sample?:boolean;error?:string;quality?:string;notes?:string[];notesAccepted?:boolean}[]){return new Set(entries.filter(e=>!e.sample&&(e.regions.some(r=>!r.acceptedBy)||!!e.error||!!e.quality||!!e.notes?.length&&!e.notesAccepted)).map(e=>e.documentId));}
