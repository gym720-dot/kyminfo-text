import { tools } from './catalog.ts';
import { MAX_INPUT,MAX_DIFF,lf,txtBytes,decodeTxt,csv,type Result,type Options } from './engine.ts';
import { PREFIX,readDraft,saveDraft,type Draft } from './storage.ts';

const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const select=(name:string,label:string,items:string[][],value:string)=>`<label class="option">${label}<select name="${name}">${items.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
const check=(name:string,label:string,on=false)=>`<label class="option"><input type="checkbox" name="${name}" ${on?'checked':''}>${label}</label>`;
const field=(name:string,label:string,value:string,type='text')=>`<label class="option">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type==='number'?'min="1" max="200000" step="1"':''}></label>`;
function optionMarkup(mode:string){
  switch(mode){
    case 'character-counter':return select('basis','제한 기준',[['characters','공백 포함 글자'],['withoutSpaces','공백 제외 글자'],['bytes','UTF-8 바이트']],'characters')+field('limit','제한량','1000','number');
    case 'remove-line-breaks':return select('breakMode','연결 방식',[['paragraphs','문단 유지 · 공백 연결'],['space','모든 줄 공백 연결'],['join','모든 줄 붙여 연결']],'paragraphs');
    case 'whitespace-cleaner':return check('trim','줄 양끝 공백 제거',true)+check('collapse','연속 가로 공백을 하나로',true)+check('blank','빈 줄 하나만 유지',true)+check('tabs','탭을 공백으로')+select('tabSize','탭 공백 수',Array.from({length:8},(_,i)=>[String(i+1),`${i+1}칸`]),'4')+check('zero','폭이 없는 문자 제거')+check('all','모든 공백 삭제 (줄바꿈 포함)');
    case 'remove-duplicate-lines':return check('trimKey','양끝 공백 무시')+check('ignoreCase','영문 대소문자 무시')+check('empty','빈 줄도 중복 제거');
    case 'sort-lines':return check('numeric','숫자 자연 정렬',true)+check('reverse','역순')+check('dropBlank','빈 줄 제외');
    case 'text-diff':return select('diffMode','비교 단위',[['words','단어 상세'],['lines','줄 단위']],'words')+check('ignoreSpace','공백·줄바꿈 차이 무시');
    case 'word-frequency':return check('ignoreCase','영문 대소문자 합산',true)+check('numbers','숫자만 있는 항목 포함');
    case 'case-converter':return select('caseMode','변환 방식',[['upper','모두 대문자'],['lower','모두 소문자'],['title','단어 첫 글자 대문자'],['sentence','문장 첫 글자 대문자']],'upper');
    case 'lorem-ipsum':return select('language','언어',[['ko','한국어'],['latin','라틴 예문']],'ko')+select('unit','생성 단위',[['paragraphs','문단'],['sentences','문장'],['words','단어']],'paragraphs')+field('amount','생성 개수','3','number');
    case 'find-and-replace':return field('find','찾을 내용','기록을')+field('replace','바꿀 내용','메모를')+check('ignoreCase','영문 대소문자 무시')+check('firstOnly','첫 번째만 바꾸기');
    default:return '';
  }
}
class Workspace {
  root:HTMLElement;mode:string;worker?:Worker;timer?:ReturnType<typeof setTimeout>;timeout?:ReturnType<typeof setTimeout>;saveTimer?:ReturnType<typeof setTimeout>;abort=new AbortController();seq=0;result?:Result;revision:string|null=null;candidate:Draft|null=null;history:{input:string;second:string;options:Options}[]=[];composing=false;dirty=false;validInput='';validSecond='';disposed=false;
  constructor(root:HTMLElement,transfer?:string){
    this.root=root;this.mode=root.dataset.mode!;
    const dummy=this.mode==='lorem-ipsum',diff=this.mode==='text-diff';
    root.innerHTML=`<div class="workspace-top"><div><strong>${dummy?'필요한 길이의 예문을 만들어 보세요':'텍스트를 붙여넣고 바로 확인하세요'}</strong><div class="privacy-note">이 브라우저에서 처리 · 기본 미저장 · 외부로 원문 전송 없음</div></div><div class="editor-tools"><button class="button subtle" data-action="sample">예제 넣기</button><button class="button subtle" data-action="import" ${dummy?'hidden':''}>TXT 열기</button><input id="txt-file" class="visually-hidden" type="file" accept=".txt,text/plain" tabindex="-1" aria-label="UTF-8 TXT 파일 선택"><button class="button subtle" data-action="undo" disabled>작업 되돌리기</button><button class="button subtle danger" data-action="reset">초기화</button><button class="button subtle" data-action="expand" aria-expanded="false">크게 보기</button></div></div><div class="draft-banner" hidden><span id="draft-message"></span><button class="button" data-action="restore">초안 복원</button><button class="button" data-action="delete-draft">초안 삭제</button></div><div class="workspace-body"><div class="editor-grid ${diff?'two':''}" ${dummy?'hidden':''}><div><label class="editor-label" for="text-input"><span>${diff?'원문':'입력 텍스트'}</span><small>${diff?'각 5만':'20만'} 코드 단위까지</small></label><textarea class="editor" id="text-input" spellcheck="false" autocomplete="off" placeholder="여기에 텍스트를 입력하거나 붙여넣으세요."></textarea></div>${diff?'<div><label class="editor-label" for="text-second"><span>수정문</span><small>비교할 새 문서</small></label><textarea class="editor" id="text-second" spellcheck="false" autocomplete="off" placeholder="수정한 문서를 입력하세요."></textarea></div>':''}</div><div class="options" aria-label="처리 옵션">${optionMarkup(this.mode)}</div><div class="actions"><button class="button primary" data-action="run">${diff?'두 문서 비교':dummy?'예문 생성':this.mode==='character-counter'?'다시 계산':'결과 확인'}</button><button class="button" data-action="cancel" disabled>처리 중지</button><span class="status" id="status" role="status" aria-live="polite">${dummy?'생성 단위와 개수를 선택하세요.':'입력하면 결과가 자동으로 갱신됩니다.'}</span></div><div id="result" class="result-box" hidden><h2 class="result-heading">${this.mode==='character-counter'?'글자수 확인':'처리 결과'}</h2><div id="stats"></div><div id="limit-view"></div><div id="analysis"></div><div id="output-wrapper" ${this.mode==='character-counter'||this.mode==='word-frequency'||diff?'hidden':''}><label class="editor-label" for="text-output">결과 미리보기 <small>원문은 바뀌지 않았어요</small></label><textarea id="text-output" class="editor" readonly spellcheck="false"></textarea></div><p id="result-note" class="status"></p><div class="result-toolbar"><button class="button" data-action="copy">결과 복사</button><button class="button" data-action="apply" ${dummy||diff||this.mode==='character-counter'||this.mode==='word-frequency'?'hidden':''}>결과를 원문에 적용</button><button class="button" data-action="download">TXT 저장</button><label class="option"><input type="checkbox" id="bom">UTF-8 BOM</label><label class="option">줄바꿈 <select id="line-ending"><option value="lf">LF</option><option value="crlf">CRLF</option></select></label><span class="export-size" id="export-size"></span>${this.mode==='word-frequency'?'<button class="button" data-action="csv">전체 CSV 저장</button>':''}</div><div class="handoff"><select id="handoff-tool" aria-label="결과를 보낼 도구">${tools.filter(t=>t.slug!==this.mode&&t.slug!=='lorem-ipsum').map(t=>`<option value="${t.slug}">${esc(t.name)}</option>`).join('')}</select><button class="button" data-action="handoff">결과 보내기 →</button><p>직접 선택한 경우에만 다음 도구로 전달합니다. 주소나 서버에 텍스트를 남기지 않습니다.</p></div></div></div><div class="storage-row"><label><input type="checkbox" id="save-draft">이 브라우저에 초안 저장 (선택)</label><small id="storage-note">기본 미저장 · 저장하면 7일 후 만료 · 공용 기기에서는 끄세요</small><button class="button subtle" data-action="delete-draft">저장 초안 삭제</button></div><div class="spell-note"><a target="_blank" rel="noopener noreferrer" href="https://search.naver.com/search.naver?query=%EB%A7%9E%EC%B6%A4%EB%B2%95%20%EA%B2%80%EC%82%AC%EA%B8%B0">네이버 맞춤법 검사기 찾기 ↗</a><p>필요한 텍스트를 직접 복사해 새 창에 붙여넣으세요. 이 사이트에서 자동으로 전송하지 않습니다.</p></div>`;
    this.q('[data-action=reset]').textContent='입력 지우기';
    const storageRow=this.q('.storage-row');
    const clearAll=document.createElement('button');clearAll.className='button subtle';clearAll.dataset.action='delete-all';clearAll.textContent='모든 초안 삭제';storageRow.append(clearAll);
    const unsaved=document.createElement('p');unsaved.className='unsaved-note';unsaved.textContent='미저장 입력은 페이지 이동·새로고침·탭 닫기 때 사라집니다. 중요한 문서는 TXT로 보관하세요.';this.q('.workspace-body').append(unsaved);
    const result=this.q('#result'),panel=document.createElement('div'),empty=document.createElement('p');panel.className='result-panel';empty.id='result-empty';empty.className='empty-state';empty.textContent='결과가 여기에 표시됩니다. 원문을 바꾸지 않고 먼저 확인하세요.';result.replaceWith(panel);panel.append(empty,result);
    if(!['character-counter','text-diff','word-frequency','lorem-ipsum'].includes(this.mode))this.q('.workspace-body').classList.add('split-workspace');
    if(diff){const targetLabel=document.createElement('label');targetLabel.className='option import-target';targetLabel.innerHTML='TXT 불러올 위치 <select id="import-target"><option value="input">원문</option><option value="second">수정문</option></select>';this.q('.editor-tools').append(targetLabel);}
    const signal=this.abort.signal;
    root.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');if(b&&!b.disabled)this.action(b.dataset.action!);},{signal});
    for(const input of [this.input,this.second].filter(Boolean) as HTMLTextAreaElement[]){
      input.addEventListener('compositionstart',()=>{this.composing=true;this.invalidate();},{signal});
      input.addEventListener('compositionend',()=>{this.composing=false;this.edited(input);},{signal});
      input.addEventListener('input',()=>{if(!this.composing)this.edited(input);},{signal});
    }
    root.querySelector('.options')!.addEventListener('input',()=>{this.dirty=true;this.invalidate();this.schedule();this.queueSave();},{signal});
    root.querySelector('#txt-file')!.addEventListener('change',()=>this.importFile(),{signal});
    this.q<HTMLInputElement>('#save-draft').addEventListener('change',()=>this.toggleSave(),{signal});
    for(const el of [this.q('#bom'),this.q('#line-ending')])el.addEventListener('change',()=>this.exportSize(),{signal});
    window.addEventListener('storage',e=>{if(e.key===PREFIX+this.mode||e.key===null){if(this.saveEnabled){this.q<HTMLInputElement>('#save-draft').checked=false;clearTimeout(this.saveTimer);this.status('다른 탭에서 저장 내용이 바뀌어 자동 저장을 껐습니다. 현재 입력은 유지됩니다.',true);}this.checkDraft();}},{signal});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.parentElement?.classList.contains('expanded'))this.expand(false);},{signal});
    this.checkDraft();
    if(transfer!==undefined){this.input.value=transfer;this.validInput=transfer;this.dirty=true;this.schedule();}
    else if(this.mode==='character-counter')this.schedule();
  }
  q<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  get input(){return this.q<HTMLTextAreaElement>('#text-input');}
  get second(){return this.root.querySelector<HTMLTextAreaElement>('#text-second');}
  get saveEnabled(){return this.q<HTMLInputElement>('#save-draft').checked;}
  options():Options{const o:Options={};this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.options [name]').forEach(el=>o[el.name]=el instanceof HTMLInputElement&&el.type==='checkbox'?el.checked:el.value);return o;}
  setOptions(options:Options){this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.options [name]').forEach(el=>{if(!(el.name in options))return;if(el instanceof HTMLInputElement&&el.type==='checkbox')el.checked=!!options[el.name];else el.value=String(options[el.name]);});}
  status(message:string,error=false){const el=this.q('#status');el.setAttribute('aria-live',message==='처리 중…'||message.startsWith('완료')?'off':'polite');el.textContent=message;el.className='status'+(error?' error':'');}
  edited(el:HTMLTextAreaElement){
    const limit=this.mode==='text-diff'?MAX_DIFF:MAX_INPUT;
    if(el.value.length>limit){el.value=el===this.input?this.validInput:this.validSecond;this.invalidate();this.status(`입력 한도 ${limit.toLocaleString('ko')} 코드 단위를 넘었습니다. 이전 입력을 유지했습니다. TXT를 나누어 열어 주세요.`,true);return;}
    if(el===this.input)this.validInput=el.value;else this.validSecond=el.value;
    this.dirty=true;this.invalidate();this.schedule();this.queueSave();
  }
  invalidate(){clearTimeout(this.timer);clearTimeout(this.timeout);this.worker?.terminate();this.worker=undefined;this.seq++;this.result=undefined;this.q('#result').hidden=true;this.q('#result-empty').hidden=false;this.q<HTMLButtonElement>('[data-action=cancel]').disabled=true;}
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.compute(),220);}
  compute(){
    this.invalidate();const id=++this.seq;
    this.status('처리 중…');this.q<HTMLButtonElement>('[data-action=cancel]').disabled=false;
    try{this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
      this.timeout=setTimeout(()=>{if(id!==this.seq)return;this.invalidate();this.status('처리 시간이 길어 중지했습니다. 입력은 유지됩니다. 문서를 나누어 다시 처리해 주세요.',true);},3000);
      this.worker.onmessage=e=>{if(this.disposed||id!==this.seq)return;clearTimeout(this.timeout);this.worker?.terminate();this.worker=undefined;this.q<HTMLButtonElement>('[data-action=cancel]').disabled=true;if(e.data.error){this.status(e.data.error,true);return;}this.result=e.data.result;this.render();this.status('완료 · 입력을 바꾸면 다시 처리합니다.');};
      this.worker.onerror=()=>{if(id!==this.seq)return;this.invalidate();this.status('처리 모듈을 불러오지 못했습니다. 새로고침하거나 최신 브라우저를 사용해 주세요. 입력은 유지됩니다.',true);};
      this.worker.postMessage({id,mode:this.mode,input:this.input.value,second:this.second?.value||'',options:this.options()});
    }catch{this.invalidate();this.status('이 브라우저에서는 작업 모듈을 시작할 수 없습니다. 최신 브라우저로 이용해 주세요.',true);}
  }
  render(){
    const r=this.result!;this.q('#result').hidden=false;this.q('#result-empty').hidden=true;this.q('#result-note').textContent=r.note;
    this.q<HTMLTextAreaElement>('#text-output').value=r.output;
    const stats=this.q('#stats');stats.replaceChildren();
    if(r.stats){const s=r.stats;stats.innerHTML=`<div class="stats"><div class="stat"><span>공백 포함</span><strong>${s.characters.toLocaleString('ko')}<small>글자</small></strong></div><div class="stat"><span>공백 제외</span><strong>${s.withoutSpaces.toLocaleString('ko')}<small>글자</small></strong></div><div class="stat"><span>UTF-8</span><strong>${s.bytes.toLocaleString('ko')}<small>바이트</small></strong></div></div><details class="count-details"><summary>상세 집계 기준과 수치</summary><p>줄 ${s.lines.toLocaleString('ko')}개 · 공백 구분 어절 ${s.eojeol.toLocaleString('ko')}개 · 코드 포인트 ${s.codePoints.toLocaleString('ko')} · UTF-16 코드 단위 ${s.codeUnits.toLocaleString('ko')}<br>글자수는 문자 묶음 기준입니다. 줄바꿈은 LF 1개로 계산하며 저장 방식에 따라 파일 크기는 달라집니다.${s.invisible?`<br>폭이 없는 문자·결합 제어 문자 ${s.invisible}개가 있습니다. 이모지를 구성할 수도 있어 자동 삭제하지 않습니다.`:''}</p></details>`;
      if(this.mode==='character-counter'){const o=this.options(),basis=String(o.basis) as 'characters'|'withoutSpaces'|'bytes',limit=Number(o.limit),value=s[basis];const view=this.q('#limit-view');if(Number.isInteger(limit)&&limit>0&&limit<=200_000){view.innerHTML=`<div class="limit-box ${value>limit?'over':''}">${value.toLocaleString('ko')} / ${limit.toLocaleString('ko')} · ${Math.abs(limit-value).toLocaleString('ko')}${basis==='bytes'?'바이트':'글자'} ${value>limit?'초과':'남음'}<progress aria-label="제한량 사용 비율" max="${limit}" value="${Math.min(value,limit)}"></progress></div>`;}else view.textContent='제한량은 1~200,000 사이의 정수로 입력해 주세요.';}
    }
    const analysis=this.q('#analysis');analysis.replaceChildren();
    if(r.changes){const legend=document.createElement('p');legend.className='diff-legend';legend.textContent='− 삭제된 부분    + 추가된 부분 · 그대로인 부분은 기본 글씨';analysis.append(legend);const view=document.createElement('div');view.className='diff-view';view.setAttribute('aria-label','텍스트 변경 결과');for(const c of r.changes){const span=document.createElement(c.added?'ins':c.removed?'del':'span');if(c.added||c.removed){const sign=document.createElement('span');sign.className='diff-symbol';sign.textContent=c.added?'[+] ':'[−] ';span.append(sign);}span.append(document.createTextNode(c.value));view.append(span);}if(!r.changes.length)view.textContent='두 문서가 비어 있습니다.';analysis.append(view);}
    if(r.words){if(!r.words.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='분석할 표현이 없습니다. 문장을 입력해 주세요.';analysis.append(empty);}else{const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');table.innerHTML='<caption class="visually-hidden">단어 빈도 상위 100개</caption><thead><tr><th scope="col">표현</th><th scope="col">횟수</th><th scope="col">비율</th></tr></thead>';const tbody=document.createElement('tbody');for(const w of r.words.slice(0,100)){const row=document.createElement('tr');for(const text of [w.word,w.count.toLocaleString('ko'),w.percent.toFixed(2)+'%']){const td=document.createElement('td');td.textContent=text;row.append(td);}tbody.append(row);}table.append(tbody);wrap.append(table);analysis.append(wrap);}}
    this.exportSize();
  }
  exportSize(){if(!this.result)return;const size=txtBytes(this.result.output,this.q<HTMLInputElement>('#bom').checked,this.q<HTMLSelectElement>('#line-ending').value==='crlf').length;this.q('#export-size').textContent=`저장 파일 ${size.toLocaleString('ko')}바이트`;}
  snapshot(){this.history.push({input:this.input.value,second:this.second?.value||'',options:this.options()});if(this.history.length>10)this.history.shift();this.q<HTMLButtonElement>('[data-action=undo]').disabled=false;}
  setInput(input:string,second=''){this.input.value=lf(input);if(this.second)this.second.value=lf(second);this.validInput=this.input.value;this.validSecond=this.second?.value||'';this.dirty=true;this.invalidate();this.schedule();this.queueSave();}
  async action(action:string){
    if(action==='run'){this.compute();return;}if(action==='cancel'){this.invalidate();this.status('처리를 중지했습니다. 입력은 유지됩니다.');return;}
    if(action==='sample'){this.snapshot();const t=tools.find(t=>t.slug===this.mode)!;this.setInput(t.sample,t.second);return;}
    if(action==='reset'){this.snapshot();this.setInput('');return;}
    if(action==='undo'){const previous=this.history.pop();if(previous){this.setOptions(previous.options);this.setInput(previous.input,previous.second);}this.q<HTMLButtonElement>('[data-action=undo]').disabled=!this.history.length;return;}
    if(action==='expand'){this.expand(!this.root.parentElement?.classList.contains('expanded'));return;}
    if(action==='import'){this.q<HTMLInputElement>('#txt-file').click();return;}
    if(action==='restore'){if(this.candidate){if(this.dirty&&!confirm('현재 입력 대신 저장된 초안을 불러올까요? 현재 입력은 작업 되돌리기로 복구할 수 있습니다.'))return;this.snapshot();this.setOptions(this.candidate.options);this.setInput(this.candidate.input,this.candidate.second);this.revision=this.candidate.revision;this.candidate=null;this.q('.draft-banner').hidden=true;this.status('초안을 복원했습니다. 계속 저장하려면 초안 저장을 켜 주세요.');}return;}
    if(action==='delete-draft'||action==='delete-all'){if(action==='delete-all'&&!confirm('이 브라우저에 저장한 텍스트의 모든 도구 초안을 삭제할까요? 현재 화면의 입력은 유지됩니다.'))return;try{for(const tool of action==='delete-all'?tools:[{slug:this.mode}])localStorage.removeItem(PREFIX+tool.slug);this.revision=null;this.candidate=null;this.q<HTMLInputElement>('#save-draft').checked=false;clearTimeout(this.saveTimer);this.q('.draft-banner').hidden=true;this.q('#storage-note').textContent=action==='delete-all'?'모든 도구의 저장 초안을 삭제했습니다. 현재 입력은 유지됩니다.':'저장된 초안을 삭제했습니다. 현재 입력은 유지됩니다.';}catch{this.status('브라우저 저장 공간에 접근하지 못했습니다. 브라우저 설정에서 사이트 데이터를 확인해 주세요.',true);}return;}
    if(!this.result){this.status('처리가 완료된 뒤 결과를 이용해 주세요.',true);return;}
    if(action==='apply'){if(this.result.output.length>MAX_INPUT){this.status('결과가 원문 입력 한도 20만 코드 단위를 넘습니다. TXT로 저장하거나 나누어 사용해 주세요. 원문은 유지됩니다.',true);return;}this.snapshot();this.setInput(this.result.output);return;}
    if(action==='copy'){try{await navigator.clipboard.writeText(this.result.output);this.status('결과를 복사했습니다.');}catch{const area=this.q<HTMLTextAreaElement>('#text-output');this.q('#output-wrapper').hidden=false;area.focus();area.select();this.status('자동 복사 권한이 없습니다. 선택된 결과를 Ctrl+C 또는 복사 메뉴로 복사해 주세요.',true);}return;}
    if(action==='download'){this.download(txtBytes(this.result.output,this.q<HTMLInputElement>('#bom').checked,this.q<HTMLSelectElement>('#line-ending').value==='crlf'),'text/plain;charset=utf-8','txt');return;}
    if(action==='csv'){this.download(new TextEncoder().encode(csv(this.result.words||[])),'text/csv;charset=utf-8','csv');return;}
    if(action==='handoff'){await handoff(this.q<HTMLSelectElement>('#handoff-tool').value,this.result.output,this);}
  }
  download(bytes:Uint8Array,mime:string,extension:string){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));const a=document.createElement('a');a.href=url;const date=new Date(),stamp=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');a.download=`키미_${tools.find(t=>t.slug===this.mode)!.name.replaceAll('·','-')}_${stamp}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);this.status('다운로드를 요청했습니다. 브라우저 다운로드 목록을 확인하세요.');}
  async importFile(){const picker=this.q<HTMLInputElement>('#txt-file'),file=picker.files?.[0],target=this.root.querySelector<HTMLSelectElement>('#import-target')?.value;picker.value='';if(!file)return;try{if(file.size>2*1024*1024)throw new Error('TXT 파일은 2MB까지 열 수 있습니다. 더 작은 파일로 나누어 주세요.');const text=decodeTxt(new Uint8Array(await file.arrayBuffer()));const max=this.mode==='text-diff'?MAX_DIFF:MAX_INPUT;if(text.length>max)throw new Error(`문서가 ${max.toLocaleString('ko')} 코드 단위 한도를 넘었습니다. 원문을 유지했습니다.`);if(this.disposed)return;this.snapshot();if(target==='second')this.setInput(this.input.value,text);else this.setInput(text,this.second?.value||'');}catch(e){this.status(e instanceof TypeError?'UTF-8 형식의 TXT만 열 수 있습니다. 원문은 유지했습니다.':(e as Error).message,true);}}
  expand(on:boolean){this.root.parentElement?.classList.toggle('expanded',on);document.body.classList.toggle('no-scroll',on);const b=this.q<HTMLButtonElement>('[data-action=expand]');b.textContent=on?'작게 보기':'크게 보기';b.setAttribute('aria-expanded',String(on));if(!on)b.focus();}
  checkDraft(){try{this.candidate=readDraft(localStorage,this.mode);this.revision=this.candidate?.revision??null;this.q('.draft-banner').hidden=!this.candidate;if(this.candidate)this.q('#draft-message').textContent=`저장된 초안이 있습니다. ${new Date(this.candidate.updated).toLocaleString('ko-KR')}`;}catch{this.q('#storage-note').textContent='브라우저 저장을 사용할 수 없습니다. TXT 저장은 이용할 수 있습니다.';}}
  toggleSave(){if(!this.saveEnabled){clearTimeout(this.saveTimer);try{localStorage.removeItem(PREFIX+this.mode);this.revision=null;this.candidate=null;this.q('.draft-banner').hidden=true;this.q('#storage-note').textContent='초안 저장을 끄고 기존 초안을 삭제했습니다.';}catch{this.status('초안 삭제에 실패했습니다. 사이트 데이터를 확인해 주세요.',true);}return;}if(this.candidate){this.q<HTMLInputElement>('#save-draft').checked=false;this.status('먼저 기존 초안을 복원하거나 삭제해 주세요. 현재 입력은 유지됩니다.',true);return;}this.queueSave();}
  queueSave(){if(!this.saveEnabled)return;clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.persist(),450);}
  persist(){if(!this.saveEnabled||this.disposed)return;try{const d:Draft={version:1,updated:Date.now(),revision:crypto.randomUUID(),input:this.input.value,second:this.second?.value||'',options:this.options()};saveDraft(localStorage,this.mode,d,this.revision);this.revision=d.revision;this.q('#storage-note').textContent=`초안 저장됨 · ${new Date(d.updated).toLocaleTimeString('ko-KR')} · 7일 후 만료`;}catch(e){this.q<HTMLInputElement>('#save-draft').checked=false;this.status((e as Error).message||'저장 공간이 부족합니다. 현재 입력은 유지됩니다.',true);}}
  dispose(){if(this.saveEnabled)this.persist();this.disposed=true;this.invalidate();clearTimeout(this.saveTimer);this.abort.abort();document.body.classList.remove('no-scroll');}
}
let current:Workspace|undefined;
function mount(transfer?:string){const root=document.querySelector<HTMLElement>('#tool-root');if(root)current=new Workspace(root,transfer);}
async function handoff(slug:string,text:string,workspace:Workspace){
  if(text.length>(slug==='text-diff'?MAX_DIFF:MAX_INPUT)){workspace.status(`다음 도구의 입력 한도 ${slug==='text-diff'?'5만':'20만'} 코드 단위를 넘습니다. 결과를 TXT로 저장하거나 나누어 주세요. 원문은 유지됩니다.`,true);return;}
  try{workspace.status('다음 도구를 여는 중…');const response=await fetch(`/${slug}/`);if(!response.ok)throw new Error();const doc=new DOMParser().parseFromString(await response.text(),'text/html');const main=doc.querySelector('main');if(!main?.querySelector('#tool-root'))throw new Error();workspace.dispose();document.querySelector('main')!.replaceWith(main);document.title=doc.title;for(const selector of ['link[rel=canonical]','meta[name=description]','meta[property="og:title"]','meta[property="og:description"]','meta[property="og:url"]','script[type="application/ld+json"]']){const next=doc.querySelector(selector);const old=document.querySelector(selector);if(next&&old)old.replaceWith(next);}
    document.querySelectorAll('.main-nav a').forEach(a=>{a.removeAttribute('aria-current');if(a.getAttribute('href')===`/${slug}/`)a.setAttribute('aria-current','page');});history.pushState(null,'',`/${slug}/`);mount(text);window.scrollTo({top:0});current?.input.focus();
  }catch{workspace.status('다음 도구를 열지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 현재 입력은 유지됩니다.',true);}
}
window.addEventListener('popstate',()=>location.reload());
window.addEventListener('pagehide',()=>current?.dispose());
document.addEventListener('click',e=>{const open=document.querySelector<HTMLDetailsElement>('.family-sites[open]');if(open&&!open.contains(e.target as Node))open.open=false;});
try{for(const tool of tools)readDraft(localStorage,tool.slug);}catch{/* Storage may be blocked. Editing remains available. */}
mount();
