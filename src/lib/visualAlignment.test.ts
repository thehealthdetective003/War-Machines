import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan } from './scenePlanner';
import { applyVisualAlignments, buildAlignmentRequests, buildNarrativeGroups, validateAlignmentSelections } from './visualAlignment';

const timed=(texts:string[])=>texts.map((text,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text,silent:false}));
const withOperationalBeat=()=>{
  const raw:any=JSON.parse(JSON.stringify(template)),baseChapter=raw.visual_story_plan.chapters[0],baseBeat=baseChapter.visual_beats[0];
  const environment={...raw.environments[0],environment_id:'ENV_OPEN_WATER',environment_name:'Generic open-water patrol area',setting_scope:'OPERATIONAL',facility_type:'non-identifying open-water environment'};raw.environments.push(environment);
  const stage={...raw.production_stages[0],stage_id:'STG_OPERATIONAL',stage_number:2,stage_name:'Completed operational product',product_state_code:'C',environment_ids:['ENV_OPEN_WATER'],stage_visual_summary:'Completed product operates in open water',product_state:{...raw.production_stages[0].product_state,recognizable_as_final_product:true}};raw.production_stages.push(stage);
  const chapter=JSON.parse(JSON.stringify(baseChapter));chapter.chapter_id='CH02';chapter.chapter_order=2;chapter.chapter_name='Operational patrol';chapter.narrative_goal='Show the completed product performing its patrol role';chapter.visual_beats=[{...baseBeat,beat_id:'CH02_OPERATION',beat_order:1,beat_name:'Completed open-water patrol',narrative_purpose:'Completed product cruises through offshore waves while its search system scans the horizon',semantic_alignment_terms:['completed','open water','offshore','waves','patrol','search','horizon'],story_function:'DELIVER_PAYOFF',visual_family:'OPERATIONAL_CONTEXT',applicable_stage_ids:['STG_OPERATIONAL'],environment_ids:['ENV_OPEN_WATER'],product_visibility:'FULL',required_product_state_code:'C',must_show:['completed product','open-water wake'],must_not_show:['unfinished hull','factory assembly']}];raw.visual_story_plan.chapters.push(chapter);
  return normalizeProductionHandoff(raw);
};

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
  const selections=validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'VO_FALLBACK',beat_id:null,confidence:.82,visual_claim:'Show the class designation distinction as one text-free conceptual relationship'}]);
  const plan=applyVisualAlignments(topic,scenes,base,requests,selections);
  assert.equal(plan[0].alignment_source,'VO_FALLBACK');assert.equal(plan[0].visual_family,'TECHNICAL_GRAPHIC');assert.equal(plan[0].product_visibility,'NONE');assert.equal(scenes[0].start,0);assert.equal(scenes[0].end,6);
});

test('rejects an alignment claim with no semantic grounding in its VO',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template))),scenes=timed(['Workers assemble and inspect the structural hull section.']);
  const base=buildDocumentaryScenePlan(topic,scenes),requests=buildAlignmentRequests(topic,scenes,base);
  assert.throws(()=>validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'VO_FALLBACK',beat_id:null,confidence:.8,visual_claim:'A helicopter flies above a mountain runway'}]),/not grounded in its voiceover/i);
});

test('rejects an operational Engine beat selected for manufacturing narration',()=>{
  const topic=withOperationalBeat(),scenes=timed(['Workers install and fasten the unfinished sensor mast inside the assembly hall.']);
  const base=buildDocumentaryScenePlan(topic,scenes),requests=buildAlignmentRequests(topic,scenes,base),operational=requests[0].candidates.find(candidate=>candidate.beat_id==='CH02_OPERATION');
  assert.ok(operational);
  assert.throws(()=>validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'ENGINE_BEAT',beat_id:'CH02_OPERATION',confidence:.8,visual_claim:'Workers install the unfinished sensor mast during assembly'}]),/incompatible narration lifecycle/i);
});

test('shortlists a semantically relevant authorized beat from a later Engine chapter',()=>{
  const topic=withOperationalBeat(),scenes=timed(['The completed craft patrols offshore while its search system scans the horizon.']);
  const base=buildDocumentaryScenePlan(topic,scenes).map(scene=>({...scene,chapter_id:'CH01'})),requests=buildAlignmentRequests(topic,scenes,base);
  assert.ok(requests[0].candidates.some(candidate=>candidate.beat_id==='CH02_OPERATION'));
});

test('routes an operational VO fallback to compatible completed-product Engine metadata',()=>{
  const topic=withOperationalBeat(),scenes=timed(['The completed craft pitches through offshore waves and continues its patrol.']);
  const base=buildDocumentaryScenePlan(topic,scenes),requests=buildAlignmentRequests(topic,scenes,base);
  const selections=validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'VO_FALLBACK',beat_id:null,confidence:.7,visual_claim:'Completed craft moves through offshore waves during patrol'}]);
  const [planned]=applyVisualAlignments(topic,scenes,base,requests,selections);
  assert.equal(planned.visual_family,'OPERATIONAL_CONTEXT');assert.equal(planned.stage_id,'STG_OPERATIONAL');assert.equal(planned.environment_ref,'ENV_OPEN_WATER');assert.equal(planned.state,'C');assert.equal(planned.product_visibility,'FULL');
  assert.ok(planned.required_visible_features.includes('Completed craft moves through offshore waves during patrol'));
});
