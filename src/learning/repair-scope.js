'use strict';
const fs=require('node:fs'),path=require('node:path'),ast=require('../knowledge/native-contract');
const pure=['src/planning/dependency-time.js','src/planning/market-value.js'];
function scopes(){
 const root=path.resolve(__dirname,'../..'),out=Object.fromEntries(pure.map(f=>[f,['scripts/test-brain-'+path.basename(f,'.js')+'.js']]));
 for(const dir of ['planning','knowledge'])for(const name of fs.readdirSync(path.join(root,'src',dir)))if(/^[a-z0-9-]+\.js$/.test(name)&&!pure.includes('src/'+dir+'/'+name))out['src/'+dir+'/'+name]=['scripts/test-adaptive-progression.js','scripts/test-native-semantic-contract.js'];
 out['src/equipment-goal.js']=['scripts/test-adaptive-progression.js'];out['src/runtime/capacity-recovery.js']=['scripts/test-v32-capacity-recovery.js','scripts/test-adaptive-progression.js'];return Object.freeze(out);
}
function validate(before,after,file){
 if(pure.includes(file))return require('./repair-pure-source').validate(after);
 const parse=s=>require('acorn').parse(s,{ecmaVersion:'latest',allowReturnOutsideFunction:false});
 const footprint=source=>{const found=[];ast.walk(parse(source),(n,a)=>{
  const name=n.type==='CallExpression'||n.type==='NewExpression'?ast.member(n.callee):null;
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)){let io=false;ast.walk(n,x=>{const call=x.type==='CallExpression'?ast.member(x.callee):null;if(call&&(/^(fs|cp|http|https|vm|process)\./.test(call)||/\.(readFileSync|writeFileSync|spawnSync|execFileSync|runInNewContext|runInContext)$/.test(call)))io=true;});if(io)found.push('immutable-I/O-function:'+ast.fingerprint(n));}
  if(n.type==='Identifier'&&['process','global','globalThis','eval','Function','fs','cp','http','https','vm'].includes(n.name))found.push('authority-reference:'+n.name);
  if(n.type==='ImportExpression'||n.type==='WithStatement')found.push(ast.fingerprint(n));
  if(name&&(/^(require|eval|Function|fetch|WebSocket|process|global|globalThis)\b/.test(name)||/\b(fs|cp|child_process|http|https|vm|store|ledger|journal|scheduler|pool)\b|\.(eval|socialSend|begin|sent|save|receipt|transition|validateOwner|writeFileSync|appendFileSync|readFileSync|readFile|readdirSync|existsSync|statSync|lstatSync|realpathSync|copyFileSync|createReadStream|cpSync|mkdirSync|chmodSync|chownSync|renameSync|unlinkSync|exec[A-Za-z]*|spawn[A-Za-z]*|kill|send|markRefineDispatch|readback|validate|check|decisionGate|historyIndependent|native)\b/.test(name)))found.push('call:'+ast.fingerprint(n));
  if(n.type==='MemberExpression'&&['constructor','prototype','__proto__','caller','callee'].includes(n.computed?String(n.property.value):n.property.name))found.push('escape:'+ast.fingerprint(n));
  if(n.type==='IfStatement'&&/actorOwner|actorIdentity|registryV32|sourceCoherence|freshness|receipt|replay|uncertain|pending|teamControl|choresBusy|recycling|locks|heldResources|paid-actions|tradeAvailability|Human|operatorStopped|ownsNavigation/i.test(JSON.stringify(ast.clean(n.test))))found.push('guard:'+ast.fingerprint(n));
 });return found.sort();};
 if(JSON.stringify(footprint(before))!==JSON.stringify(footprint(after)))throw Error('Repair cannot add/change authority, I/O, transaction or ownership guards');
 // Semantic approval and source identity are trust boundaries, never self-editable.
 if(['native-contract.js','loaded-source.js','system-version.js','source-sections.js','capability-registry.js'].includes(path.basename(file))){
  const funcs=s=>ast.functions(s);const old=funcs(before),next=funcs(after);for(const [name,rows] of old)if(!['recipeConstruction','constructedRecipes','encode'].includes(name)&&JSON.stringify(rows.map(ast.clean))!==JSON.stringify((next.get(name)||[]).map(ast.clean)))throw Error('Immutable semantic/source authority boundary');
 }
 return true;
}
module.exports={scopes,validate,pure};
