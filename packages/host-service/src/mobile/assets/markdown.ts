// Deliberately small Markdown subset: DOM-only, no HTML interpretation, images or external renderer runtime.
export const mobileMarkdownSource = String.raw`
function safeLink(value) {
 try { const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null; } catch { return null; }
}
export function renderMarkdown(document,text) {
 const root=document.createElement('div');root.className='markdown';
 const inline=(parent,value,depth=0)=>{
  if(depth>3){parent.append(document.createTextNode(value));return;}
  const pattern=/(!?\[([^\]\n]{0,500})\]\(([^)\n]{1,2000})\)|\x60([^\x60\n]{1,4000})\x60|\*\*([^*\n]{1,4000})\*\*|\*([^*\n]{1,4000})\*)/g;
  let position=0,match;
  while((match=pattern.exec(value))){parent.append(document.createTextNode(value.slice(position,match.index)));let node;
   if(match[2]!==undefined){const href=!match[1].startsWith('!')&&safeLink(match[3]);node=document.createElement(href?'a':'span');if(href){node.href=href;node.rel='noopener noreferrer';node.target='_blank';}inline(node,match[2],depth+1);}
   else if(match[4]!==undefined){node=document.createElement('code');node.textContent=match[4];}
   else {node=document.createElement(match[5]!==undefined?'strong':'em');inline(node,match[5]??match[6],depth+1);}
   parent.append(node);position=pattern.lastIndex;
  }parent.append(document.createTextNode(value.slice(position)));
 };
 const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n');let i=0,blocks=0;
 while(i<lines.length){if(++blocks>1000){const rest=document.createElement('p');rest.textContent=lines.slice(i).join('\n');root.append(rest);break;}
  const line=lines[i];if(!line.trim()){i++;continue;}
  const fence=line.match(/^\s{0,3}(\x60{3,}|~{3,})([^\s]*)\s*$/);
  if(fence){i++;const content=[];while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))content.push(lines[i++]);if(i<lines.length)i++;const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=content.join('\n');pre.append(code);root.append(pre);continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){const node=document.createElement('h'+heading[1].length);inline(node,heading[2]);root.append(node);i++;continue;}
  if(/^\s*(?:[-*_]\s*){3,}$/.test(line)){root.append(document.createElement('hr'));i++;continue;}
  if(/^>\s?/.test(line)){const node=document.createElement('blockquote'),content=[];while(i<lines.length&&/^>\s?/.test(lines[i]))content.push(lines[i++].replace(/^>\s?/,''));inline(node,content.join('\n'));root.append(node);continue;}
  const item=line.match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
  if(item){const ordered=/\d/.test(item[1]),list=document.createElement(ordered?'ol':'ul');while(i<lines.length){const current=lines[i].match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);if(!current||/\d/.test(current[1])!==ordered)break;const entry=document.createElement('li');inline(entry,current[2]);list.append(entry);i++;}root.append(list);continue;}
  const paragraph=document.createElement('p'),content=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|>|\s{0,3}(?:[-+*]|\d+\.)\s|\s{0,3}(?:\x60{3,}|~{3,}))/.test(lines[i]))content.push(lines[i++]);inline(paragraph,content.join('\n'));root.append(paragraph);
 }return root;
}
`;
