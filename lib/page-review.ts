import type {TextReviewRegion} from './extraction-review';
import {groupReviewRegions} from './review-groups';
export const sameText=(a:string,b:string)=>a.replace(/\s+/gu,' ').trim()===b.replace(/\s+/gu,' ').trim();
export function pageReviewText(regions:TextReviewRegion[]){return groupReviewRegions(regions).map(g=>g.text).join('\n\n');}
// A selected excerpt may replace only its own content. Whole-page readings replace the page.
export function replacePagePart(page:string,before:string,after:string){const index=page.indexOf(before);if(index<0||page.indexOf(before,index+before.length)>=0)throw Error('This selection changed. Select it again in the page.');return page.slice(0,index)+after+page.slice(index+before.length);}
export function combinePageDrafts(key:string,text:string,drafts:Record<string,{text:string;base:string}>,regions:TextReviewRegion[]){
 const page=drafts[key+':page'];if(page)return {draft:page,keys:[key+':page']};
 let value=text;const keys:string[]=[];
 for(const [id,d] of Object.entries(drafts)){if(!id.startsWith(key+':'))continue;const group=groupReviewRegions(regions).find(g=>key+':'+g.id===id);if(group&&sameText(group.text,d.base)){value=replacePagePart(value,group.text,d.text);keys.push(id);}}
 return keys.length?{draft:{text:value,base:text},keys}:null;
}
function labels(text:string){return Array.from(text.matchAll(/(?:^|\n)\s*Q(?:uestion)?\s*(\d{1,3})(?=[.\s:：)])/giu),m=>m[1]);}
// Only repair the evidenced old bug: a whole-page accepted rereading inserted into a short fragment.
// Never remove repeated questions merely because their numbers or wording look similar.
export function legacyPageCandidate(text:string,current:TextReviewRegion[],history:TextReviewRegion[]){
 const all=labels(text),unique=[...new Set(all)];if(unique.length<3||all.length<=unique.length)return null;
 const candidates=history.filter(r=>r.acceptedBy==='human'&&r.text.length>500&&r.originalText.length<r.text.length/3&&labels(r.originalText).length<2&&labels(r.text).length===unique.length&&unique.every(q=>labels(r.text).includes(q)));
 candidates.sort((a,b)=>(b.acceptedAt||'').localeCompare(a.acceptedAt||''));
 for(const c of candidates){const later=current.filter(r=>r.acceptedBy==='human'&&(r.acceptedAt||'')>(c.acceptedAt||''));if(later.every(r=>c.text.replace(/\s+/gu,' ').includes(r.text.replace(/\s+/gu,' ').trim())))return c.text;}
 return null;
}
