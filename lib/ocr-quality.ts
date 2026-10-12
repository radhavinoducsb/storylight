// Reader scores route review; they are not accuracy percentages.
export const OCR_READER_VERSION=2;
export function isQuestionText(text:string){
 const s=text.trim();
 if(/^Q(?:uestion)?\s*\d{1,3}(?:[.)：:]|\s)/iu.test(s))return true;
 if(!/^(?:Q(?:uestion)?\s*)?\(?\d{1,3}[.)]\s/iu.test(s))return false;
 // A numbered heading is not evidence of a question.
 return /[?？]|_{2,}|\b(?:why|what|which|who|how|explain|choose|complete|find|write|calculate)\b|என்ன|ஏன்|எப்படி|எழுது|தேர்ந்தெடு|填空|为什么|选择|回答/iu.test(s);
}
export function ocrFailure(regions:{text:string;words:{score:number}[];visual?:boolean}[]){
 const text=regions.filter(r=>!r.visual).map(r=>r.text).join(' '),scores=regions.filter(r=>!r.visual).flatMap(r=>r.words.map(w=>w.score)).filter(Number.isFinite);
 if((text.match(/\p{L}/gu)||[]).length<3||!scores.length)return 'We could not read this page reliably. Try reading the saved original again.';
 if(scores.reduce((a,b)=>a+b,0)/scores.length<55)return 'The page could not be read reliably. Try reading the saved original again, or choose its language.';
 return '';
}
