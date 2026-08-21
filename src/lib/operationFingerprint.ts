const stableValue=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stableValue(item)]));
  return value;
};

export const stableSerialize=(value:unknown)=>JSON.stringify(stableValue(value));

const fnv1a=(value:string)=>{
  let hash=0x811c9dc5;
  for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,0x01000193);}
  return (hash>>>0).toString(16).padStart(8,'0');
};

export function operationFingerprint(kind:'alignment'|'direction'|'prompt'|'local-graphic',version:string,dependencies:unknown):string{
  return `${kind}:${version}:${fnv1a(stableSerialize(dependencies))}`;
}

export const isReusableFingerprint=(stored:string|undefined,expected:string)=>stored===expected||stored==='legacy-preserved-v13';

