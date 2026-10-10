import {test} from 'node:test';import assert from 'node:assert/strict';
import {readPluginConfig,writePluginConfig} from '../src/plugin-config';
import {saveOAuthSession} from '../src/providers/session';
import {activate} from '../src/plugin';
import type {PhotonApi,PanelModel,UiEvent} from '@photon/plugin-sdk';

function installHost(handler:(method:string,params?:Record<string,unknown>)=>Promise<{value?:unknown;error?:string}>){
  (globalThis as {__photonPlugin?:{request:(method:string,params?:Record<string,unknown>)=>Promise<{value?:unknown;error?:string}>}}).__photonPlugin={request:handler};
}
function clearHost(){delete (globalThis as {__photonPlugin?:unknown}).__photonPlugin;}

test('stock Photon 0.1.47 config.get does not throw and write reports the missing capability',async()=>{
  const calls:string[]=[];
  installHost(async method=>{calls.push(method);return {error:'Unsupported Photon SDK capability: '+method.replace(/^sdk\./,'')};});
  assert.equal(await readPluginConfig('library'),undefined);
  assert.equal(await writePluginConfig('library',{prompts:[],templates:[]}),false);
  assert.deepEqual(calls,['sdk.config.get','sdk.config.set']);
  clearHost();
});

test('a host with config files round-trips library JSON',async()=>{
  const files:Record<string,unknown>={};
  installHost(async(method,params)=>{
    const id=String(params?.id);
    if(method==='sdk.config.get')return {value:files[id]??{}};
    if(method==='sdk.config.set'){files[id]=params?.value;return {};}
    return {};
  });
  assert.equal(await writePluginConfig('library',{prompts:[],templates:[]}),true);
  assert.deepEqual(await readPluginConfig('library'),{prompts:[],templates:[]});
  clearHost();
});

test('missing credentials.store does not throw when saving a session',async()=>{
  installHost(async()=>({error:'Unsupported Photon SDK capability: credentials.store'}));
  await saveOAuthSession('codex',{accessToken:'token'});
  clearHost();
});

test('activate still renders when per-plugin config files are missing',async()=>{
  installHost(async method=>({error:'Unsupported Photon SDK capability: '+method.replace(/^sdk\./,'')}));
  let latest:PanelModel={controls:[]};
  let handler:(event:UiEvent)=>void|Promise<void>=()=>{};
  const api={ui:{render:async(_panel:string,model:PanelModel)=>{latest=model;},onEvent:(callback:typeof handler)=>{handler=callback;return {dispose(){handler=()=>{};}};}},commands:{on:()=>({dispose(){}})},events:{subscribe:()=>({dispose(){}})},settings:{get:async()=>({}),set:async()=>{}},credentials:{status:async()=>({id:'openai',configured:false,persistent:false}),configure:async()=>({id:'openai',configured:true,persistent:true,origin:'https://api.openai.com'}),delete:async()=>{}},network:{request:async()=>({status:200,headers:{},body:{}})},jobs:{run:async()=>{}},documents:{active:async()=>null,capture:async()=>{throw new Error('unused');},release:async()=>{},applyImage:async()=>({documentId:'doc',layerId:'new'})},images:{encode:async()=>({width:1,height:1,pixels:new Uint8Array(),bytes:new Uint8Array()}),decode:async()=>({width:1,height:1,pixels:new Uint8Array()})},files:{pick:async()=>null}} as unknown as PhotonApi;
  const lifecycle=await activate(api);
  assert.ok(latest.controls.some(control=>control.id==='provider'));
  lifecycle.dispose();
  clearHost();
  void handler;
});
