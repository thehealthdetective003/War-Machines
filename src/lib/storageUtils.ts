import type { AppState, FullProjectData, ProjectCheckpoint, ProjectCheckpointReason, SavedProject } from '../types';

const DB_NAME = 'modus_assembly_projects';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const CHECKPOINTS_STORE = 'checkpoints';
const METADATA_STORE = 'metadata';
const DIAGNOSTICS_STORE = 'diagnostics';
const ACTIVE_PROJECT_KEY = 'assembly_line_active_project';
const LEGACY_AUTOSAVE_KEY = 'assembly_line_save';
const LEGACY_INDEX_KEY = 'assembly_line_projects';
const LEGACY_PROJECT_PREFIX = 'assembly_line_project_';
const CHECKPOINT_LIMIT = 3;

type MetadataRecord = { key:string; value:unknown };
type DiagnosticRecord = { id:string; createdAt:string; source:string; message:string; stack?:string; context?:unknown };
export type LegacyMigrationReport = { migratedProjects:number; removedKeys:string[]; corruptKeys:string[] };
export type StorageUsage = { usedKb:number; totalKb:number; percent:number; persisted:boolean; available:boolean };
export type SaveProjectOptions = { checkpointReason?:ProjectCheckpointReason };

let databasePromise:Promise<IDBDatabase>|null=null;
let lastCheckpointSequence=0;
const nextCheckpointSequence=()=>lastCheckpointSequence=Math.max(Date.now(),lastCheckpointSequence+1);

const requestResult=<T>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));
});
const transactionDone=(transaction:IDBTransaction)=>new Promise<void>((resolve,reject)=>{
  transaction.oncomplete=()=>resolve();
  transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed.'));
  transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction was aborted.'));
});

function openDatabase():Promise<IDBDatabase>{
  if(databasePromise)return databasePromise;
  if(typeof indexedDB==='undefined')return Promise.reject(new Error('IndexedDB is unavailable in this browser profile.'));
  databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains(PROJECTS_STORE))database.createObjectStore(PROJECTS_STORE,{keyPath:'id'});
      if(!database.objectStoreNames.contains(CHECKPOINTS_STORE)){
        const store=database.createObjectStore(CHECKPOINTS_STORE,{keyPath:'id'});
        store.createIndex('projectId','projectId',{unique:false});
      }
      if(!database.objectStoreNames.contains(METADATA_STORE))database.createObjectStore(METADATA_STORE,{keyPath:'key'});
      if(!database.objectStoreNames.contains(DIAGNOSTICS_STORE)){
        const store=database.createObjectStore(DIAGNOSTICS_STORE,{keyPath:'id'});
        store.createIndex('createdAt','createdAt',{unique:false});
      }
    };
    request.onsuccess=()=>{
      request.result.onversionchange=()=>request.result.close();
      resolve(request.result);
    };
    request.onerror=()=>{databasePromise=null;reject(request.error||new Error('Unable to open project storage.'));};
    request.onblocked=()=>{databasePromise=null;reject(new Error('Project storage upgrade is blocked by another open tab.'));};
  });
  return databasePromise;
}

async function getMetadata<T>(key:string):Promise<T|undefined>{
  const database=await openDatabase();
  const transaction=database.transaction(METADATA_STORE,'readonly');
  const done=transactionDone(transaction);
  const record=await requestResult(transaction.objectStore(METADATA_STORE).get(key)) as MetadataRecord|undefined;
  await done;
  return record?.value as T|undefined;
}
async function setMetadata(key:string,value:unknown):Promise<void>{
  const database=await openDatabase();
  const transaction=database.transaction(METADATA_STORE,'readwrite');
  const done=transactionDone(transaction);
  transaction.objectStore(METADATA_STORE).put({key,value} satisfies MetadataRecord);
  await done;
}

