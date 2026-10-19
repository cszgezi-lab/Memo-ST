import {initST,activateST,disableST} from './src/st-bootstrap.js';
import {createProductShellController as createCoreController} from './src/product-shell-controller.js';
import {STHostAdapter} from './src/st-host-adapter.js';
import {createMemoHostAdapter} from './src/memo-host-adapter.js';
import {createSTProductFetch} from './src/st-network.js';
export {initProductShell} from './ui/product-view.js';
export * from './src/product-settings.js';
export {DEFAULT_USER_EXTRACTORS,DEFAULT_SUMMARY_LANGUAGE,PROMPT_LABELS,applyExtractors,buildPromptFromExtracted,extractSingleAssistantReply} from './src/user-extractors.js';
export function createProductShellController(options={}){
 const host=options.host??globalThis,fetchImpl=options.fetchImpl??host.fetch?.bind(host);
 const raw=options.adapter??new STHostAdapter(host,{fetchImpl,getAccountId:options.getAccountId??(()=>host[Symbol.for('memo-st.sillytavern.instance')]?.adapter?.getAccountId?.()),nativeHost:host,deviceStorage:host.localStorage,indexedDB:host.indexedDB,locks:host.navigator?.locks});
 const adapter=createMemoHostAdapter(raw,{edition:'st',disposeUnderlying:options.adapter==null,independentLifetime:true});
 const core=createCoreController({...options,host,adapter,fetchImpl:createSTProductFetch(host,fetchImpl)}),descriptors=Object.getOwnPropertyDescriptors(core);
 descriptors.dispose={...descriptors.dispose,value:async()=>{try{return await core.dispose();}finally{await adapter.dispose();}}};
 return Object.freeze(Object.defineProperties({},descriptors));
}
export function init(options={}){return initST(options);}
export function onActivate(){activateST();}
export function onEnable(){return initST();}
export function onDisable(){return disableST();}
export function onDelete(){return disableST();}
