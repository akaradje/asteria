'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stores=new Map(),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const unresolved=['INTENT','SENT','UNCERTAIN','OBSERVED'];
class DurableStore{
 constructor(file){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const {DatabaseSync}=require('node:sqlite');this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   INSERT OR IGNORE INTO metadata VALUES('schema','1');
   CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,actor TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,actor TEXT NOT NULL,resource TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,intent TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,hash TEXT NOT NULL,at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS owners(account TEXT PRIMARY KEY,actor TEXT NOT NULL,host TEXT NOT NULL,pid INTEGER NOT NULL,generation INTEGER NOT NULL,session TEXT NOT NULL,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS actors(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  if(this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get().value!=='1')throw Error('Unsupported durable schema; preserve database and stop mutations');
  if(!this.db.prepare('PRAGMA table_info(documents)').all().some(r=>r.name==='revision'))this.db.exec('ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 get(id){const row=this.db.prepare('SELECT data FROM intents WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
 write(row){this.db.prepare('INSERT INTO intents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(row.id,row.actorId,row.status,JSON.stringify(row));}
 begin({id=crypto.randomUUID(),actorId,session,generation,kind,bill={},available={},target={},at=Date.now(),contractRevision}){
  if(!actorId||!session||!Number.isSafeInteger(generation)||!kind)throw Error('Incomplete action intent identity');
  if(Object.entries(bill).some(([k,n])=>!k||!Number.isSafeInteger(n)||n<0))throw Error('Invalid integer resource bill');
  return this.transaction(()=>{
   if(this.get(id))throw Error('Intent already exists; never replay');
   for(const [resource,amount]of Object.entries(bill)){
    const held=this.db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM claims WHERE actor=? AND resource=? AND status IN ('HELD','UNCERTAIN')").get(actorId,resource).amount;
    if(!Number.isSafeInteger(available[resource])||available[resource]-held<amount)throw Error('Insufficient unreserved '+resource);
   }
   const row={id,actorId,session,generation,kind,target,bill,at,contractRevision:contractRevision||null,status:'INTENT',receipts:[]};
   this.write(row);for(const [resource,amount]of Object.entries(bill))this.db.prepare('INSERT INTO claims VALUES(?,?,?,?,?,?)').run(id+':'+resource,actorId,resource,amount,'HELD',id);
   return row;
  });
 }
 sent(id,at=Date.now()){return this.transition(id,'SENT',{sentAt:at},['INTENT']);}
 transition(id,status,fields={},allowed=unresolved){return this.transaction(()=>{const row=this.get(id);if(!row||!allowed.includes(row.status))throw Error('Invalid intent transition');Object.assign(row,fields,{status});this.write(row);return row;});}
 observed(id,evidence){return this.transition(id,'OBSERVED',{observation:evidence},['SENT','UNCERTAIN','OBSERVED']);}
 receipt(id,{receiptId,actorId,session,generation,kind,authority,at,applied,proof}){
  if(!receiptId||!['server_socket','server_readback'].includes(authority)||!Number.isFinite(at)||typeof applied!=='boolean'||!proof)throw Error('Exact native receipt proof required');
  return this.transaction(()=>{
   const prior=this.db.prepare('SELECT intent FROM receipts WHERE id=?').get(receiptId);
   if(prior){if(prior.intent!==id)throw Error('Receipt already belongs to another action');return this.get(id);}
   const row=this.get(id);
   if(!row||!unresolved.includes(row.status)||row.actorId!==actorId||row.session!==session||row.generation!==generation||row.kind!==kind||!row.sentAt||at<row.sentAt)throw Error('Native receipt does not match dispatched attempt');
   const receipt={receiptId,actorId,session,generation,kind,authority,at,applied,proof};
   this.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(receiptId,id,JSON.stringify(receipt));
   row.receipts.push(receiptId);row.status=applied?'CONFIRMED':'NOT_APPLIED';row.confirmedAt=at;this.write(row);
   this.db.prepare("UPDATE claims SET status='RELEASED' WHERE intent=?").run(id);return row;
  });
 }
 recover(actorId){return this.transaction(()=>{const rows=this.db.prepare("SELECT data FROM intents WHERE actor=? AND status IN ('INTENT','SENT','OBSERVED')").all(actorId);
  for(const raw of rows){const row=JSON.parse(raw.data);row.status='UNCERTAIN';row.reason='Restart with unresolved intent; reconciliation required, no replay';this.write(row);this.db.prepare("UPDATE claims SET status='UNCERTAIN' WHERE intent=?").run(row.id);}return rows.length;
 });}
 pending(actorId){return this.db.prepare("SELECT data FROM intents WHERE actor=? AND status IN ('INTENT','SENT','OBSERVED','UNCERTAIN')").all(actorId).map(row=>JSON.parse(row.data));}
 held(actorId){return Object.fromEntries(this.db.prepare("SELECT resource,SUM(amount) AS amount FROM claims WHERE actor=? AND status IN ('HELD','UNCERTAIN') GROUP BY resource").all(actorId).map(row=>[row.resource,row.amount]));}
 putDocument(id,data,expectedRevision){
  if(expectedRevision!==undefined){const result=this.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(data),id,expectedRevision);if(result.changes!==1)throw Error('Document writer conflict; reload before mutation');return expectedRevision+1;}
  this.db.prepare('INSERT INTO documents(id,data,revision) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=documents.revision+1').run(id,JSON.stringify(data));return this.documentRevision(id);
 }
 documentRevision(id){return this.db.prepare('SELECT revision FROM documents WHERE id=?').get(id)?.revision??null;}
 document(id){const row=this.db.prepare('SELECT data FROM documents WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
 importDocument(id,data){const encoded=JSON.stringify(data),digest=hash(encoded);return this.transaction(()=>{const old=this.db.prepare('SELECT hash FROM imports WHERE id=?').get(id);if(old)return {imported:false,hash:old.hash};this.putDocument(id,data);this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(id,digest,Date.now());return {imported:true,hash:digest};});}
 acquire({accountId,actorId,host,pid=process.pid,session=crypto.randomUUID(),previousStopped=false}){
  return this.transaction(()=>{const old=this.db.prepare('SELECT * FROM owners WHERE account=?').get(accountId);
   if(old&&old.state!=='STOPPED'){
    if(old.pid===pid&&old.host===host&&old.actor===actorId&&old.session===session)return old;
    // Expiry alone is not proof the old process stopped, particularly on another host.
    if(!previousStopped)throw Error('Account owner has not positively drained');
   }
   const generation=(old?.generation||0)+1;
   this.db.prepare('INSERT INTO owners VALUES(?,?,?,?,?,?,?) ON CONFLICT(account) DO UPDATE SET actor=excluded.actor,host=excluded.host,pid=excluded.pid,generation=excluded.generation,session=excluded.session,state=excluded.state').run(accountId,actorId,host,pid,generation,session,'ACTIVE');
   return this.db.prepare('SELECT * FROM owners WHERE account=?').get(accountId);
  });
 }
 validateOwner(owner){const current=this.db.prepare('SELECT * FROM owners WHERE account=?').get(owner.account);return current?.state==='ACTIVE'&&current.actor===owner.actor&&current.generation===owner.generation&&current.session===owner.session&&current.pid===owner.pid&&current.host===owner.host;}
 stopOwner(owner,{closed}={}){if(!closed)throw Error('Session close proof required');if(!this.validateOwner(owner))return false;this.db.prepare("UPDATE owners SET state='STOPPED' WHERE account=? AND generation=? AND session=?").run(owner.account,owner.generation,owner.session);return true;}
 close(){this.db.close();}
}
function shared(root){const file=path.resolve(root,'logs','runtime-v32.db');if(!stores.has(file))stores.set(file,new DurableStore(file));return stores.get(file);}
module.exports={DurableStore,shared};
