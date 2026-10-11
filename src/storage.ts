export const PREFIX = 'kymi-textlab:draft:';
export const AGE = 7 * 24 * 60 * 60 * 1000;
export interface Draft { version: 1; updated: number; revision: string; input: string; second: string; options: Record<string,string|boolean> }
export interface Store { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void }
export function readDraft(storage:Store,mode:string,now=Date.now()):Draft|null {
  const raw=storage.getItem(PREFIX+mode); if(!raw)return null;
  try {
    const d=JSON.parse(raw);
    if(d.version!==1||typeof d.updated!=='number'||d.updated>now+60_000||now-d.updated>AGE||typeof d.revision!=='string'||typeof d.input!=='string'||typeof d.second!=='string'||!d.options||typeof d.options!=='object'||Array.isArray(d.options)||!Object.values(d.options).every(x=>typeof x==='string'||typeof x==='boolean')||d.input.length>200_000||d.second.length>200_000) {storage.removeItem(PREFIX+mode);return null;}
    return d;
  } catch {storage.removeItem(PREFIX+mode);return null;}
}
export function saveDraft(storage:Store,mode:string,d:Draft,expectedRevision:string|null) {
  const previous=readDraft(storage,mode);
  if((previous?.revision??null)!==expectedRevision)throw new Error('다른 탭에서 초안이 바뀌었습니다. 현재 입력은 그대로 유지했습니다. 초안을 확인한 뒤 다시 저장을 켜 주세요.');
  const raw=JSON.stringify(d);
  if(new TextEncoder().encode(raw).length>1_048_576)throw new Error('초안 저장 한도를 넘었습니다. TXT로 저장해 주세요. 현재 입력은 유지됩니다.');
  storage.setItem(PREFIX+mode,raw);
}
