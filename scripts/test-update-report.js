'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {analyse,summarize}=require('../src/knowledge/update-report'),{extractPatchNotes}=require('../src/knowledge/patch-notes');
const notes=(title='Title',extra='')=>`<!doctype html><script>const r=/["']/; // parser skips quotes in regex
const PATCH_NOTES_ALL=[{id:'n1',date:__L('Today'),title:__L('${title}'),items:[{t:'Thing',d:'brackets [ ] and } in a string',${extra}}],launch:true}]; const PATCH_NOTES=PATCH_NOTES_ALL.filter(n=>!n.launch);</script>`;
let p=extractPatchNotes(notes('T',"when:()=>!!AsteriaWorld.ASCEND?.open,"));
assert.equal(p.status,'parsed');assert.equal(p.notes.length,1);assert.equal(p.coverage.runtimeGates,1);assert.equal(p.notes[0].items[0].when.evaluated,false);assert.equal(p.coverage.runtimeVisibilityVerified,false);
assert.equal(extractPatchNotes("// const PATCH_NOTES=[];\nconst PATCH_NOTES=[{id:'ok',title:'Yes',items:[]}];").notes[0].id,'ok');
assert.equal(extractPatchNotes("const text=`const PATCH_NOTES=[{id:'fake',title:'Wrong',items:[]}];`; const PATCH_NOTES=[{id:'ok',title:'Yes',items:[]}];").notes[0].id,'ok');
global.__patchExecuted=false;
for(const expression of ["(()=>{global.__patchExecuted=true;return 'x'})()","__L(global.__patchExecuted=true)","`template ${global.__patchExecuted=true}`","({get id(){global.__patchExecuted=true}})"]){
 const r=extractPatchNotes("const PATCH_NOTES=[{id:'n',title:"+expression+",items:[]}];");assert.equal(r.status,'unsupported');assert(!r.coverage.complete);
}
assert.equal(global.__patchExecuted,false);delete global.__patchExecuted;
assert.equal(extractPatchNotes(notes('T','when:()=>evil(),')).status,'unsupported');
assert.equal(extractPatchNotes("const PATCH_NOTES=[{id:'n',title:'a',items:[],id:'n2'}];").status,'unsupported');
const manyNotes='const PATCH_NOTES='+JSON.stringify(Array.from({length:5},(_,n)=>({id:'n'+n,title:'Title '+n,items:[]})))+';';
assert.equal(extractPatchNotes(manyNotes,{maxNotes:2}).status,'truncated');assert.equal(extractPatchNotes(manyNotes,{maxNotes:10}).coverage.complete,true);
assert.equal(extractPatchNotes(manyNotes,{maxCharacters:25}).coverage.complete,false);
assert.equal(extractPatchNotes('const PATCH_NOTES=loadRemote();').status,'unsupported');assert.equal(extractPatchNotes('<html>no notes</html>').status,'missing');
assert.equal(extractPatchNotes("const PATCH_NOTES=[{id:'n',title:__L('escaped \\u0e01 \\x41'),items:[]}];").notes[0].title,'escaped ก A');
const old={html:notes(),world:'AsteriaWorld={MAX_LV:120};',network:'function net(){return 1;}',wiki:{classes:{max:120},monsters:{monsters:[{id:'a',hp:10},{id:'b',hp:20}]},items:{equipment:[{id:'x',stats:{atk:1}}]},mystery:{'a/b~c':{enabled:false}},removedFeature:{x:1},_source:{verifiedBuild:'old'}}};
const current={...old,html:notes('Edited same ID'),world:'AsteriaWorld={MAX_LV:125};',network:'function net(){return 2;}',wiki:{classes:{max:125},monsters:{monsters:[{id:'b',hp:21},{id:'c',hp:30},{id:'a',hp:10}]},items:{equipment:[{id:'x',stats:{atk:2}}]},mystery:{'a/b~c':{enabled:true}},newFeature:{rules:[1,2]},_source:{verifiedBuild:'new'}}};
const r=analyse({previous:old,current,build:'new',previousBuild:'old'});
assert(r.coverage.complete);assert.equal(r.wikiDiff.domains.length,7,'all top-level domains, including new/removed/metadata');
assert(r.wikiDiff.domains.some(d=>d.domain==='newFeature'&&!d.knownDomain&&d.counts.added===1));
assert(r.wikiDiff.domains.some(d=>d.domain==='removedFeature'&&d.counts.removed===1));
const monster=r.wikiDiff.domains.find(d=>d.domain==='monsters');assert.equal(monster.counts.changed,1);assert.equal(monster.counts.added,1);assert.equal(monster.counts.removed,0,'array reorder is not loss of old monsters');
const hp=monster.examples.find(e=>e.kind==='changed');assert.equal(hp.beforePath,'/wiki/monsters/monsters/1/hp');assert.equal(hp.afterPath,'/wiki/monsters/monsters/0/hp');assert.equal(hp.before,20);assert.equal(hp.after,21);
assert(r.wikiDiff.examples.some(e=>e.path==='/wiki/mystery/a~1b~0c/enabled'),'JSON pointer escapes are exact');
assert(r.patchNotes.diff.examples.some(e=>e.path==='/patchNotes/0/title'&&e.before==='Title'&&e.after==='Edited same ID'),'same-ID note edits are changes');
assert(r.sourceChanges.network.changed);assert(r.sourceChanges.network.unclassifiedChange,'whole source hash catches lines outside known section hints');
assert(r.reviewTasks.some(t=>t.domain==='wiki:newFeature'));assert(r.reviewTasks.every(t=>t.status==='review_required'&&t.automaticApproval===false));assert.equal(r.serverVerified,false);assert.equal(r.authorizesActions,false);
assert.doesNotThrow(()=>JSON.stringify(r));
const unchanged=analyse({previous:old,current:structuredClone(old),build:'same',previousBuild:'same'});assert.deepEqual(unchanged.wikiDiff.counts,{added:0,removed:0,changed:0});assert.equal(unchanged.reviewTasks.length,0);
const missing=analyse({previous:old,current:{html:'',world:null,network:null,wiki:'bad json'},build:'new'});assert(!missing.coverage.complete);assert.equal(missing.wikiDiff.coverage.current,'invalid_json');assert.equal(missing.wikiDiff.counts.removed,0,'missing fetch must not look like removal of every feature');
const baseline=analyse({current:old,build:'old'});assert(baseline.baseline);assert.equal(baseline.wikiDiff.status,'baseline');assert.equal(baseline.wikiDiff.counts.added,0,'initial reference is not a claimed game change');
const bigOld={...old,wiki:{newDomain:Object.fromEntries(Array.from({length:100},(_,n)=>['k'+n,n]))}},bigNew={...old,wiki:{newDomain:Object.fromEntries(Array.from({length:100},(_,n)=>['k'+n,n+1]))}};
const bounded=analyse({previous:bigOld,current:bigNew,build:'new'},{maxNodes:15,maxExamples:2});assert(!bounded.coverage.complete);assert(bounded.wikiDiff.coverage.countsAreLowerBounds);assert(bounded.wikiDiff.coverage.visitedNodes<=15);assert(bounded.wikiDiff.examples.length<=2);assert(bounded.wikiDiff.coverage.truncated);
const full=analyse({previous:bigOld,current:bigNew,build:'new'});assert(full.wikiDiff.coverage.complete);assert(full.wikiDiff.domains[0].coverage.examplesTruncated,'example limit does not pretend all changed paths were displayed');assert.equal(full.wikiDiff.counts.changed,100);
const summary=summarize({...r,reviewTasks:Array.from({length:30},()=>r.reviewTasks[0]),patchNotes:{...r.patchNotes,current:extractPatchNotes(manyNotes)}});assert(summary.detailsTruncated);assert.equal(summary.reviewTasks.length,12);assert.equal(summary.reviewTaskCount,30);assert(summary.wikiDiff.examples.length<=24);assert(summary.patchNotes.current.notes.length<=3);assert(summary.patchNotes.diff.examples.length<=5);
const verboseValue=Object.fromEntries(Array.from({length:8},(_,n)=>['key'+n,Object.fromEntries(Array.from({length:8},(_,n)=>['child'+n,'x'.repeat(1000)]))]));
const verbose=analyse({previous:{...old,wiki:{a:null}},current:{...old,wiki:{a:verboseValue}},build:'new'});assert(verbose.wikiDiff.examples[0].afterTruncated);assert(JSON.stringify(summarize(verbose)).length<30000,'nested previews stay bounded in repeated runtime status');
const actualFile=path.join(__dirname,'../cache/d7aa27a/asteria-online.io/asteria-online-visual-polish.html');
if(fs.existsSync(actualFile)){const actual=extractPatchNotes(fs.readFileSync(actualFile,'utf8'));assert.equal(actual.status,'parsed');assert(actual.notes.length>=22);assert.equal(actual.declaration,'PATCH_NOTES_ALL');assert(actual.coverage.runtimeGates>=1);}
console.log('PASS bounded semantic diff for every domain, exact identity paths, missing-input preservation, source hashes, no approval, literal-only notes and runtime summary');
