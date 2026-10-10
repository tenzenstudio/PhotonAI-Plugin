import {PluginError,type PhotonApi,type PanelModel,type Control,type Capture,type ImagePixels} from '@photon/plugin-sdk';
import {providers,modelsFor} from './providers/catalog';
import {adapters} from './providers';
import type {Mode,ProviderId,Model,GenerateRequest,ImageInput} from './providers/types';
import {REMOVE_PROMPT,base64} from './providers/common';
import {ideogramMask} from './providers/ideogram';
import {startDeviceLogin,completeDeviceLogin,refreshSession,type OAuthProvider,type OAuthSession} from './providers/oauth';
import {clearOAuthSession,loadOAuthSession,saveOAuthSession} from './providers/session';
import {MODEL_CACHE_MS,cachedBundledModels,listsModels,loadProviderModels,modelCacheStale,sanitizeModelCache,type ModelCacheEntry} from './providers/model-list';
import {applyOutputOptions} from './providers/output-options';
import {signInDialog,updateSignInDialog} from './signin';
import {loadAccountQuota} from './providers/quota';
import {cleanLibrary,fillTemplate,migrateTemplateSyntax,newId,recordPrompt,referenceBytes,REFERENCE_BUDGET,ROOT_FOLDER,templateFields,type LibraryState,type PromptItem,type ReferenceImage,type TemplateItem,type TemplateField} from './library';
import {captureHistoryContext,cleanHistoryImages,compactHistoryImages,historyImageBytes,restoreHistoryImages,restoreHistoryTemplate} from './history-images';
import {seedPremadeTemplates} from './premade-templates';
import {ensureEditPrompts,editPrompt,editActionHints,type EditAction} from './edit-prompts';
import {readPluginConfig,writePluginConfig} from './plugin-config';
import type {CustomPanel} from './custom-ui';
import {canConvertTemplate,convertTemplate} from './template-conversion';
import {exportCollection as prepareCollectionExport,importCollection as prepareCollectionImport} from './library-transfer';
interface Settings {provider:ProviderId;models:Partial<Record<ProviderId,string>>;customBase:string;customModel:string;customEdit:boolean;customSizes:string;customQualities:string;customMaxEdge:number;modelCache:Partial<Record<ProviderId,ModelCacheEntry>>;library:LibraryState;historyImages?:unknown;}
interface Result {bytes:Uint8Array;image:ImagePixels;capture?:Capture;name:string;mode:Mode;editMethod?:'mask'|'prompt';target?:{documentId:string;revision:number};}
export async function activate(api:PhotonApi,panel?:CustomPanel){
  const oldSettings=await api.settings.get<Partial<Settings>>();
  const storedLibrary=await readPluginConfig<unknown>('library');
  const storedHistoryImages=await readPluginConfig<unknown>('references');
  const hasStoredLibrary=!!storedLibrary&&typeof storedLibrary==='object'&&Array.isArray((storedLibrary as Partial<LibraryState>).templates)&&Array.isArray((storedLibrary as Partial<LibraryState>).prompts);
  const {library:_ignoredLibrary,historyImages:settingsHistoryImages,...restSettings}=oldSettings;
  let settings:Settings={provider:'openai',models:{},customBase:'https://api.openai.com/v1',customModel:'',customEdit:true,customSizes:'1024x1024,1536x1024,1024x1536',customQualities:'',customMaxEdge:2048,modelCache:{},...restSettings,library:cleanLibrary(hasStoredLibrary?storedLibrary:oldSettings.library)};
  const historyImages=cleanHistoryImages(storedHistoryImages??settingsHistoryImages);
  let historyImagesDirty=compactHistoryImages(historyImages,settings.library);
  const seededTemplates=seedPremadeTemplates(settings.library);
  const seededEditPrompts=ensureEditPrompts(settings.library);
  const migratedTemplateSyntax=migrateTemplateSyntax(settings.library);
  settings.modelCache=sanitizeModelCache(settings.modelCache);
  if(!providers.some(p=>p.id===settings.provider))settings.provider='openai';
  let mode:Mode='generate',editAction:EditAction='add',prompt='',promptSaveError='',size='1024x1024',quality='auto',busy=false,error='',credential=false,persistent=true,result:Result|undefined,insert=false,hasSelection=false,activeTemplateId='',restoredTemplate:TemplateItem|undefined,restoredEditInstruction:string|undefined,expectedReplayModel:string|undefined,templateValues:Record<string,string>={},manualReferences:ReferenceImage[]=[];
  const sessions:Partial<Record<'codex'|'grok',OAuthSession>>={};const quotas:Partial<Record<'codex'|'grok',string>>={};
  const subscriptions:{dispose():void}[]=[];let disposed=false;const listAbort=new AbortController();let refreshTimer:ReturnType<typeof setTimeout>|undefined;let quotaTimer:ReturnType<typeof setTimeout>|undefined;let quotaBusy=false;
  const provider=()=>providers.find(p=>p.id===settings.provider)!;
  const customModel=():Model=>({id:settings.customModel,label:settings.customModel||'Enter a model ID',generate:true,edit:settings.customEdit?'mask':false,maxEdge:Math.min(8192,Math.max(64,settings.customMaxEdge||2048)),sizes:settings.customSizes.split(',').map(v=>v.trim()).filter(v=>/^[1-9][0-9]{1,3}x[1-9][0-9]{1,3}$/.test(v)),qualities:settings.customQualities.split(',').map(v=>v.trim()).filter(Boolean)});
  const models=():Model[]=>{
    if(settings.provider==='custom')return [customModel()];
    const cached=settings.modelCache[settings.provider]?.models;
    const choices=modelsFor({...provider(),models:cached?.length?cached:provider().models},mode).map(item=>applyOutputOptions(settings.provider,item));
    if(mode==='fill'&&(settings.provider==='openai'||settings.provider==='codex')){
      choices.sort((a,b)=>Number(/gpt-image-2\.5-sunburst/.test(b.id))-Number(/gpt-image-2\.5-sunburst/.test(a.id)));
      return choices.map(item=>({...item,label:/gpt-image-2\.5-sunburst/.test(item.id)?`${item.label} · Precise`:/gpt-image-2\.5-flare/.test(item.id)?`${item.label} · Fast`:item.label}));
    }
    return choices;
  };
  const sizeLabel=(value:string)=>{const pixels=/^(\d+)x(\d+)$/.exec(value);if(pixels)return pixels[1]+' × '+pixels[2];return value==='auto'?'Auto':value;};
  const qualityLabel=(value:string):string=>{const compound=/^([a-z]+(?:_[a-z]+)?)@([0-9.]+k)$/i.exec(value);if(compound)return qualityLabel(compound[1])+' · '+compound[2].toUpperCase();if(value==='xhigh')return 'Extra high';if(value==='hd')return 'HD';if(/^[0-9.]+k$/i.test(value))return value.toUpperCase();return value.split('_').map(part=>part?part[0].toUpperCase()+part.slice(1):part).join(' ');};
  const model=()=>models().find(m=>m.id===settings.models[settings.provider])??models()[0];
  const activeTemplate=()=>restoredTemplate??settings.library.templates.find(item=>item.id===activeTemplateId);
  const keyId=()=>settings.provider;
  const endpoint=()=>settings.provider==='custom'?new URL(settings.customBase).origin:provider().origin;
  const refreshContext=async()=>{const doc=await api.documents.active();hasSelection=!!doc?.hasSelection;};
  const clearResult=async()=>{if(result?.capture)await api.documents.release(result.capture.token).catch(()=>{});result=undefined;};
  const save=async(preserveHistoryId?:string)=>{
    const bytes=()=>new TextEncoder().encode(JSON.stringify(settings.library)).length;
    historyImagesDirty=compactHistoryImages(historyImages,settings.library)||historyImagesDirty;
    while(settings.library.history.length&&(settings.library.history.length>500||bytes()>900_000||historyImageBytes(historyImages)>900_000)){
      if(settings.library.history[0].id===preserveHistoryId)throw new PluginError('HISTORY_FULL','This prompt and its references exceed the available History storage. Remove saved cards or references, then try again.');
      settings.library.history.shift();historyImagesDirty=compactHistoryImages(historyImages,settings.library)||historyImagesDirty;
    }
    if(bytes()>940_000||historyImageBytes(historyImages)>940_000)throw new PluginError('LIBRARY_FULL','The library is full. Remove saved cards or image references before adding more.');
    historyImagesDirty=compactHistoryImages(historyImages,settings.library)||historyImagesDirty;
    const wroteRefs=!historyImagesDirty||await writePluginConfig('references',historyImages as unknown as Record<string,unknown>);
    if(historyImagesDirty&&wroteRefs)historyImagesDirty=false;
    const wroteLibrary=await writePluginConfig('library',settings.library as unknown as Record<string,unknown>);
    const {library:_library,historyImages:_storedImages,...mainSettings}=settings;
    await api.settings.set((wroteLibrary&&wroteRefs?mainSettings:{...mainSettings,library:settings.library,...wroteRefs?{}:{historyImages}}) as Record<string,unknown>);
  };
  const fieldControl=(field:TemplateField):Control=>{
    const id='templateField:'+field.name,value=templateValues[field.name];
    if(field.kind==='check')return {type:'checkbox',id,label:field.name,value:value==='true',disabled:busy,description:field.choices?.[1]?.content?'Unchecked: '+field.choices[1].content:undefined};
    if(field.kind==='radio'||field.kind==='multi'||field.kind==='multiselect'){
      const selected=new Set((value??'').split(',').filter(Boolean));
      return {type:'group',id:'templateOptions:'+field.kind+':'+field.name,label:field.name,disabled:busy,children:(field.choices??[]).map((choice,index)=>({type:'checkbox',id:'templateOption:'+field.name+':'+index,label:choice.label,value:field.kind==='radio'?(value??'0')===String(index):selected.has(String(index)),disabled:busy}))};
    }
    if(field.kind==='select')return {type:'select',id,label:field.name,value:value??'0',disabled:busy,options:(field.choices??[]).map((choice,index)=>({value:String(index),label:choice.label}))};
    if(field.options.length)return {type:'select',id,label:field.name,value:value??field.options[0],disabled:busy,options:field.options.map(option=>({value:option,label:option}))};
    return {type:'input',id,label:field.name,value:value??'',disabled:busy};
  };
  if(seededTemplates||seededEditPrompts||migratedTemplateSyntax||historyImagesDirty||!hasStoredLibrary||oldSettings.library!==undefined)await save();
  const refreshCredential=async()=>{const info=await api.credentials.status(keyId());credential=info.configured;try{credential=credential&&info.origin===endpoint();}catch{credential=false;}persistent=info.persistent;};
  const listContext=(id:ProviderId)=>({api,credential:id,job:{id:'models',signal:listAbort.signal,progress:async()=>{}}});
  const refreshModels=async(id:ProviderId,force:boolean)=>{
    if(disposed||!listsModels(id))return;const current=settings.modelCache[id];if(!force&&!modelCacheStale(current)&&!cachedBundledModels(id,current))return;
    const session=id==='codex'||id==='grok'?sessions[id]:undefined;
    if(!session){const info=await api.credentials.status(id);let origin='';try{origin=id==='custom'?new URL(settings.customBase).origin:providers.find(item=>item.id===id)!.origin;}catch{return;}if(!info.configured||info.origin!==origin)return;}
    let timer:ReturnType<typeof setTimeout>|undefined;const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new PluginError('TIMEOUT','The model list took too long.')),20_000);});
    try{const loaded=await Promise.race([loadProviderModels(listContext(id),id,{accessToken:session?.accessToken,accountId:session?.accountId,baseUrl:id==='custom'?settings.customBase:undefined}),timeout]);if(disposed)return;if(!loaded.length)throw new PluginError('MODEL_UNAVAILABLE','The account did not return any image models.');const selected=settings.models[id];if(selected&&!loaded.some(item=>item.id===selected))delete settings.models[id];settings.modelCache={...settings.modelCache,[id]:{fetchedAt:Date.now(),models:loaded}};await save();}
    finally{clearTimeout(timer);}
  };
  const armRefresh=()=>{clearTimeout(refreshTimer);if(disposed)return;const entry=settings.modelCache[settings.provider];const delay=entry?Math.max(60_000,entry.fetchedAt+MODEL_CACHE_MS-Date.now()):MODEL_CACHE_MS;const handle=setTimeout(()=>{void refreshModels(settings.provider,false).finally(armRefresh);},delay);(handle as {unref?:()=>void}).unref?.();refreshTimer=handle;};
  const restoreSessions=async()=>{for(const id of ['codex','grok'] as const){const saved=await loadOAuthSession(id);if(!saved)continue;try{const current=saved.refreshToken&&(!saved.expiresAt||saved.expiresAt<Date.now()+60_000)?await refreshSession(listContext(id),id,saved):saved;sessions[id]=current;if(current!==saved)await saveOAuthSession(id,current);}catch{delete sessions[id];await clearOAuthSession(id);}}};
  const refreshQuota=async(id:'codex'|'grok')=>{const session=sessions[id];if(!session){delete quotas[id];return;}try{const line=await loadAccountQuota(listContext(id),id,session);if(!disposed&&line)quotas[id]=line;}catch{/* Keep the last quota line. */}};
  const refreshShownQuota=()=>{if(disposed||quotaBusy||settings.provider!=='codex'&&settings.provider!=='grok'||!sessions[settings.provider])return;quotaBusy=true;void refreshQuota(settings.provider).then(()=>{if(!disposed)return publish();}).finally(()=>{quotaBusy=false;});};
  const armQuota=()=>{clearTimeout(quotaTimer);if(disposed)return;const handle=setTimeout(()=>{refreshShownQuota();armQuota();},10*60*1000);(handle as {unref?:()=>void}).unref?.();quotaTimer=handle;};
  const publish=async()=>{
    if(disposed)return;const m=model();if(m?.sizes?.length&&!m.sizes.includes(size))size=m.sizes[0];if(m?.qualities?.length&&!m.qualities.includes(quality))quality=m.qualities[0];const controls:Control[]=[
      {type:'tabs',id:'mode',label:'Image operation',value:mode,disabled:busy,options:[{value:'generate',label:'Generate'},{value:'remove',label:'Remove'},{value:'fill',label:'Edit'}]},
      {type:'select',id:'provider',label:'Provider',value:settings.provider,disabled:busy,options:providers.map(p=>({value:p.id,label:p.label}))}
    ];
    const oauthId=settings.provider==='codex'||settings.provider==='grok'?settings.provider:undefined;const oauthSession=oauthId?sessions[oauthId]:undefined;const signedIn=!!oauthSession||credential;
    if(settings.provider==='midjourney')controls.push({type:'text',text:'Midjourney does not publish an official image API. Create the image there, then open it in Photon.'});
    else if(oauthId){if(oauthSession)controls.push({type:'button',id:'forgetLogin',label:'Forget Login',disabled:busy});else controls.push({type:'button',id:'configure',label:oauthId==='codex'?'Sign in with Codex':'Sign in with Grok',disabled:busy});if(oauthId==='grok')controls.push({type:'button',id:'apikey',label:credential?'Change API key':'Use an API key',disabled:busy});if(!oauthSession)controls.push({type:'text',text:credential?(persistent?'API key saved securely on this device.':'API key available for this session.'):'Sign in with the device code. The access token is not shown.'});if(error)controls.push({type:'text',tone:'danger',text:error});}
    else controls.push({type:'button',id:'configure',label:credential?'Change API key':'Connect provider',disabled:busy},{type:'text',text:credential?(persistent?'API key saved securely on this device.':'API key available for this session.'):'Connect this provider to start.'});
    if(settings.provider!=='midjourney'&&credential)controls.push({type:'button',id:'forget',label:'Forget API key',disabled:busy});
    if(settings.provider==='custom')controls.push({type:'input',id:'customBase',label:'API base URL',value:settings.customBase,disabled:busy,description:'An OpenAI-compatible API base, including /v1 when required.'},{type:'input',id:'customModel',label:'Model ID',value:settings.customModel,disabled:busy},{type:'input',id:'customSizes',label:'Supported sizes',value:settings.customSizes,disabled:busy,description:'Comma-separated widthxheight values; leave blank to use provider defaults.'},{type:'input',id:'customQualities',label:'Supported qualities',value:settings.customQualities,disabled:busy,description:'Comma-separated API values; leave blank if unsupported.'},{type:'number',id:'customMaxEdge',label:'Maximum reference edge',value:settings.customMaxEdge,min:64,max:8192,disabled:busy},{type:'checkbox',id:'customEdit',label:'This model supports masked image edits',value:settings.customEdit,disabled:busy});
    else controls.push({type:'select',id:'model',label:'Model',description:oauthId&&oauthSession&&!error?quotas[oauthId]:undefined,value:m?.id??'',disabled:busy,options:models().map(item=>({value:item.id,label:item.label}))});
    const accountModels=settings.provider==='custom'?settings.modelCache.custom?.models??[]:[];
    if(accountModels.length)controls.push({type:'select',id:'accountModel',label:'Account models',value:accountModels.some(item=>item.id===settings.customModel)?settings.customModel:'',disabled:busy,options:accountModels.map(item=>({value:item.id,label:item.label}))});
    if(mode!=='generate')controls.push({type:'text',id:hasSelection&&m?.edit==='prompt'?'selectionHelp':undefined,text:hasSelection?'The current selection defines the editable region.':'Make a selection in the document to continue.'});
    if(mode==='fill')controls.push({type:'tabs',id:'editAction',label:'Edit action',value:editAction,disabled:busy,options:[{value:'add',label:'Add'},{value:'change',label:'Change'},{value:'replace',label:'Replace'}]});
    if(mode!=='generate'&&!m?.edit)controls.push({type:'text',tone:'danger',text:'This model does not support image editing. Choose a model with edit support.'});
    if(mode!=='remove'){
      controls.push({type:'textarea',id:'prompt',label:mode==='fill'?editActionHints[editAction]:'Describe your image',value:prompt,description:promptSaveError,disabled:busy});
      controls.push({type:'group',id:'promptActions',children:[{type:'button',id:'library',label:'Library',disabled:busy},{type:'button',id:'templates',label:'Templates',disabled:busy}]});
      const template=activeTemplate();
      if(template){const fields:Control[]=templateFields(template.text).map(fieldControl);if(template.transparentBackground)fields.push({type:'text',text:'Transparent image · OpenAI, Codex, or Grok'});controls.push({type:'group',id:'templateSurface',label:template.name,children:fields});}
      const refs=[...(template?.references??[]),...manualReferences];
      controls.push({type:'group',id:'referenceStrip',label:'Image references',children:refs.map(r=>({type:'image',id:'reference:'+r.id,label:r.name,src:r.dataUrl}))});
    }
    if(m?.sizes?.length)controls.push({type:'select',id:'size',label:'Output size',value:size,disabled:busy,options:m.sizes.map(value=>({value,label:sizeLabel(value)}))});
    if(m?.qualities?.length)controls.push({type:'select',id:'quality',label:'Quality',value:quality,disabled:busy,options:m.qualities.map(value=>({value,label:qualityLabel(value)}))});
    if(mode==='generate')controls.push({type:'checkbox',id:'insert',label:'Insert into the current document',value:insert,disabled:busy});
    if(error&&!oauthId)controls.push({type:'text',tone:'danger',text:error});
    controls.push({type:'button',id:'run',tone:'primary',label:busy?'Working…':result?'Regenerate':mode==='generate'?'Generate Image':mode==='remove'?'Remove Selection':'Generate Edit',disabled:busy||settings.provider==='midjourney'||!signedIn||!m?.id||!!expectedReplayModel&&m.id!==expectedReplayModel||(mode==='generate'?!m?.generate:!m?.edit)||mode!=='generate'&&!hasSelection});
    if(result)controls.push({type:'group',label:'Result preview',children:[
      {type:'image',label:result.name,src:'data:image/png;base64,'+base64(result.bytes)},
      {type:'group',id:'resultActions',children:[
        {type:'button',id:'apply',tone:'primary',label:'Apply',disabled:busy},
        {type:'button',id:'discard',label:'Discard',disabled:busy},
        {type:'button',id:'export',label:'Save as PNG',disabled:busy}
      ]},
      ...(result.mode==='generate'?[]:[{type:'text' as const,text:result.editMethod==='mask'?'The provider received the selection mask. Check the preview; Apply limits changes to the selection.':'The provider received a selection guide. The preview may change nearby content; Apply limits changes to the selection.'}]),
      {type:'text',text:'Apply creates a new layer with one undo step. Your original layers stay editable.'}
    ]});
    await api.ui.render('ai',{title:'AI',controls} satisfies PanelModel);
  };
  const run=async()=>{
    if(busy)return;const selected=model();if(!selected?.id||expectedReplayModel&&selected.id!==expectedReplayModel)throw new PluginError('MODEL_UNAVAILABLE','The saved model is unavailable. Choose another model before running.');
    if(mode!=='remove'&&!prompt.trim())throw new PluginError('PROMPT_REQUIRED','Write a prompt before generating.');
    if(mode!=='generate'&&!selected.edit)throw new PluginError('MODEL_UNAVAILABLE','This model does not support editing.');
    const selectedTemplate=mode==='remove'?undefined:activeTemplate();const selectedReferences=[...(selectedTemplate?.references??[]),...manualReferences];
    if(selectedTemplate?.transparentBackground&&(mode!=='generate'||!['openai','codex','grok'].includes(settings.provider)||settings.provider!=='grok'&&!selected.id.startsWith('gpt-image-')))throw new PluginError('TRANSPARENT_UNSUPPORTED','Transparent images require Generate mode with OpenAI, Codex, or Grok.');
    if(mode!=='remove'&&selectedReferences.length&&!['openai','codex','gemini','grok','xai'].includes(settings.provider))throw new PluginError('REFERENCES_UNSUPPORTED','This provider does not support image references here. Remove the references or choose OpenAI, Codex, Gemini, or Grok.');
    busy=true;error='';await publish();const requestedMode=mode;const requestedProvider=settings.provider;let capture:Capture|undefined;
    try{
      const next=await api.jobs.run(requestedMode==='generate'?'Generating image…':requestedMode==='remove'?'Removing selection…':'Editing selection…',async job=>{
        const target=insert&&requestedMode==='generate'?await api.documents.active():null;if(insert&&requestedMode==='generate'&&!target)throw new PluginError('DOCUMENT_REQUIRED','Open a document before inserting an image.');
        let source:ImageInput|undefined;
        if(requestedMode!=='generate'){
          await job.progress('Capturing selection…');capture=await api.documents.capture({selection:true,padding:64});job.signal.throwIfAborted();
          const encoded=await api.images.encode(capture,{maxEdge:selected.maxEdge});
          const maskPixels=new Uint8Array(capture.width*capture.height*4);for(let i=0;i<capture.mask!.length;i++){maskPixels[i*4]=maskPixels[i*4+1]=maskPixels[i*4+2]=capture.mask![i];maskPixels[i*4+3]=255;}
          const maskImage={width:capture.width,height:capture.height,pixels:requestedProvider==='ideogram'?ideogramMask(capture.mask!):maskPixels};
          const white=await api.images.encode(maskImage,requestedProvider==='ideogram'?{maxEdge:selected.maxEdge}:{maxEdge:selected.maxEdge,mask:'white'}),alpha=await api.images.encode({width:capture.width,height:capture.height,pixels:maskPixels},{maxEdge:selected.maxEdge,mask:'alpha'});
          if(encoded.width!==white.width||encoded.height!==white.height||encoded.width!==alpha.width||encoded.height!==alpha.height)throw new PluginError('MASK_SIZE','The selection mask does not match the source image. Try the edit again.');
          source={png:encoded.bytes,whiteMask:white.bytes,alphaMask:alpha.bytes,width:encoded.width,height:encoded.height};
        }
        const oauthProvider=requestedProvider==='codex'||requestedProvider==='grok'?requestedProvider:undefined;let session=oauthProvider?sessions[oauthProvider]:undefined;if(oauthProvider&&session?.refreshToken&&session.expiresAt&&session.expiresAt<Date.now()+60_000){session=await refreshSession({api,job,credential:oauthProvider},oauthProvider,session);sessions[oauthProvider]=session;}
        const template=requestedMode==='remove'?undefined:activeTemplate();
        const context=template?fillTemplate(template.text,templateValues).trim():'';
        const editInstruction=requestedMode==='fill'?(restoredEditInstruction??editPrompt(settings.library,editAction)):undefined;
        const fullPrompt=requestedMode==='remove'?REMOVE_PROMPT:[editInstruction??'',context,prompt.trim()].filter(Boolean).join('\n\n');
        const references=requestedMode==='remove'?[]:[...(template?.references??[]),...manualReferences];
        const request:GenerateRequest={provider:requestedProvider,mode:requestedMode,model:selected.id,prompt:fullPrompt,size:selected.sizes?.length?size:requestedProvider==='custom'?'':'1024x1024',quality:selected.qualities?.length?quality:'',transparentBackground:!!template?.transparentBackground,source,references:references.map(r=>r.dataUrl),...(requestedProvider==='custom'?{baseUrl:settings.customBase}:{}),...(session?{accessToken:session.accessToken,accountId:session.accountId}:{})};
        const historyContext=captureHistoryContext(historyImages,{mode:requestedMode,editAction,editInstruction,provider:requestedProvider,model:selected.id,size:request.size,quality:request.quality,insert,template,values:templateValues,manualReferences});
        historyImagesDirty=true;
        const historyItem=recordPrompt(settings.library,requestedMode==='remove'?'Remove selection':prompt.trim(),historyContext);
        try{await save(historyItem.id);}catch(reason){settings.library.history=settings.library.history.filter(item=>item.id!==historyItem.id);historyImagesDirty=compactHistoryImages(historyImages,settings.library)||historyImagesDirty;throw reason;}
        await job.progress('Sending to '+provider().label+'…');const bytes=await adapters[requestedProvider].run({api,job,credential:keyId()},request);job.signal.throwIfAborted();
        await job.progress('Preparing preview…');const image=await api.images.decode(bytes,capture?{width:capture.bounds.width,height:capture.bounds.height}:undefined);job.signal.throwIfAborted();const encoded=await api.images.encode(image,{maxEdge:8192});
        return {bytes:encoded.bytes,image,capture,name:requestedMode==='generate'?'AI Generated Image':requestedMode==='remove'?'AI Remove':'AI Edit',mode:requestedMode,editMethod:selected.edit||undefined,target:target?{documentId:target.id,revision:target.revision}:undefined} satisfies Result;
      });
      await clearResult();result=next;capture=undefined;
    }catch(e){if(capture)await api.documents.release(capture.token).catch(()=>{});error=e instanceof Error?e.message:String(e);}
    finally{busy=false;await refreshContext();await publish();}
  };
  const restorePromptContext=async(item:PromptItem)=>{
    const context=item.context;
    const templateReferences=restoreHistoryImages(historyImages,item,'template');
    const savedManualReferences=restoreHistoryImages(historyImages,item,'manual');
    const missing=(context?.references.length??0)-templateReferences.length-savedManualReferences.length;
    if(missing>0)throw new PluginError('HISTORY_REFERENCES_MISSING','This prompt is missing saved image references and cannot be restored.');
    prompt=context?.mode==='remove'?'':item.text;promptSaveError='';
    restoredTemplate=undefined;activeTemplateId='';restoredEditInstruction=undefined;expectedReplayModel=undefined;templateValues={};manualReferences=[];
    if(!context){mode='generate';await refreshContext();await publish();return;}
    mode=context.mode;
    if(context.editAction)editAction=context.editAction;
    if(context.mode==='fill')restoredEditInstruction=context.editInstruction;
    manualReferences=savedManualReferences;
    restoredTemplate=restoreHistoryTemplate(historyImages,item);
    if(restoredTemplate){activeTemplateId=restoredTemplate.id;templateValues={...context.template!.values};}
    if(context.provider&&providers.some(entry=>entry.id===context.provider)){
      settings.provider=context.provider as ProviderId;
      if(context.model){settings.models[settings.provider]=context.model;expectedReplayModel=context.model;if(settings.provider==='custom')settings.customModel=context.model;}
      await refreshCredential();armRefresh();
    }
    if(context.size)size=context.size;
    if(context.quality)quality=context.quality;
    insert=context.insert===true;
    await refreshContext();
    const unavailable=!!context.model&&model()?.id!==context.model;
    error=context.provider&&!providers.some(entry=>entry.id===context.provider)?'The saved provider is unavailable. Choose a provider before running.':unavailable?'The saved model is unavailable. Choose a model before running.':'';
    await save();await publish();
  };
  const onEvent=async(event:{id:string;value?:string|number|boolean})=>{
    if(busy)return;error='';
    try{
      if(event.id==='configure'&&(settings.provider==='codex'||settings.provider==='grok')){busy=true;await publish();const providerId=settings.provider;const controller=new AbortController();const context={api,credential:providerId,job:{id:'oauth',signal:controller.signal,progress:async()=>{}}};const pending=await startDeviceLogin(context,providerId);let tokens:OAuthSession|undefined,failure:unknown;const polling=completeDeviceLogin(context,pending).then(async value=>{tokens=value;await updateSignInDialog(signInDialog(providerId,pending,true));}).catch(async reason=>{failure=reason;await updateSignInDialog(signInDialog(providerId,pending,false,reason instanceof Error?reason.message:'Sign-in did not finish.'));});const choice=await api.ui.dialog(signInDialog(providerId,pending,false));if(!choice||choice.id==='cancel'){controller.abort();await polling.catch(()=>{});if(failure)throw failure instanceof Error?failure:new PluginError('AUTHENTICATION','Sign-in did not finish.');throw new PluginError('CANCELLED','Sign-in cancelled.');}await polling;if(!tokens)throw failure instanceof Error?failure:new PluginError('AUTHENTICATION','Sign-in did not finish.');sessions[providerId]=tokens;let saveFailure:unknown;try{await saveOAuthSession(providerId,tokens);}catch(reason){saveFailure=reason;}await refreshModels(providerId,true);armRefresh();await refreshQuota(providerId);if(saveFailure)throw saveFailure instanceof Error?saveFailure:new PluginError('AUTHENTICATION','Sign-in could not be saved for the next launch.');busy=false;}
      else if(event.id==='configure'||event.id==='apikey'){busy=true;await publish();if(settings.provider==='custom')await api.network.allowEndpoint(endpoint());const info=await api.credentials.configure(keyId(),provider().label+' API key',endpoint());credential=info.configured;persistent=info.persistent;await refreshModels(settings.provider,true);armRefresh();busy=false;}
      else if(event.id==='forgetLogin'&&(settings.provider==='codex'||settings.provider==='grok')){const oauthId=settings.provider as OAuthProvider;delete sessions[oauthId];delete quotas[oauthId];await clearOAuthSession(oauthId);const modelCache={...settings.modelCache};delete modelCache[oauthId];settings.modelCache=modelCache;await save();}
      else if(event.id==='forget'){await api.credentials.delete(keyId());credential=false;}
      else if(event.id==='run'){promptSaveError='';await run();return;}
      else if(event.id==='savePrompt'){
        const text=prompt.trim();
        if(!text)promptSaveError='Write a prompt before saving it.';
        else {
          promptSaveError='';const now=Date.now(),selected=model();
          const previousHistory=[...settings.library.history],previousImages={...historyImages.images};
          const context=captureHistoryContext(historyImages,{mode,editAction,editInstruction:mode==='fill'?(restoredEditInstruction??editPrompt(settings.library,editAction)):undefined,provider:settings.provider,model:selected?.id??'',size,quality,insert,template:activeTemplate(),values:templateValues,manualReferences});
          const item:PromptItem={id:newId(),folderId:ROOT_FOLDER,text,order:now,createdAt:now,updatedAt:now,context};
          historyImagesDirty=true;settings.library.prompts.push(item);
          try{await save();}catch(reason){settings.library.prompts=settings.library.prompts.filter(saved=>saved.id!==item.id);settings.library.history=previousHistory;historyImages.images=previousImages;historyImagesDirty=true;throw reason;}
        }
      }
      else if((event.id==='library'||event.id==='templates')&&panel){const selected=model(),conversionProvider=settings.provider;await panel.openCollection(event.id==='library'?'prompts':'templates',{library:settings.library,historyImages:historyImages.images,save:save,
        exportCollection:async(view,folderId)=>{
          const transfer=prepareCollectionExport(settings.library,historyImages,view,folderId);
          const scope=(transfer.folderName??'All').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,50);
          const file=await api.files.pick({save:true,name:`PhotonAI-${view}-${scope}.json`});
          if(!file)return null;
          await api.files.write(file,new TextEncoder().encode(transfer.json));
          return {count:transfer.count};
        },
        importCollection:async view=>{
          const file=await api.files.pick();
          if(!file)return null;
          const data=await api.files.read(file);
          if(data.length>8_000_000)throw new Error('This import file is too large.');
          const json=new TextDecoder('utf-8',{fatal:true}).decode(data);
          const transfer=prepareCollectionImport(settings.library,historyImages,view,json);
          const previousLibrary=structuredClone(settings.library),previousImages={...historyImages.images};
          Object.assign(settings.library,transfer.library);
          for(const key of Object.keys(historyImages.images))delete historyImages.images[key];
          Object.assign(historyImages.images,transfer.images.images);
          historyImagesDirty=true;
          try{await save();}catch(reason){Object.assign(settings.library,previousLibrary);for(const key of Object.keys(historyImages.images))delete historyImages.images[key];Object.assign(historyImages.images,previousImages);historyImagesDirty=true;throw reason;}
          return {count:transfer.count,folderName:transfer.folderName};
        },usePrompt:async item=>{if(item.context){await restorePromptContext(item);return;}prompt=item.text;promptSaveError='';expectedReplayModel=undefined;restoredEditInstruction=undefined;if(restoredTemplate){restoredTemplate=undefined;activeTemplateId='';templateValues={};manualReferences=[];}await publish();},useHistory:restorePromptContext,useTemplate:async item=>{restoredTemplate=undefined;restoredEditInstruction=undefined;expectedReplayModel=undefined;activeTemplateId=item.id;templateValues={};await publish();},conversion:{model:selected?.label??'No model selected',available:!!selected&&canConvertTemplate(conversionProvider,selected.id)},convertTemplate:async(text,direction)=>{if(!selected?.id)throw new PluginError('MODEL_UNAVAILABLE','Choose a model before converting.');if(conversionProvider==='codex'?!sessions.codex:!credential)throw new PluginError('AUTHENTICATION','Connect this provider before converting.');return convertTemplate(api,{provider:conversionProvider,model:selected.id,baseUrl:settings.customBase,credential:conversionProvider,text,direction,codexSession:sessions.codex,onCodexSession:async session=>{sessions.codex=session;await saveOAuthSession('codex',session);}});}});return;}
      else if(event.id==='clearTemplate'){activeTemplateId='';restoredTemplate=undefined;templateValues={};}
      else if(event.id==='panelError'){error=String(event.value??'');}
      else if(event.id.startsWith('templateField:')){templateValues[event.id.slice(14)]=String(event.value??'');return;}
      else if(event.id.startsWith('templateOption:')){
        const match=/^templateOption:(.*):(\d+)$/.exec(event.id);
        const template=activeTemplate();
        const field=template&&match?templateFields(template.text).find(item=>item.name===match[1]):undefined;
        const index=match?Number(match[2]):-1;
        if(!field||index<0||index>=(field.choices?.length??0))return;
        if(field.kind==='radio')templateValues[field.name]=String(index);
        else if(field.kind==='multi'||field.kind==='multiselect'){
          const selected=new Set((templateValues[field.name]??'').split(',').filter(Boolean));
          if(event.value)selected.add(String(index));else selected.delete(String(index));
          templateValues[field.name]=[...selected].sort((a,b)=>Number(a)-Number(b)).join(',');
        }
        return;
      }
      else if(event.id==='manualReference'){const ref=JSON.parse(String(event.value)) as ReferenceImage;if(!/^data:image\/(png|jpeg|webp);base64,/.test(ref.dataUrl))throw new PluginError('INVALID_REFERENCE','Choose an image reference.');const manualBytes=manualReferences.reduce((n,r)=>n+r.dataUrl.length,0)+ref.dataUrl.length;const restoredBytes=restoredTemplate?.references.reduce((n,r)=>n+r.dataUrl.length,0)??0;if(referenceBytes(settings.library)+manualBytes>REFERENCE_BUDGET||restoredBytes+manualBytes>REFERENCE_BUDGET)throw new PluginError('REFERENCE_LIMIT','Reference storage is full. Remove an image before adding another.');manualReferences.push(ref);}
      else if(event.id.startsWith('removeReference:')){const id=event.id.slice(16);manualReferences=manualReferences.filter(r=>r.id!==id);const template=activeTemplate();if(template?.references.some(r=>r.id===id)){template.references=template.references.filter(r=>r.id!==id);if(!restoredTemplate)await save();}}
      else if(event.id==='apply'&&result){busy=true;await publish();await api.documents.applyImage({image:result.image,name:result.name,captureToken:result.capture?.token,documentId:result.target?.documentId,expectedRevision:result.target?.revision,newDocument:result.mode==='generate'&&!result.target});await clearResult();busy=false;await refreshContext();}
      else if(event.id==='discard')await clearResult();
      else if(event.id==='export'&&result){const file=await api.files.pick({save:true,name:result.name+'.png'});if(file)await api.files.write(file,result.bytes);}
      else if(event.id==='provider'){settings.provider=event.value as ProviderId;expectedReplayModel=undefined;await refreshCredential();await refreshModels(settings.provider,false);if(settings.provider==='codex'||settings.provider==='grok')await refreshQuota(settings.provider);armRefresh();await save();}
      else if(event.id==='mode'){mode=event.value as Mode;expectedReplayModel=undefined;await refreshContext();}
      else if(event.id==='editAction'&&['add','change','replace'].includes(String(event.value))){editAction=event.value as EditAction;restoredEditInstruction=undefined;}
      else if(event.id==='model'){settings.models[settings.provider]=String(event.value);expectedReplayModel=undefined;await save();}
      else if(event.id==='accountModel'){settings.customModel=String(event.value??'');settings.models.custom=settings.customModel;expectedReplayModel=undefined;await save();}
      else if(event.id==='prompt'){prompt=String(event.value??'');if(promptSaveError){promptSaveError='';await publish();}return;}
      else if(event.id==='size')size=String(event.value);
      else if(event.id==='quality')quality=String(event.value);
      else if(event.id==='insert')insert=Boolean(event.value);
      else if(event.id==='customBase'||event.id==='customModel'||event.id==='customSizes'||event.id==='customQualities'){settings[event.id]=String(event.value??'');await refreshCredential();await save();}
      else if(event.id==='customMaxEdge'){settings.customMaxEdge=Math.min(8192,Math.max(64,Math.round(Number(event.value)||2048)));await save();}
      else if(event.id==='customEdit'){settings.customEdit=Boolean(event.value);await save();}
    }catch(e){busy=false;error=e instanceof Error?e.message:String(e);}
    await publish();
  };
  subscriptions.push(api.ui.onEvent(onEvent));
  for(const command of ['generate','remove','fill'] as const)subscriptions.push(api.commands.on(command,async()=>{if(!busy){mode=command;error='';await refreshContext();await publish();}}));
  subscriptions.push(api.events.subscribe(event=>{if(event.type==='documentChanged')void refreshContext().then(publish).catch(()=>{});if(event.type==='visibility'&&event.visible===true)refreshShownQuota();}));
  await refreshCredential();await restoreSessions();await refreshContext();await publish();armQuota();const startupQuota=settings.provider==='codex'||settings.provider==='grok'?refreshQuota(settings.provider):Promise.resolve();void Promise.all([refreshModels(settings.provider,false).then(()=>{if(!disposed)armRefresh();}),startupQuota]).then(()=>{if(!disposed)return publish();}).catch(reason=>{if(disposed)return;error=reason instanceof Error?reason.message:String(reason);return publish();});
  return {dispose(){disposed=true;clearTimeout(refreshTimer);clearTimeout(quotaTimer);listAbort.abort();for(const subscription of subscriptions)subscription.dispose();void clearResult();}};
}
