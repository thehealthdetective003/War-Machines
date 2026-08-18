import assert from 'node:assert/strict';
import test from 'node:test';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { alignScenesToChapters, buildDocumentaryScenePlan, deriveGraphicSceneSpec, isOperationallyMobileProduct } from './scenePlanner';

const scenes=(count:number,duration=10)=>Array.from({length:count},(_,i)=>({number:i+1,start:i*duration,end:(i+1)*duration,duration,text:i%4===0?'factory scale and logistics':i%4===1?'assembly workers install component':i%4===2?'precision testing and measurement':'mechanical system relationship',silent:false}));
const operationalTopic=(productClass='combat helicopter',restricted=false)=>{
  const raw:any=JSON.parse(JSON.stringify(template));raw.product.official_name='HX-1';raw.product.exact_variant='HX-1 operational configuration';raw.product.product_class=productClass;raw.product.immutable_identity_features=['five-blade main rotor','broad utility cabin','single tail rotor'];
  const env={...raw.environments[1],environment_id:'ENV_OPERATIONAL',environment_name:'Generic flight-test range',setting_scope:'OPERATIONAL',facility_type:'non-identifying operational test environment'};raw.environments.push(env);
  const finalStage=JSON.parse(JSON.stringify(raw.production_stages[0]));finalStage.stage_id='STG_07';finalStage.stage_number=7;finalStage.stage_name='Operational testing and deployment';finalStage.product_state_code='C';finalStage.product_state.recognizable_as_final_product=true;finalStage.environment_ids=['ENV_OPERATIONAL'];finalStage.stage_visual_summary='Complete aircraft performs controlled operational flight';raw.production_stages.push(finalStage);
  const base=raw.visual_story_plan.chapters[0].visual_beats[0];
  const beat=(id:string,family:string,fn:string,purpose:string)=>({...base,beat_id:id,beat_order:raw.visual_story_plan.chapters[0].visual_beats.length+1,beat_name:purpose,story_function:fn,visual_family:family,narrative_purpose:purpose,semantic_alignment_terms:['flight','hover','maneuver','deployment'],applicable_stage_ids:['STG_07'],environment_ids:['ENV_OPERATIONAL'],product_visibility:'FULL',required_product_state_code:'C',preferred_media_routes:restricted?['AUTHENTIC_VIDEO']:['GENERATED_T2V'],generation_permission:restricted?'REFERENCE_REQUIRED':'T2V_ALLOWED',must_show:['single HX-1','five-blade main rotor','stable configuration'],must_not_show:['weapon discharge','invented markings']});
  raw.visual_story_plan.chapters[0].visual_beats.push(beat('OP_HOOK','OPERATIONAL_CONTEXT','OPENING_HOOK','Controlled low hover in a generic flight drill'),beat('OP_PAYOFF','DYNAMIC_TESTING','PREVIEW_PAYOFF','Banked operational transit over a generic test range'));
  return normalizeProductionHandoff(raw);
};

test('preserves coherent manufacturing runs instead of forcing a new family every two scenes',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const input=Array.from({length:12},(_,i)=>({number:i+1,start:i*10,end:(i+1)*10,duration:10,text:`Technicians assemble structural component ${i+1}, preserve its interface, and continue the same manufacturing sequence.`,silent:false}));
  const plan=buildDocumentaryScenePlan(topic,input);
  assert.equal(plan.length,12);
  assert.ok(plan.every(item=>item.visual_family==='ASSEMBLY_PROCESS'));
  assert.ok(plan.every(item=>item.visual_treatment==='LIVE_ACTION_T2V'));
  assert.ok(plan.every(item=>item.beat_id.endsWith('__SEMANTIC_FALLBACK')));
});

