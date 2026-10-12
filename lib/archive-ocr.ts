'use client';
import {isQuestionText,ocrFailure,OCR_READER_VERSION} from './ocr-quality';
import type {OCRPage} from './extraction-review';
type Rendered={canvas:HTMLCanvasElement;width:number;height:number};
const cache=new Map<string,Promise<Rendered>>();
export async function renderArchivePage(url:string,mime:string):Promise<Rendered>{
 if(cache.has(url))return cache.get(url)!;
 const work=(async()=>{
  const canvas=document.createElement('canvas');
  if(mime==='application/pdf'){
   const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
   const task=pdfjs.getDocument({url,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
   const doc=await task.promise;try{const page=await doc.getPage(1),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(3.5,2600/Math.max(base.width,base.height))});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvas,viewport}).promise;}finally{await task.destroy();}
  }else{
   const response=await fetch(url);if(!response.ok)throw Error('The saved original could not be loaded.');const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
   try{const img=new Image();img.src=objectUrl;await img.decode();const scale=Math.min(1,2600/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);}finally{URL.revokeObjectURL(objectUrl);}
  }
  return{canvas,width:canvas.width,height:canvas.height};
 })();cache.set(url,work);work.catch(()=>cache.delete(url));while(cache.size>3)cache.delete(cache.keys().next().value!);return work;
}
let queue:Promise<unknown>=Promise.resolve();
export function readArchiveOCR(url:string,mime:string,subject:string,onProgress:(s:string)=>void=()=>{},readerLanguage='auto'):Promise<OCRPage|null>{
 if(mime==='text/plain')return Promise.resolve(null);
 const run=async()=>{
  onProgress('Reading page positions');const image=await renderArchivePage(url,mime);
  const {createWorker,PSM}=await import('tesseract.js');
  // The curriculum subject is only a hint. Read all supported scripts before choosing one.
  const language:OCRPage['language']=readerLanguage==='Tamil'?'tam+eng':readerLanguage==='Chinese'?'chi_sim+eng':readerLanguage==='Malay'?'msa+eng':readerLanguage==='English'?'eng':/malay/i.test(subject)?'eng+tam+chi_sim+msa':'eng+tam+chi_sim';
  const worker=await createWorker(language,1,{workerPath:'/vendor/ocr/worker.min.js',corePath:'/vendor/ocr',langPath:'/vendor/ocr',workerBlobURL:false,logger:m=>onProgress(m.status==='recognizing text'?`Checking text confidence · ${Math.round(m.progress*100)}%`:'Preparing document reader')});
  try{
   await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO,preserve_interword_spaces:'1'});
   let result=await worker.recognize(image.canvas,{}, {blocks:true});
   if(result.data.confidence<55){onProgress('Trying another page layout…');await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});const retry=await worker.recognize(image.canvas,{}, {blocks:true});if(retry.data.confidence>result.data.confidence)result=retry;}const regions:OCRPage['regions']=[];
   for(const block of result.data.blocks||[])for(const paragraph of block.paragraphs){
    // Split at question starts so adjacent numbered questions remain separate records.
    let lines:typeof paragraph.lines=[];
    const flush=()=>{if(!lines.length)return;const text=lines.map(l=>l.text.trimEnd()).join('\n').trim();if(!text){lines=[];return;}const x=Math.min(...lines.map(l=>l.bbox.x0)),y=Math.min(...lines.map(l=>l.bbox.y0)),right=Math.max(...lines.map(l=>l.bbox.x1)),bottom=Math.max(...lines.map(l=>l.bbox.y1));regions.push({id:`ocr-${regions.length+1}`,text:text.slice(0,14000),box:{x:x/image.width,y:y/image.height,w:Math.max(1,right-x)/image.width,h:Math.max(1,bottom-y)/image.height},words:lines.flatMap(l=>l.words).map(w=>({text:w.text.slice(0,500),score:Math.max(0,Math.min(100,w.confidence))})).slice(0,2000),visual:false});lines=[];};
    for(const line of paragraph.lines){if(isQuestionText(line.text)&&lines.length)flush();lines.push(line);}flush();
   }
   // Blank gaps, answer rules and page shadows are not diagrams. Actual visual
   // content is identified by the document reader, independently of text scores.
   if(regions.length>159)regions.splice(159,regions.length-159,{id:'overflow-review',text:'This dense page exceeds the region limit. Check the full original for content not shown separately.',box:{x:0,y:0,w:1,h:1},words:[],visual:true});
   return{engine:'tesseract' as const,language,width:image.width,height:image.height,regions,readerVersion:OCR_READER_VERSION,failureReason:ocrFailure(regions)};
  }finally{await worker.terminate();}
 };
 const result=queue.then(run,run);queue=result.catch(()=>{});return result;
}