const projectSummary=(project:FullProjectData):SavedProject=>({
  id:project.id,
  name:project.topic?.topic?.product||project.projectName||'Untitled',
  title:project.topic?.topic?.title||'Untitled Project',
  category:project.topic?.topic?.category||'Uncategorized',
  phase:project.phase,
  sceneCount:project.visualPrompts?.length||0,
  savedAt:project.savedAt,
  createdAt:project.createdAt,
});

async function pruneCheckpointsInTransaction(store:IDBObjectStore,projectId:string):Promise<void>{
  const checkpoints=await requestResult(store.index('projectId').getAll(IDBKeyRange.only(projectId))) as ProjectCheckpoint[];
  checkpoints.sort((a,b)=>b.sequence-a.sequence);
  checkpoints.slice(CHECKPOINT_LIMIT).forEach(checkpoint=>store.delete(checkpoint.id));
}

export async function saveProject(state:AppState,options:SaveProjectOptions={}):Promise<string>{
  const database=await openDatabase();
  const id=state.id||crypto.randomUUID();
  const existing=await loadProject(id);
  const now=new Date().toISOString();
  const fullData:FullProjectData={...state,id,savedAt:now,createdAt:existing?.createdAt||now};
  const stores=options.checkpointReason?[PROJECTS_STORE,CHECKPOINTS_STORE]:[PROJECTS_STORE];
  const transaction=database.transaction(stores,'readwrite');
  const done=transactionDone(transaction);
  transaction.objectStore(PROJECTS_STORE).put(fullData);
  if(options.checkpointReason){
    const sequence=nextCheckpointSequence();
    const checkpoint:ProjectCheckpoint={id:`${id}:${sequence}:${crypto.randomUUID()}`,projectId:id,sequence,reason:options.checkpointReason,savedAt:now,state:fullData};
    const checkpointStore=transaction.objectStore(CHECKPOINTS_STORE);
    checkpointStore.put(checkpoint);
    await pruneCheckpointsInTransaction(checkpointStore,id);
  }
  await done;
  setActiveProjectId(id);
  return id;
}

export async function getAllProjects():Promise<SavedProject[]>{
  const database=await openDatabase();
  const transaction=database.transaction(PROJECTS_STORE,'readonly');
  const done=transactionDone(transaction);
  const projects=await requestResult(transaction.objectStore(PROJECTS_STORE).getAll()) as FullProjectData[];
  await done;
  return projects.map(projectSummary).sort((a,b)=>new Date(b.savedAt).getTime()-new Date(a.savedAt).getTime());
}
export async function loadProject(id:string):Promise<FullProjectData|null>{
  const database=await openDatabase();
  const transaction=database.transaction(PROJECTS_STORE,'readonly');
  const done=transactionDone(transaction);
  const project=await requestResult(transaction.objectStore(PROJECTS_STORE).get(id)) as FullProjectData|undefined;
  await done;
  return project||null;
}
export async function getProjectCheckpoints(projectId:string):Promise<ProjectCheckpoint[]>{
  const database=await openDatabase();
  const transaction=database.transaction(CHECKPOINTS_STORE,'readonly');
  const done=transactionDone(transaction);
  const records=await requestResult(transaction.objectStore(CHECKPOINTS_STORE).index('projectId').getAll(IDBKeyRange.only(projectId))) as ProjectCheckpoint[];
  await done;
  return records.sort((a,b)=>b.sequence-a.sequence).slice(0,CHECKPOINT_LIMIT);
}
export async function restoreCheckpoint(checkpointId:string):Promise<FullProjectData|null>{
  const database=await openDatabase();
  const read=database.transaction(CHECKPOINTS_STORE,'readonly');
  const readDone=transactionDone(read);
  const checkpoint=await requestResult(read.objectStore(CHECKPOINTS_STORE).get(checkpointId)) as ProjectCheckpoint|undefined;
  await readDone;
  if(!checkpoint)return null;
  const restored={...checkpoint.state,savedAt:new Date().toISOString()};
  const write=database.transaction(PROJECTS_STORE,'readwrite');
  const writeDone=transactionDone(write);
  write.objectStore(PROJECTS_STORE).put(restored);
  await writeDone;
  setActiveProjectId(restored.id);
  return restored;
}
export async function deleteProject(id:string):Promise<void>{
  const database=await openDatabase();
  const transaction=database.transaction([PROJECTS_STORE,CHECKPOINTS_STORE],'readwrite');
  const done=transactionDone(transaction);
  transaction.objectStore(PROJECTS_STORE).delete(id);
  const checkpointStore=transaction.objectStore(CHECKPOINTS_STORE);
  const checkpoints=await requestResult(checkpointStore.index('projectId').getAllKeys(IDBKeyRange.only(id)));
  checkpoints.forEach(key=>checkpointStore.delete(key));
  await done;
  if(getActiveProjectId()===id)clearActiveProjectId();
}

