export function mobileWorkerSource(paths: readonly string[], version: string) {
	return `const CACHE=${JSON.stringify("jedv-mobile-static-" + version)};
const PUBLIC=new Set(${JSON.stringify(paths)});
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const path of PUBLIC){const response=await fetch(path,{credentials:'omit',cache:'reload',redirect:'error'});if(!response.ok)throw new Error('Static asset unavailable');await cache.put(path,response);}await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('jedv-mobile-static-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.search||!PUBLIC.has(url.pathname)||url.pathname.startsWith('/mobile/api'))return;event.respondWith((async()=>{const cached=await(await caches.open(CACHE)).match(url.pathname);return cached||fetch(new Request(request,{credentials:'omit',cache:'no-cache',redirect:'error'}));})());});
`;
}
