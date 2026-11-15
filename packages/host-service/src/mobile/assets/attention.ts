export const mobileAttentionSource = String.raw`
export function attentionTitle(group,t){return t(({suspected_stalled:'suspectedStalled',mail_unacked:'mailUnacked',automation_failed:'automationFailed',team_attention:'teamAttention'})[group.kind]||'alerts');}
export function renderAttentionGroups({document,state,t,time,actions,hasApprovals=false}) {
 const root=document.createElement('section');root.className='attention-groups';root.setAttribute('aria-label',t('alerts'));
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;};
 const button=(label,fn)=>{const node=el('button','text-button',label);node.type='button';node.addEventListener('click',fn);return node;};
 const previous=new Map([...document.querySelectorAll('article[data-group-key]')].map(node=>[node.dataset.groupKey,!!node.querySelector('details.audit')?.open]));
 if(!state.groups.length&&state.attentionReady&&!hasApprovals)root.append(el('p','empty',t('noAttention')));
 for(const group of state.groups){
  const card=el('article','card attention-card');card.dataset.groupKey=group.groupKey;
  const title=el('div','card-title'),icon=el('img','icon');icon.src='/mobile/icons/'+(group.severity==='high'?'alert':'inbox')+'.svg';icon.alt='';icon.setAttribute('aria-hidden','true');title.append(icon,el('h2','',attentionTitle(group,t)),el('span','badge',t(group.disposition==='open'?'attentionOpen':group.disposition)));card.append(title);
  const source=group.source,team=state.status.teams.find(item=>item.id===source.teamId),member=team?.members.find(item=>item.id===source.memberId),automation=state.status.automations.find(item=>item.id===source.automationId),names=[team?.name,member?.name,automation?.name].filter(Boolean);
  if(names.length)card.append(el('p','card-body',names.join(' · ')));
  const meta=el('div','attention-meta');if(group.disposition==='open')meta.append(el('span','',t('activeItems',{count:group.activeCount})));if(group.unread)meta.append(el('span','unread',t('unread')));meta.append(el('time','',time(group.latestCreatedAt)));card.append(meta);
  const details=el('details','audit');details.open=previous.get(group.groupKey)||false;details.append(el('summary','',t('details')),el('p','',group.body),el('p','',t('totalItems',{count:group.totalCount})),el('pre','',JSON.stringify({groupKey:group.groupKey,source:group.source},null,2)));
  for(const item of group.items){const entry=el('div','attention-detail');entry.append(el('p','',time(item.createdAt)),el('p','',item.body));if(item.ignoreReason)entry.append(el('p','',item.ignoreReason));entry.append(el('pre','',JSON.stringify({id:item.id,readAt:item.readAt,ignoredAt:item.ignoredAt,resolvedAt:item.resolvedAt},null,2)));details.append(entry);}card.append(details);
  const busy=state.attentionBusy.has(group.groupKey),uncertain=state.uncertainAttention.has(group.groupKey),disabled=!state.online||!state.attentionReady||state.loggingOut||busy||uncertain;
  const row=el('div','actions');
  if(group.disposition==='open'){
   if(group.unread){const read=button(t('markRead'),()=>void actions.markAttentionRead(group));read.dataset.attentionAction='read';read.disabled=disabled;row.append(read);}
   const ignore=button(t('ignore'),()=>actions.editIgnore(group.groupKey));ignore.dataset.attentionAction='ignore';ignore.disabled=disabled;row.append(ignore);
  }
  const ask=button(t('askButler'),()=>void actions.ask({groupKey:group.groupKey,...(source.teamId?{teamId:source.teamId}:{}),...(source.workspaceId?{workspaceId:source.workspaceId}:{})}));ask.disabled=!state.conversationReady;row.append(ask);card.append(row);
  if(state.ignoreEditor===group.groupKey&&group.disposition==='open'){
   const form=el('form','ignore-form'),label=el('label','',t('ignoreReason')),input=el('textarea');input.id='ignore-reason';input.maxLength=2000;input.rows=2;input.value=state.ignoreReasons.get(group.groupKey)||'';input.disabled=busy;input.addEventListener('input',()=>actions.ignoreReason(group.groupKey,input.value));label.append(input);
   const controls=el('div','actions'),cancel=button(t('cancel'),()=>actions.cancelIgnore()),submit=button(t('ignore'),()=>{});submit.type='submit';submit.dataset.attentionAction='confirm-ignore';submit.disabled=disabled;cancel.disabled=busy;controls.append(cancel,submit);form.append(label,controls);form.addEventListener('submit',event=>{event.preventDefault();void actions.ignoreAttention(group,input.value);});card.append(form);
  }
  if(uncertain)card.append(el('p','error-inline',t('attentionUpdateFailed')));
  root.append(card);
 }
 return root;
}
`;