export function getActiveProjectId():string|null{
  try{return localStorage.getItem(ACTIVE_PROJECT_KEY);}catch{return null;}
}
export function setActiveProjectId(id:string):void{
  try{localStorage.setItem(ACTIVE_PROJECT_KEY,id);}catch{/* Lightweight pointer failure is non-fatal. */}
}
export function clearActiveProjectId():void{
  try{localStorage.removeItem(ACTIVE_PROJECT_KEY);}catch{/* Ignore unavailable localStorage. */}
}

export async function calculateStorageUsage():Promise<StorageUsage>{
  try{
    const estimate=await navigator.storage?.estimate?.();
    const persisted=await navigator.storage?.persisted?.()??false;
    const usage=estimate?.usage||0,quota=estimate?.quota||0;
    return {usedKb:Math.round(usage/102.4)/10,totalKb:Math.round(quota/102.4)/10,percent:quota?Math.min(100,(usage/quota)*100):0,persisted,available:Boolean(quota)};
  }catch{return {usedKb:0,totalKb:0,percent:0,persisted:false,available:false};}
}
export async function requestPersistentStorage():Promise<boolean>{
  try{return await navigator.storage?.persist?.()??false;}catch{return false;}
}
export async function recordDiagnostic(source:string,error:unknown,context?:unknown):Promise<void>{
  try{
    const database=await openDatabase();
    const transaction=database.transaction(DIAGNOSTICS_STORE,'readwrite');
    const done=transactionDone(transaction);
    const value=error instanceof Error?error:new Error(String(error));
    const record:DiagnosticRecord={id:crypto.randomUUID(),createdAt:new Date().toISOString(),source,message:value.message,stack:value.stack,context};
    const store=transaction.objectStore(DIAGNOSTICS_STORE);
    store.put(record);
    const all=await requestResult(store.index('createdAt').getAll()) as DiagnosticRecord[];
    all.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(20).forEach(item=>store.delete(item.id));
    await done;
  }catch{/* Diagnostics must never create a second failure. */}
}

const promptCount=(value:any)=>Array.isArray(value?.visualPrompts)?value.visualPrompts.length:0;
const savedTime=(value:any)=>new Date(value?.savedAt||value?.generationSession?.lastCommittedAt||0).getTime()||0;
async function writeLegacyGroup(projectId:string,candidates:Array<{key:string;value:any}>):Promise<void>{
  const database=await openDatabase();
  const ranked=[...candidates].sort((a,b)=>promptCount(b.value)-promptCount(a.value)||savedTime(b.value)-savedTime(a.value));
  const now=new Date().toISOString();
  const normalized=ranked.map((candidate,index)=>({
    ...candidate,
    value:{...candidate.value,id:projectId,savedAt:candidate.value.savedAt||now,createdAt:candidate.value.createdAt||candidate.value.savedAt||now} as FullProjectData,
    sequence:Date.now()-index,
  }));
  const transaction=database.transaction([PROJECTS_STORE,CHECKPOINTS_STORE],'readwrite');
  const done=transactionDone(transaction);
  transaction.objectStore(PROJECTS_STORE).put(normalized[0].value);
  const checkpoints=transaction.objectStore(CHECKPOINTS_STORE);
  normalized.slice(0,CHECKPOINT_LIMIT).forEach(item=>checkpoints.put({id:`${projectId}:${item.sequence}:${crypto.randomUUID()}`,projectId,sequence:item.sequence,reason:'migration',savedAt:item.value.savedAt,state:item.value} satisfies ProjectCheckpoint));
  await done;
  const verified=await loadProject(projectId);
  if(!verified||verified.id!==projectId)throw new Error(`Verification failed for migrated project ${projectId}.`);
}

