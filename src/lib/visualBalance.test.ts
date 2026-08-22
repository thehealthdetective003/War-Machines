import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import type { PlannedScene, TimedScene } from '../types';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan } from './scenePlanner';
import { buildAlignmentRequests } from './visualAlignment';
import { auditVisualBalance, rebalanceVisualPlan } from './visualBalance';

const scenes=(count:number):TimedScene[]=>Array.from({length:count},(_,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text:['Workers assemble the visible structure','A technician inspects the external interface','Material moves through the production hall','The finished product enters controlled testing'][index%4],silent:false}));
const topicWithLegacyGraphicBeat=()=>{const raw:any=JSON.parse(JSON.stringify(template)),chapter=raw.visual_story_plan.chapters[0],seed=chapter.visual_beats[0];chapter.visual_beats.push({...seed,beat_id:'LEGACY_GFX',beat_order:99,visual_family:'TECHNICAL_GRAPHIC',story_function:'EXPLAIN_HIDDEN_SYSTEM',narrative_purpose:'Diagram a hidden load relationship',semantic_alignment_terms:['hidden','load','relationship'],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED'});return normalizeProductionHandoff(raw);};
const asLegacyGraphic=(plan:PlannedScene):PlannedScene=>({...plan,visual_family:'TECHNICAL_GRAPHIC',visual_treatment:'MOTION_GRAPHIC_T2V',environment_ref:'ENV_TECHNICAL_GRAPHIC',graphic_spec:{graphic_subtype:'MECHANICAL_RELATIONSHIP',visual_claim:'Hidden load relationship',composition:'SINGLE_SUBJECT',motion_pattern:'COMPONENT_TRANSLATION',annotation_devices:['DIRECTIONAL_ARROWS'],palette_profile:'PREMIUM_TECHNICAL_VECTOR',maximum_animated_elements:1,transition_anchor:null,text_policy:'NO_GENERATED_TEXT'}});

test('alignment and new planning exclude legacy graphic beats',()=>{
  const topic=topicWithLegacyGraphicBeat(),timed=scenes(8),plan=buildDocumentaryScenePlan(topic,timed),requests=buildAlignmentRequests(topic,timed,plan);
  assert.ok(plan.every(item=>item.visual_treatment==='LIVE_ACTION_T2V'&&item.graphic_spec===null));
  assert.ok(plan.every(item=>!['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN'].includes(item.visual_family)));
  assert.ok(requests.every(request=>request.candidates.every(candidate=>candidate.beat_id!=='LEGACY_GFX')));
});

test('legacy graphic family and environment normalize locally to evidence-safe cinematic scenes',()=>{
  const topic=topicWithLegacyGraphicBeat(),timed=scenes(4),base=buildDocumentaryScenePlan(topic,timed),result=rebalanceVisualPlan(topic,timed,base.map(asLegacyGraphic));
  assert.equal(result.diagnostics.cinematicScenesNormalized,4);
  assert.ok(result.plan.every(item=>item.visual_treatment==='LIVE_ACTION_T2V'&&item.graphic_spec===null));
  assert.ok(result.plan.every(item=>!['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN'].includes(item.visual_family)));
  assert.ok(result.plan.every(item=>item.environment_ref!=='ENV_TECHNICAL_GRAPHIC'));
});

test('long sequences retain cinematic variety without a graphic quota',()=>{
  const topic=topicWithLegacyGraphicBeat(),timed=scenes(40),result=rebalanceVisualPlan(topic,timed,buildDocumentaryScenePlan(topic,timed));
  assert.ok(Object.keys(result.diagnostics.visualFamilyCounts).length>=2);
  assert.equal(result.diagnostics.visualFamilyCounts.TECHNICAL_GRAPHIC,undefined);
  assert.equal(result.diagnostics.visualFamilyCounts.MAP_OR_SUPPLY_CHAIN,undefined);
  assert.ok(result.diagnostics.longestSameFamilyRun.length<=(topic._production_handoff as any).visual_story_plan.rhythm_policy.maximum_consecutive_same_visual_family);
});

test('closed graphics_and_reference_media target is reported only as reference media',()=>{
  const topic=topicWithLegacyGraphicBeat(),timed=scenes(6),plan=buildDocumentaryScenePlan(topic,timed),diagnostics=auditVisualBalance(topic,timed,plan);
  assert.equal(typeof diagnostics.referenceMediaPercentage,'number');
  assert.equal('technicalGraphicPercentage' in diagnostics,false);
});
