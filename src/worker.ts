/// <reference lib="webworker" />
import { run } from './engine';
self.onmessage = e => {
  const { id,mode,input,second,options } = e.data;
  try { self.postMessage({id, result:run(mode,input,second,options)}); }
  catch(error) { self.postMessage({id,error:error instanceof Error?error.message:'처리 중 오류가 발생했습니다.'}); }
};
