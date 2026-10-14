'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),security=require('../src/runtime/panel-security');
const guard=security.create({host:'127.0.0.1',port:4711,password:'',random:()=> 'a'.repeat(64)});
assert.throws(()=>security.create({host:'0.0.0.0',port:4711,password:''}));
assert.doesNotThrow(()=>security.create({host:'192.0.2.12',port:4711,password:'fixture'}));
const panel=fs.readFileSync('src/panel.js','utf8');let handler,starts=0,stops=0,bodyReads=0;
const context={URL,Buffer,crypto:require('node:crypto'),controlSecurity:guard,PANEL_PASSWORD:'',PORT:4711,HOST:'127.0.0.1',ROOT:'.',sessions:new Set(),controlRevision:0,
 http:{createServer:cb=>{handler=cb;return {}}},isAuthed:()=>true,
 json:(_r,code,body)=>({code,body}),readBody:async()=>{bodyReads++;return {n:3}},controllerRecovery:{reset(){}},start:()=>{starts++;return {ok:true}},stop:async()=>{stops++;return {ok:true}},
 Team:class{constructor(){this.file='team.json';this.members=[{slot:0,username:'fixture-login',password:'fixture-password',charName:'Fixture',job:'priest'}]}},path:require('node:path'),
 require:id=>id==='./runtime/panel-security'?security:id==='./runtime/host-intent'?{record(){}}:{},console:{error(){}}
};
vm.runInNewContext(panel.slice(panel.indexOf('const server = http.createServer('),panel.indexOf('// A panel that dies')),context);
const headers={host:'127.0.0.1:4711',origin:'http://127.0.0.1:4711','content-type':'application/json','x-asteria-control':guard.token};
(async()=>{
 for(const route of ['start','stop'])for(const patch of [{origin:'https://attacker.invalid'},{host:'rebinding.invalid:4711'},{origin:'null'},{'x-asteria-control':''},{'content-type':'application/x-www-form-urlencoded'},{'sec-fetch-site':'cross-site'}])assert.equal((await handler({url:'/api/'+route,method:'POST',headers:{...headers,...patch}},{})).code,403);
 assert.equal(starts+stops+bodyReads,0,'reject before reading body or touching native controls/intent');
 assert.equal((await handler({url:'/api/start',method:'POST',headers},{})).code,200);
 assert.equal((await handler({url:'/api/stop',method:'POST',headers},{})).code,200);assert.equal(starts,1);assert.equal(stops,1);
 assert.equal((await handler({url:'/api/start',method:'POST',headers:{...headers,origin:undefined}},{})).code,200,'authenticated same-host CLI token works');
 const t=await handler({url:'/api/team',method:'GET',headers:{host:headers.host}},{});assert.equal(t.code,200);assert(!JSON.stringify(t).includes('fixture-password'));assert(!JSON.stringify(t).includes('fixture-login'));assert.equal(t.body.members[0].charName,'Fixture');
 assert.equal((await handler({url:'/api/control-token',method:'GET',headers:{host:headers.host,origin:'https://attacker.invalid'}},{})).code,403);
 assert.equal((await handler({url:'/api/control-token',method:'GET',headers:{host:headers.host}},{})).body.token,guard.token);
 const html=fs.readFileSync('src/public/panel.html','utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())require('acorn').parse(m[1],{ecmaVersion:'latest'});
 assert(!html.includes('m.password'));console.log('PASS actual start/stop handlers reject Origin/Host/token/content-type before controls; authenticated CLI/UI and credential-free team');
})().catch(e=>{console.error(e);process.exitCode=1;});
