import { defineConfig } from 'vite';
import { pages } from './scripts/content.mjs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const securityHeaders=Object.fromEntries(readFileSync(new URL('public/_headers',import.meta.url),'utf8').split('\n\n')[0].split('\n').slice(1).filter(Boolean).map(line=>{const index=line.indexOf(':');return [line.slice(0,index).trim(),line.slice(index+1).trim()];}));
export default defineConfig({
  appType:'mpa',
  preview:{headers:securityHeaders},
  build: { rollupOptions: { input: Object.fromEntries(pages.map(p => [p.slug || 'home', resolve(import.meta.dirname, p.slug === '404' ? '404.html' : p.slug ? p.slug + '/index.html' : 'index.html')])) } }
});
