import assert from 'node:assert/strict';
import test from 'node:test';
import type { TopicBrief, VoiceoverTranscription } from '../types';
import { diagnosticsVisible, handoffSummary, productionOperationLabel, scenePresentationState, transcriptSummary, validationPresentation, WORKFLOW_STAGES } from './uiPresentation';

test('valid handoff presentation is concise metadata rather than raw JSON',()=>{
  const topic={lifecycle_stages:[{},{},{}],environments:[{},{}],_production_handoff:{production_stages:[{},{},{}],environments:[{},{}],visual_story_plan:{chapters:[{visual_beats:[{},{}]},{visual_beats:[{}]}]}}} as unknown as TopicBrief;
  assert.equal(handoffSummary(topic).label,'3 stages · 3 visual beats · 2 environments');assert.doesNotMatch(handoffSummary(topic).label,/\{|production_stages/);
});

test('transcript presentation preserves timing while returning one compact summary',()=>{
  const transcript={duration:636,sceneDurationSeconds:6,scenes:Array.from({length:106},(_,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text:'x',silent:false}))} as unknown as VoiceoverTranscription;
  assert.equal(transcriptSummary(transcript),'10:36.000 · 106 scenes · 6s clips');
});

test('production presentation hides operation enums and reduces completed internals to Ready',()=>{
  assert.equal(productionOperationLabel('DIRECTION_CORRECTION'),'Correcting scene directions…');assert.equal(scenePresentationState({hasDirection:true,hasPrompt:true,hasWarning:false,hasBlocker:false}).label,'Ready');assert.equal(scenePresentationState({hasDirection:true,hasPrompt:true,hasWarning:true,hasBlocker:false}).label,'Review suggested');assert.equal(scenePresentationState({hasDirection:false,hasPrompt:false,hasWarning:false,hasBlocker:true}).label,'Needs repair');
});

test('diagnostic details follow the persisted user preference',()=>{assert.equal(diagnosticsVisible(false),false);assert.equal(diagnosticsVisible(true),true);});

test('validation success stays quiet while failures expose actionable details',()=>{
  assert.deepEqual(validationPresentation(true,0),{label:'Validated',detailOpen:false,tone:'success'});
  assert.deepEqual(validationPresentation(false,3),{label:'Validation failed · 3 issues',detailOpen:true,tone:'error'});
});

test('workflow navigation contains only the three concise creator stages',()=>{
  assert.deepEqual(WORKFLOW_STAGES.map(stage=>stage.label),['Setup','Production','Review & Export']);
  assert.equal(productionOperationLabel('UNRECOGNIZED_INTERNAL_CODE'),'Working…');
});
