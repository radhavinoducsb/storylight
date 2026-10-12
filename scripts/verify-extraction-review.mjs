import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {build}=createRequire(import.meta.resolve('drizzle-kit'))('esbuild');
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
const objects=new Map();
const statement=(query,args=[])=>({bind(...v){return statement(query,v)},async first(){return sql.prepare(query).get(...args)||null},async all(){return{results:sql.prepare(query).all(...args)}},async run(){return sql.prepare(query).run(...args)}});
globalThis.__STORYLIGHT_RUNTIME_ENV__={DB:{prepare:statement},BUCKET:{async put(key,bytes){objects.set(key,bytes)},async get(key){return objects.has(key)?{body:objects.get(key)}:null}}};
mkdirSync('.sites-runtime/review-tests',{recursive:true});
for(const entry of ['lib/review-groups.ts','lib/extraction-review.ts','lib/lessoncraft-import.ts','app/api/worksheets/library/route.ts','app/api/worksheets/cache/route.ts','app/api/assessments/review/route.ts'])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/review-tests/'+entry.replaceAll('/','_').replace('.ts','.mjs'),logLevel:'silent'});
const load=n=>import('../.sites-runtime/review-tests/'+n+'.mjs');
const {reviewTranscript,acceptHigh,allTextAccepted,coverageWarnings,preserveTextReviews,extractionFailure}=await load('lib_extraction-review');
const ocr={engine:'tesseract',language:'eng',width:100,height:200,regions:[{id:'a',text:'1. What did Mira notice?',box:{x:.1,y:.2,w:.8,h:.1},visual:false,words:[{text:'Mira',score:99}]},{id:'b',text:'A missing passage about a bicycle.',box:{x:.1,y:.4,w:.8,h:.1},visual:false,words:[{text:'bicycle',score:55}]}]};
const regions=reviewTranscript('1. What did Mira notice?\nUnknown line',ocr);assert.equal(regions[0].kind,'question');assert.equal(regions[0].confidence,'high');assert.equal(regions[1].confidence,'unknown');assert.equal(acceptHigh(regions,true)[0].acceptedBy,'automatic');assert(!allTextAccepted(acceptHigh(regions,true)));assert(coverageWarnings(regions[0].text,ocr).length);assert.notEqual(reviewTranscript('1. What did Mina notice?',ocr)[0].confidence,'high');
const {parseLessoncraftPackage}=await load('lib_lessoncraft-import');
assert.throws(()=>parseLessoncraftPackage({schema:'lessoncraft-storylight',schemaVersion:1,language:'ta',level:'P5',package:{approved:false,items:[]}}));
const resource={schema:'lessoncraft-storylight',schemaVersion:1,language:'ta',level:'P5',lesson:{id:'L1',objective:'Read carefully'},package:{approved:true,title:'Tamil practice',instructions:'Read the question.',items:[{prompt:'Explain the reason.',expectedAnswer:'Uses passage evidence',support:'Find the clue.'}]}};assert.equal(parseLessoncraftPackage(resource).sections[0].question.key_points[0],'Uses passage evidence');
const library=await load('app_api_worksheets_library_route'),cache=await load('app_api_worksheets_cache_route'),review=await load('app_api_assessments_review_route');
const request=(data)=>new Request('https://test.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed:true,familyId:'test-family-alpha',...data})});
const form=new FormData();form.set('adultConfirmed','true');form.set('familyId','test-family-alpha');form.set('file',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'synthetic.png',{type:'image/png'}));
let r=await library.POST(new Request('https://test.invalid/api',{method:'POST',body:form}));assert.equal(r.status,200);const {id}=await r.json();
r=await library.POST(request({action:'save',cacheKey:'test-source-001',title:'Synthetic paper',language:'ta',level:'P5',pages:[{storedId:id}]}));assert.equal(r.status,200);
r=await library.POST(request({action:'list',familyId:'test-family-other'}));assert.equal((await r.json()).items.length,0);
r=await library.GET(new Request('https://test.invalid/api?familyId=test-family-other&id='+id));assert.equal(r.status,404);
r=await library.POST(request({action:'open',cacheKey:'test-source-001'}));assert.equal((await r.json()).pages[0].storedId,id);
r=await cache.POST(request({action:'save',cacheKind:'set',cacheKey:'test-source-001',language:'ta',level:'P5',payload:{pages:[{transcript:'Corrected Tamil text',textAccepted:true,roleAccepted:false}]}}));assert.equal(r.status,200);
r=await cache.POST(request({action:'lookup',cacheKind:'set',cacheKey:'test-source-001',language:'ta',level:'P5'}));assert.equal((await r.json()).payload.pages[0].transcript,'Corrected Tamil text');
r=await review.POST(request({pages:[{role:'student_answer',transcript:'x',textAccepted:true,roleAccepted:false}]}));assert.equal(r.status,400);
console.log('PASS: confidence thresholds, unknown evidence, omission checks, approved resource validation, saved originals, workspace isolation, corrected-text persistence and independent role approval. No model calls were made.');

