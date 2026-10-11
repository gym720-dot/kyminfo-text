import { diffLines, diffWordsWithSpace } from 'diff';

export const MAX_INPUT = 200_000;
export const MAX_DIFF = 50_000;
export const MAX_OUTPUT = 400_000;
export type Options = Record<string, string | boolean>;
export type Change = { value: string; added?: boolean; removed?: boolean; count?: number };
export type WordRow = { word: string; count: number; percent: number };
export type Result = { output: string; note: string; changes?: Change[]; words?: WordRow[]; total?: number; stats?: ReturnType<typeof countText> };
export const lf = (s: string) => s.replace(/\r\n?/g, '\n');
const white = /\p{White_Space}/gu;
const horizontal = /[^\S\n\r\u2028\u2029]+/gu;
export function graphemes(s: string): string[] {
  if (!('Segmenter' in Intl)) throw new Error('정확한 글자수 계산을 위해 최신 Chrome·Edge·Firefox·Safari를 사용해 주세요.');
  return Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(s), p => p.segment);
}
export function countText(input: string) {
  const s = lf(input);
  const trimmed=s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,'');
  return {
    characters: graphemes(s).length,
    withoutSpaces: graphemes(s.replace(white, '')).length,
    bytes: new TextEncoder().encode(s).length,
    codePoints: Array.from(s).length, codeUnits: s.length,
    lines: s ? s.split('\n').length : 0,
    eojeol: trimmed ? trimmed.split(/\p{White_Space}+/u).length : 0,
    invisible: Array.from(s.matchAll(/[\u200B-\u200D\u2060\uFEFF]/gu)).length
  };
}
export function removeBreaks(s: string, mode: string) {
  s = lf(s);
  const join = (x: string) => x.split('\n').map(line => line.trim()).join(mode === 'join' ? '' : ' ');
  return mode === 'paragraphs' ? s.split(/\n[\t ]*\n(?:[\t ]*\n)*/).map(join).join('\n\n') : join(s);
}
export function cleanSpace(s: string, o: Options) {
  s = lf(s);
  if (o.tabs) s = s.replace(/\t/g, ' '.repeat(Math.max(1, Math.min(8, Number(o.tabSize) || 4))));
  if (o.collapse) s = s.replace(horizontal, ' ');
  if (o.trim) s = s.split('\n').map(l => l.replace(/^[^\S\n]+|[^\S\n]+$/gu, '')).join('\n');
  if (o.blank) s = s.replace(/\n(?:[^\S\n]*\n){2,}/gu, '\n\n');
  if (o.zero) s = s.replace(/[\u200B\u2060\uFEFF]/gu, ''); // ZWJ/ZWNJ can form meaningful scripts/emoji.
  if (o.all) s = s.replace(white, '');
  return s;
}
export function deduplicate(s: string, o: Options) {
  if (!s) return { output: '', removed: 0 };
  const seen = new Set<string>(); let removed = 0;
  const output = lf(s).split('\n').filter(line => {
    let key = o.trimKey ? line.trim() : line;
    if (o.ignoreCase) key = key.toLocaleLowerCase('en');
    if (!key && !o.empty) return true;
    if (seen.has(key)) { removed++; return false; }
    seen.add(key); return true;
  }).join('\n');
  return { output, removed };
}
export function sortLines(s: string, o: Options) {
  if (!s) return '';
  let lines = lf(s).split('\n');
  if (o.dropBlank) lines = lines.filter(l => l.trim());
  const collator = new Intl.Collator('ko', { numeric: !!o.numeric, sensitivity: 'variant' });
  return lines.map((value, i) => ({ value, i })).sort((a, b) => (o.reverse ? -1 : 1) * collator.compare(a.value, b.value) || a.i - b.i).map(x => x.value).join('\n');
}
export function changeCase(s: string, mode: string) {
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'title') return s.toLowerCase().replace(/[a-z]+(?:['’][a-z]+)*/g, w => w[0].toUpperCase()+w.slice(1));
  return s.toLowerCase().replace(/(^[\s"'“‘([{]*|[.!?]["'”’)\]}]*\s+["'“‘([{]*)([a-z])/g, (_, prefix, c) => prefix + c.toUpperCase());
}
export function replaceText(s: string, needle: string, replacement: string, ignoreCase = false, firstOnly = false) {
  if (!needle) throw new Error('찾을 내용을 입력해 주세요.');
  if(needle.length>20_000||replacement.length>20_000)throw new Error('찾을 내용과 바꿀 내용은 각각 2만 코드 단위까지 지원합니다.');
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, ignoreCase ? 'giu' : 'gu');
  let found = 0, replaced = 0,outputLength=s.length;
  const output = s.replace(regex, match => {
    found++;
    if (firstOnly && replaced) return match;
    outputLength+=replacement.length-match.length;
    if(outputLength>MAX_OUTPUT)throw new Error('변환 결과가 40만 코드 단위를 넘습니다. 원문을 나누거나 바꿀 내용을 줄여 주세요. 원문은 유지됩니다.');
    replaced++; return replacement;
  });
  return { output, found, replaced };
}
export function frequencies(s: string, o: Options): { rows: WordRow[]; total: number } {
  const tokens = s.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) || [];
  const counts = new Map<string, number>(); let total = 0;
  for (let word of tokens) {
    if (!o.numbers && /^\p{N}+$/u.test(word)) continue;
    if (o.ignoreCase) word = word.toLocaleLowerCase('en');
    counts.set(word, (counts.get(word) || 0) + 1); total++;
  }
  const rows = [...counts].map(([word, count]) => ({ word, count, percent: total ? count / total * 100 : 0 }))
    .sort((a,b) => b.count - a.count || a.word.localeCompare(b.word,'ko'));
  return { rows, total };
}
const korean = [
  '작은 메모를 정리하면 오늘 해야 할 일이 한눈에 보입니다.',
  '창가에 놓인 책을 펼치고 새로운 아이디어를 천천히 기록합니다.',
  '서로 다른 의견을 나누며 더 나은 방법을 함께 찾아갑니다.',
  '복잡한 문장도 필요한 내용을 차례로 살펴보면 쉽게 이해할 수 있습니다.',
  '편안한 여백과 읽기 쉬운 글씨는 문서의 흐름을 자연스럽게 만듭니다.',
  '이 문장은 화면 구성과 문서 길이를 확인하기 위한 예시입니다.'
];
const latin = ['Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 'Integer vitae libero a nulla posuere facilisis.', 'Sed commodo neque vel tellus pretium, eget mattis erat consequat.', 'Donec vel urna non arcu viverra suscipit.'];
export function dummy(language: string, unit: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > (unit === 'words' ? 1000 : unit === 'sentences' ? 100 : 30)) throw new Error('문단 1~30개, 문장 1~100개, 단어 1~1,000개로 입력해 주세요.');
  const corpus = language === 'latin' ? latin : korean;
  if (unit === 'words') { const words = corpus.join(' ').split(/\s+/); return Array.from({length:n}, (_,i) => words[i % words.length]).join(' '); }
  if (unit === 'sentences') return Array.from({length:n}, (_,i) => corpus[i % corpus.length]).join(' ');
  return Array.from({length:n}, (_,i) => Array.from({length:3},(_,j)=>corpus[(i*3+j)%corpus.length]).join(' ')).join('\n\n');
}
export function compareText(a: string, b: string, o: Options): Change[] {
  a = lf(a); b = lf(b);
  if (a.length > MAX_DIFF || b.length > MAX_DIFF || a.split('\n').length > 5000 || b.split('\n').length > 5000) throw new Error('비교는 각 문서 5만 코드 단위·5,000줄까지 지원합니다. 나누어 비교해 주세요.');
  if (o.ignoreSpace) { a = a.replace(/\p{White_Space}+/gu, ' ').trim(); b = b.replace(/\p{White_Space}+/gu, ' ').trim(); }
  const opts = { timeout: 1800, maxEditLength: 4000 };
  const changes = o.diffMode === 'words' ? diffWordsWithSpace(a,b,opts) : diffLines(a,b,opts);
  if (!changes) throw new Error('변경량이 많아 비교 한도를 넘었습니다. 문서를 나누어 다시 비교해 주세요.');
  return changes;
}
export function csv(rows: WordRow[]) {
  const cell = (s: string) => '"' + (/^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g,'""') + '"';
  return '\uFEFF단어,횟수,비율(%)\r\n' + rows.map(r=>`${cell(r.word)},${r.count},${r.percent.toFixed(2)}`).join('\r\n');
}
export function txtBytes(s: string, bom: boolean, crlf: boolean) {
  s = lf(s); if (crlf) s = s.replace(/\n/g,'\r\n');
  return new TextEncoder().encode((bom ? '\uFEFF' : '') + s);
}
export function decodeTxt(bytes: Uint8Array) { return lf(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
export function run(mode: string, input: string, second: string, o: Options): Result {
  input = lf(input); second = lf(second);
  if (input.length > MAX_INPUT || second.length > MAX_INPUT) throw new Error('처리 한도 20만 코드 단위를 넘었습니다. 텍스트를 나누어 주세요. 원문은 변경하지 않았습니다.');
  let output = input, note = '';
  switch(mode) {
    case 'character-counter': return {output, note:'', stats:countText(input)};
    case 'remove-line-breaks': output = removeBreaks(input,String(o.breakMode)); note='선택한 규칙으로 줄바꿈을 정리했습니다.'; break;
    case 'whitespace-cleaner': output=cleanSpace(input,o); note='선택한 공백만 정리했습니다. 원문과 비교해 주세요.'; break;
    case 'remove-duplicate-lines': { const r=deduplicate(input,o); output=r.output; note=`중복 줄 ${r.removed.toLocaleString('ko')}개를 제거했습니다.`; break; }
    case 'sort-lines': output=sortLines(input,o); note='줄 내용을 보존하며 선택한 순서로 정렬했습니다.'; break;
    case 'case-converter': output=changeCase(input,String(o.caseMode)); note='영문 대소문자를 변환했습니다. 약어와 고유명사를 확인해 주세요.'; break;
    case 'find-and-replace': { const r=replaceText(input,String(o.find||''),String(o.replace||''),!!o.ignoreCase,!!o.firstOnly); output=r.output; note=`${r.found}개 일치 · ${r.replaced}개 바꿈`; break; }
    case 'lorem-ipsum': output=dummy(String(o.language),String(o.unit),Number(o.amount)); note='화면·문서 레이아웃 확인용 예문입니다.'; break;
    case 'word-frequency': {const r=frequencies(input,o); return {output:input,note:`전체 ${r.total}개 토큰 · 서로 다른 표현 ${r.rows.length}개`,words:r.rows,total:r.total};}
    case 'text-diff': {const changes=compareText(input,second,o); return {output:second,changes,note:o.ignoreSpace?'공백을 정규화한 두 문서를 비교한 결과입니다.':'원문과 수정문의 실제 변경을 표시합니다.'};}
    default: throw new Error('알 수 없는 도구입니다.');
  }
  if(output.length>MAX_OUTPUT)throw new Error('변환 결과가 40만 코드 단위를 넘습니다. 입력을 나누어 처리해 주세요. 원문은 유지됩니다.');
  return { output, note, stats: countText(output) };
}
