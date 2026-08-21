import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, T2VPrompt } from '../types';
import { getProjectCheckpoints, initializeProjectStorage, loadProject, resetProjectStorageForTests, saveProject } from './storageUtils';
import { idleGenerationSession } from './generationSession';

class MemoryStorage {
  private values=new Map<string,string>();
  get length(){return this.values.size;}
  key(index:number){return [...this.values.keys()][index]??null;}
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,String(value));}
  removeItem(key:string){this.values.delete(key);}
  clear(){this.values.clear();}
}
const storage=new MemoryStorage();
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
const prompt=(number:number)=>({number,video_prompt:`prompt ${number}`,action_description:'action',voiceover:'',stock_keywords:''} as T2VPrompt);
const project=(id:string,count:number):AppState=>({id,projectSchemaVersion:13,projectName:id,projectFormat:'standard-lifecycle',phase:3,topic:null,plannedScenes:[],sceneDirections:[],masterVoiceoverScript:'',voiceoverTranscription:null,t2vPromptProfile:'omni-flash',visualPrompts:Array.from({length:count},(_,index)=>prompt(index+1)),demoState:'idle',demoScenes:[],demoSceneNumbers:[],generationSession:{...idleGenerationSession(),completedScenes:count}});

test('migrates duplicate legacy states, verifies the winner, and retains only three checkpoints',async()=>{
  await resetProjectStorageForTests();storage.clear();
  storage.setItem('assembly_line_project_legacy',JSON.stringify({...project('legacy',2),savedAt:'2026-01-02T00:00:00.000Z'}));
  storage.setItem('assembly_line_save',JSON.stringify({...project('legacy',4),savedAt:'2026-01-01T00:00:00.000Z'}));
  storage.setItem('assembly_line_project_corrupt','{bad json');
  const report=await initializeProjectStorage();
  assert.equal(report.migratedProjects,1);
  assert.deepEqual(report.corruptKeys,['assembly_line_project_corrupt']);
  assert.equal((await loadProject('legacy'))?.visualPrompts.length,4,'most completed state wins before timestamp');
  assert.equal((await getProjectCheckpoints('legacy')).length,2,'duplicate states remain recoverable');
  assert.equal(storage.getItem('assembly_line_save'),null);
  assert.ok(storage.getItem('assembly_line_project_corrupt'),'corrupt legacy records remain untouched');

  for(let count=1;count<=4;count++)await saveProject(project('retained',count),{checkpointReason:'batch'});
  const checkpoints=await getProjectCheckpoints('retained');
  assert.equal(checkpoints.length,3);
  assert.deepEqual(checkpoints.map(item=>item.state.visualPrompts.length),[4,3,2]);
});
