'use strict';
// Fixed local controller; callers never choose an endpoint or credentials.
async function request(route,body,{fetcher=fetch}={}){
 if(!['start','stop'].includes(route))throw Error('Unsupported controller operation');
 const base='http://127.0.0.1:4711',get=async p=>{const r=await fetcher(base+p,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Controller authentication unavailable');return r.json();};
 const h=await get('/api/panel-health');if(h.service!=='asteria-panel'||h.machine!=='windows')throw Error('Controller identity mismatch');
 let headers={'Content-Type':'application/json'};
 if(h.version>=15){const t=await get('/api/control-token');if(!/^[a-f0-9]{64}$/.test(t.token||''))throw Error('Controller token unavailable');headers['X-Asteria-Control']=t.token;}
 else if(h.loadedControllerRevision!=='6764094f9dce7fe4156c110d77674c0b1e83f7cbf494f789ccfd723fb4127d35')throw Error('Unverified legacy controller');
 const r=await fetcher(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Controller operation rejected');return r.json();
}
module.exports={request};