export async function migrateLegacyStorage():Promise<LegacyMigrationReport>{
  const alreadyMigrated=await getMetadata<string>('legacyMigrationCompletedAt');
  if(alreadyMigrated)return {migratedProjects:0,removedKeys:[],corruptKeys:[]};
  const report:LegacyMigrationReport={migratedProjects:0,removedKeys:[],corruptKeys:[]};
  const candidates:Array<{key:string;value:any}>=[];
  for(let index=0;index<localStorage.length;index++){
    const key=localStorage.key(index);
    if(!key||(key!==LEGACY_AUTOSAVE_KEY&&!key.startsWith(LEGACY_PROJECT_PREFIX)))continue;
    const raw=localStorage.getItem(key);
    if(!raw)continue;
    try{
      const value=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Legacy project is not an object.');
      candidates.push({key,value});
    }catch(error){report.corruptKeys.push(key);await recordDiagnostic('legacy-migration-parse',error,{key});}
  }
  const groups=new Map<string,Array<{key:string;value:any}>>();
  candidates.forEach(candidate=>{
    const id=String(candidate.value.id||candidate.key.replace(LEGACY_PROJECT_PREFIX,'')||crypto.randomUUID());
    const items=groups.get(id)||[];items.push(candidate);groups.set(id,items);
  });
  let preferredActive:string|null=null,preferredPrompts=-1,preferredTime=-1;
  for(const [id,items] of groups){
    try{
      await writeLegacyGroup(id,items);
      report.migratedProjects++;
      items.forEach(item=>{localStorage.removeItem(item.key);report.removedKeys.push(item.key);});
      const winner=[...items].sort((a,b)=>promptCount(b.value)-promptCount(a.value)||savedTime(b.value)-savedTime(a.value))[0];
      const count=promptCount(winner.value),time=savedTime(winner.value);
      if(count>preferredPrompts||(count===preferredPrompts&&time>preferredTime)){preferredActive=id;preferredPrompts=count;preferredTime=time;}
    }catch(error){items.forEach(item=>report.corruptKeys.push(item.key));await recordDiagnostic('legacy-migration-write',error,{projectId:id});}
  }
  if(preferredActive)setActiveProjectId(preferredActive);
  if(report.corruptKeys.length===0)localStorage.removeItem(LEGACY_INDEX_KEY);
  await setMetadata('legacyMigrationCompletedAt',new Date().toISOString());
  return report;
}

export async function initializeProjectStorage():Promise<LegacyMigrationReport>{
  await openDatabase();
  const report=await migrateLegacyStorage();
  void requestPersistentStorage();
  return report;
}
export async function exportActiveProject():Promise<void>{
  const id=getActiveProjectId();
  if(!id)throw new Error('No active project is available to export.');
  const project=await loadProject(id);
  if(!project)throw new Error('The active project could not be loaded.');
  const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`${(project.projectName||'recovered-project').replace(/\s+/g,'_')}_recovery.json`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}

export async function resetProjectStorageForTests():Promise<void>{
  if(databasePromise){try{(await databasePromise).close();}catch{/* Ignore failed test database opens. */}}
  databasePromise=null;
  lastCheckpointSequence=0;
  if(typeof indexedDB==='undefined')return;
  await new Promise<void>((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error||new Error('Could not reset test project storage.'));
    request.onblocked=()=>reject(new Error('Test project storage reset was blocked.'));
  });
}
