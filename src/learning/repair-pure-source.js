'use strict';
// Deliberately small JS subset for the two reviewed calculation-only modules.
// Container testing remains mandatory; parsing is not a replacement for isolation.
function validate(source){
 const ast=require('acorn').parse(source,{ecmaVersion:2022,sourceType:'script'}),declared=new Set(),globals=new Set(['module','Object','Array','Number','Math','Map','Set','Error','String','Boolean','Infinity','NaN','undefined']);
 const banned=new Set(['constructor','prototype','__proto__','__defineGetter__','__defineSetter__','getPrototypeOf','setPrototypeOf','getOwnPropertyDescriptor','getOwnPropertyDescriptors','defineProperty','defineProperties','prepareStackTrace','caller','callee','require','process','global','globalThis','eval','Function']);
 const walk=(n,fn,parent=null,key=null)=>{if(!n||typeof n!=='object')return;if(typeof n.type==='string')fn(n,parent,key);for(const [k,v]of Object.entries(n)){if(Array.isArray(v))v.forEach(x=>walk(x,fn,n,k));else if(v&&typeof v==='object')walk(v,fn,n,k);}};
 const bind=n=>{if(!n)return;if(n.type==='Identifier')declared.add(n.name);else if(n.type==='RestElement')bind(n.argument);else if(n.type==='AssignmentPattern')bind(n.left);else if(n.type==='ObjectPattern')n.properties.forEach(p=>bind(p.value||p.argument));else if(n.type==='ArrayPattern')n.elements.forEach(bind);};
 walk(ast,n=>{if(n.type==='VariableDeclarator')bind(n.id);if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)){bind(n.id);n.params.forEach(bind);}if(n.type==='CatchClause')bind(n.param);});
 for(const n of declared)if(globals.has(n)||banned.has(n))throw Error('Pure source shadows restricted name');
 walk(ast,(n,p,k)=>{
  if(['ThisExpression','WithStatement','ImportExpression','MetaProperty','ClassDeclaration','ClassExpression','AwaitExpression','YieldExpression'].includes(n.type))throw Error('Pure source uses execution context');
  if(n.type==='MemberExpression'){
   if(n.computed&&n.property.type!=='Literal')throw Error('Dynamic property access outside repair scope');
   const name=n.computed?n.property.value:n.property.name;if(banned.has(String(name)))throw Error('Restricted property');
   if(n.object.type==='Identifier'&&n.object.name==='module'&&!(name==='exports'&&p?.type==='AssignmentExpression'&&k==='left'&&p.operator==='='))throw Error('Only module.exports assignment allowed');
  }
  if(n.type==='Identifier'){
   if(p?.type==='MemberExpression'&&k==='property'&&!p.computed||['Property','MethodDefinition'].includes(p?.type)&&k==='key'&&!p.computed)return;
   if(n.name==='module'&&!(p?.type==='MemberExpression'&&k==='object'))throw Error('Module context cannot escape');
   if(!declared.has(n.name)&&!globals.has(n.name))throw Error('Unknown free identifier in pure repair');
  }
 });return true;
}
module.exports={validate};
