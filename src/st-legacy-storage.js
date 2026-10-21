import {clone,sha256} from './utils.js';
import {ShiyiError} from './errors.js';
const fail=message=>new ShiyiError(message,'PERSISTENCE_UNAVAILABLE');
const DB='shiyi-memory-st-v1',STORE='documents',PREFIX='shiyi-st-v1-';
/** A deliberately read-only original-edition reader. It has no write/delete
 * methods, never upgrades an existing DB, and aborts creation of an absent DB. */
export class STLegacyReadStore{
  constructor({scope,indexedDB=globalThis.indexedDB,deviceStorage=globalThis.localStorage,backend='indexeddb',fetchImpl=globalThis.fetch,getRequestHeaders=()=>({}),guard=async()=>{}}){if(!scope?.accountId)throw fail('旧拾忆账号身份未就绪');Object.assign(this,{scope:clone(scope),scopeHash:sha256(scope),ownerAccountHash:sha256(scope.accountId),indexedDB,deviceStorage,backend,fetchImpl,getRequestHeaders,guard});this.connection=null;}
  async _ready(){
    if(this.connection)return this.connection;
    this.connection=(async()=>{if(!this.indexedDB?.open)throw fail('旧拾忆数据库读取不可用');if(typeof this.indexedDB.databases==='function'&&!(await this.indexedDB.databases()).some(d=>d.name===DB))return null;
      return new Promise((resolve,reject)=>{let missing=false,settled=false;const req=this.indexedDB.open(DB);req.onupgradeneeded=()=>{missing=true;req.transaction.abort();};req.onerror=()=>{if(!settled){settled=true;missing?resolve(null):reject(fail('旧拾忆数据库打开失败，未当作空存档'));}};req.onblocked=()=>{settled=true;reject(fail('旧拾忆数据库被占用，未当作空存档'));};req.onsuccess=()=>{const db=req.result;if(settled){db.close();return;}settled=true;if(!db.objectStoreNames.contains(STORE)){db.close();reject(fail('旧拾忆存储结构无效'));return;}db.onversionchange=()=>{db.close();this.connection=null;};resolve(db);};});})();
    return this.connection;
  }
  async tryGetJson({namespace,table='main',key,signal}={}){
    if(typeof namespace!=='string'||!namespace.startsWith('shiyi-')||typeof table!=='string'||!table||typeof key!=='string'||!key)throw fail('旧拾忆只读地址无效');await this.guard();const address={namespace,table,key},addressHash=sha256(address);let document;
    if(namespace==='shiyi-device-credentials'){
      const hash=sha256({accountId:this.scope.accountId,edition:'sillytavern'}),raw=this.deviceStorage?.getItem(PREFIX+'device-'+hash+'-'+addressHash);if(raw==null)return {found:false};try{document=JSON.parse(raw);}catch{throw fail('旧拾忆本机凭据完整性校验失败');}if(document?.format!=='shiyi-st-device-v1'||document.digest!==sha256(document.value))throw fail('旧拾忆本机凭据完整性校验失败');
    }else if(this.backend==='files'){
      const res=await this.fetchImpl('/user/files/'+PREFIX+this.scopeHash+'-'+addressHash+'.json',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:this.getRequestHeaders(),signal});if(res.status===404)return {found:false};if(!res.ok)throw fail('旧拾忆文件读取失败');document=await res.json();if(document?.format!=='shiyi-st-json-v1'||document.scopeHash!==this.scopeHash||document.addressHash!==addressHash||document.digest!==sha256(document.value))throw fail('旧拾忆文件身份或完整性校验失败');
    }else{
      const db=await this._ready();await this.guard();if(!db)return {found:false};document=await new Promise((resolve,reject)=>{let tx,req,value;try{tx=db.transaction(STORE,'readonly');req=tx.objectStore(STORE).get(this.scopeHash+':'+addressHash);}catch{reject(fail('旧拾忆只读事务失败'));return;}req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(fail('旧拾忆只读事务中止'));tx.onerror=()=>{};});if(document===undefined)return {found:false};if(document?.format!=='shiyi-st-idb-v1'||document.ownerAccountHash!==this.ownerAccountHash||document.scopeHash!==this.scopeHash||document.addressHash!==addressHash||document.digest!==sha256(document.value))throw fail('旧拾忆存档身份或完整性校验失败');
    }
    await this.guard();if(!Object.hasOwn(document,'value'))throw fail('旧拾忆存档内容缺失');return {found:true,value:clone(document.value)};
  }
  async getJson(args){const r=await this.tryGetJson(args);if(!r.found)throw new ShiyiError('旧拾忆存储项不存在','NOT_FOUND');return r.value;}
  async close(){const db=await this.connection?.catch(()=>null);db?.close();this.connection=null;}
}
