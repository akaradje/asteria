'use strict';
// Reconcile live data without discarding focused controls, disclosures or scroll containers.
window.updateFleetDOM=function updateFleetDOM(host,markup){
 const template=document.createElement('template');template.innerHTML=markup;
 const key=node=>node.nodeType===1?(node.id||node.getAttribute('data-live-key')):null;
 const same=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==1||a.localName===b.localName&&a.namespaceURI===b.namespaceURI)&&key(a)===key(b);
 function patch(parent,next){
  let cursor=parent.firstChild;
  for(const desired of Array.from(next.childNodes)){
   let current=cursor;
   if(key(desired)&&(!current||key(current)!==key(desired)))current=Array.from(parent.childNodes).find(n=>key(n)===key(desired)&&same(n,desired));
   if(!current||!same(current,desired)){parent.insertBefore(desired.cloneNode(true),cursor);continue;}
   if(current!==cursor)parent.insertBefore(current,cursor);
   if(current.nodeType===1){
    const focused=current===document.activeElement;
    for(const attr of Array.from(current.attributes))if(!desired.hasAttribute(attr.name)&&!(current.localName==='details'&&attr.name==='open')&&!(focused&&attr.name==='value'))current.removeAttribute(attr.name);
    for(const attr of Array.from(desired.attributes))if(!(current.localName==='details'&&attr.name==='open')&&!(focused&&attr.name==='value')&&current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
    // A user's query or chart selection must survive background refreshes.
    if(!focused||!['input','textarea','select'].includes(current.localName))patch(current,desired);
   }else if(current.nodeValue!==desired.nodeValue)current.nodeValue=desired.nodeValue;
   cursor=current.nextSibling;
  }
  while(cursor){const following=cursor.nextSibling;cursor.remove();cursor=following;}
 }
 patch(host,template.content);
};
