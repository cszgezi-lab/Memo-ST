import {STHostAdapter} from './st-host-adapter.js';
import {createSTWorldbookBridge} from './st-worldbook.js';

import {initProductShell} from '../ui/product-view.js';
import {ShiyiError} from './errors.js';
import {createSTBrowserBackup} from './st-backup.js';
import {createMemoHostAdapter} from './memo-host-adapter.js';
import {MEMO_ST_IDENTITY} from './memo-identity.js';

const INSTANCE=Symbol.for('memo-st.sillytavern.instance');
const STARTING=Symbol.for('memo-st.sillytavern.starting');
const READY_LISTENER=Symbol.for('memo-st.sillytavern.ready-listener');
const READY_TIMER=Symbol.for('memo-st.sillytavern.ready-timer');
const EPOCH=Symbol.for('memo-st.sillytavern.epoch');
export function assertSTHost(host,version){
  if(host?.__TAURITAVERN__)throw new ShiyiError('这是原版酒馆版，请在 TT 中使用Memo TT 版。','ST_WRONG_HOST');
  const context=host?.SillyTavern?.getContext?.()??host?.getContext?.();
  if(!context||typeof context.getRequestHeaders!=='function'||typeof context.eventSource?.on!=='function'||typeof context.setExtensionPrompt!=='function')
    throw new ShiyiError('原版酒馆接口尚未就绪，请刷新后重试。','ST_HOST_UNAVAILABLE');
  if(!/^1\.(?:17|18|19)\.\d+$/.test(String(version??'')))
    throw new ShiyiError('当前原版版支持 SillyTavern 1.17.x–1.19.x；其它版本尚未验证。','ST_VERSION_UNSUPPORTED');
  return context;
}

/** Public ST globals remain real. The facade only supplies this edition's
 * read-only source bridge; it never claims TauriTavern capabilities. */
