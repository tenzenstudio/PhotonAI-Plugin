import type {PhotonApi,PanelModel,Control,UiEvent} from '@photon/plugin-sdk';
import {ROOT_FOLDER,newId,promptStacks,referenceBytes,REFERENCE_BUDGET,templateFields,templateTags,type HistoryItem,type LibraryState,type PromptItem,type TemplateItem,type ReferenceImage} from './library';
import {pillKind,templatePillsHtml,richText,richSelection,richOffsetBefore,richOffsetAtPoint,setRichSelection,type PillKind} from './template-rich';
import penSvg from '../svg/pen.svg';
import trashSvg from '../svg/trash.svg';
import wandSvg from '../svg/wand-magic-sparkles.svg';
import {EDIT_PROMPTS_FOLDER,editActionHints,isEditPrompt,type EditAction} from './edit-prompts';
import type {TransferView} from './library-transfer';

const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const encodeTagPart=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/=>/g,'\\=>').replace(/:/g,'\\:').replace(/[{}]/g,brace=>'\\'+brace);
const cardIcon=(svg:string)=>`<span class="card-action-icon" aria-hidden="true">${svg}</span>`;
const templateFieldHelp=(open:boolean)=>String.raw`<section id="template-fields-help" class="template-fields-help" role="region" aria-label="Template field guide" ${open?'':'hidden'}>
  <p>Write double-brace tags in a template. When you use it, each tag becomes a control below the prompt. The selected text is added to the hidden instructions sent with your prompt.</p>
  <dl>
    <div><dt>Text field</dt><dd><code>{{Subject}}</code><span>Type any value.</span></dd></div>
    <div><dt>Dropdown</dt><dd><code>{{View|select:Front=>front view|Side=>side view}}</code><span>Choose one from a menu.</span></dd></div>
    <div><dt>Radio</dt><dd><code>{{Light|radio:Softbox=>soft studio light|Window=>window light}}</code><span>Choose one visible option.</span></dd></div>
    <div><dt>Multiple checkboxes</dt><dd><code>{{Details|multi:Dew=>dew drops|Leaves=>autumn leaves}}</code><span>Choose any number. Their text is combined in the order shown.</span></dd></div>
    <div><dt>Multi-select dropdown</dt><dd><code>{{Details|multiselect:separator=; :Dew=>dew drops|Leaves=>autumn leaves}}</code><span>Choose several in a menu. The separator joins their prompt text in option order.</span></dd></div>
    <div><dt>Checkbox</dt><dd><code>{{Props|check:Add a few props.}}</code><span>Unchecked adds nothing.</span></dd></div>
    <div><dt>Checkbox with two states</dt><dd><code>{{Grain|check:Add fine grain.|Keep the finish clean.}}</code><span>The second text is used when unchecked.</span></dd></div>
  </dl>
  <p>Single braces, such as <code>{"size":"1024x1024"}</code>, stay as written. Use <code>Short label=&gt;prompt text</code> for concise choices. Dropdowns and radio groups start on their first option; multi-selects and checkboxes start empty. For a multi-select, write the separator after <code>separator=</code>; for example <code>: </code>, <code>; </code>, or <code>, </code>. Reuse a field name to reuse its value. The older choice form <code>{{Style:oil|watercolor}}</code> still works.</p>
  <p>Inside a tag, write <code>\|</code> for a pipe, <code>\=&gt;</code> for an arrow, <code>\}</code> for a closing brace, and <code>\\</code> for a backslash. Write <code>\{{</code> for literal double braces in template text.</p>
</section>`;
const root=document.getElementById('app')!;
const overlay=document.getElementById('overlay')!;
type CollectionKind='prompts'|'templates';
export interface CollectionActions {library:LibraryState;historyImages:Record<string,string>;save():Promise<void>;exportCollection(view:TransferView,folderId:string):Promise<{count:number}|null>;importCollection(view:TransferView):Promise<{count:number;folderName:string|null}|null>;usePrompt(item:PromptItem):Promise<void>;useHistory(item:HistoryItem):Promise<void>;useTemplate(item:TemplateItem):Promise<void>;conversion:{model:string;available:boolean};convertTemplate(text:string,direction:'json'|'narrative'):Promise<string>;}
export interface CustomPanel {api:PhotonApi;openCollection(kind:CollectionKind,actions:CollectionActions):Promise<void>;closeCollection():Promise<void>;}

interface HostReply {value?:unknown;error?:string;}
interface HostBridge {request(method:string,params:Record<string,unknown>):Promise<HostReply>;}
function bridge():HostBridge{
  const host=(globalThis as typeof globalThis & {__photonPlugin?:HostBridge}).__photonPlugin;
  if(!host)throw new Error('Photon Studio plugin bridge is unavailable.');
  return host;
}
function unsupported(error?:string):boolean{
  return !!error&&/Unsupported Photon SDK capability/i.test(error);
}
async function editorDialog(params:{open?:boolean;ready?:boolean}):Promise<HostReply>{
  const reply=await bridge().request('sdk.ui.customDialog',params);
  if(reply?.error&&unsupported(reply.error))return {};
  return reply;
}
function applyPhotonTheme(value:unknown):void{
  if(!value||typeof value!=='object')return;
  const theme=value as {name?:unknown;tokens?:unknown};
  if(!theme.tokens||typeof theme.tokens!=='object')return;
  for(const [name,token] of Object.entries(theme.tokens)){
    if(/^--ph-[a-z0-9-]+$/.test(name)&&typeof token==='string')document.documentElement.style.setProperty(name,token);
  }
  if(typeof theme.name==='string'){
    document.documentElement.dataset.photonTheme=theme.name;
    document.documentElement.style.colorScheme=theme.name==='light'||theme.name==='softLight'?'light':'dark';
  }
}

