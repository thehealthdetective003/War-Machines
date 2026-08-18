import type { PlannedScene, SceneDirection } from '../types';

const OPERATIONAL_FAMILIES=new Set(['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','ENVIRONMENTAL_TESTING','DELIVERY_AND_ROLLOUT','HERO_PRODUCT']);
const GRAPHIC_FAMILIES=new Set(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN']);
const stop=new Set(['about','across','after','against','along','around','before','clearly','close','completed','detailed','from','into','m75','oceanalpha','object','scene','show','showing','system','through','visible','with']);
const semanticTokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{4,}/g)||[]).filter(token=>!stop.has(token)).map(token=>token.slice(0,7)));
export const isOperationalVisualClaim=(value:string)=>/\b(open water|at sea|offshore|coastal|waves?|pitches?|rolls?|cruises?|speed(?:ing)?|stable course|traffic|rescue|search(?:ing)?|tracking|deployed|launch|transit|horizon|navigat(?:e|es|ing)|patrol(?:s|ling)?|underway)\b/i.test(value)
  ||/\bcompleted\s+(?:product|boat|vessel|craft|vehicle|aircraft|platform|system)\b/i.test(value)
  ||/\b(?:product|boat|vessel|craft|vehicle|aircraft|platform|system)\s+(?:operates?|operating|operational)\b/i.test(value);
export const isManufacturingVisualClaim=(value:string)=>/\b(assembl(?:e|es|ing|y)|fabricat(?:e|es|ed|ing|ion)|weld(?:s|ed|ing)?|machin(?:e|es|ed|ing)|cutout|cut edge|cutting (?:tool|head|machine|operation)|trim(?:s|med|ming)?|drill(?:s|ed|ing)?|bond(?:s|ed|ing)?|install(?:s|ed|ing|ation)?|fasten(?:s|ed|ing)?|join(?:s|ed|ing)?|layup|mould(?:s|ed|ing)?|mold(?:s|ed|ing)?|cure(?:s|d|ing)?|fixture|jig|raw material|unfinished|workshop|production line)\b/i.test(value);

export function lifecycleAlignmentIssues(claim:string,visualFamily:string,state?:string):string[]{
  const operational=isOperationalVisualClaim(claim),manufacturing=isManufacturingVisualClaim(claim),familyOperational=OPERATIONAL_FAMILIES.has(visualFamily),familyGraphic=GRAPHIC_FAMILIES.has(visualFamily),issues:string[]=[];
  if(operational&&!familyOperational&&!familyGraphic)issues.push('LIFECYCLE_CONTRADICTION');
  if(operational&&familyOperational&&state&&state!=='C')issues.push('LIFECYCLE_CONTRADICTION');
  if(manufacturing&&familyOperational)issues.push('MANUFACTURING_AS_OPERATION_CONTRADICTION');
  return [...new Set(issues)];
}

export function plannedSceneSemanticIssues(scene:PlannedScene):string[]{
  const claim=String(scene.alignment_claim||'').trim();
  return claim?lifecycleAlignmentIssues(claim,String(scene.visual_family),scene.state):['MISSING_ALIGNMENT_CLAIM'];
}

export function validatePlannedSceneSemantics(scenes:PlannedScene[]):string[]{
  return scenes.flatMap(scene=>plannedSceneSemanticIssues(scene).map(issue=>`Scene ${scene.number}: ${issue}`));
}

export function directionSemanticIssues(direction:SceneDirection):string[]{
  const issues:string[]=[],claim=String(direction.alignment_claim||'').trim();
  if(!claim)return ['MISSING_ALIGNMENT_CLAIM'];
  const familyOperational=OPERATIONAL_FAMILIES.has(String(direction.visual_family));issues.push(...lifecycleAlignmentIssues(claim,String(direction.visual_family),direction.state));
  const creative=[direction.subject,direction.primary_action,direction.temporal_action?.opening_state,direction.temporal_action?.primary_motion,direction.temporal_action?.physical_interaction,direction.temporal_action?.mid_shot_progression,direction.temporal_action?.ending_state].filter(Boolean).join(' ');
  const expected=semanticTokens(claim),actual=semanticTokens(creative),common=[...expected].filter(token=>actual.has(token)).length;
  if(expected.size>=4&&(common<2||common/expected.size<0.24))issues.push('DIRECTION_ALIGNMENT_MISMATCH');
  if(familyOperational&&/\b(unfinished|raw shell|cutout|fabrication|workshop|assembly jig|technician installs?|worker measures?|trimming tool)\b/i.test(creative)&&!isOperationalVisualClaim(creative))issues.push('OPERATIONAL_ACTION_CONTRADICTION');
  return [...new Set(issues)];
}

export function validateDirectionSemantics(directions:SceneDirection[]):string[]{
  return directions.flatMap(direction=>directionSemanticIssues(direction).map(issue=>`Scene ${direction.number}: ${issue}`));
}