test('aligns narration monotonically across every Engine chapter without explicit chapter headings',()=>{
  const raw:any=JSON.parse(JSON.stringify(template)),base=raw.visual_story_plan.chapters[0];
  raw.visual_story_plan.chapters=['materials','assembly','electronics','operation'].map((keyword,index)=>{const chapter=JSON.parse(JSON.stringify(base));chapter.chapter_id=`CH0${index+1}`;chapter.chapter_order=index+1;chapter.chapter_name=`${keyword} chapter`;chapter.narrative_goal=`Explain the ${keyword} portion of the product story`;chapter.visual_beats=chapter.visual_beats.map((beat:any,beatIndex:number)=>({...beat,beat_id:`CH0${index+1}_B0${beatIndex+1}`,beat_name:`${keyword} visual`,narrative_purpose:`Show the ${keyword} portion`,semantic_alignment_terms:[keyword]}));return chapter;});
  const input=['raw materials arrive.','material stock is prepared.','structural assembly starts.','workers join the assembly.','electronics enter the system.','sensors and electronics connect.','the completed product begins operation.','it continues operating offshore.'].map((text,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text,silent:false}));
  const assigned=alignScenesToChapters(raw,input).map(chapter=>chapter?.chapter_id);
  assert.deepEqual([...new Set(assigned)],['CH01','CH02','CH03','CH04']);
  assert.ok(assigned.every((chapter,index)=>index===0||String(chapter)>=String(assigned[index-1])));
});

test('rejects a handoff that offers only a restricted reference beat',()=>{
  const raw:any=JSON.parse(JSON.stringify(template)); const beat=raw.visual_story_plan.chapters[0].visual_beats[0];
  beat.generation_permission='REFERENCE_REQUIRED';beat.preferred_media_routes=['REFERENCE_IMAGE_I2V'];
  assert.throws(()=>buildDocumentaryScenePlan(normalizeProductionHandoff(raw),scenes(1)),/does not contain any visual beats/i);
});

test('plans 8-second and partial-duration windows without changing scene numbers',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const input=[...scenes(3,8),{number:4,start:24,end:29.75,duration:5.75,text:'final payoff',silent:false}];
  assert.deepEqual(buildDocumentaryScenePlan(topic,input).map(x=>x.number),[1,2,3,4]);
});

test('uses operational footage only for VO that describes active operation',()=>{
  const topic=operationalTopic();
  const input=[
    'A finished HX-1 begins to roll across the test apron.',
    'The aircraft accelerates and lifts from the ground into a controlled climb.',
    'Earlier, technicians assemble the unfinished central structure inside the factory.',
    'Workers install a structural component and preserve its exposed interface.',
    'The component is measured before the next panel is attached.',
    'The same assembly sequence continues with controlled tooling.',
  ].map((text,i)=>({number:i+1,start:i*10,end:(i+1)*10,duration:10,text,silent:false}));
  const plan=buildDocumentaryScenePlan(topic,input);const operational=(item:any)=>['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(item.visual_family);
  assert.equal(isOperationallyMobileProduct(topic),true);
  assert.deepEqual(plan.map(operational),[true,true,false,false,false,false]);
  assert.equal(plan[0].showdown_role,'GROUND_REVEAL');
  assert.equal(plan[0].camera_platform,'GROUND_TRIPOD');
  assert.equal(plan[1].showdown_role,'DEPARTURE');
  assert.equal(plan[1].camera_platform,'RUNWAY_LONG_LENS');
  assert.ok(plan.slice(2).every(item=>item.showdown_role===null));
});

test('uses the Engine-provided T2V alternative instead of synthesizing a reference-only event',()=>{
  const input=[{number:1,start:0,end:10,duration:10,text:'The fighter accelerates for takeoff and lifts into a controlled climb.',silent:false}];
  const topic:any=operationalTopic('fighter aircraft',true);const chapter=topic._production_handoff.visual_story_plan.chapters[0];const restricted=chapter.visual_beats.find((beat:any)=>beat.beat_id==='OP_HOOK');
  chapter.visual_beats.push({...restricted,beat_id:'OP_HOOK_CONTEXTUAL',generation_permission:'T2V_ALLOWED',preferred_media_routes:['GENERATED_T2V'],reference_asset_ids:[],exact_factory_claim_allowed:false,narrative_purpose:'Generic non-identifying controlled takeoff and climb'});
  const plan=buildDocumentaryScenePlan(topic,input);const opening=plan.find(item=>item.visual_family==='OPERATIONAL_CONTEXT');
  assert.ok(opening);assert.equal(opening!.beat_id,'OP_HOOK_CONTEXTUAL');assert.doesNotMatch(opening!.beat_id,/__T2V_SAFE$/);
});

test('allows at most one factory aerial and only where the VO identifies the facility',()=>{
  const topic=operationalTopic();
  const input=[
    'Technicians assemble the central structure and preserve every interface.',
    'Production continues at the HX manufacturing plant and its expanded assembly facility.',
    'Workers install the next component inside the same hall.',
    'The airframe receives outer panels and remains on its assembly fixture.',
    'Quality teams inspect the joined structure.',
    'The manufacturing sequence continues through controlled tooling.',
  ].map((text,i)=>({number:i+1,start:i*10,end:(i+1)*10,duration:10,text,silent:false}));
  const plan=buildDocumentaryScenePlan(topic,input);
  const aerials=plan.filter(item=>item.visual_family==='FACTORY_AERIAL');
  assert.equal(aerials.length,1);
  assert.equal(aerials[0].number,2);
  assert.ok(plan.filter((_,index)=>index!==1).every(item=>item.visual_family!=='FACTORY_AERIAL'));
});

test('detects aircraft but does not classify a stationary industrial product as mobile',()=>{
  assert.equal(isOperationallyMobileProduct(operationalTopic('fighter aircraft')),true);
  const stationary=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));assert.equal(isOperationallyMobileProduct(stationary),false);
});