assert.equal(reviewTranscript('3. முன்னுணர்வுக் கருத்தறிதல்',null)[0].kind,'text');
assert.equal(reviewTranscript('Saved text',{...ocr,failureReason:'Confidence unavailable'})[0].text,'Saved text');
assert.equal(reviewTranscript('Saved text',{...ocr,failureReason:'Confidence unavailable'})[0].confidence,'unknown');
assert.equal(extractionFailure({ocrFailure:'Read again'}),'Read again');
const corrected={...regions[0],text:'Teacher-corrected Tamil',acceptedBy:'human',acceptedAt:'saved'};
assert.equal(preserveTextReviews(reviewTranscript(corrected.text,null),[corrected])[0].acceptedBy,'human');
assert.equal(preserveTextReviews(reviewTranscript('Different text',null),[corrected])[0].acceptedBy,undefined);
console.log('PASS: saved text remains reviewable when confidence checking fails, saved corrections survive evidence refresh, changed text stays unaccepted, and numbered headings are not questions.');

const tamilOCR={...ocr,regions:[{...ocr.regions[0],text:'ஒரு\u200c நாள்\u200c',words:[{text:'ஒரு',score:99},{text:'நாள்',score:99}]}]};
assert.equal(reviewTranscript('ஒரு நாள்',tamilOCR)[0].confidence,'high','Invisible OCR formatting is not a transcription difference');
assert.notEqual(reviewTranscript('ஒரு நாய்',tamilOCR)[0].confidence,'high','A different Tamil word must stay in review');
console.log('PASS: harmless Tamil formatting does not create false review items; changed words still do.');

const draft={key:'2:text-3',filter:'needs',paused:true,drafts:{'2:text-3':{text:'Unfinished Tamil correction',base:'Original'}}};
r=await cache.POST(request({action:'save',cacheKind:'batch',cacheKey:'review-checkpoint',language:'ta',level:'P5',payload:draft}));assert.equal(r.status,200);r=await cache.POST(request({action:'lookup',cacheKind:'batch',cacheKey:'review-checkpoint',language:'ta',level:'P5'}));assert.deepEqual((await r.json()).payload,draft);
const approved=reviewTranscript('Correct existing text',{...ocr,failureReason:'No confidence'}).map(r=>({...r,acceptedBy:'human'}));assert.equal(extractionFailure({ocrFailure:'No confidence',reviewRegions:approved}),'');assert(allTextAccepted(approved));
console.log('PASS: Storylight draft resume and accepting existing text without repeating extraction.');

// Regression: review questions together, count documents, preserve unselected content.
const groupedReview=await load('lib_review-groups');
const lines=['Name: ______','Class: P5','Q1. Choose the correct word.','(1) tree','(2) bird','Q2. Explain why the child waited.','Use evidence from the passage.'];
const reviewRows=lines.map((text,i)=>({id:'line-'+i,text,originalText:text,score:null,confidence:'unknown',kind:'text'}));
const reviewGroups=groupedReview.groupReviewRegions(reviewRows);
assert.equal(reviewGroups.length,3);assert.equal(reviewGroups[1].label,'Question 1');assert(reviewGroups[1].text.includes('(2) bird'));
const acceptedGroup=groupedReview.replaceReviewedGroup(reviewRows,reviewGroups[1].memberIds,reviewGroups[1].text);
assert.deepEqual(acceptedGroup.map(r=>r.text),lines);assert(acceptedGroup.slice(2,5).every(r=>r.acceptedBy==='human'));assert(!acceptedGroup[5].acceptedBy);
const replacedGroup=groupedReview.replaceReviewedGroup(reviewRows,reviewGroups[1].memberIds,'Q1. New question.\n(1) leaf\n(2) nest');
assert.equal(replacedGroup[0].text,lines[0]);assert.equal(replacedGroup.at(-1).text,lines.at(-1));assert.equal(replacedGroup.filter(r=>r.text.includes('Q1.')).length,1);
assert.throws(()=>groupedReview.replaceReviewedGroup(reviewRows,['line-1','line-5'],'Broken selection'));
assert.equal(groupedReview.replacementScope(undefined),'page');assert.equal(groupedReview.replacementScope({x:0,y:0,w:1,h:.5}),'block');assert.equal(groupedReview.replacementScope({x:0,y:0,w:1,h:.5},true),'addition');
assert.equal(groupedReview.pendingDocumentIds([{documentId:'one',regions:reviewRows},{documentId:'one',regions:reviewRows},{documentId:'two',regions:acceptedGroup.map(r=>({...r,acceptedBy:'human'}))},{documentId:'sample',sample:true,regions:reviewRows}]).size,1);
console.log('PASS: complete question grouping, answer choices, document counts, scoped replacement and unrelated-text preservation.');

r=await cache.POST(request({action:'save',cacheKind:'set',cacheKey:'test-source-001',language:'ta',level:'P5',payload:{pages:[{transcript:'A later correction',textAccepted:true,roleAccepted:false}]}}));assert.equal(r.status,200);
r=await cache.POST(request({action:'lookup',cacheKind:'set',cacheKey:'test-source-001',language:'ta',level:'P5'}));const withHistory=(await r.json()).payload;assert(withHistory.readingHistoryKey);assert.equal(JSON.parse(objects.get(withHistory.readingHistoryKey)).payload.pages[0].transcript,'Corrected Tamil text');
console.log('PASS: earlier reading is retained when a saved transcript changes.');
