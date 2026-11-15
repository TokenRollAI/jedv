export const mobileAppSource = String.raw`
import {createMobileApi} from './client.js';
import {createTranslator} from './i18n.js';
import {renderMobile} from './ui.js';
export function mountMobile({window,document,fetcher=window.fetch.bind(window),clock=()=>Date.now(),uuid=()=>window.crypto.randomUUID()}) {
 const root=document.getElementById('app'),i18n=createTranslator(document,window.navigator),views=new Map();let serial=0;
 function createView(threadId=null,mode='default'){const view={key:String(++serial),threadId,mode,draft:'',sending:false,pendingTurn:null,messages:[],error:null,degraded:null,turnContext:null};views.set(view.key,view);if(views.size>20)for(const [key,item]of views)if(item!==view&&!item.draft&&!item.pendingTurn&&!item.sending){views.delete(key);break;}return view;}
 let active=createView();
 const state={phase:'loading',screen:'inbox',session:null,online:window.navigator.onLine!==false,loading:false,pairing:false,loggingOut:false,pairCode:'',deviceLabel:'',currentThreadId:null,conversationReady:false,showConversations:false,threads:[],groups:[],badge:null,attentionReady:false,attentionView:'open',attentionBusy:new Set(),uncertainAttention:new Set(),ignoreEditor:null,ignoreReasons:new Map(),approvals:[],inboxApprovals:[],approvalHistory:[],knownTeams:[],status:{teams:[],automations:[]},showHistory:false,reasons:new Map(),resolving:new Set(),uncertainApprovals:new Set()};
 for(const key of ['threadId','draft','sending','pendingTurn','messages','error','degraded','turnContext'])Object.defineProperty(state,key,{enumerable:true,get:()=>active[key],set:value=>{active[key]=value;}});
 Object.defineProperty(state,'followDefault',{get:()=>active.mode==='default'&&!active.draft&&!active.sending&&!active.pendingTurn&&!active.turnContext});
 Object.defineProperty(state,'awayFromCurrent',{get:()=>active.mode!=='default'||active.threadId!==state.currentThreadId});
 Object.defineProperty(state,'savedViews',{get:()=>[...views.values()].filter(view=>view!==active&&(view.draft||view.sending||view.pendingTurn)).map(view=>({key:view.key,label:(view.pendingTurn?.humanText||view.draft).slice(0,80),sending:view.sending}))});
 const api=createMobileApi(fetcher,()=>state.online);let epoch=0,disposed=false,refreshing=null;const expired=new Set();
 const render=()=>{state.now=clock();if(!disposed)renderMobile(document,root,state,i18n,actions);};
 const mergeApprovals=items=>{state.approvals=[...items,...state.approvals.filter(item=>!items.some(next=>next.id===item.id))].slice(0,500);};
 function forget(key=null){epoch++;expired.clear();api.clear();views.clear();active=createView();state.pairCode='';state.deviceLabel='';state.session=null;state.phase='pair';state.currentThreadId=null;state.conversationReady=false;state.threads=[];state.groups=[];state.badge=null;state.attentionReady=false;state.attentionView='open';state.attentionBusy.clear();state.uncertainAttention.clear();state.ignoreEditor=null;state.ignoreReasons.clear();state.approvals=[];state.inboxApprovals=[];state.approvalHistory=[];state.knownTeams=[];state.status={teams:[],automations:[]};state.reasons.clear();state.resolving.clear();state.uncertainApprovals.clear();state.showConversations=false;state.error=key?{key}:null;render();}
 function error(error,key,view=active){if(error.status===401){forget('sessionExpired');return;}view.error={key:error.status===403?'forbidden':error.status===429?'rateLimit':key,detail:error.status?error.message:undefined};render();}
 function applyConversation(value){state.conversationReady=true;state.currentThreadId=value.currentThreadId;if(state.followDefault)active.threadId=value.currentThreadId;}
 async function loadView(view=active){const id=view.threadId,version=epoch;if(!id){view.messages=[];render();return;}const data=await Promise.allSettled([api.history(id),api.approvals('all',id)]);if(version!==epoch||view.threadId!==id)return;for(let i=0;i<data.length;i++){const item=data[i];if(item.status==='rejected'){error(item.reason,'refreshFailed',view);if(item.reason.status===401)return;}else if(i===0)view.messages=item.value;else mergeApprovals(item.value);}render();}
 function applyInbox(value,inboxView){
  if(!Array.isArray(value.groups)||!value.badge||![value.badge.count,value.badge.pendingApprovals,value.badge.unreadHighFaultGroups].every(n=>Number.isSafeInteger(n)&&n>=0)){state.attentionReady=false;throw new Error('attention unsupported');}
  state.badge=value.badge;state.attentionReady=true;if(inboxView!==state.attentionView)return;state.groups=value.groups;state.inboxApprovals=value.approvals||[];mergeApprovals(state.inboxApprovals);
 }
 async function reloadAttention(){const version=epoch,inboxView=state.attentionView;const value=await api.inbox(inboxView);if(version===epoch)applyInbox(value,inboxView);}
 async function mutateAttention(group,kind,reason){
  if(!state.online||state.phase!=='authenticated'||!state.attentionReady||state.loggingOut||state.attentionBusy.has(group.groupKey)||state.uncertainAttention.has(group.groupKey))return;
  const current=state.groups.find(item=>item.groupKey===group.groupKey);if(!current||current.disposition!=='open'||(kind==='read'&&!current.unread))return;
  if(clock()>=state.session.expiresAt){forget('sessionExpired');return;}
  const version=epoch,view=active;state.attentionBusy.add(group.groupKey);view.error=null;render();
  try{const value=await(kind==='read'?api.markAttentionRead(group.groupKey):api.ignoreAttention(group.groupKey,reason));if(version!==epoch)return;state.badge=value.badge;if(kind==='ignore'){state.ignoreEditor=null;state.ignoreReasons.delete(group.groupKey);}await reloadAttention();}
  catch(e){if(version!==epoch)return;if(e.status!==401)state.uncertainAttention.add(group.groupKey);error(e,'attentionUpdateFailed',view);}
  finally{state.attentionBusy.delete(group.groupKey);render();}
 }
 async function refresh(explicit=false){
  if(disposed||state.phase!=='authenticated'||!state.online)return;if(refreshing)return refreshing;
  const version=epoch,view=active,inboxView=state.attentionView;state.loading=true;render();
  const work=(async()=>{try{
   const session=await api.session();if(version!==epoch)return;state.session=session;
   const data=await Promise.allSettled([api.conversationState(),api.threads(),api.inbox(inboxView),api.status()]);if(version!==epoch)return;
   let failed=false;
   for(let i=0;i<data.length;i++){const item=data[i];if(item.status==='rejected'){if(item.reason.status===401){forget('sessionExpired');return;}if(i===0){state.conversationReady=false;view.error={key:'conversationUnavailable'};}failed=true;continue;}const value=item.value;if(i===0)applyConversation(value);if(i===1)state.threads=value.filter(thread=>!thread.kind||thread.kind==='conversation');if(i===2){try{applyInbox(value,inboxView);}catch{failed=true;view.error={key:'attentionUnavailable'};}}if(i===3){state.status=value;state.knownTeams=[...value.teams,...state.knownTeams.filter(team=>!value.teams.some(current=>current.id===team.id))].slice(0,500);}}
   if(explicit){if(state.conversationReady&&state.attentionReady)view.error=failed?{key:'refreshFailed'}:null;if(!failed){state.uncertainApprovals.clear();state.uncertainAttention.clear();}}else if(failed&&state.conversationReady&&state.attentionReady)view.error={key:'refreshFailed'};
   await loadView(active);
  }catch(e){if(version===epoch)error(e,'refreshFailed',view);}finally{state.loading=false;refreshing=null;render();}})();refreshing=work;return work;
 }
 async function choose(view){active=view;state.showConversations=false;state.screen='butler';render();await loadView(view);}
 const actions={
  refresh,
  async attentionView(value){if(!['open','handled','all'].includes(value)||value===state.attentionView)return;state.attentionView=value;state.groups=[];state.inboxApprovals=[];state.ignoreEditor=null;render();if(refreshing)await refreshing;await refresh(true);},
  markAttentionRead:group=>mutateAttention(group,'read'),
  ignoreAttention:(group,reason)=>mutateAttention(group,'ignore',reason?.trim()),
  editIgnore(groupKey){state.ignoreEditor=groupKey;render();document.getElementById('ignore-reason')?.focus();},
  ignoreReason(groupKey,value){state.ignoreReasons.set(groupKey,value);},
  cancelIgnore(){state.ignoreEditor=null;render();},
  async restore(){if(state.loading||!state.online)return;state.loading=true;render();try{await start();}finally{state.loading=false;render();}},
  language(value){i18n.set(value);render();},pairCode(value){state.pairCode=value;},deviceLabel(value){state.deviceLabel=value;},
  draft(value){if(active.pendingTurn&&active.pendingTurn.humanText!==value){const previous=active;active=createView(previous.threadId,previous.mode);active.turnContext=previous.turnContext;}active.draft=value;const button=root.querySelector('[data-send]');if(button)button.disabled=!state.online||!state.conversationReady||state.sending||state.loggingOut||!value.trim();},
  screen(value){state.screen=value;render();},
  async thread(id){const view=[...views.values()].reverse().find(item=>item.threadId===id&&item.mode!=='new')||createView(id,'history');view.mode='history';await choose(view);},
  async newTopic(){await choose(createView(null,'new'));},
  async current(){let current;try{current=await api.conversationState();state.currentThreadId=current.currentThreadId;state.conversationReady=true;}catch(e){error(e,'refreshFailed');return;}const view=[...views.values()].reverse().find(item=>item.threadId===current.currentThreadId&&item.mode!=='new')||createView(current.currentThreadId);view.mode='default';await choose(view);},
  async restoreView(key){const view=views.get(key);if(view)await choose(view);},
  conversations(){state.showConversations=!state.showConversations;render();},
  async ask(context){if(!state.conversationReady)return;if(active.draft||active.pendingTurn||active.sending)active=createView(state.currentThreadId,'history');else active.threadId=state.currentThreadId;active.turnContext={...context};state.screen='butler';render();await loadView(active);document.getElementById('draft')?.focus();},
  async pair(){if(state.pairing||!state.online||!state.pairCode.trim())return;state.pairing=true;state.error=null;const code=state.pairCode.trim(),label=state.deviceLabel.trim()||undefined;render();try{const session=await api.pair(code,label);epoch++;state.session=session;state.phase='authenticated';state.pairCode='';state.error=null;await refresh(true);}catch(e){state.error={key:e.status===401?'expiredCode':e.status===429?'rateLimit':'pairFailed'};}finally{state.pairing=false;state.pairCode='';render();if(state.phase==='pair')document.getElementById('pair-code')?.focus();}},
  async logout(){if(state.loggingOut||!state.online)return;state.loggingOut=true;render();try{await api.logout();i18n.clearPreference();forget();}catch(e){error(e,'logoutFailed');}finally{state.loggingOut=false;render();}},
  async send(){
   if(state.sending||!state.online||!state.conversationReady||state.phase!=='authenticated'||state.loggingOut||!state.draft.trim())return;
   if(clock()>=state.session.expiresAt){forget('sessionExpired');return;}
   const version=epoch,view=active,text=view.draft;
   const body=view.pendingTurn&&view.pendingTurn.humanText===text?view.pendingTurn:{humanText:text,requestId:uuid(),...(view.mode==='new'?{newTopic:true}:view.threadId?{threadId:view.threadId}:{}),...(view.turnContext?{context:{...view.turnContext}}:{})};
   view.pendingTurn=body;view.sending=true;view.error=null;let accepted=false;render();
   try{const result=await api.send(body);if(version!==epoch)return;accepted=true;view.threadId=result.threadId;view.degraded=result.reason;if(result.reason)state.reasons.set(result.requestId,result.reason);if(state.reasons.size>50)state.reasons.delete(state.reasons.keys().next().value);mergeApprovals(result.approvals);view.draft='';view.pendingTurn=null;view.turnContext=null;if(view.mode==='new')view.mode='default';
    await loadView(view);const current=await api.conversationState();if(version!==epoch)return;state.currentThreadId=current.currentThreadId;state.conversationReady=true;if(view.threadId!==state.currentThreadId)view.mode='history';const threads=await api.threads();if(version===epoch)state.threads=threads.filter(thread=>!thread.kind||thread.kind==='conversation');}
   catch(e){if(version===epoch)error(e,accepted?'refreshFailed':e.status===0?'uncertainMessage':'requestFailed',view);}
   finally{if(version===epoch){view.sending=false;render();}}
  },
  async resolve(card,decision){
   if(!state.online||state.phase!=='authenticated'||state.loggingOut||state.resolving.has(card.id)||state.uncertainApprovals.has(card.id)||card.status!=='pending'||clock()>=card.expiresAt)return;
   if(clock()>=state.session.expiresAt){forget('sessionExpired');return;}
   const current=state.approvals.find(item=>item.id===card.id);if(!current||current.status!=='pending'||current.payloadHash!==card.payloadHash)return;
   const version=epoch;state.resolving.add(card.id);state.error=null;render();
   try{const result=await api.resolve(card.id,card.payloadHash,decision);if(version!==epoch)return;mergeApprovals([result]);try{await reloadAttention();}catch(e){if(version===epoch)error(e,'refreshFailed');}if(result.status==='failed')state.error={key:'approvalFailed'};}
   catch(e){if(version!==epoch)return;if(e.status!==401)state.uncertainApprovals.add(card.id);error(e,[409,412].includes(e.status)?'approvalConflict':'uncertainApproval');}
   finally{state.resolving.delete(card.id);render();}
  },
  async history(){await actions.attentionView(state.attentionView==='open'?'handled':'open');},
 };
 const offline=()=>{state.online=false;render();};const online=()=>{state.online=true;render();void(state.phase==='pair'?start():refresh(false));};
 const visibility=()=>{if(!document.hidden&&state.online)void refresh(false);};window.addEventListener('offline',offline);window.addEventListener('online',online);document.addEventListener('visibilitychange',visibility);
 const poll=window.setInterval(()=>{if(!document.hidden&&state.online)void refresh(false);},15000);
 const expiry=window.setInterval(()=>{if(state.session&&clock()>=state.session.expiresAt){forget('sessionExpired');return;}let changed=false;for(const card of state.approvals)if(card.status==='pending'&&clock()>=card.expiresAt&&!expired.has(card.id)){expired.add(card.id);if(expired.size>200)expired.delete(expired.values().next().value);changed=true;}if(changed)render();},1000);
 async function start(){render();if(!state.online){state.phase='pair';render();return;}try{state.session=await api.session();state.phase='authenticated';await refresh(true);}catch(e){state.phase='pair';state.error=e.status===401?null:{key:'refreshFailed'};render();}}
 const ready=start();
 return{ready,state,actions,dispose(){disposed=true;epoch++;api.clear();views.clear();active=createView();state.session=null;state.knownTeams=[];state.groups=[];state.badge=null;state.ignoreReasons.clear();state.attentionBusy.clear();state.uncertainAttention.clear();state.approvals=[];state.reasons.clear();window.clearInterval(poll);window.clearInterval(expiry);window.removeEventListener('offline',offline);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);}};
}
if(typeof window!=='undefined'&&window.document&&window.document.getElementById('app')){mountMobile({window,document:window.document});if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('/mobile/service-worker.js',{scope:'/mobile/'}).catch(()=>{});}
`;
