import {cleanSpace,deduplicate,sortLines,lf,type Options,type Change} from './engine.ts';
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function pipeline(s:string,o:Options){let out=cleanSpace(s,o);if(o.pipelineDedupe)out=deduplicate(out,{trimKey:true,empty:true}).output;if(o.pipelineSort)out=sortLines(out,{numeric:true});return out;}
export function repairPdf(s:string,hyphens:boolean){s=lf(s);if(hyphens)s=s.replace(/([A-Za-z])[-\u00AD]\n[\t ]*([a-z])/g,'$1$2');return s.split(/\n[\t ]*\n(?:[\t ]*\n)*/).map(p=>p.split('\n').map(l=>l.trim()).join(' ')).join('\n\n');}
export function maskCandidates(s:string,o:Options){const counts={email:0,phone:0,id:0};let output=s;
  if(o.maskEmail)output=output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,()=>{counts.email++;return '[이메일 숨김]';});
  if(o.maskPhone)output=output.replace(/(?<!\d)(?:01[016789][ -]?\d{3,4}[ -]?\d{4})(?!\d)/g,()=>{counts.phone++;return '[전화번호 숨김]';});
  if(o.maskId)output=output.replace(/(?<!\d)\d{6}[ -]?[1-8]\d{6}(?!\d)/g,()=>{counts.id++;return '[주민번호 형태 숨김]';});
  return {output,counts};
}
export function listCsv(s:string,excelText:boolean){const cell=(v:string)=>{if(excelText||/^[\s]*[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};return '\uFEFF내용\r\n'+lf(s).split('\n').map(cell).join('\r\n');}
export function diffReport(changes:Change[],html=false){const additions=changes.filter(c=>c.added).length,deletions=changes.filter(c=>c.removed).length;const title=`텍스트 비교 · 추가 ${additions}구간 · 삭제 ${deletions}구간`;
  if(!html)return title+'\n\n'+changes.map(c=>(c.added?'[+] ':c.removed?'[-] ':'[=] ')+c.value).join('');
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>텍스트 비교 보고서</title><style>body{font:16px/1.7 sans-serif;max-width:960px;margin:32px auto;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}ins{background:#d8f5e6}del{background:#ffe1e1}</style><h1>'+title+'</h1><p>원문을 포함할 수 있는 로컬 보고서입니다. 공유 전 내용을 확인하세요.</p><pre>'+changes.map(c=>{const tag=c.added?'ins':c.removed?'del':'span';return '<'+tag+'>'+escapeHtml((c.added?'[+] ':c.removed?'[-] ':'')+c.value)+'</'+tag+'>';}).join('')+'</pre></html>';
}
