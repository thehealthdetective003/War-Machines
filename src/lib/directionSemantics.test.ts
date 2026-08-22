import assert from 'node:assert/strict';
import test from 'node:test';
import { directionSemanticIssues, isManufacturingVisualClaim, isOperationalVisualClaim } from './directionSemantics';
import type { SceneDirection } from '../types';

const base:any={number:1,alignment_claim:'The completed unmanned vessel maintains a stable course through moderate offshore waves',visual_family:'OPERATIONAL_CONTEXT',state:'C',subject:'Completed unmanned vessel',primary_action:'The vessel maintains a stable course through moderate waves',temporal_action:{opening_state:'The vessel enters a moderate wave',primary_motion:'The bow rises over the crest',physical_interaction:'Spray moves along the hull',mid_shot_progression:'The hull rolls gently and recovers',ending_state:'The vessel settles on a stable course'}};

test('accepts an operational direction that visibly represents its alignment claim',()=>assert.deepEqual(directionSemanticIssues(base),[]));

test('rejects an operational claim routed into unfinished factory work',()=>{
  const issues=directionSemanticIssues({...base,visual_family:'ASSEMBLY_PROCESS',state:'A',subject:'Quality control of sensor routing cutouts',primary_action:'A technician measures a raw deck cutout',temporal_action:{opening_state:'The unfinished shell rests in a workshop',primary_motion:'A gauge enters the cutout',physical_interaction:'The worker checks the raw edge',mid_shot_progression:'The gauge rotates',ending_state:'The worker removes the gauge'}});
  assert.ok(issues.includes('LIFECYCLE_CONTRADICTION'));assert.ok(issues.includes('DIRECTION_ALIGNMENT_MISMATCH'));
});

test('does not confuse a manufacturing operation with deployed product operation',()=>{
  const direction={...base,visual_family:'ASSEMBLY_PROCESS',state:'B',alignment_claim:'A robotic welding operation completes a continuous structural seam',subject:'Robotic welding cell and structural seam',primary_action:'The robotic welding operation advances along the structural seam',temporal_action:{...base.temporal_action,primary_motion:'The welding head advances continuously',physical_interaction:'The welding arc completes the structural seam',mid_shot_progression:'The completed seam lengthens behind the welding head'}} as SceneDirection;
  assert.deepEqual(directionSemanticIssues(direction),[]);
});

test('rejects manufacturing narration assigned to completed-product operational footage',()=>{
  const direction={...base,visual_family:'OPERATIONAL_CONTEXT',state:'C',alignment_claim:'Workers install and fasten the unfinished sensor mast inside the assembly hall',subject:'Completed vessel offshore',primary_action:'The vessel cruises through open water'} as SceneDirection;
  assert.ok(directionSemanticIssues(direction).includes('MANUFACTURING_AS_OPERATION_CONTRADICTION'));
});

test('does not grant legacy technical graphics a lifecycle-validation exemption',()=>{
  const direction={...base,visual_family:'TECHNICAL_GRAPHIC',state:'A',alignment_claim:'Signal waves show how the vessel searches offshore and keeps an operator connected',subject:'Text-free vessel and signal relationship',primary_action:'Signal waves extend between the vessel and operator',temporal_action:{...base.temporal_action,primary_motion:'One signal wave expands offshore',physical_interaction:'The wave connects the vessel and operator',mid_shot_progression:'The search coverage zone becomes visible'}} as SceneDirection;
  assert.ok(directionSemanticIssues(direction).includes('LIFECYCLE_CONTRADICTION'));
});

test('distinguishes the manufacturing verb install from an operational installation noun',()=>{
  assert.equal(isManufacturingVisualClaim('Workers install the sensor module inside the workshop'),true);
  assert.equal(isManufacturingVisualClaim('A compact machine moves beside an offshore installation'),false);
  assert.equal(isOperationalVisualClaim('A compact machine moves beside an offshore installation'),true);
});