export function createSTHostFacade(host,bridge){
  const overrides={...bridge,__MEMO_EDITION__:'st',memoIdentity:MEMO_ST_IDENTITY};
  return new Proxy(host,{get(target,key){
    if(Object.hasOwn(overrides,key))return overrides[key];
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

export async function initST({host=globalThis,importModule=url=>import(url),fetchImpl=host.fetch?.bind(host)}={}){
  if(host[INSTANCE])return host[INSTANCE];
  const epoch=host[EPOCH]??0;
  if(host[STARTING]?.epoch===epoch)return host[STARTING].task;
  const abort=new AbortController();
  const check=()=>{if(abort.signal.aborted||(host[EPOCH]??0)!==epoch)throw new ShiyiError('Memo启动已取消。','CANCELED');};
  const task=(async()=>{
    check();
    if(host?.__TAURITAVERN__)throw new ShiyiError('这是原版酒馆版，请在 TT 中使用Memo TT 版。','ST_WRONG_HOST');
    const context=host.SillyTavern?.getContext?.()??host.getContext?.();
    if(typeof fetchImpl!=='function'||!context?.getRequestHeaders)throw new ShiyiError('酒馆请求接口尚未就绪。','ST_HOST_UNAVAILABLE');
    const response=await fetchImpl('/version',{credentials:'same-origin',cache:'no-store',signal:abort.signal});check();
    if(!response.ok)throw new ShiyiError('无法核实酒馆版本，请刷新后重试。','ST_HOST_UNAVAILABLE');
    const {pkgVersion}=await response.json();check();assertSTHost(host,pkgVersion);
    if(host.document?.getElementById('memo-floating-layer'))throw new ShiyiError('已有Memo窗口，请只启用一个Memo版本。','ST_DUPLICATE_EDITION');
    const [worldInfoModule,userModule]=await Promise.all([importModule('/scripts/world-info.js'),importModule('/scripts/user.js')]);
    check();
    const accountResponse=await fetchImpl('/api/users/me',{headers:context.getRequestHeaders(),credentials:'same-origin',cache:'no-store',signal:abort.signal});check();
    if(!accountResponse.ok)throw new ShiyiError('无法确认当前酒馆账户，请重新登录后重试。','ST_ACCOUNT_UNAVAILABLE');
    const account=await accountResponse.json();
    check();
    if(typeof account.handle!=='string'||!account.handle||userModule.getCurrentUserHandle?.()!==account.handle)
      throw new ShiyiError('酒馆账户已变化，请刷新后重试。','ST_ACCOUNT_CHANGED');
    const getContext=()=>host.SillyTavern?.getContext?.()??host.getContext?.();
    const getAccountId=()=>userModule.getCurrentUserHandle();
    const bridge=createSTWorldbookBridge({context:getContext,worldInfoModule,fetchImpl});
    const facade=createSTHostFacade(host,bridge);
    const rawAdapter=new STHostAdapter(facade,{fetchImpl,getAccountId,nativeHost:host,deviceStorage:host.localStorage,locks:host.navigator?.locks});
    await rawAdapter.ready();check();
    const adapter=createMemoHostAdapter(rawAdapter,{edition:'st',disposeUnderlying:true});
    const renameOff=adapter.attachRenameListener?.({onError:cause=>host.toastr?.error?.(cause.message??'Memo未能跟随聊天更名；原存档保留。')});
    let shell;
    try{shell=initProductShell({host:facade,documentRef:host.document,controllerOptions:{adapter,identity:MEMO_ST_IDENTITY,fetchImpl}});}
    catch(error){renameOff?.();await adapter.dispose?.();throw error;}
    if(!shell){renameOff?.();await adapter.dispose?.();throw new ShiyiError('Memo窗口未能挂载，请刷新页面。','ST_MOUNT_FAILED');}
    const originalDestroy=shell.destroy.bind(shell);
    shell.edition=Object.freeze({name:'memo-st',hostVersion:pkgVersion,account:account.handle});
    shell.adapter=adapter;
    // Browser backup remains an explicit API; the frozen Memo UI has only its chosen exports.
    shell.destroy=async()=>{try{renameOff?.();await originalDestroy();}finally{await adapter.dispose?.();if(host[INSTANCE]===shell)delete host[INSTANCE];}};
    host[INSTANCE]=shell;
    shell.browserBackup=createSTBrowserBackup({indexedDB:host.indexedDB,getAccountId,locks:host.navigator?.locks,
      beforeRestore:()=>shell.destroy(),afterRestore:()=>((host[EPOCH]??0)===epoch?initST({host,importModule,fetchImpl}):false)});

    return shell;
  })();
  const starting={task,abort,epoch};host[STARTING]=starting;
  try{return await task;}finally{if(host[STARTING]===starting)delete host[STARTING];}
}

/** The awaited ST loader must finish before APP_READY. Register, then defer
 * initialization so no model lifetime blocks the host's ready event. */
export function activateST(host=globalThis){
  if(host?.__TAURITAVERN__){host.toastr?.error?.('这是原版酒馆版，请使用Memo TT 版。');return;}
  if(host[READY_LISTENER]||host[INSTANCE])return;
  const context=host.SillyTavern?.getContext?.()??host.getContext?.();
  if(!context?.eventSource?.on)return;
  const type=context.eventTypes?.APP_READY??'app_ready';
  const epoch=host[EPOCH]??0;
  const listener=()=>{deactivateReadyListener(host);host[READY_TIMER]=host.setTimeout(()=>{delete host[READY_TIMER];if((host[EPOCH]??0)!==epoch)return;void initST({host}).catch(error=>{if(error?.code!=='CANCELED'&&error?.name!=='AbortError')host.toastr?.error?.(error.message??'Memo启动失败');});},0);};
  host[READY_LISTENER]={source:context.eventSource,type,listener};context.eventSource.on(type,listener);
}
function deactivateReadyListener(host){const saved=host[READY_LISTENER];if(saved){(saved.source.removeListener??saved.source.off)?.call(saved.source,saved.type,saved.listener);delete host[READY_LISTENER];}}
export async function disableST(host=globalThis){host[EPOCH]=(host[EPOCH]??0)+1;deactivateReadyListener(host);if(host[READY_TIMER]!=null){host.clearTimeout(host[READY_TIMER]);delete host[READY_TIMER];}host[STARTING]?.abort.abort();await host[INSTANCE]?.destroy();}
