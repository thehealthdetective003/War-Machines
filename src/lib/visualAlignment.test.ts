import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan } from './scenePlanner';
import { applyVisualAlignments, buildAlignmentRequests, buildNarrativeGroups, validateAlignmentSelections } from './visualAlignment';

const timed=(texts:string[])=>texts.map((text,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text,silent:false}));

test('groups adjacent transcript windows by complete ideas with a four-scene ceiling',()=>{
  const groups=buildNarrativeGroups(timed(['This idea begins','and continues.','A second idea','continues again','and again','before ending']));
  assert.deepEqual(groups.map(group=>group.scene_numbers),[[1,2],[3,4,5,6]]);
  assert.match(groups[0].voiceover,/begins and continues/);
});

test('shortlists only Engine-authorized generated T2V beats and validates selection IDs',()=>{
  const raw:any=JSON.parse(JSON.stringify(template));
  const restricted={...raw.visual_story_plan.chapters[0].visual_beats[0],beat_id:'REF_ONLY',generation_permission:'REFERENCE_REQUIRED',preferred_media_routes:['REFERENCE_IMAGE_I2V']};
  raw.visual_story_plan.chapters[0].visual_beats.push(restricted);
  const topic=normalizeProductionHandoff(raw),scenes=timed(['Workers assemble the structural component.']);
  const plan=buildDocumentaryScenePlan(topic,scenes),requests=buildAlignmentRequests(topic,scenes,plan);
  assert.ok(requests[0].candidates.length>0);assert.ok(requests[0].candidates.every(candidate=>candidate.beat_id!=='REF_ONLY'));
  assert.throws(()=>validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'ENGINE_BEAT',beat_id:'REF_ONLY',confidence:1,visual_claim:'Wrong'}]),/outside its validated shortlist/);
});

test('applies a safe VO fallback without changing transcript timing',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template))),scenes=timed(['The name is not an official class designation.']);
  const base=buildDocumentaryScenePlan(topic,scenes),requests=buildAlignmentRequests(topic,scenes,base);
  const selections=validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'VO_FALLBACK',beat_id:null,confidence:.82,visual_claim:'Show the distinction as one text-free conceptual relationship'}]);
  const plan=applyVisualAlignments(topic,scenes,base,requests,selections);
  assert.equal(plan[0].alignment_source,'VO_FALLBACK');assert.equal(plan[0].visual_family,'TECHNICAL_GRAPHIC');assert.equal(plan[0].product_visibility,'NONE');assert.equal(scenes[0].start,0);assert.equal(scenes[0].end,6);
});