function controlHtml(c:Control):string{
  const id=esc(c.id),label=esc(c.label),value=esc(c.value),disabled=c.disabled?'disabled':'';
  switch(c.type){
    case 'group':
      if(c.id==='promptActions')return `<div class="prompt-actions">${(c.children??[]).map(controlHtml).join('')}</div>`;
      if(c.id==='resultActions')return `<div class="result-actions" role="group" aria-label="Result actions">${(c.children??[]).map(controlHtml).join('')}</div>`;
      if(c.id==='templateSurface')return `<section class="template-surface"><div class="template-heading"><h3>${label}</h3><button type="button" class="template-remove" data-control="clearTemplate" title="Remove template" aria-label="Remove template">${cardIcon(trashSvg)}</button></div>${(c.children??[]).map(controlHtml).join('')}</section>`;
      if(c.id?.startsWith('templateOptions:')){
        if(c.id.startsWith('templateOptions:multiselect:')){
          const choices=c.children??[],selected=choices.filter(option=>option.value).map(option=>option.label);
          return `<div class="template-multiselect"><span class="template-multiselect-label">${label}</span><details><summary><span data-multiselect-summary="true">${esc(selected.length?selected.join(', '):'Choose options')}</span><span aria-hidden="true">▾</span></summary><div class="template-multiselect-options">${choices.map((option,index)=>`<label class="template-choice"><input type="checkbox" data-control="${esc(option.id)}" value="${index}" ${option.value?'checked':''} ${option.disabled?'disabled':''}><span>${esc(option.label)}</span></label>`).join('')}</div></details></div>`;
        }
        const radio=c.id.startsWith('templateOptions:radio:');
        return `<fieldset class="template-choice-set"><legend>${label}</legend><div class="template-choice-options">${(c.children??[]).map((option,index)=>`<label class="template-choice"><input type="${radio?'radio':'checkbox'}" name="${esc(c.id)}" data-control="${esc(option.id)}" value="${index}" ${option.value?'checked':''} ${option.disabled?'disabled':''}><span>${esc(option.label)}</span></label>`).join('')}</div></fieldset>`;
      }
      if(c.id==='referenceStrip')return `<div class="reference-strip">${(c.children??[]).map(controlHtml).join('')}<label class="reference-add" title="Add image reference" aria-label="Add image reference">＋<input type="file" accept="image/png,image/jpeg,image/webp" data-manual-reference hidden></label></div>`;
      return `<section class="control-group"><h3>${label}</h3>${(c.children??[]).map(controlHtml).join('')}</section>`;
    case 'text':return c.id==='selectionHelp'?`<div class="selection-guidance"><p class="control-text">${esc(c.text)}</p><span class="selection-info"><button type="button" data-selection-help="true" aria-label="Prompt-based editing information" aria-describedby="selection-help-text" aria-expanded="false">?</button><span id="selection-help-text" class="selection-popover" role="tooltip">Prompt-guided edit: the source and white-area selection guide are sent as images. Photon limits Apply to your selection.</span></span></div>`:`<p class="control-text ${c.tone==='danger'?'danger':''}">${esc(c.text)}</p>`;
    case 'input':return `<label class="field"><span>${label}</span><input data-control="${id}" value="${value}" ${disabled}></label>${c.description?`<small>${esc(c.description)}</small>`:''}`;
    case 'textarea':return c.id==='prompt'
      ? `<div class="field prompt-field"><label for="prompt-input">${label}</label><div class="prompt-input"><textarea id="prompt-input" data-control="${id}" rows="5" ${c.description?'aria-describedby="prompt-save-error"':''} ${disabled}>${esc(c.value)}</textarea><button type="button" class="prompt-save" data-control="savePrompt" title="Save current prompt to Library" aria-label="Save current prompt to Library" ${disabled}><span class="glyph-icon" aria-hidden="true">&#x1F516;&#xFE0E;</span></button></div>${c.description?`<p id="prompt-save-error" class="prompt-save-error" role="alert">${esc(c.description)}</p>`:''}</div>`
      : `<label class="field"><span>${label}</span><textarea data-control="${id}" rows="5" ${disabled}>${esc(c.value)}</textarea></label>`;
    case 'number':return `<label class="field"><span>${label}</span><input type="number" data-control="${id}" value="${value}" min="${c.min??0}" max="${c.max??999999}" ${disabled}></label>`;
    case 'checkbox':return `<div class="template-check-field"><label class="check"><input type="checkbox" data-control="${id}" ${c.value?'checked':''} ${disabled}><span>${label}</span></label>${c.description?`<small>${esc(c.description)}</small>`:''}</div>`;
    case 'select':return `<label class="field"><span class="${c.id==='model'&&c.description?'model-label-row':''}"><span>${label}</span>${c.id==='model'&&c.description?`<span class="model-quota" title="${esc(c.description)}">${esc(c.description)}</span>`:''}</span><select data-control="${id}" ${disabled}>${(c.options??[]).map(o=>`<option value="${esc(o.value)}" ${o.value===c.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    case 'tabs':return `<div class="tabs" role="group" aria-label="${label}">${(c.options??[]).map(o=>{const hint=c.id==='editAction'?editActionHints[o.value as EditAction]:undefined;return `<button type="button" data-control="${id}" data-value="${esc(o.value)}" class="${o.value===c.value?'active':''}" ${hint?`title="${esc(hint)}" aria-description="${esc(hint)}"`:''} ${disabled}>${esc(o.label)}</button>`;}).join('')}</div>`;
    case 'button':return `<button type="button" data-control="${id}" class="action ${c.tone==='primary'?'primary':''}" ${disabled}>${label}</button>`;
    case 'image':return c.id?.startsWith('reference:')?`<span class="reference-thumb"><img src="${esc(c.src)}" alt="${label}"><button type="button" data-control="removeReference:${esc(c.id.slice(10))}" aria-label="Remove ${label}"></button></span>`:`<img class="result-image" alt="${label}" src="${esc(c.src)}">`;
    case 'progress':return `<progress value="${Number(c.value)||0}" max="100"></progress>`;
  }
}

export async function createCustomPanel(base:PhotonApi):Promise<CustomPanel>{
  const theme=await bridge().request('sdk.ui.theme',{});
  if(theme.error)throw new Error(theme.error);
  applyPhotonTheme(theme.value);
  let disposeCollection:(()=>void)|undefined;
  base.events.subscribe(event=>{if(event.type==='theme')applyPhotonTheme(event.theme);else if(String(event.type)==='customDialogClosed'){disposeCollection?.();disposeCollection=undefined;overlay.hidden=true;overlay.replaceChildren();root.inert=false;document.body.classList.remove('collection-modal');}});
  let handler:((event:UiEvent)=>void|Promise<void>)|undefined;
  const emit=(id:string,value?:string|number|boolean)=>{void handler?.({id,value,panel:'ai'});};
  root.addEventListener('input',event=>{const el=event.target as HTMLInputElement|HTMLTextAreaElement;if(el.dataset.control==='prompt')emit('prompt',el.value);});
  root.addEventListener('change',event=>{const el=event.target as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;if(!el.dataset.control||el.dataset.control==='prompt')return;const menu=el.closest<HTMLElement>('.template-multiselect');if(menu){const selected=Array.from(menu.querySelectorAll<HTMLInputElement>('input:checked')).map(input=>input.nextElementSibling?.textContent??'').filter(Boolean);const summary=menu.querySelector<HTMLElement>('[data-multiselect-summary]');if(summary)summary.textContent=selected.length?selected.join(', '):'Choose options';}emit(el.dataset.control,el.type==='checkbox'?(el as HTMLInputElement).checked:el.type==='number'?Number(el.value):el.value);});
  root.addEventListener('change',async event=>{const el=event.target as HTMLInputElement;if(!el.hasAttribute('data-manual-reference')||!el.files?.[0])return;try{emit('manualReference',JSON.stringify(await smallImage(el.files[0])));}catch(error){emit('panelError',error instanceof Error?error.message:String(error));}});
  root.addEventListener('click',event=>{const target=event.target as Element;const help=target.closest<HTMLButtonElement>('[data-selection-help]');const wrapper=root.querySelector<HTMLElement>('.selection-info');if(help){const open=!wrapper?.classList.contains('open');wrapper?.classList.toggle('open',open);help.setAttribute('aria-expanded',String(open));return;}if(wrapper&&!wrapper.contains(target)){wrapper.classList.remove('open');wrapper.querySelector('button')?.setAttribute('aria-expanded','false');}const el=target.closest<HTMLButtonElement>('button[data-control]');if(el)emit(el.dataset.control!,el.dataset.value);});
  const api:PhotonApi={...base,ui:{...base.ui,render:async(_panel:string,model:PanelModel)=>{
    const active=document.activeElement as HTMLInputElement|HTMLTextAreaElement|null;
    const id=active?.dataset?.control,position=active&&'selectionStart'in active?active.selectionStart:null;
    root.innerHTML=`<main class="panel-main">${model.controls.map(controlHtml).join('')}</main>`;
    if(id){const replacement=Array.from(root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-control]')).find(el=>el.dataset.control===id);replacement?.focus();if(position!==null&&replacement&&'setSelectionRange'in replacement)replacement.setSelectionRange(position,position);}
  },onEvent:callback=>{handler=callback;return {dispose(){if(handler===callback)handler=undefined;}};}}};
  const closeCollection=async()=>{
    const reply=await editorDialog({open:false});
    if(reply?.error)throw new Error(reply.error);
    disposeCollection?.();disposeCollection=undefined;
    overlay.hidden=true;overlay.replaceChildren();root.inert=false;document.body.classList.remove('collection-modal');
  };
  return {api,async openCollection(kind,actions){
    try{
      const reply=await editorDialog({open:true});
      if(reply?.error)throw new Error(reply.error);
      document.body.classList.add('collection-modal');
      disposeCollection=showCollection(kind,actions,closeCollection);
      const ready=await editorDialog({ready:true});
      if(ready?.error)throw new Error(ready.error);
    }catch(error){disposeCollection?.();disposeCollection=undefined;overlay.hidden=true;overlay.replaceChildren();root.inert=false;document.body.classList.remove('collection-modal');await editorDialog({open:false}).catch(()=>{});throw error;}
  },closeCollection};
}

function showCollection(kind:CollectionKind,actions:CollectionActions,closeCollection:()=>Promise<void>):()=>void{
  let folder=ROOT_FOLDER,tab:'saved'|'history'='saved',expanded=new Set<string>(),dragging:string|undefined,templateHelpOpen=false,search='';
  const historyUrls=new Map<string,string>();
  const historyImageUrl=(key:string)=>{
    const cached=historyUrls.get(key);if(cached)return cached;
    const dataUrl=actions.historyImages[key],match=/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(dataUrl??'');if(!match)return;
    const binary=atob(match[2]),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:match[1]}));historyUrls.set(key,url);return url;
  };
  let editor:{id?:string;kind:'prompt'|'template';folderId:string;text:string;name:string;transparent:boolean;newItem:boolean;error?:string;converting?:boolean}|undefined;
  type ChoiceKind=PillKind;
  type FieldOption={id:string;label:string;content:string};
  type FieldDialog={kind:ChoiceKind;name:string;separator:string;choices:FieldOption[];start:number;end:number;editing:boolean;error?:string};
  let fieldDialog:FieldDialog|undefined,fieldDragging:string|undefined,selectedPill:HTMLElement|undefined,draggingPill:HTMLElement|undefined;
  type DeleteTarget={kind:'folder'|'card';id:string;expiresAt:number};
  let folderEditor:string|undefined,armedDelete:DeleteTarget|undefined,deleteTimer:ReturnType<typeof setTimeout>|undefined,notice='',transferStatus='';
  const deleteButton=(target:DeleteTarget)=>Array.from(overlay.querySelectorAll<HTMLButtonElement>(target.kind==='folder'?'[data-delete-folder]':'[data-delete]')).find(button=>(target.kind==='folder'?button.dataset.deleteFolder:button.dataset.delete)===target.id);
  const resetDelete=()=>{clearTimeout(deleteTimer);deleteTimer=undefined;if(!armedDelete)return;const button=deleteButton(armedDelete);button?.classList.remove('delete-armed');if(button){const name=armedDelete.kind==='folder'?actions.library.folders.find(item=>item.id===armedDelete?.id)?.name:undefined;button.title=name?'Delete folder':'Delete';button.setAttribute('aria-label',name?'Delete '+name:'Delete');button.removeAttribute('aria-pressed');}armedDelete=undefined;};
  const armDelete=(kind:DeleteTarget['kind'],id:string)=>{resetDelete();armedDelete={kind,id,expiresAt:Date.now()+2000};const button=deleteButton(armedDelete);button?.classList.add('delete-armed');if(button){button.title='Click again to delete';button.setAttribute('aria-label','Click again to delete');button.setAttribute('aria-pressed','true');}deleteTimer=setTimeout(resetDelete,2000);};
  const hide=()=>{if(editor){editor=undefined;render();return;}resetDelete();void closeCollection().catch(error=>{notice=error instanceof Error?error.message:String(error);render();});};
  const list=()=>kind==='prompts'?actions.library.prompts:actions.library.templates;
  const commit=async()=>{try{await actions.save();notice='';render();}catch(error){notice=error instanceof Error?error.message:String(error);render();}};
  const setTemplateHelp=(open:boolean)=>{templateHelpOpen=open;const help=overlay.querySelector<HTMLElement>('#template-fields-help');if(help)help.hidden=!open;const toggle=overlay.querySelector<HTMLButtonElement>('[data-template-tags]');toggle?.setAttribute('aria-expanded',String(open));toggle?.focus();};
  const markdown=[['h1','H1','Heading 1'],['h2','H2','Heading 2'],['h3','H3','Heading 3'],['bold','B','Bold'],['italic','I','Italic'],['strike','S','Strikethrough'],['quote','❞','Quote'],['bullet','• List','Bulleted list'],['number','1. List','Numbered list'],['task','☑ List','Task list'],['link','Link','Link'],['table','Table','Table'],['code','Code','Inline code'],['block','Code block','Code block'],['rule','―','Horizontal rule']];
  const tags=[['text','Text','{{Subject}}'],['select','Dropdown',''],['radio','Radio',''],['multi','Checkboxes',''],['multiselect','Multi-select dropdown',''],['check','Checkbox','{{Props|check:Add a few props.}}'],['check-two','Two states','{{Grain|check:Add fine grain.|Keep the finish clean.}}']];
  const fieldTitle=(type:ChoiceKind)=>({text:'Text field',select:'Dropdown',radio:'Radio group',multi:'Checkboxes',multiselect:'Multi-select dropdown',check:'Checkbox','check-two':'Two-state checkbox'} as Record<ChoiceKind,string>)[type];
  const fieldOptionHtml=(option:FieldOption,index:number)=>`<div class="field-option" data-field-option="${esc(option.id)}"><button type="button" class="field-option-handle" data-field-drag="${esc(option.id)}" draggable="true" aria-label="Reorder option ${index+1}" title="Drag to reorder; Alt+Up or Alt+Down to move">⋮⋮</button><label>Label<input data-field-option-label="${esc(option.id)}" value="${esc(option.label)}" maxlength="80"></label><label>Prompt text<input data-field-option-content="${esc(option.id)}" value="${esc(option.content)}" maxlength="500"></label><button type="button" class="field-option-remove" data-field-remove="${esc(option.id)}" title="Remove option" aria-label="Remove option ${index+1}">${cardIcon(trashSvg)}</button></div>`;
  const fieldDialogHtml=()=>{
    if(!fieldDialog)return '';
    const {kind,choices,separator}=fieldDialog;
    const controls=kind==='text'?'<small>This field accepts free text when the template is used.</small>':kind==='check'||kind==='check-two'
      ?`<label class="field-config-name">When checked<input data-field-checked="true" value="${esc(choices[0]?.content??'')}" maxlength="500"></label><label class="field-config-name">When unchecked (optional)<input data-field-unchecked="true" value="${esc(choices[1]?.content??'')}" maxlength="500"></label><small>Leave the unchecked text empty to add nothing.</small>`
      :`${kind==='multiselect'?`<label class="field-config-name">Separator between selected values<input data-field-separator="true" value="${esc(separator)}" maxlength="30"></label><small>Example: <code data-field-separator-preview="true">one${esc(separator)}two</code>. Selections use the order below.</small>`:''}<div class="field-options-head"><span>Options</span><button type="button" data-field-add="true">+ Add option</button></div><div class="field-options">${choices.map(fieldOptionHtml).join('')}</div>`;
    return `<div class="field-config-layer"><div class="field-config-backdrop" data-field-cancel="true"></div><section class="field-config-dialog" role="dialog" aria-modal="true" aria-label="Configure ${fieldTitle(kind)}"><header><span class="dialog-title">${fieldTitle(kind)}</span><button type="button" class="close" data-field-cancel="true" aria-label="Close field options">×</button></header><div class="field-config-body"><label class="field-config-name">Field label<input data-field-name="true" value="${esc(fieldDialog.name)}" maxlength="80"></label>${controls}${fieldDialog.error?`<p class="editor-error" role="alert">${esc(fieldDialog.error)}</p>`:''}</div><footer><button type="button" data-field-cancel="true">Cancel</button><button type="button" class="field-config-insert" data-field-save="true">${fieldDialog.editing?'Update field':'Insert field'}</button></footer></section></div>`;
  };
  const conversionHtml=()=>editor?.kind==='template'?`<div class="editor-conversion" role="group" aria-label="Convert template text"><span class="editor-conversion-model" title="${esc(actions.conversion.model)}">[<span>${esc(actions.conversion.model)}</span>]</span><span class="editor-conversion-dot" aria-hidden="true">·</span><span class="editor-conversion-label">Convert to:</span><button type="button" data-convert="json" ${editor.converting||!actions.conversion.available?'disabled':''} title="${actions.conversion.available?'Convert with the selected model':'The selected model cannot return text'}">JSON</button><button type="button" data-convert="narrative" ${editor.converting||!actions.conversion.available?'disabled':''} title="${actions.conversion.available?'Convert with the selected model':'The selected model cannot return text'}">Text</button></div>`:'';
  const editorHtml=()=>!editor?'':`<div class="editor-layer"><div class="editor-backdrop" data-editor-cancel="true"></div><section class="item-editor" role="dialog" aria-modal="${fieldDialog?'false':'true'}" aria-label="${editor.newItem?'New template':editor.kind==='template'?'Edit template':'Edit prompt'}"><header><span class="dialog-title">${editor.newItem?'New template':editor.kind==='template'?'Edit template':'Edit prompt'}</span><button type="button" class="close" data-editor-cancel="true" aria-label="Close editor">×</button></header><div class="item-editor-body">${editor.kind==='template'?`<label class="editor-name">Name<input data-editor-name="true" value="${esc(editor.name)}" maxlength="100" ${isEditPrompt(editor.id??'')?'readonly':''}></label>`:''}<div class="editor-toolbars"><div class="editor-tools" role="toolbar" aria-label="Markdown formatting">${markdown.map(([command,label,title])=>`<button type="button" data-markdown="${command}" title="${title}" aria-label="${title}">${label}</button>`).join('')}</div>${editor.kind==='template'&&!isEditPrompt(editor.id??'')?`<div class="editor-tools" role="toolbar" aria-label="Insert template field">${tags.map(([type,label])=>`<button type="button" data-insert-tag="${type}" title="Insert ${label.toLowerCase()} field">${label}</button>`).join('')}</div>`:''}</div><label class="editor-text-label" for="item-editor-text">${isEditPrompt(editor.id??'')?'Edit instruction':editor.kind==='template'?'Template instructions':'Prompt'}</label>${editor.kind==='template'&&!isEditPrompt(editor.id??'')?`<div id="item-editor-text" class="template-rich-editor" data-editor-rich="true" contenteditable="true" role="textbox" aria-label="Template instructions" aria-multiline="true" spellcheck="true">${templatePillsHtml(editor.text,true)}</div>`:`<textarea id="item-editor-text" data-editor-text="true" spellcheck="true">${esc(editor.text)}</textarea>`}${editor.kind==='template'&&!isEditPrompt(editor.id??'')?`<div class="editor-transparent"><label class="check"><input type="checkbox" data-editor-transparent="true" ${editor.transparent?'checked':''}> Transparent image</label><span class="transparency-info"><button type="button" data-transparent-help="true" aria-label="Transparent image support" aria-describedby="transparency-help" aria-expanded="false">?</button><span id="transparency-help" class="transparency-popover" role="tooltip">OpenAI, Codex, and Grok can receive transparent image requests here. OpenAI and Codex request PNG alpha output; Grok uses prompt instructions, so alpha is not guaranteed. For other providers, check their documentation.</span></span>${conversionHtml()}</div>`:''}${editor.error?`<p class="editor-error" role="alert">${esc(editor.error)}</p>`:''}</div><footer><button type="button" data-editor-cancel="true">Cancel</button><button type="button" class="editor-save" data-editor-save="true">Save</button></footer></section>${fieldDialogHtml()}</div>`;
  const openEditor=(item?:PromptItem|TemplateItem)=>{resetDelete();editor={id:item?.id,kind:kind==='templates'?'template':'prompt',folderId:item?.folderId??folder,text:item?.text??'',name:item&&'name'in item?item.name:'Untitled template',transparent:!!(item&&'transparentBackground'in item&&item.transparentBackground),newItem:!item};render();};
  const editorArea=()=>overlay.querySelector<HTMLTextAreaElement>('[data-editor-text]');
  const richArea=()=>overlay.querySelector<HTMLElement>('[data-editor-rich]');
  const getEditorText=()=>richArea()?richText(richArea()!):editorArea()?.value??'';
  const getEditorSelection=()=>richArea()?richSelection(richArea()!):{start:editorArea()?.selectionStart??0,end:editorArea()?.selectionEnd??0};
  const setEditorSelection=(start:number,end=start)=>{const rich=richArea();if(rich)setRichSelection(rich,start,end);else{const area=editorArea();area?.focus();area?.setSelectionRange(start,end);}};
  const setEditorValue=(value:string,start=value.length,end=start)=>{if(!editor)return;editor.text=value;selectedPill=undefined;const rich=richArea();if(rich)rich.innerHTML=templatePillsHtml(value,true);else if(editorArea())editorArea()!.value=value;setEditorSelection(start,end);};
  const replaceEditorText=(start:number,end:number,text:string,selectFrom=text.length,selectLength=0)=>{const value=getEditorText();setEditorValue(value.slice(0,start)+text+value.slice(end),start+selectFrom,start+selectFrom+selectLength);};
  const selectPill=(pill?:HTMLElement)=>{selectedPill?.classList.remove('selected');selectedPill=pill;if(pill){pill.classList.add('selected');const rich=richArea();if(rich){const start=richOffsetBefore(rich,pill);setRichSelection(rich,start,start+(pill.dataset.templateTag?.length??0));}}};
  const readFieldInputs=()=>{if(!fieldDialog)return;fieldDialog.name=overlay.querySelector<HTMLInputElement>('[data-field-name]')?.value??fieldDialog.name;fieldDialog.separator=overlay.querySelector<HTMLInputElement>('[data-field-separator]')?.value??fieldDialog.separator;if(fieldDialog.kind==='check'||fieldDialog.kind==='check-two')fieldDialog.choices=[{id:'checked',label:'Checked',content:overlay.querySelector<HTMLInputElement>('[data-field-checked]')?.value??''},{id:'unchecked',label:'Unchecked',content:overlay.querySelector<HTMLInputElement>('[data-field-unchecked]')?.value??''}];for(const option of fieldDialog.choices){option.label=Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-field-option-label]')).find(input=>input.dataset.fieldOptionLabel===option.id)?.value??option.label;option.content=Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-field-option-content]')).find(input=>input.dataset.fieldOptionContent===option.id)?.value??option.content;}};
  const refreshFieldDialog=(focusId?:string)=>{const layer=overlay.querySelector<HTMLElement>('.field-config-layer');if(!layer||!fieldDialog)return;const before=new Map(Array.from(layer.querySelectorAll<HTMLElement>('[data-field-option]')).map(row=>[row.dataset.fieldOption!,row.getBoundingClientRect()]));layer.outerHTML=fieldDialogHtml();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const row of Array.from(overlay.querySelectorAll<HTMLElement>('[data-field-option]'))){const old=before.get(row.dataset.fieldOption!);if(!old)continue;const now=row.getBoundingClientRect(),dy=old.top-now.top;if(dy)row.animate([{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});}if(focusId)Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-field-option-label]')).find(input=>input.dataset.fieldOptionLabel===focusId)?.focus();};
  const openFieldDialog=(type:ChoiceKind,pill?:HTMLElement)=>{
    if(!editor)return;
    const value=getEditorText(),selection=getEditorSelection(),start=pill&&richArea()?richOffsetBefore(richArea()!,pill):selection.start;
    const end=pill?start+(pill.dataset.templateTag?.length??0):selection.end;
    const existing=pill?templateTags(pill.dataset.templateTag??'')[0]?.field:undefined;
    editor.text=value;editor.name=overlay.querySelector<HTMLInputElement>('[data-editor-name]')?.value??editor.name;
    editor.transparent=!!overlay.querySelector<HTMLInputElement>('[data-editor-transparent]')?.checked;
    const examples:Record<ChoiceKind,{name:string;choices:[string,string][]}>={text:{name:'Subject',choices:[]},select:{name:'View',choices:[['Front','front view'],['Side','side view']]},radio:{name:'Light',choices:[['Softbox','soft studio light'],['Window','window light']]},multi:{name:'Details',choices:[['Detail A','include detail A'],['Detail B','include detail B']]},multiselect:{name:'Details',choices:[['Detail A','include detail A'],['Detail B','include detail B']]},check:{name:'Props',choices:[['Checked','Add a few props.'],['Unchecked','']]},'check-two':{name:'Grain',choices:[['Checked','Add fine grain.'],['Unchecked','Keep the finish clean.']]}};
    const example=examples[type];const source=existing?.choices??existing?.options.map(option=>({label:option,content:option}))??example.choices.map(([label,content])=>({label,content}));
    fieldDialog={kind:type,name:existing?.name??example.name,separator:existing?.separator??', ',choices:source.map(({label,content})=>({id:newId(),label,content})),start,end,editing:!!pill};selectedPill=undefined;render();
  };
  const closeFieldDialog=()=>{if(!fieldDialog)return;const {start,end}=fieldDialog;fieldDialog=undefined;fieldDragging=undefined;render();setEditorSelection(start,end);};
  const saveFieldDialog=()=>{
    if(!fieldDialog||!editor)return;readFieldInputs();
    const name=fieldDialog.name.trim(),choices=fieldDialog.choices.map(choice=>({label:choice.label.trim(),content:choice.content.trim()}));const {kind,separator,start,end}=fieldDialog;
    let error='';if(!/^[\p{L}\p{N}][^\r\n{}"]*$/u.test(name))error='Enter a field label without braces or quotes.';
    else if(kind==='check'||kind==='check-two'){if(!choices[0]?.content)error='Enter the text to use when checked.';}
    else if(kind!=='text'){if(!choices.length)error='Add at least one option.';else if(choices.some(choice=>!choice.label||!choice.content))error='Every option needs a label and prompt text.';else if(/[\r\n]/.test(separator))error='Use a single-line separator.';}
    if(error){fieldDialog.error=error;refreshFieldDialog();overlay.querySelector<HTMLInputElement>('[data-field-name]')?.focus();return;}
    let syntax=`{{${encodeTagPart(name)}}}`;
    if(kind==='check'||kind==='check-two')syntax=`{{${encodeTagPart(name)}|check:${encodeTagPart(choices[0].content)}${choices[1]?.content?`|${encodeTagPart(choices[1].content)}`:''}}}`;
    else if(kind!=='text'){const parts=choices.map(choice=>`${encodeTagPart(choice.label)}=>${encodeTagPart(choice.content)}`);syntax=`{{${encodeTagPart(name)}|${kind}:${kind==='multiselect'?`separator=${encodeTagPart(separator)}|`:''}${parts.join('|')}}}`;}
    closeFieldDialog();replaceEditorText(start,end,syntax);const rich=richArea(),pill=rich?Array.from(rich.querySelectorAll<HTMLElement>('[data-template-tag]')).find(node=>richOffsetBefore(rich,node)===start):undefined;if(pill)selectPill(pill);
  };
  const insertEditorText=(text:string,selectFrom=0,selectLength=0)=>{const {start,end}=getEditorSelection();replaceEditorText(start,end,text,selectFrom,selectLength);};
  const showEditorError=(message:string)=>{if(!editor)return;editor.error=message;const error=overlay.querySelector<HTMLElement>('.item-editor-body .editor-error');if(error){error.textContent=message;error.hidden=!message;}else if(message)overlay.querySelector<HTMLElement>('.item-editor-body')?.insertAdjacentHTML('beforeend',`<p class="editor-error" role="alert">${esc(message)}</p>`);};
  const convertEditor=async(direction:'json'|'narrative')=>{
    const currentEditor=editor;
    if(!currentEditor||currentEditor.kind!=='template'||currentEditor.converting||!richArea())return;
    const original=getEditorText();
    currentEditor.converting=true;
    for(const button of Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-convert],[data-editor-save]')))button.disabled=true;
    try{
      const converted=await actions.convertTemplate(original,direction);
      if(editor!==currentEditor)return;
      if(fieldDialog||!richArea()||getEditorText()!==original){showEditorError('The template changed while conversion was running. Run conversion again to avoid replacing your edits.');return;}
      setEditorValue(converted);showEditorError('');
    }catch(reason){if(editor===currentEditor)showEditorError(reason instanceof Error?reason.message:String(reason));}
    finally{currentEditor.converting=false;if(editor===currentEditor)for(const button of Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-convert],[data-editor-save]')))button.disabled=button.hasAttribute('data-convert')&&!actions.conversion.available;}
  };
  const formatMarkdown=(command:string)=>{const value=getEditorText(),{start,end}=getEditorSelection(),selection=value.slice(start,end);let text='',selectFrom=0,selectLength=0;
    const wrap=(left:string,right=left,placeholder='text')=>{const content=selection||placeholder;text=left+content+right;selectFrom=left.length;selectLength=content.length;};
    if(command==='h1'||command==='h2'||command==='h3'||command==='quote'||command==='bullet'||command==='number'||command==='task'){
      const prefix=command==='h1'?'# ':command==='h2'?'## ':command==='h3'?'### ':command==='quote'?'> ':command==='bullet'?'- ':command==='number'?'1. ':'- [ ] ';
      const lineStart=value.lastIndexOf('\n',Math.max(0,start-1))+1,lineEnd=value.indexOf('\n',end);const to=lineEnd<0?value.length:lineEnd;
      const lines=value.slice(lineStart,to).split('\n');text=lines.map((line,index)=>command==='number'?`${index+1}. ${line}`:prefix+line).join('\n');replaceEditorText(lineStart,to,text,0,text.length);return;
    }
    if(command==='bold')wrap('**');else if(command==='italic')wrap('*');else if(command==='strike')wrap('~~');else if(command==='code')wrap('`');else if(command==='block')wrap('```\n','\n```','code');else if(command==='link')wrap('[','](https://example.com)','link text');else if(command==='table'){text='| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |';selectFrom=2;selectLength=8;}else if(command==='rule'){text='\n---\n';selectFrom=text.length;}else return;
    insertEditorText(text,selectFrom,selectLength);
  };
  const card=(item:PromptItem|TemplateItem,history=false)=>{
    const template=kind==='templates'&&!history?item as TemplateItem:undefined;
    const modePrompt=!!template&&isEditPrompt(item.id);
    const images=template?.references??[];
    const saved=item.context;
    const fieldDetails=saved?.template?templateFields(saved.template.text).map(field=>{
      const raw=saved.template!.values[field.name]??'';
      const value=field.kind==='check'?raw==='true'?'On':'Off':field.kind==='radio'||field.kind==='select'?field.choices?.[Number(raw||0)]?.label??raw:field.kind==='multi'||field.kind==='multiselect'?raw.split(',').filter(Boolean).map(index=>field.choices?.[Number(index)]?.label).filter(Boolean).join(', '):raw;
      return `<div><dt>${esc(field.name)}</dt><dd>${esc(value||'—')}</dd></div>`;
    }).join(''):'';
    const historyDetails=saved?`<div class="history-summary"><span>${saved.mode==='fill'?`Edit · ${esc(saved.editAction?saved.editAction[0].toUpperCase()+saved.editAction.slice(1):'Add')}`:saved.mode==='remove'?'Remove':'Generate'}</span>${saved.template?`<span>Template · ${esc(saved.template.name)}</span>`:''}${saved.references.length?`<span>${saved.references.length} reference${saved.references.length===1?'':'s'}</span>`:''}</div>${saved.references.length?`<div class="history-reference-list">${saved.references.map(ref=>{const url=historyImageUrl(ref.key);return url?`<span class="card-reference" title="${esc(ref.name)} · ${ref.source}"><img class="card-reference-thumb" src="${esc(url)}" alt="${esc(ref.name)}"><span class="card-reference-preview"><img src="${esc(url)}" alt=""></span></span>`:`<span class="history-missing-reference" title="${esc(ref.name)}">${esc(ref.name)} unavailable</span>`;}).join('')}</div>`:''}<details class="history-details"><summary>Details</summary><dl><div><dt>Provider</dt><dd>${esc(saved.provider??'Unknown')}</dd></div><div><dt>Model</dt><dd>${esc(saved.model??'Unknown')}</dd></div>${saved.size?`<div><dt>Size</dt><dd>${esc(saved.size)}</dd></div>`:''}${saved.quality?`<div><dt>Quality</dt><dd>${esc(saved.quality)}</dd></div>`:''}${saved.insert?'<div><dt>Output</dt><dd>Insert in document</dd></div>':''}${saved.editInstruction?`<div><dt>Edit instruction</dt><dd>${esc(saved.editInstruction)}</dd></div>`:''}${saved.template?`<div><dt>Template text</dt><dd>${esc(saved.template.text)}</dd></div>${saved.template.transparentBackground?'<div><dt>Background</dt><dd>Transparent</dd></div>':''}${fieldDetails}`:''}${saved.references.map(ref=>`<div><dt>${ref.source==='template'?'Template reference':'Reference'}</dt><dd>${esc(ref.name)}</dd></div>`).join('')}</dl></details>`:history&&(item as HistoryItem).templateName?`<div class="history-summary"><span>Legacy · ${esc((item as HistoryItem).templateName)}</span></div>`:'';
    return `<article class="card" draggable="${!modePrompt}" data-card="${esc(item.id)}">
      <div class="card-top">${modePrompt?'':`<span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>`}${template?`<strong>${esc(template.name)}</strong>`:`<span class="card-date">${new Date(item.updatedAt).toLocaleString()}</span>`}</div>
      <p>${template&&!modePrompt?templatePillsHtml(item.text):esc(item.text)}</p>${template?.transparentBackground?'<small>Transparent image</small>':''}${historyDetails}
      <div class="card-footer">${template&&!modePrompt?`<div class="card-footer-left"><button type="button" class="add-reference" data-add-ref-button="${esc(item.id)}">＋ Reference</button><input type="file" accept="image/png,image/jpeg,image/webp" data-add-ref="${esc(item.id)}" hidden>${images.map(r=>`<span class="card-reference" title="${esc(r.name)}"><img class="card-reference-thumb" src="${esc(r.dataUrl)}" alt="${esc(r.name)}"><span class="card-reference-preview"><img src="${esc(r.dataUrl)}" alt=""></span><button type="button" aria-label="Remove ${esc(r.name)}" data-remove-ref="${esc(item.id)}" data-ref="${esc(r.id)}"></button></span>`).join('')}</div>`:'<div></div>'}<div class="card-actions"><button type="button" title="Edit" aria-label="Edit" data-edit="${esc(item.id)}">${cardIcon(penSvg)}</button>${modePrompt?'':`<button type="button" title="Delete" aria-label="Delete" data-delete="${esc(item.id)}">${cardIcon(trashSvg)}</button><button type="button" class="use" title="Use" aria-label="Use" data-use="${esc(item.id)}">${cardIcon(wandSvg)}</button>`}</div></div>
    </article>`;
  };
  const render=(searchChanged=false,focusFilter=false)=>{
    const searchInput=overlay.querySelector<HTMLInputElement>('[data-collection-search]');
    const searchCaret=searchInput&&searchInput===document.activeElement?searchInput.selectionStart??searchInput.value.length:null;
    const contentScroll=overlay.querySelector<HTMLElement>('.collection-content-scroll')?.scrollTop??0;
    const folders=actions.library.folders.filter(item=>kind==='templates'||item.id!==EDIT_PROMPTS_FOLDER).sort((a,b)=>a.order-b.order);
    const source=tab==='history'?actions.library.history:list();
    const visible=source.filter(x=>folder===ROOT_FOLDER||x.folderId===folder).slice().sort((a,b)=>tab==='history'?b.order-a.order:a.order-b.order);
    const query=search.trim().toLocaleLowerCase();
    const matches=(item:PromptItem|TemplateItem)=>{const context=item.context;return [item.text,'name'in item?item.name:new Date(item.updatedAt).toLocaleString(),...(context?[context.template?.name??'',context.editAction??'',context.provider??'',context.model??'',...context.references.map(ref=>ref.name)]:[])].some(value=>value.toLocaleLowerCase().includes(query));};
    const groups=promptStacks(visible).filter(group=>!query||group.some(matches)||group.length>1&&`${group.length} versions`.includes(query));
    const previous=new Map(Array.from(overlay.querySelectorAll<HTMLElement>('[data-card]')).map(el=>[el.dataset.card!,el.getBoundingClientRect()]));
    root.inert=true;
    overlay.hidden=false;
    const folderInput=(id:string,name:string)=>`<div class="folder-edit-row"><input data-folder-name="${esc(id)}" aria-label="Folder name" value="${esc(name)}" maxlength="80"><button type="button" data-save-folder="${esc(id)}" title="Save folder" aria-label="Save folder">✓</button><button type="button" data-cancel-folder="true" title="Cancel" aria-label="Cancel">×</button></div>`;
    const folderRows=folders.map(f=>folderEditor===f.id?folderInput(f.id,f.name):`<div class="folder-row"><button class="folder ${folder===f.id?'active':''}" data-folder="${esc(f.id)}">${esc(f.name)}</button>${f.id===EDIT_PROMPTS_FOLDER?'':`<button title="Rename folder" aria-label="Rename ${esc(f.name)}" data-rename-folder="${esc(f.id)}">${cardIcon(penSvg)}</button><button title="Delete folder" aria-label="Delete ${esc(f.name)}" data-delete-folder="${esc(f.id)}">${cardIcon(trashSvg)}</button>`}</div>`).join('');
    const searchField=`<label class="collection-search"><span class="sr-only">Filter ${kind==='prompts'?'prompts':'templates'}</span><input type="search" data-collection-search="true" value="${esc(search)}" placeholder="Filter ${kind==='prompts'?'Prompts':'Templates'}" autocomplete="off"></label>`;
    const toolbar=kind==='prompts'?`<div class="tabs"><button class="${tab==='saved'?'active':''}" data-tab="saved">Saved</button><button class="${tab==='history'?'active':''}" data-tab="history">History</button></div>${searchField}`:`<button class="add" data-add="true">＋ New Template</button>${searchField}<button type="button" class="template-help-toggle" data-template-tags="true" aria-controls="template-fields-help" aria-expanded="${templateHelpOpen}"><span class="glyph-icon" aria-hidden="true">&#x24D8;</span> Template Fields</button>`;
    overlay.innerHTML=`<div class="modal-backdrop" data-close="true"></div><section class="collection-dialog" role="dialog" aria-modal="${editor?'false':'true'}" aria-label="${kind==='prompts'?'Prompt Library':'Templates'}"><header><span class="dialog-title">${kind==='prompts'?'Prompt Library':'Templates'}</span><button class="close" type="button" aria-label="Close" data-close="true">×</button></header>${notice?`<p class="dialog-notice" role="alert">${esc(notice)}</p>`:''}<div class="collection-body"><aside class="folders"><button class="folder ${folder===ROOT_FOLDER?'active':''}" data-folder="${ROOT_FOLDER}">All ${kind==='prompts'?'prompts':'templates'}</button>${folderRows}${folderEditor==='new'?folderInput('new',''):'<button class="new-folder" data-new-folder="true">＋ Folder</button>'}</aside><div class="collection-content"><div class="collection-content-scroll"><div class="collection-toolbar">${toolbar}</div>${kind==='templates'?templateFieldHelp(templateHelpOpen):''}<div class="cards">${groups.length?groups.map(group=>{const key=group[0].stackId||group[0].id;return group.length>1?`<section class="stack" data-stack-drop="${esc(key)}">${query?`<div class="stack-title"><span>▤ ${group.length} versions</span></div>${group.map(i=>card(i,tab==='history')).join('')}`:`<button class="stack-title" data-stack="${esc(key)}"><span>▤ ${group.length} versions</span><span>${expanded.has(key)?'−':'＋'}</span></button>${card(group[0],tab==='history')}${expanded.has(key)?group.slice(1).map(i=>card(i,tab==='history')).join(''):''}`}</section>`:card(group[0],tab==='history');}).join(''):`<p class="empty">${query?'No matches.':tab==='history'?'No prompt history.':kind==='prompts'?'No saved prompts.':'No templates.'}</p>`}<div class="unstack-drop" data-unstack="true">Drop here to separate</div></div></div><footer class="collection-footer"><span class="collection-transfer-status" role="status">${esc(transferStatus)}</span><div class="collection-footer-actions"><button type="button" data-export-collection="true">Export</button><button type="button" data-import-collection="true">Import</button></div></footer></div></div></section>${editorHtml()}`;
    for(const summary of Array.from(overlay.querySelectorAll<HTMLElement>('.card .history-summary'))){
      const details=summary.parentElement?.querySelector<HTMLElement>(':scope > .history-details');
      const first=summary.querySelector('span');
      if(!details||!first)continue;
      const row=document.createElement('div');row.className='history-meta-row';
      summary.before(row);row.append(first,details);
      if(!summary.childElementCount)summary.remove();
    }
    overlay.querySelector<HTMLElement>('.collection-dialog')!.inert=!!editor;
    if(fieldDialog)overlay.querySelector<HTMLElement>('.item-editor')!.inert=true;
    if(armedDelete){const button=deleteButton(armedDelete);button?.classList.add('delete-armed');if(button){button.title='Click again to delete';button.setAttribute('aria-label','Click again to delete');button.setAttribute('aria-pressed','true');}}
    if(!searchChanged&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const el of Array.from(overlay.querySelectorAll<HTMLElement>('[data-card]'))){const before=previous.get(el.dataset.card!);if(!before)continue;const after=el.getBoundingClientRect(),dx=before.left-after.left,dy=before.top-after.top;if(dx||dy)el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:230,easing:'cubic-bezier(.2,.8,.2,1)'});}
    overlay.querySelector<HTMLElement>('.collection-dialog')?.setAttribute('tabindex','-1');
    overlay.querySelector<HTMLElement>('.collection-content-scroll')!.scrollTop=searchChanged?0:contentScroll;
    if(fieldDialog)overlay.querySelector<HTMLInputElement>('[data-field-name]')?.focus();
    else if((searchCaret!==null||focusFilter)&&!editor){const replacement=overlay.querySelector<HTMLInputElement>('[data-collection-search]');replacement?.focus();if(focusFilter)replacement?.select();else if(searchCaret!==null)replacement?.setSelectionRange(searchCaret,searchCaret);}else (overlay.querySelector<HTMLElement>(editor?'[data-editor-name], [data-editor-text]':'[data-folder-name]')??overlay.querySelector<HTMLElement>(editor?'.item-editor':'.collection-dialog'))?.focus();
  };
  const current=(id:string)=>[...actions.library.prompts,...actions.library.history,...actions.library.templates].find(x=>x.id===id);
  overlay.oninput=e=>{const input=e.target as HTMLInputElement;if(fieldDialog){if(input.dataset.fieldName)fieldDialog.name=input.value;else if(input.dataset.fieldSeparator){fieldDialog.separator=input.value;const preview=overlay.querySelector<HTMLElement>('[data-field-separator-preview]');if(preview)preview.textContent='one'+input.value+'two';}else if(input.dataset.fieldOptionLabel){const option=fieldDialog.choices.find(choice=>choice.id===input.dataset.fieldOptionLabel);if(option)option.label=input.value;}else if(input.dataset.fieldOptionContent){const option=fieldDialog.choices.find(choice=>choice.id===input.dataset.fieldOptionContent);if(option)option.content=input.value;}return;}if(editor&&richArea()&&richArea()!.contains(input)){editor.text=getEditorText();if(!(e as InputEvent).isComposing&&templateTags(editor.text).length!==richArea()!.querySelectorAll('[data-template-tag]').length){const {start,end}=getEditorSelection();setEditorValue(editor.text,start,end);}return;}if(!input.dataset.collectionSearch)return;search=input.value;if(!(e as InputEvent).isComposing)render(true);};
  overlay.onclick=async e=>{
    const target=e.target as Element;
    if(fieldDialog){const button=target.closest<HTMLElement>('[data-field-cancel],[data-field-add],[data-field-remove],[data-field-save]');if(!button)return;if(button.dataset.fieldCancel){closeFieldDialog();return;}if(button.dataset.fieldAdd){readFieldInputs();const option={id:newId(),label:'New option',content:'new option'};fieldDialog.choices.push(option);fieldDialog.error=undefined;refreshFieldDialog(option.id);return;}if(button.dataset.fieldRemove){readFieldInputs();fieldDialog.choices=fieldDialog.choices.filter(choice=>choice.id!==button.dataset.fieldRemove);fieldDialog.error=undefined;refreshFieldDialog();overlay.querySelector<HTMLButtonElement>('[data-field-add]')?.focus();return;}if(button.dataset.fieldSave){saveFieldDialog();return;}return;}
    if(editor){
      const pill=target.closest<HTMLElement>('.template-rich-editor [data-template-tag]');
      if(pill){selectPill(pill);return;}
      if(target.closest('[data-editor-rich]'))selectPill();
      const editorButton=target.closest<HTMLElement>('[data-editor-cancel],[data-editor-save],[data-markdown],[data-insert-tag],[data-transparent-help],[data-convert]');
      if(!editorButton){overlay.querySelector<HTMLElement>('.transparency-info.open')?.classList.remove('open');overlay.querySelector<HTMLButtonElement>('[data-transparent-help]')?.setAttribute('aria-expanded','false');return;}
      if(editorButton.dataset.editorCancel){editor=undefined;render();return;}
      if(editorButton.dataset.convert){void convertEditor(editorButton.dataset.convert as 'json'|'narrative');return;}
      if(editorButton.dataset.markdown){formatMarkdown(editorButton.dataset.markdown);return;}
      if(editorButton.dataset.insertTag){openFieldDialog(editorButton.dataset.insertTag as ChoiceKind);return;}
      if(editorButton.dataset.transparentHelp){const wrapper=editorButton.closest<HTMLElement>('.transparency-info');const open=!wrapper?.classList.contains('open');wrapper?.classList.toggle('open',open);editorButton.setAttribute('aria-expanded',String(open));return;}
      if(editorButton.dataset.editorSave){
        if(editor.converting)return;
        const text=getEditorText().trim();
        const name=overlay.querySelector<HTMLInputElement>('[data-editor-name]')?.value.trim()??editor.name;
        if(!text||editor.kind==='template'&&!name){showEditorError(!text?'Write text before saving.':'Enter a template name.');return;}
        const now=Date.now();
        if(editor.newItem){if(editor.kind==='template')actions.library.templates.push({id:newId(),folderId:editor.folderId,name,text,transparentBackground:!!overlay.querySelector<HTMLInputElement>('[data-editor-transparent]')?.checked,references:[],order:now,createdAt:now,updatedAt:now});}
        else {const item=current(editor.id!);if(item){item.text=text;item.updatedAt=now;if('references'in item){const template=item as TemplateItem;template.name=isEditPrompt(item.id)?template.name:name;template.transparentBackground=isEditPrompt(item.id)?false:!!overlay.querySelector<HTMLInputElement>('[data-editor-transparent]')?.checked;}}}
        editor=undefined;await commit();return;
      }
      return;
    }
    const button=target.closest<HTMLElement>('[data-close],[data-folder],[data-tab],[data-add],[data-template-tags],[data-stack],[data-edit],[data-delete],[data-use],[data-remove-ref],[data-add-ref-button],[data-new-folder],[data-rename-folder],[data-delete-folder],[data-save-folder],[data-cancel-folder],[data-export-collection],[data-import-collection]');
    const repeatedDelete=!!armedDelete&&!!button&&(armedDelete.kind==='card'?button.dataset.delete===armedDelete.id:button.dataset.deleteFolder===armedDelete.id)&&Date.now()<armedDelete.expiresAt;
    if(armedDelete&&!repeatedDelete)resetDelete();
    if(!button)return;
    if(button.dataset.close){hide();return;}
    if(button.dataset.templateTags){setTemplateHelp(!templateHelpOpen);return;}
    if(button.hasAttribute('data-export-collection')){
      try{const result=await actions.exportCollection(kind==='templates'?'templates':tab,folder);if(result){notice='';transferStatus=`Exported ${result.count} ${kind==='templates'?'template':'prompt'}${result.count===1?'':'s'}.`;render();}}
      catch(reason){transferStatus='';notice=reason instanceof Error?reason.message:String(reason);render();}
      return;
    }
    if(button.hasAttribute('data-import-collection')){
      try{const result=await actions.importCollection(kind==='templates'?'templates':tab);if(result){notice='';transferStatus=`Imported ${result.count} ${kind==='templates'?'template':'prompt'}${result.count===1?'':'s'}.`;if(result.folderName)folder=actions.library.folders.find(item=>item.name===result.folderName&&(kind==='templates'||item.id!==EDIT_PROMPTS_FOLDER))?.id??folder;render();}}
      catch(reason){transferStatus='';notice=reason instanceof Error?reason.message:String(reason);render();}
      return;
    }
    if(button.dataset.cancelFolder){folderEditor=undefined;notice='';render();return;}
    if(button.dataset.saveFolder){const id=button.dataset.saveFolder;if(id===EDIT_PROMPTS_FOLDER)return;const input=overlay.querySelector<HTMLInputElement>(`[data-folder-name="${id}"]`);const name=input?.value.trim();if(!name){notice='Enter a folder name.';render();return;}if(id==='new'){const next=newId();actions.library.folders.push({id:next,name,order:Date.now()});folder=next;}else{const found=actions.library.folders.find(x=>x.id===id);if(found)found.name=name;}folderEditor=undefined;await commit();return;}
    if(button.dataset.folder){folder=button.dataset.folder;render();return;}
    if(button.dataset.tab){tab=button.dataset.tab as 'saved'|'history';render();return;}
    if(button.dataset.stack){expanded.has(button.dataset.stack)?expanded.delete(button.dataset.stack):expanded.add(button.dataset.stack);render();return;}
    if(button.dataset.newFolder){folderEditor='new';notice='';render();return;}
    if(button.dataset.renameFolder){if(button.dataset.renameFolder===EDIT_PROMPTS_FOLDER)return;folderEditor=button.dataset.renameFolder;notice='';render();return;}
    if(button.dataset.deleteFolder){const id=button.dataset.deleteFolder;if(id===EDIT_PROMPTS_FOLDER)return;if(!repeatedDelete){armDelete('folder',id);return;}resetDelete();actions.library.folders=actions.library.folders.filter(x=>x.id!==id);for(const item of [...actions.library.prompts,...actions.library.history,...actions.library.templates])if(item.folderId===id)item.folderId=ROOT_FOLDER;folder=ROOT_FOLDER;await commit();return;}
    if(button.dataset.addRefButton){const id=button.dataset.addRefButton;Array.from(overlay.querySelectorAll<HTMLInputElement>('[data-add-ref]')).find(input=>input.dataset.addRef===id)?.click();return;}
    if(button.dataset.add&&kind==='templates'){openEditor();return;}
    const id=button.dataset.edit||button.dataset.delete||button.dataset.use||button.dataset.removeRef;if(!id)return;const item=current(id);if(!item)return;
    if(button.dataset.edit){openEditor(item);return;}
    if(button.dataset.delete){if(isEditPrompt(id))return;if(!repeatedDelete){armDelete('card',id);return;}resetDelete();for(const key of ['prompts','history','templates'] as const)actions.library[key]=actions.library[key].filter(x=>x.id!==id) as never;await commit();return;}
    if(button.dataset.removeRef&&'references'in item){item.references=(item as TemplateItem).references.filter(r=>r.id!==button.dataset.ref);await commit();return;}
    if(button.dataset.use){
      if(isEditPrompt(id))return;
      try{if('name'in item)await actions.useTemplate(item as TemplateItem);else if(tab==='history')await actions.useHistory(item as HistoryItem);else await actions.usePrompt(item as PromptItem);hide();}
      catch(reason){notice=reason instanceof Error?reason.message:String(reason);render();}
    }
  };
  overlay.onchange=async e=>{const input=e.target as HTMLInputElement;if(!input.dataset.addRef||!input.files?.[0])return;const item=current(input.dataset.addRef) as TemplateItem|undefined;if(!item||!('references'in item))return;try{const image=await smallImage(input.files[0]);if(referenceBytes(actions.library)+image.dataUrl.length>REFERENCE_BUDGET)throw Error('Reference storage is full. Remove an image before adding another.');item.references.push(image);item.updatedAt=Date.now();await commit();}catch(error){notice=error instanceof Error?error.message:String(error);render();}};
  overlay.onmousedown=e=>{if(editor&&!fieldDialog&&(e.target as Element).closest('[data-markdown],[data-insert-tag]'))e.preventDefault();};
  overlay.ondblclick=e=>{if(!editor||fieldDialog)return;const pill=(e.target as Element).closest<HTMLElement>('.template-rich-editor [data-template-tag]');if(pill){e.preventDefault();openFieldDialog(pillKind(templateTags(pill.dataset.templateTag??'')[0].field),pill);}};
  overlay.oncopy=e=>{if(!selectedPill||!richArea()?.contains(selectedPill)||!richArea()?.contains(e.target as Node))return;e.preventDefault();e.clipboardData?.setData('text/plain',selectedPill.dataset.templateTag??'');};
  overlay.oncut=e=>{if(!selectedPill||!richArea()?.contains(selectedPill)||!richArea()?.contains(e.target as Node))return;e.preventDefault();e.clipboardData?.setData('text/plain',selectedPill.dataset.templateTag??'');const rich=richArea()!,start=richOffsetBefore(rich,selectedPill);replaceEditorText(start,start+(selectedPill.dataset.templateTag?.length??0),'');};
  overlay.onpaste=e=>{if(!editor||fieldDialog||!richArea()?.contains(e.target as Node))return;e.preventDefault();insertEditorText(e.clipboardData?.getData('text/plain')??'');};
  overlay.addEventListener('keydown',e=>{if(!editor||fieldDialog||!richArea()?.contains(e.target as Node))return;
    if(selectedPill&&e.key.startsWith('Arrow'))selectPill();
    if(selectedPill&&richArea()!.contains(selectedPill)){
      if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();openFieldDialog(pillKind(templateTags(selectedPill.dataset.templateTag??'')[0].field),selectedPill);return;}
      if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();e.stopImmediatePropagation();const start=richOffsetBefore(richArea()!,selectedPill);replaceEditorText(start,start+(selectedPill.dataset.templateTag?.length??0),'');return;}
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();selectPill();return;}
    }
    if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();insertEditorText('\n');}
  });
  overlay.ondragstart=e=>{
    if(fieldDialog){const handle=(e.target as Element).closest<HTMLElement>('[data-field-drag]');fieldDragging=handle?.dataset.fieldDrag;if(!fieldDragging){e.preventDefault();return;}handle?.closest<HTMLElement>('[data-field-option]')?.classList.add('dragging');e.dataTransfer?.setData('text/plain',fieldDragging);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';return;}
    if(editor){const pill=(e.target as Element).closest<HTMLElement>('.template-rich-editor [data-template-tag]');if(!pill){e.preventDefault();return;}draggingPill=pill;selectPill(pill);e.dataTransfer?.setData('text/plain',pill.dataset.templateTag??'');if(e.dataTransfer)e.dataTransfer.effectAllowed='move';return;}
    resetDelete();const card=(e.target as Element).closest<HTMLElement>('[data-card]');dragging=card?.dataset.card;if(dragging&&isEditPrompt(dragging)){dragging=undefined;e.preventDefault();return;}
    if(!dragging)return;
    const entries=tab==='history'?actions.library.history:list();const visible=entries.filter(x=>folder===ROOT_FOLDER||x.folderId===folder).sort((a,b)=>tab==='history'?b.order-a.order:a.order-b.order);
    if(promptStacks(visible).some(group=>group.length>1&&group.some(item=>item.id===dragging)))overlay.classList.add('dragging-stack');
    card?.classList.add('dragging');e.dataTransfer?.setData('text/plain',dragging);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';
  };
  overlay.ondragover=e=>{if(fieldDialog){const row=(e.target as Element).closest<HTMLElement>('[data-field-option]');if(!row||!fieldDragging)return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';overlay.querySelectorAll('.field-option.drop-before,.field-option.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));const rect=row.getBoundingClientRect();row.classList.add(e.clientY<rect.top+rect.height/2?'drop-before':'drop-after');return;}if(editor&&draggingPill&&((e.target as Element).closest('[data-editor-rich]'))){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';return;}if((e.target as Element).closest('[data-card],[data-stack-drop],[data-folder],[data-unstack],.cards')){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';}};
  overlay.ondrop=async e=>{
    if(fieldDialog){e.preventDefault();const source=fieldDragging,target=(e.target as Element).closest<HTMLElement>('[data-field-option]');fieldDragging=undefined;if(!source||!target)return;readFieldInputs();const from=fieldDialog.choices.findIndex(choice=>choice.id===source),to=fieldDialog.choices.findIndex(choice=>choice.id===target.dataset.fieldOption);if(from<0||to<0||from===to){overlay.querySelectorAll('.field-option').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));return;}const rect=target.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;const [option]=fieldDialog.choices.splice(from,1);const index=fieldDialog.choices.findIndex(choice=>choice.id===target.dataset.fieldOption);fieldDialog.choices.splice(index+(after?1:0),0,option);refreshFieldDialog();return;}
    if(editor){e.preventDefault();const rich=richArea(),pill=draggingPill;draggingPill=undefined;if(!rich||!pill||!rich.contains(pill)||(e.target as Element).closest('[data-editor-rich]')===null)return;const value=getEditorText(),source=richOffsetBefore(rich,pill),syntax=pill.dataset.templateTag??'',rawDestination=richOffsetAtPoint(rich,e.clientX,e.clientY),destination=rawDestination>source?Math.max(source,rawDestination-syntax.length):rawDestination;const remaining=value.slice(0,source)+value.slice(source+syntax.length);setEditorValue(remaining.slice(0,destination)+syntax+remaining.slice(destination),destination,destination+syntax.length);return;}
    e.preventDefault();const sourceId=dragging;dragging=undefined;overlay.classList.remove('dragging-stack');overlay.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging'));
    if(!sourceId)return;
    const entries=tab==='history'?actions.library.history:list();const from=entries.find(x=>x.id===sourceId);if(!from)return;
    const target=e.target as Element;const destination=target.closest<HTMLElement>('[data-folder]')?.dataset.folder;
    if(destination){if(isEditPrompt(sourceId))return;from.folderId=destination;from.stackId=null;folder=destination;await commit();return;}
    const visible=entries.filter(x=>folder===ROOT_FOLDER||x.folderId===folder).slice().sort((a,b)=>tab==='history'?b.order-a.order:a.order-b.order);
    const groups=promptStacks(visible);const arranged=groups.flat().filter(item=>item.id!==sourceId);
    const targetCard=target.closest<HTMLElement>('[data-card]');const targetId=targetCard?.dataset.card;
    const targetStack=target.closest<HTMLElement>('[data-stack-drop]')?.dataset.stackDrop;
    if(targetId&&isEditPrompt(targetId))return;
    if(targetId===sourceId)return;
    const targetGroup=groups.find(group=>targetStack?(group[0].stackId||group[0].id)===targetStack:group.some(item=>item.id===targetId));
    if(!targetGroup&&!target.closest('[data-unstack],.cards'))return;
    if(targetGroup&&targetGroup.length>1){
      const stackId=targetGroup[0].stackId||newId();for(const item of targetGroup)item.stackId=stackId;
      from.stackId=stackId;from.folderId=targetGroup[0].folderId;expanded.add(stackId);
    }else if(targetGroup){from.stackId=null;from.folderId=targetGroup[0].folderId;}
    else from.stackId=null;
    let index=arranged.length;
    if(targetId&&targetId!==sourceId){const at=arranged.findIndex(item=>item.id===targetId);if(at>=0){const rect=targetCard!.getBoundingClientRect();index=at+(e.clientY>rect.top+rect.height/2?1:0);}}
    else if(targetGroup?.length){const last=targetGroup[targetGroup.length-1];const at=arranged.findIndex(item=>item.id===last.id);if(at>=0)index=at+1;}
    arranged.splice(index,0,from);
    let cursor=0;const ordered=folder===ROOT_FOLDER?arranged:entries.slice().sort((a,b)=>tab==='history'?b.order-a.order:a.order-b.order).map(item=>item.folderId===folder?arranged[cursor++]:item);
    ordered.forEach((item,i)=>item.order=tab==='history'?ordered.length-i:i);
    await commit();
  };
  overlay.ondragend=()=>{draggingPill=undefined;if(fieldDialog){fieldDragging=undefined;overlay.querySelectorAll('.field-option').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));return;}dragging=undefined;overlay.classList.remove('dragging-stack');overlay.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging'));};
  overlay.onkeydown=e=>{const input=e.target as HTMLInputElement;if(fieldDialog){if(e.key==='Escape'){e.preventDefault();closeFieldDialog();}else if(e.key==='Tab'){const focusable=Array.from(overlay.querySelectorAll<HTMLElement>('.field-config-dialog button,.field-config-dialog input')).filter(el=>!el.hasAttribute('disabled'));const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}else if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')&&input.dataset.fieldDrag){e.preventDefault();readFieldInputs();const id=input.dataset.fieldDrag,index=fieldDialog.choices.findIndex(choice=>choice.id===id),next=index+(e.key==='ArrowUp'?-1:1);if(index>=0&&next>=0&&next<fieldDialog.choices.length){const [choice]=fieldDialog.choices.splice(index,1);fieldDialog.choices.splice(next,0,choice);refreshFieldDialog();Array.from(overlay.querySelectorAll<HTMLElement>('[data-field-drag]')).find(el=>el.dataset.fieldDrag===id)?.focus();}}return;}if(editor){if(e.key==='Escape'){e.preventDefault();editor=undefined;render();}else if(e.key==='Tab'){const focusable=Array.from(overlay.querySelectorAll<HTMLElement>('.item-editor button,.item-editor input,.item-editor textarea')).filter(el=>!el.hasAttribute('disabled'));const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}return;}if(e.key==='Enter'&&input.dataset.folderName){e.preventDefault();overlay.querySelector<HTMLButtonElement>(`[data-save-folder="${input.dataset.folderName}"]`)?.click();}else if(e.key==='Escape'){e.preventDefault();if(input.dataset.collectionSearch&&search){search='';render(true);}else if(armedDelete)resetDelete();else if(folderEditor){folderEditor=undefined;render();}else if(templateHelpOpen)setTemplateHelp(false);else hide();}};
  render(false,true);
  return ()=>{for(const url of historyUrls.values())URL.revokeObjectURL(url);historyUrls.clear();};
}

async function smallImage(file:File):Promise<ReferenceImage>{
  if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error('Choose a PNG, JPEG, or WebP image.');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const dataUrl=canvas.toDataURL('image/jpeg',.78);if(dataUrl.length>240_000)throw Error('This reference is too large after resizing. Choose a smaller image.');
  return {id:newId(),name:file.name.slice(0,100),dataUrl};
}