test('does not add aviation showdown metadata to non-aviation manufacturing scenes',()=>{
  const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const plan=buildDocumentaryScenePlan(topic,scenes(12));
  assert.ok(plan.every(item=>item.showdown_role===null&&item.camera_platform===null));
});

test('classifies text-free technical graphic subtypes from VO and beat semantics',()=>{
  const plan={beat_id:'GFX',visual_family:'TECHNICAL_GRAPHIC',visual_treatment:'MOTION_GRAPHIC_T2V'} as const;
  const scene=(text:string)=>({number:1,start:0,end:10,duration:10,text,silent:false});
  assert.equal(deriveGraphicSceneSpec(null,scene('Radar waves sweep outward and detect the aircraft'),plan as any)?.graphic_subtype,'SENSOR_SIGNAL');
  assert.equal(deriveGraphicSceneSpec(null,scene('Heat moves from the combustion chamber through the turbine'),plan as any)?.graphic_subtype,'HEAT_OR_ENERGY_FLOW');
  assert.equal(deriveGraphicSceneSpec(null,scene('Compare the two aircraft on the same scale'),plan as any)?.graphic_subtype,'SCALE_COMPARISON');
  const factory=deriveGraphicSceneSpec(null,scene('A robotic arm installs the component in the factory'),plan as any);
  assert.equal(factory?.graphic_subtype,'FACTORY_SCHEMATIC');
  assert.equal(factory?.text_policy,'NO_GENERATED_TEXT');
  assert.ok((factory?.annotation_devices.length||0)<=2);
  assert.ok((factory?.maximum_animated_elements||0)<=3);
});

test('stores a graphic specification on every planned static or motion graphic',()=>{
  const raw:any=JSON.parse(JSON.stringify(template));
  const base=raw.visual_story_plan.chapters[0].visual_beats[0];
  raw.visual_story_plan.chapters[0].visual_beats.push({...base,beat_id:'CH01_GFX',beat_order:2,beat_name:'Interface alignment relationship',story_function:'EXPLAIN_ARCHITECTURE',visual_family:'TECHNICAL_GRAPHIC',narrative_purpose:'Explain how alignment error propagates through connected structural interfaces',semantic_alignment_terms:['alignment','error','propagates','connected','interface'],product_visibility:'DETAIL_ONLY',preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED'});
  const topic=normalizeProductionHandoff(raw);
  const input=scenes(35).map((scene,index)=>({...scene,text:index===17?'Alignment error propagates through every connected structural interface.':'Workers install and inspect the physical component inside the assembly hall.'}));
  const plan=buildDocumentaryScenePlan(topic,input);
  const graphics=plan.filter(item=>item.visual_treatment==='STATIC_GRAPHIC_T2V'||item.visual_treatment==='MOTION_GRAPHIC_T2V');
  assert.equal(graphics.length,1);
  assert.equal(graphics[0].number,18);
  assert.ok(graphics.every(item=>item.graphic_spec?.text_policy==='NO_GENERATED_TEXT'));
  assert.ok(plan.filter(item=>item.visual_treatment==='LIVE_ACTION_T2V').every(item=>item.graphic_spec===null));
});
