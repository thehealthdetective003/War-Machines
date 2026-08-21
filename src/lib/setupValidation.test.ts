import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { validateProductionReadiness } from './setupValidation';

const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
const transcript={audioFileName:'voiceover.json',duration:12,language:'en',languageProbability:1,model:'external',computeType:'external',text:'First complete idea. Second complete idea.',segments:[],words:[],sceneDurationSeconds:6,scenes:[{number:1,start:0,end:6,duration:6,text:'First complete idea.',silent:false},{number:2,start:6,end:12,duration:6,text:'Second complete idea.',silent:false}],importedAt:'now'};
const state=(overrides:Record<string,unknown>={})=>({topic,voiceoverTranscription:transcript,plannedScenes:[],sceneDirections:[],visualPrompts:[],...overrides} as any);

test('requires both a validated handoff and coherent transcription before production starts',()=>{
  assert.equal(validateProductionReadiness(state()).ready,true);
  assert.equal(validateProductionReadiness(state({topic:null})).ready,false);
  assert.equal(validateProductionReadiness(state({voiceoverTranscription:null})).ready,false);
});

test('rejects incoherent transcription timing deterministically without an API call',()=>{
  const broken={...transcript,scenes:[transcript.scenes[0],{...transcript.scenes[1],start:7}]};
  const result=validateProductionReadiness(state({voiceoverTranscription:broken}));
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(error=>/coherent timeline/i.test(error)));
});

test('rejects prompts that have no compatible saved direction',()=>{
  const result=validateProductionReadiness(state({visualPrompts:[{number:1,video_prompt:'prompt'}]}));
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(error=>/no compatible scene direction/i.test(error)));
});
