export const mobileApiSource = `
export class MobileApiError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}
export function createMobileApi(fetcher, online) {
 let csrf = null;
 async function request(path, options = {}) {
  if (!online()) throw new MobileApiError(0, 'offline');
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json' };
  if (method === 'POST') {
   headers['Content-Type'] = 'application/json';
   if (path !== '/pair') {
    if (!csrf) throw new MobileApiError(401, 'session');
    headers['x-jedv-mobile-csrf'] = csrf;
   }
  }
  let response;
  try { response = await fetcher('/mobile/api' + path, { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(method === 'POST' ? {body: JSON.stringify(options.body || {})} : {}) }); }
  catch { throw new MobileApiError(0, 'network'); }
  let value;
  try { value = await response.json(); } catch { throw new MobileApiError(response.status || 502, 'response'); }
  if (!response.ok) { if (response.status === 401) csrf = null; throw new MobileApiError(response.status, typeof value.error === 'string' ? value.error : 'request'); }
  return value;
 }
 return {
  clear() { csrf = null; },
  async session() { const value = await request('/session'); csrf = value.csrfToken; return value; },
  async pair(code, label) { const value = await request('/pair', {method:'POST',body:{code,label}}); csrf = value.csrfToken; return value; },
  async logout() { const value = await request('/logout', {method:'POST'}); csrf = null; return value; },
  threads: () => request('/butler/threads'),
  conversationState: preferredThreadId => request('/butler/state' + (preferredThreadId ? '?preferredThreadId='+encodeURIComponent(preferredThreadId) : '')),
  history: id => request('/butler/history?limit=100' + (id ? '&threadId='+encodeURIComponent(id) : '')),
  send: body => request('/butler/send', {method:'POST',body}),
  inbox: (view='open') => request('/inbox?view='+encodeURIComponent(view)+'&limit=100'),
  markAttentionRead: groupKey => request('/attention/read',{method:'POST',body:{groupKey}}),
  ignoreAttention: (groupKey,reason) => request('/attention/ignore',{method:'POST',body:{groupKey,...(reason?{reason}:{})}}),
  approvals: (status,threadId) => request('/approvals?status=' + encodeURIComponent(status)+(threadId?'&threadId='+encodeURIComponent(threadId):'')+'&limit=200'),
  resolve: (id, payloadHash, decision) => request('/approvals/' + encodeURIComponent(id) + '/resolve', {method:'POST',body:{payloadHash,decision}}),
  status: () => request('/status'),
 };
}
`;
