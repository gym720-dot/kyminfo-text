import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {domain,pages} from './content.mjs';
const file=path=>new URL('../dist/'+path,import.meta.url);
const titles=new Set(),descriptions=new Set();let links=0;
const headerText=await readFile(file('_headers'),'utf8');
for(const line of headerText.split('\n'))assert.ok(line.length<=2000,'Cloudflare header line limit');
for(const p of pages){
 const path=p.slug==='404'?'404.html':p.slug?p.slug+'/index.html':'index.html';
 const html=await readFile(file(path),'utf8');
 const title=html.match(/<title>(.*?)<\/title>/s)?.[1];assert.ok(title,path+' title missing');assert.ok(!titles.has(title),'duplicate title');titles.add(title);
 const desc=html.match(/<meta name="description" content="([^"]+)"/s)?.[1];assert.ok(desc,path+' description missing');assert.ok(!descriptions.has(desc),'duplicate description');descriptions.add(desc);
 assert.equal((html.match(/<h1[ >]/g)||[]).length,1,path+' h1');
 assert.ok(html.includes(`href="${domain}${p.slug==='404'?'/404.html':p.slug?'/'+p.slug+'/':'/'}"`),path+' canonical');
 assert.ok(html.includes('lang="ko"'));
 if(p.slug!=='404')assert.ok(!html.includes('name="robots" content="noindex"'));
 else assert.ok(html.includes('name="robots" content="noindex"'));
 const json=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];assert.ok(json);assert.equal(JSON.parse(json)['@context'],'https://schema.org');
 assert.ok(headerText.includes('sha256-'+createHash('sha256').update(json).digest('base64')),'JSON-LD CSP hash mismatch');
 assert.ok(!/adsbygoogle|pagead2|googlesyndication|google-analytics|gtag\(/i.test(html),'active ad or analytics');
 for(const [,href] of html.matchAll(/(?:href|src)="(\/[^"#]*)(?:#[^"]*)?"/g)){if(!href)continue;const target=href==='/'?'index.html':href.slice(1)+(href.endsWith('/')?'index.html':'');assert.ok((await stat(file(target))).isFile(),path+' missing '+href);links++;}
}
const sitemap=await readFile(file('sitemap.xml'),'utf8');assert.equal((sitemap.match(/<loc>/g)||[]).length,16);assert.ok(!sitemap.includes('404'));assert.ok((await readFile(file('robots.txt'),'utf8')).includes(domain+'/sitemap.xml'));
const headers=await readFile(file('_headers'),'utf8');assert.ok(headers.includes("connect-src 'self'"));assert.ok(headers.includes("object-src 'none'"));
assert.ok(headers.includes('https://:version.:project.pages.dev/*'));assert.ok((await readFile(file('licenses.txt'),'utf8')).includes('BSD 3-Clause'));
console.log(`Static check passed: ${pages.length} pages, 16 canonical sitemap URLs, ${links} local references, unique metadata and structured data, no active ads or Google Analytics; Cloudflare beacon is injected at deployment.`);
