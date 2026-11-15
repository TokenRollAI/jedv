export const mobileI18nSource = String.raw`
import {catalogs, localeLabels, localeCookie, supportedLocales} from './messages.js';
export function resolveLanguage(preferences) {
 const aliases = {'zh-hant':'zh-TW','zh-hk':'zh-TW','zh-mo':'zh-TW','zh-hans':'zh-CN','zh-sg':'zh-CN'};
 for (const preference of preferences) {
  let parts = String(preference).toLowerCase().split('-').filter(Boolean);
  const singleton = parts.findIndex((part,i) => i > 0 && part.length === 1);
  if (singleton >= 0) parts = parts.slice(0,singleton);
  const exact = supportedLocales.find(code => code.toLowerCase() === parts.join('-')); if (exact) return exact;
  const base = parts[0], script = parts.find(part => part.length === 4), region = parts[parts.length-1];
  for (const key of [parts.join('-'), script && base+'-'+script, region && base+'-'+region]) if (aliases[key]) return aliases[key];
  const shared = supportedLocales.find(code => code.toLowerCase() === base || code.split('-')[0] === base); if (shared) return shared;
 }
 return 'en';
}
export function createTranslator(document, navigator) {
 const raw = document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(localeCookie+'='));
 let chosen = null; try { chosen = raw ? decodeURIComponent(raw.slice(localeCookie.length+1)) : null; } catch {}
 let locale = supportedLocales.includes(chosen) ? chosen : resolveLanguage(navigator.languages || [navigator.language]);
 function t(key, values={}) { const text=catalogs[locale][key] || catalogs.en[key]; return text.replace(/\{(\w+)\}/g, (_,name)=>String(values[name] ?? '{'+name+'}')); }
 return { t, labels:localeLabels, get locale(){return locale;}, set(value){if(!supportedLocales.includes(value))return;locale=value;document.cookie=localeCookie+'='+encodeURIComponent(value)+'; Path=/; Max-Age=31536000; SameSite=Lax';document.documentElement.lang=value;}, clearPreference(){document.cookie=localeCookie+'=; Path=/; Max-Age=0; SameSite=Lax';}, time(value){return new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));} };
}
`;
