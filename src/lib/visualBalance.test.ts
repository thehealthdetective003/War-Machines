import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import type { GraphicSceneSpec, PlannedScene, TimedScene, VisualFamily } from '../types';
import { normalizeProductionHandoff } from './productionTemplate';
import { buildDocumentaryScenePlan } from './scenePlanner';
import { applyVisualAlignments, buildAlignmentRequests, classifyFallbackVisualFamily, validateAlignmentSelections } from './visualAlignment';
import { auditVisualBalance, rebalanceVisualPlan } from './visualBalance';

const scenes=(texts:string[]):TimedScene[]=>texts.map((text,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text,silent:false}));
const topicWithBeats=(options:{graphicsMaximum?:number;maximumRun?:number;graphicsOnly?:boolean}={})=>{
  const raw:any=JSON.parse(JSON.stringify(template)),chapter=raw.visual_story_plan.chapters[0],seed=chapter.visual_beats[0],stage=raw.production_stages[0].stage_id,environment=raw.production_stages[0].environment_ids[0];
  const beat=(beat_id:string,visual_family:VisualFamily,narrative_purpose:string,terms:string[],story_function='EXPLAIN_PROCESS')=>({...seed,beat_id,beat_order:chapter.visual_beats.length+1,beat_name:narrative_purpose,story_function,visual_family,narrative_purpose,semantic_alignment_terms:terms,applicable_stage_ids:[stage],environment_ids:[environment],product_visibility:visual_family==='TECHNICAL_GRAPHIC'?'NONE':visual_family==='COMPONENT_MACRO'?'DETAIL_ONLY':'PARTIAL',reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',must_show:visual_family==='TECHNICAL_GRAPHIC'?['one text-free relationship']:['supported physical production action'],must_not_show:[],continuity_requirements:[],negative_constraints:[]});
  const graphic=beat('GFX_RELATION','TECHNICAL_GRAPHIC','Explain the hidden signal and mechanical relationship between connected layers',['hidden','signal','mechanical','relationship','connected','layers'],'EXPLAIN_HIDDEN_SYSTEM');
  chapter.visual_beats=options.graphicsOnly?[graphic]:[
    beat('PHY_ASSEMBLY','ASSEMBLY_PROCESS','Workers physically assemble and connect the supported component',['workers','assemble','connect','component']),
    beat('PHY_DETAIL','COMPONENT_MACRO','Close physical detail of the supported component interface',['component','interface','detail']),
    beat('PHY_MACHINE','MACHINERY_ACTION','Approved machinery positions the component during production',['machinery','positions','component','production']),
    beat('PHY_QC','QUALITY_CONTROL','Technicians physically inspect the completed interface',['technicians','inspect','interface']),
    graphic,
  ];
  raw.visual_story_plan.rhythm_policy.maximum_consecutive_same_visual_family=options.maximumRun??2;
  raw.visual_story_plan.visual_balance_targets.graphics_and_reference_media_percent.maximum=options.graphicsMaximum??50;
  return normalizeProductionHandoff(raw);
};
const forceFamily=(item:PlannedScene,family:VisualFamily,beatId:string,claim:string):PlannedScene=>({...item,beat_id:beatId,visual_family:family,visual_treatment:family==='TECHNICAL_GRAPHIC'?'MOTION_GRAPHIC_T2V':'LIVE_ACTION_T2V',product_visibility:family==='TECHNICAL_GRAPHIC'?'NONE':family==='COMPONENT_MACRO'?'DETAIL_ONLY':'PARTIAL',graphic_spec:family==='TECHNICAL_GRAPHIC'?{graphic_subtype:'MECHANICAL_RELATIONSHIP',visual_claim:claim,composition:'SINGLE_SUBJECT',motion_pattern:'COMPONENT_TRANSLATION',annotation_devices:['DIRECTIONAL_ARROWS'],palette_profile:'PREMIUM_TECHNICAL_VECTOR',maximum_animated_elements:2,transition_anchor:null,text_policy:'NO_GENERATED_TEXT'} satisfies GraphicSceneSpec:null,alignment_claim:claim});

test('A: a group-level graphic opportunity allocates only its smallest scene subset',()=>{
  const topic=topicWithBeats(),timed=scenes(['Workers assemble the housing','A hidden signal path connects the internal layers','Technicians inspect the physical interface','Machinery positions the completed component']);
  const initial=buildDocumentaryScenePlan(topic,timed).map(item=>forceFamily(item,'ASSEMBLY_PROCESS','PHY_ASSEMBLY','Supported physical production coverage'));
  const requests=buildAlignmentRequests(topic,timed,initial),graphic=requests[0].candidates.find(item=>item.beat_id==='GFX_RELATION');assert.ok(graphic);
  const selections=validateAlignmentSelections(requests,[{group_id:requests[0].group_id,source:'ENGINE_BEAT',beat_id:'GFX_RELATION',confidence:.9,visual_claim:'A hidden signal path connects the internal layers',graphic_required:true,graphic_scene_numbers:[1,2,3,4]}]);
  const final=applyVisualAlignments(topic,timed,initial,requests,selections),graphics=final.filter(item=>item.visual_family==='TECHNICAL_GRAPHIC');
  assert.deepEqual(graphics.map(item=>item.number),[2]);assert.ok(final.filter(item=>item.number!==2).every(item=>item.visual_treatment==='LIVE_ACTION_T2V'));assert.ok(final.every(item=>item.semantic_group_id===requests[0].group_id));
});

test('B: repeated nearby graphic claims collapse to one explanatory insert',()=>{
  const topic=topicWithBeats({graphicsMaximum:100}),timed=scenes(['The hidden signal relationship begins','The same hidden signal relationship continues','The same hidden signal relationship concludes']);
  const initial=buildDocumentaryScenePlan(topic,timed),base=initial.map((item,index)=>forceFamily(item,['ASSEMBLY_PROCESS','COMPONENT_MACRO','QUALITY_CONTROL'][index] as VisualFamily,`PHY_${index}`,'Supported physical alternative'));
  const repeated=initial.map((item,index)=>forceFamily(item,'TECHNICAL_GRAPHIC','GFX_RELATION','One hidden signal relationship between connected layers'));
  const result=rebalanceVisualPlan(topic,timed,repeated,base);
  assert.equal(result.plan.filter(item=>item.visual_family==='TECHNICAL_GRAPHIC').length,1);assert.equal(result.diagnostics.duplicateGraphicClaimsCollapsed,2);
});

test('C: adjacent graphics with materially different necessary claims survive without physical alternatives',()=>{
  const topic=topicWithBeats({graphicsOnly:true,graphicsMaximum:100}),timed=scenes(['A hidden thermal path crosses sealed layers','An invisible signal architecture links remote modules']);
  const initial=buildDocumentaryScenePlan(topic,timed),input=[forceFamily(initial[0],'TECHNICAL_GRAPHIC','GFX_THERMAL','Heat transfers through sealed insulation layers'),forceFamily(initial[1],'TECHNICAL_GRAPHIC','GFX_SIGNAL','Radio signal architecture connects remote control modules')];
  const result=rebalanceVisualPlan(topic,timed,input);
  assert.equal(result.plan.filter(item=>item.visual_family==='TECHNICAL_GRAPHIC').length,2);assert.equal(result.diagnostics.duplicateGraphicClaimsCollapsed,0);
});

test('D: excessive post-alignment graphics are restored to the configured balance when supported alternatives exist',()=>{
  const topic=topicWithBeats({graphicsMaximum:20}),timed=scenes(Array.from({length:20},(_,index)=>`Workers assemble and inspect supported component ${index+1}`));
  const initial=buildDocumentaryScenePlan(topic,timed),base=initial.map((item,index)=>forceFamily(item,index%2?'COMPONENT_MACRO':'ASSEMBLY_PROCESS',index%2?'PHY_DETAIL':'PHY_ASSEMBLY','Supported physical production coverage'));
  const overwritten=initial.map(item=>forceFamily(item,'TECHNICAL_GRAPHIC','GFX_RELATION','One repeated hidden component relationship'));
  const result=rebalanceVisualPlan(topic,timed,overwritten,base),graphics=result.plan.filter(item=>item.visual_family==='TECHNICAL_GRAPHIC');
  assert.ok(graphics.length<=4);assert.ok(result.plan.every((item,index)=>item.number===timed[index].number));assert.ok(result.diagnostics.graphicScenesReassigned>=16);
});

test('E: broad analytical keywords do not override strong physical documentary actions',()=>{
  ['Workers compare the scale while physically measuring the component.','A truck follows the official route through the factory.','Technicians explain why they inspect the network enclosure.','Workers trace material flow by moving parts on a conveyor.'].forEach(value=>assert.notEqual(classifyFallbackVisualFamily(value),'TECHNICAL_GRAPHIC'));
});

test('F: a genuinely schematic scene remains when no authorized physical alternative exists',()=>{
  const topic=topicWithBeats({graphicsOnly:true,graphicsMaximum:1}),timed=scenes(['An otherwise invisible signal path crosses sealed internal layers']);
  const [planned]=buildDocumentaryScenePlan(topic,timed),result=rebalanceVisualPlan(topic,timed,[forceFamily(planned,'TECHNICAL_GRAPHIC','GFX_RELATION','An invisible signal path crosses sealed internal layers')]);
  assert.equal(result.plan[0].visual_family,'TECHNICAL_GRAPHIC');assert.ok(result.diagnostics.warnings.some(warning=>warning.includes('advisory')));
});

test('G: custom same-family rhythm remains enforced after alignment',()=>{
  const topic=topicWithBeats({maximumRun:1,graphicsMaximum:100}),timed=scenes(['Workers assemble one component','Technicians inspect its interface','Machinery positions the next component','Workers verify the connection']);
  const seed=buildDocumentaryScenePlan(topic,timed),base=seed.map((item,index)=>forceFamily(item,['ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL'][index] as VisualFamily,`PHY_${index}`,'Supported physical coverage'));
  const overwritten=seed.map(item=>forceFamily(item,'ASSEMBLY_PROCESS','PHY_ASSEMBLY','Workers assemble and inspect the supported component'));
  const result=rebalanceVisualPlan(topic,timed,overwritten,base),audit=auditVisualBalance(topic,timed,result.plan);
  assert.ok(audit.longestSameFamilyRun.length<=1);assert.ok(!audit.warnings.some(warning=>warning.includes('configured maximum is 1')));
});

test('legacy resume rebalances only undirected scenes and preserves the committed prefix',()=>{
  const topic=topicWithBeats({graphicsMaximum:20}),timed=scenes(Array.from({length:10},(_,index)=>`Workers assemble and inspect supported component ${index+1}`));
  const initial=buildDocumentaryScenePlan(topic,timed),base=initial.map((item,index)=>forceFamily(item,index%2?'COMPONENT_MACRO':'ASSEMBLY_PROCESS',index%2?'PHY_DETAIL':'PHY_ASSEMBLY','Supported physical production coverage'));
  const legacy=initial.map(item=>forceFamily(item,'TECHNICAL_GRAPHIC','GFX_RELATION','One repeated hidden component relationship')),result=rebalanceVisualPlan(topic,timed,legacy,base,{lockedThroughScene:3});
  assert.deepEqual(result.plan.slice(0,3),legacy.slice(0,3));assert.ok(result.plan.slice(3).some(item=>item.visual_family!=='TECHNICAL_GRAPHIC'));
});
