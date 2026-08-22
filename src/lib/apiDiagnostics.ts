export type ApiOperationKind='alignment'|'direction'|'prompt'|'correction';
export interface ApiUsageDiagnostics {
  totalApiCalls:number;
  alignmentApiCalls:number;
  directionApiCalls:number;
  promptApiCalls:number;
  correctionApiCalls:number;
  totalRequestedItems:number;
  firstPassAcceptedItems:number;
  selectivelyRetriedItems:number;
  fullBatchRetriesAvoided:number;
  duplicateCallsAvoided:number;
  persistedResultsReused:number;
  unusedGeneratedFieldsRemoved:number;
  estimatedInputCharactersAvoided:number;
}

const empty=():ApiUsageDiagnostics=>({totalApiCalls:0,alignmentApiCalls:0,directionApiCalls:0,promptApiCalls:0,correctionApiCalls:0,totalRequestedItems:0,firstPassAcceptedItems:0,selectivelyRetriedItems:0,fullBatchRetriesAvoided:0,duplicateCallsAvoided:0,persistedResultsReused:0,unusedGeneratedFieldsRemoved:0,estimatedInputCharactersAvoided:0});
let metrics=empty();
const debug=()=>{if(process.env.NODE_ENV!=='production')console.debug('Production API efficiency',metrics);};

export function recordApiCall(kind:ApiOperationKind,requestedItems:number,options:{correction?:boolean;estimatedInputCharactersAvoided?:number}={}){
  metrics.totalApiCalls++;metrics.totalRequestedItems+=requestedItems;
  if(kind==='alignment')metrics.alignmentApiCalls++;if(kind==='direction')metrics.directionApiCalls++;if(kind==='prompt')metrics.promptApiCalls++;if(kind==='correction'||options.correction)metrics.correctionApiCalls++;
  metrics.estimatedInputCharactersAvoided+=Math.max(0,options.estimatedInputCharactersAvoided||0);debug();
}
export function recordPartialAcceptance(accepted:number,failed:number,correction=false){if(!correction)metrics.firstPassAcceptedItems+=accepted;if(correction)metrics.selectivelyRetriedItems+=accepted+failed;if(accepted>0&&failed>0)metrics.fullBatchRetriesAvoided++;debug();}
export function recordFingerprintReuse(count=1){metrics.duplicateCallsAvoided+=count;metrics.persistedResultsReused+=count;debug();}
export function recordUnusedFieldsRemoved(count:number){metrics.unusedGeneratedFieldsRemoved+=Math.max(0,count);debug();}
export const getApiUsageDiagnostics=():ApiUsageDiagnostics=>({...metrics});
export const resetApiUsageDiagnostics=()=>{metrics=empty();};
