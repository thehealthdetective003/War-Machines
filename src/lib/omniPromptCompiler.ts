import { OmniPromptSections, SceneDirection, T2VPrompt, TopicBrief } from '../types';
import { generatedClipDuration } from './sceneDuration';

const cleanSpace = (value: unknown) => String(value ?? '').replace(/\[object Object\]/gi, '').replace(/\s+/g, ' ').trim();
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' ? value.split(/\s*[|;]\s*/).map(cleanSpace).filter(Boolean) : [];
const commaStrings = (value:unknown):string[] => strings(value).flatMap(item=>item.split(/\s*,\s*/).map(cleanSpace).filter(Boolean));
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizedCameraValue = (value: unknown) => cleanSpace(value).toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim();
export const uniqueStrings = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap(strings).filter(value => { const normalized=key(value).replace(/^(no|avoid|exclude|without|do not show) /,''); if(!normalized||seen.has(normalized)) return false; seen.add(normalized); return true; });
};

const preferSpecific = (values: unknown[], limit = Number.POSITIVE_INFINITY): string[] => {
  const unique=uniqueStrings(values);
  return unique.filter((value,index)=>{
    const normalized=key(value);
    return !unique.some((other,otherIndex)=>otherIndex!==index&&key(other).includes(normalized)&&key(other).length>normalized.length);
  }).slice(0,limit);
};

const negativeTerm = (value: unknown): string => cleanSpace(value)
  .replace(/^(?:exclude|avoid|without)\s+/i,'')
  .replace(/^no\s+/i,'')
  .replace(/^do not\s+(?:show|include|use)\s+/i,'')
  .replace(/^do not\s+merge\s+/i,'merging ')
  .replace(/^do not\s+invent\s+/i,'invented ')
  .replace(/^do not\s+change\s+/i,'changes to ')
  .replace(/^do not\s+add\s+/i,'added ')
  .trim();

const sentence = (value: unknown): string => {
  let text=cleanSpace(value).replace(/\s+([,.;:!?])/g,'$1').replace(/([,.;:!?])\1+/g,'$1').replace(/\s*[,;:]\s*$/,'').trim();
  text=text.replace(/\b(?:and|or|of|for|on|the|with|to|from|while|but|a|an)\s*[.!?]?$/i,'').trim();
  if(!text) return '';
  text=text[0].toUpperCase()+text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const scaleMap:Array<[RegExp,string]>=[
  [/\bextreme\s+wide\b/i,'extreme-wide'],[/\bmedium\s+close\s*up\b/i,'medium close-up'],[/\bmedium\s+wide\b/i,'medium-wide'],[/\bclose\s*up\b/i,'close-up'],[/\bmacro\b/i,'macro close-up'],[/\bwide\b/i,'wide'],[/\bmedium\b/i,'medium'],
];
const movementMap: Array<[RegExp,string]> = [
  [/\b(?:lock(?:ed)?|static|stationary|tripod)\b/i,'locked camera'],[/\bpan\b/i,'slow pan'],[/\b(?:push|move)\s*-?in\b/i,'slow push-in'],[/\b(?:pull|move)\s*-?back\b/i,'slow pull-back'],[/\b(?:crane|rise|aerial)\b/i,'restrained crane rise'],[/\blateral\s+dolly\b/i,'slow lateral dolly'],[/\blateral\s+(?:track|tracking)\b/i,'slow lateral tracking movement'],[/\bdolly\b/i,'slow dolly'],[/\btrack(?:ing)?\b|\bfollow(?:ing)?\b/i,'restrained tracking movement'],
];
const mapped = (value:string,map:Array<[RegExp,string]>) => map.find(([pattern])=>pattern.test(value))?.[1];
const naturalList=(items:string[])=>items.length<2?(items[0]||''):items.length===2?`${items[0]} and ${items[1]}`:`${items.slice(0,-1).join(', ')}, and ${items.at(-1)}`;
const viewPattern = (viewpoint:string) => viewpoint.includes('rear')?/(tail|fin|stabil|engine|rotodome|hook|rear)/i:viewpoint.includes('front')?/(forward|nose|wing|engine|nacelle|rotodome|gear|front)/i:viewpoint.includes('side')?/(proportion|wing|engine|rotodome|gear|fuselage|side)/i:viewpoint.includes('interior')?/(interior|cockpit|cabin|bay|rack|panel|interface)/i:viewpoint.includes('overhead')?/(planform|wing|span|roof|top|rotodome|layout)/i:null;
const rankedUnique=(items:Array<{value:unknown;score:number}>,limit:number)=>{
  const best=new Map<string,{value:string;score:number;order:number}>();let order=0;
  items.forEach(item=>strings(item.value).forEach(value=>{const normalized=key(value);const score=item.score+(/\b(?:exactly|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(value)?25:0);const current=best.get(normalized);if(!current||score>current.score)best.set(normalized,{value,score,order:order++});}));
  return [...best.values()].sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,limit).map(item=>item.value);
};

export interface ResolvedProductionScene {
  stage: any;
  environment: any;
  geometryModules: any[];
  references: any[];
  transition: any;
  identity: string[];
  present: string[];
  absent: string[];
  exposed: string[];
  forbidden: string[];
  confirmed: string[];
  inferred: string[];
  camera: { shotScale:string; lens:string; viewpoint:string; behavior:string; speed:string; movementCount:number; contradictions:string[] };
}

export function resolveProductionScene(topic: TopicBrief | null, direction: SceneDirection): ResolvedProductionScene {
  const handoff=(topic as any)?._production_handoff || {};
  const stages=Array.isArray(handoff.production_stages)?handoff.production_stages:[];
  const stage=stages.find((item:any)=>item.stage_id===direction.stage_id) || {};
  const environments=Array.isArray(handoff.environments)?handoff.environments:[];
  const environment=environments.find((item:any)=>item.environment_id===direction.environment_ref) || {};
  const modules=Array.isArray(handoff.geometry_modules)?handoff.geometry_modules:[];
  const moduleIds=[stage.geometry_control?.primary_geometry_module_id,...(stage.geometry_control?.secondary_geometry_module_ids||[])].filter(Boolean);
  const geometryModules=modules.filter((item:any)=>moduleIds.includes(item.module_id));
  const references=(handoff.reference_assets||[]).filter((item:any)=>(stage.visual_evidence?.reference_asset_ids||[]).includes(item.asset_id));
  const transition=(handoff.stage_transitions||[]).find((item:any)=>item.from_stage_id===direction.stage_id)||{};
  const guidance=stage.camera_guidance||{};
  const stageViews=strings(guidance.preferred_views).map(normalizedCameraValue);
  const stageScales=strings(guidance.safe_shot_scales).map(value=>mapped(normalizedCameraValue(value),scaleMap)).filter(Boolean) as string[];
  const stageMovements=strings(guidance.preferred_camera_movements).map(value=>mapped(normalizedCameraValue(value),movementMap)).filter(Boolean) as string[];
  const forbiddenMovements=strings(guidance.forbidden_camera_movements).map(normalizedCameraValue);
  const scaleInput=normalizedCameraValue(direction.camera.shot_scale);
  const lensInput=normalizedCameraValue(direction.camera.lens);
  const viewpointInput=normalizedCameraValue(direction.camera.angle);
  const movementInput=normalizedCameraValue(direction.camera.movement);
  const rawCamera=`${scaleInput} ${lensInput} ${viewpointInput} ${movementInput}`;
  const rawDirectionMovements=movementMap.filter(([pattern])=>pattern.test(movementInput)).map(([,label])=>label);
  const directionMovements=rawDirectionMovements.some(label=>label==='slow lateral tracking movement')
    ? rawDirectionMovements.filter(label=>label!=='restrained tracking movement')
    : rawDirectionMovements.some(label=>label==='slow lateral dolly')
      ? rawDirectionMovements.filter(label=>label!=='slow dolly')
      : rawDirectionMovements;
  const contradictions:string[]=[];
  if(/static|locked/.test(rawCamera)&&/track|dolly|pan|push|pull|crane/.test(rawCamera)) contradictions.push('Locked/static camera conflicts with camera movement.');
  if(/macro/.test(rawCamera)&&/wide|medium-wide/.test(rawCamera)) contradictions.push('Macro conflicts with a wide shot scale.');
  if(/wide-angle/.test(rawCamera)&&/\b(?:50|85|100|135)\s*mm/.test(rawCamera)) contradictions.push('Wide-angle conflicts with the supplied focal length.');
  if(/close-up/.test(rawCamera)&&/establishing/.test(rawCamera)) contradictions.push('Close-up conflicts with an establishing view.');
  const requestedScale=mapped(scaleInput,scaleMap);
  const shotScale=requestedScale&&(!stageScales.length||stageScales.includes(requestedScale))?requestedScale:(stageScales[0]||'medium-wide');
  const focal=lensInput.match(/\b(\d{2,3})\s*mm\b/)?.[1];
  const lens=focal?(Number(focal)<=35?'wide-angle':Number(focal)<=60?'normal':Number(focal)<=100?'short telephoto':'long telephoto'):(/wide/.test(lensInput)?'wide-angle':/long\s+telephoto/.test(lensInput)?'long telephoto':/telephoto/.test(lensInput)?'short telephoto':/normal|standard/.test(lensInput)?'normal':'normal');
  const viewpoint=viewpointInput||stageViews[0]||'side profile';
  const viewpointWords=viewpoint.toLowerCase();
  const viewTerms=viewPattern(viewpointWords);
  const identityCandidates=[
    ...direction.required_visible_features.map(value=>({value,score:120+(viewTerms?.test(value)?30:0)})),
    ...strings(stage.geometry_control?.required_visible_anchors).map(value=>({value,score:105+(viewTerms?.test(value)?30:0)})),
    ...geometryModules.flatMap((item:any)=>strings(item.required_visible_features).map(value=>({value,score:90+(viewTerms?.test(value)?30:0)}))),
    ...strings(handoff.product?.immutable_identity_features).map(value=>({value,score:65+(viewTerms?.test(value)?30:0)})),
  ];
  const identity=rankedUnique(identityCandidates,6);
  const movementConflict=directionMovements.length>1||(/static|locked|tripod/.test(movementInput)&&/track|dolly|pan|push|pull|crane/.test(movementInput));
  let behavior=(!movementConflict?directionMovements[0]:undefined)||(stageMovements[0]||'locked camera');
  const movementKeywords=key(behavior).split(' ').filter(word=>!['slow','restrained','camera','movement'].includes(word));
  if(forbiddenMovements.some(item=>movementKeywords.some(word=>item.includes(word))))behavior='locked camera';
  const speed=/^(?:none|n\/a|static|locked)?$/i.test(cleanSpace(direction.camera.movement_speed))?'':normalizedCameraValue(direction.camera.movement_speed);
  return {
    stage,environment,geometryModules,references,transition,
    identity,
    present:uniqueStrings([stage.present_now,direction.required_visible_features]),
    absent:uniqueStrings([stage.not_yet_installed,direction.forbidden_elements]),
    exposed:uniqueStrings([stage.temporarily_exposed,stage.open_interfaces,stage.unfinished_edges_or_sections]),
    forbidden:uniqueStrings([stage.geometry_control?.negative_constraints,stage.geometry_control?.forbidden_transformations,stage.stage_actions?.flatMap((a:any)=>a.forbidden_actions||[]),environment.forbidden_elements,direction.forbidden_elements]),
    confirmed:uniqueStrings([stage.visual_evidence?.confirmed_visual_details]), inferred:uniqueStrings([stage.visual_evidence?.analyst_inferred_visual_details]),
    camera:{ shotScale, lens, viewpoint, behavior, speed, movementCount:directionMovements.length, contradictions },
  };
}

const productName=(topic:TopicBrief|null):string=>{
  const product=(topic as any)?._production_handoff?.product;
  const official=cleanSpace(product?.official_name);
  const variant=cleanSpace(product?.exact_variant);
  return variant&&official&&key(variant).startsWith(key(official))?variant:[official,variant].filter(Boolean).join(' ')||topic?.topic.product||topic?.topic.title||'product';
};

export function canonicalIdentitySignature(topic:TopicBrief|null):string {
  const product=(topic as any)?._production_handoff?.product;
  const handoff=(topic as any)?._production_handoff||{};
  const name=productName(topic);
  const fullModule=(handoff.geometry_modules||[]).find((item:any)=>item.module_id==='FULL_PRODUCT')||(handoff.geometry_modules||[])[0]||{};
  const dimensions=handoff.dimensions_and_proportions||{};
  const dimensionParts=[['overall length',dimensions.overall_length],['overall width or wingspan',dimensions.overall_width_or_wingspan],['overall height',dimensions.overall_height]].flatMap(([label,measurement]:any)=>measurement?.value!==null&&measurement?.value!==undefined?[`${label} ${measurement.value}${measurement.unit?` ${measurement.unit}`:''}`]:[]);
  const immutable=preferSpecific([product?.immutable_identity_features],4);
  const geometry=preferSpecific([fullModule.required_visible_features],4);
  const proportions=preferSpecific([dimensions.important_proportion_rules,dimensionParts,dimensions.human_scale_reference],3);
  const anchors=preferSpecific([
    preferSpecific([product?.overall_visual_description],1),
    immutable.slice(0,2),
    geometry.slice(0,2),
    proportions.slice(0,2),
  ],7);
  return sentence(anchors.length?`Preserve the same exact ${name} design in every clip: ${naturalList(anchors)}`:`Preserve the same exact ${name} design and proportions in every clip`);
}

function viewpointIdentitySentence(resolved:ResolvedProductionScene):string {
  const anchors=preferSpecific(resolved.identity,4);
  return anchors.length?sentence(`From this ${resolved.camera.viewpoint} viewpoint, keep ${naturalList(anchors)} clearly visible`):'';
}

function stateSentence(direction:SceneDirection,resolved:ResolvedProductionScene,topic:TopicBrief|null):string {
  const presentItems=preferSpecific(resolved.present,5),absentItems=preferSpecific(resolved.absent,5),exposedItems=preferSpecific(resolved.exposed,4);
  const present=presentItems.length?`show ${naturalList(presentItems)}`:`show ${direction.product_visual_state}`;
  const absent=absentItems.length?` Do not show ${naturalList(absentItems)}`:'';
  const exposed=exposedItems.length?` Keep ${naturalList(exposedItems)} visibly unfinished or exposed`:'';
  return sentence(`Keep the underlying ${productName(topic)} proportions stable. Show only the incomplete State ${direction.state} configuration: ${present}.${exposed}.${absent}`.replace(/\.\s*\./g,'. '));
}

const showdownPurpose=(direction:SceneDirection):string=>{
  switch(direction.showdown_role){
    case 'ANTICIPATION':return 'Begin in controlled stillness and reveal operational scale without premature spectacle';
    case 'GROUND_REVEAL':return 'Establish the aircraft as a real operational machine at rest with clear scale';
    case 'HUMAN_SCALE':return 'Use restrained professional personnel or support equipment to communicate aircraft scale';
    case 'PREPARATION':return 'Show one visible readiness action progressing toward operation';
    case 'DEPARTURE':return 'Progress from grounded movement into one credible takeoff, hover transition, or climb';
    case 'AIRBORNE_ESTABLISHMENT':return 'Establish stable forward flight clearly within the surrounding airspace';
    case 'PERFORMANCE_PASS':return 'Show one readable coordinated pass or bank without changing configuration';
    case 'COCKPIT_IMMERSION':return 'Communicate maneuver forces through a restrained operator, moving horizon, vibration, and canopy reflections';
    case 'ENVIRONMENTAL_SPECTACLE':return 'Use only physically caused cloud, vapor, heat haze, dust, spray, airflow, or downwash as spectacle';
    case 'OPERATIONAL_RESET':return 'Return to grounded preparation or inspection and reveal new operational information';
    case 'SECOND_PEAK':return 'Increase at least two supported dimensions of proximity, speed cue, maneuver intensity, formation scale, environmental response, or operator immersion';
    case 'CONTROLLED_RETURN':return 'Reduce intensity through stable approach, landing, taxi, or subdued ground movement';
    default:return '';
  }
};

const graphicCompositionPhrase=(value:string):string=>({
  SINGLE_SUBJECT:'one dominant simplified subject with generous negative space',
  ORTHOGRAPHIC_CUTAWAY:'a clear orthographic cutaway with exposed layers kept visually separate',
  LEFT_TO_RIGHT_FLOW:'a clean left-to-right process composition',
  LAYERED_SEPARATION:'parallel layers separated along one stable axis',
  TWO_PANEL_COMPARISON:'two balanced text-free panels on one shared visual baseline',
  CONCENTRIC_SIGNAL_FIELD:'a top-down concentric signal field with one source and one response',
  SCHEMATIC_FACTORY:'a layered schematic factory with restrained foreground machinery and one central process',
  SYMBOLIC_ROUTE:'a symbolic route through broad geometric terrain without cartographic detail',
  MATCHED_SHAPE_TRANSITION:'one centered geometric form held as a stable transition anchor',
} as Record<string,string>)[value]||'one clear technical composition';
const graphicMotionPhrase=(value:string):string=>({
  MINIMAL_PARALLAX:'Use only minimal parallax and a restrained light pass',
  HIGHLIGHT_PULSE:'Pulse one clean highlight once around the relevant feature',
  FLOW_DRAW_ON:'Draw one directional flow progressively through the composition',
  COMPONENT_TRANSLATION:'Move one component along one mechanically credible path',
  LAYER_SEPARATION:'Separate the layers gently while preserving alignment and proportions',
  SIGNAL_SWEEP:'Rotate one restrained signal sweep while source and target remain fixed',
  HEAT_ZONE_PROGRESSION:'Progress one clean cool-to-warm energy zone through the mechanism',
  CONTROLLED_ASSEMBLY:'Move one tool or component through one controlled assembly interaction',
  MATCH_ANCHOR:'Move gently toward the centered transition shape without morphing it',
} as Record<string,string>)[value]||'Keep all geometry stable';
const graphicAnnotationPhrase=(values:string[]):string=>values.map(value=>({
  DIRECTIONAL_ARROWS:'simple directional arrows',FLOW_LINES:'clean flow lines',HIGHLIGHT_RING:'one highlight ring',
  COLORED_ZONE:'one colored emphasis zone',SIGNAL_WAVES:'simple signal waves',MEASUREMENT_BASELINE:'an unlabeled measurement baseline',
} as Record<string,string>)[value]||'').filter(Boolean).join(' and ');

export function normalizeOmniSections(raw:any,direction:SceneDirection,topic:TopicBrief|null):{sections:OmniPromptSections;resolved:ResolvedProductionScene} {
  const resolved=resolveProductionScene(topic,direction);
  const treatment=direction.visual_treatment||'LIVE_ACTION_T2V';
  const visibility=direction.product_visibility||(direction.state==='C'?'FULL':'PARTIAL');
  const operational=['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(direction.visual_family||'');
  const productClass=`${(topic as any)?._production_handoff?.product?.product_class||''} ${productName(topic)} ${direction.primary_action}`.toLowerCase();
  const inferred=resolved.inferred.length&&cleanSpace(direction.environment_description).length<45?`Use a plausible non-identifying production environment; do not invent proprietary internal layouts`:'';
  const factory=/factory|assembly|production|hangar|workshop/i.test(`${direction.environment_description} ${resolved.environment?.facility_type||''}`);
  const carrier=/carrier|maritime|deck/i.test(direction.environment_description);
  const sound=treatment!=='LIVE_ACTION_T2V'?'Use restrained abstract documentary sound design synchronized only to the visible graphic motion':operational&&/helicopter|rotorcraft|rotor/.test(productClass)?'Generate synchronized rotor, engine, airflow, and environmental sound, including physically matched downwash where visible':operational&&/aircraft|airplane|fighter|jet|uas|uav|drone/.test(productClass)?'Generate synchronized propulsion, airflow, wind, and control-surface sound appropriate to the maneuver':carrier?'Generate synchronized maritime deck ambience with wind, distant machinery, restrained deck-equipment movement, and physically matched mechanical sound':factory?'Generate synchronized factory ambience with distant ventilation, restrained machinery hum, soft tool contact, and subtle footsteps':'Generate realistic synchronized environmental and mechanical ambience appropriate to the visible action';
  const rawSubject=cleanSpace(raw?.subject)||direction.subject;
  const rawEnvironment=cleanSpace(raw?.environment)||direction.environment_description;
  const rawStyle=cleanSpace(raw?.style_lighting)||direction.lighting_and_material;
  const coveredStateTerms=new Set((direction.state==='C'?[]:[...resolved.present,...resolved.absent,...resolved.exposed]).map(key));
  ['dialogue','narration','music','readable generated text'].forEach(value=>coveredStateTerms.add(key(value)));
  const exclusionCandidates=[
    ...direction.forbidden_elements.map(value=>({value,score:120})),
    ...strings(resolved.stage.geometry_control?.forbidden_transformations).map(value=>({value,score:110})),
    ...strings(resolved.stage.geometry_control?.negative_constraints).map(value=>({value,score:100})),
    ...(resolved.stage.stage_actions||[]).flatMap((action:any)=>strings(action.forbidden_actions).map(value=>({value,score:90}))),
    ...strings(resolved.environment.forbidden_elements).map(value=>({value,score:80})),
    ...commaStrings(raw?.exclusions).map(value=>({value,score:60})),
  ].filter(item=>!coveredStateTerms.has(key(String(item.value))));
  const cleanExclusions=preferSpecific(rankedUnique(exclusionCandidates,7).map(negativeTerm).filter(Boolean),6);
  const speedAlreadyExpressed=resolved.camera.speed==='slow'&&resolved.camera.behavior.startsWith('slow ');
  const speedClause=resolved.camera.speed&&resolved.camera.behavior!=='locked camera'&&!speedAlreadyExpressed?` at ${resolved.camera.speed} speed`:'';
  const temporal=direction.temporal_action;
  const temporalAction=temporal?`${temporal.opening_state}. ${temporal.primary_motion}; ${temporal.physical_interaction}. Mid-shot, ${temporal.mid_shot_progression}. End with ${temporal.ending_state}`:cleanSpace(raw?.action)||direction.primary_action;
  const showdownAction=showdownPurpose(direction);
  const platform=direction.camera_platform?.toLowerCase().replaceAll('_',' ');
  const graphicSpec=direction.graphic_spec;
  const graphicAnnotations=graphicSpec?graphicAnnotationPhrase(graphicSpec.annotation_devices):'';
  const graphicAction=graphicSpec?`Use the opening quarter to establish the complete composition. ${graphicMotionPhrase(graphicSpec.motion_pattern)} while moving no more than ${graphicSpec.maximum_animated_elements} elements and keeping the background and major geometry fixed. Resolve the single relationship through the middle half, then hold the completed graphic steadily for the final quarter`:temporalAction;
  const moduleIdentity=preferSpecific(resolved.identity,2);
  const productState=visibility==='NONE'?'':visibility==='DETAIL_ONLY'?(moduleIdentity.length?sentence(`Show only this component detail: ${naturalList(moduleIdentity)}`):sentence(direction.product_visual_state)):visibility==='FULL'?[canonicalIdentitySignature(topic),viewpointIdentitySentence(resolved)].filter(Boolean).join(' '):stateSentence(direction,resolved,topic);
  const graphicSubject=treatment==='STATIC_GRAPHIC_T2V'?'An unlabeled documentary technical composition of clean geometric forms and material layers':treatment==='MOTION_GRAPHIC_T2V'?'An unlabeled documentary motion graphic of components, paths, layers, and mechanical relationships':'';
  const sections:OmniPromptSections={
    cinematography:graphicSpec?`Use a stable 16:9 flat vector composition with ${graphicCompositionPhrase(graphicSpec.composition)} and no orbit, handheld motion, lens change, or artificial depth distortion`:treatment==='STATIC_GRAPHIC_T2V'?'Use a stable orthographic documentary composition with only minimal parallax and a restrained light pass':treatment==='MOTION_GRAPHIC_T2V'?'Use a stable technical viewpoint with one controlled graphic camera drift':`${platform?`Film from a physically credible ${platform}. `:''}Use a ${resolved.camera.shotScale} ${resolved.camera.viewpoint} view on a ${resolved.camera.lens} lens, with one ${resolved.camera.behavior}${speedClause}`,
    subject:graphicSpec?`Create a premium technical vector explainer for one claim: ${graphicSpec.visual_claim}${graphicAnnotations?`, using ${graphicAnnotations}`:''}`:graphicSubject||(/\b(?:is|are|stands|sits|rests|remains|appears|moves|shows)\b/i.test(rawSubject)?rawSubject:`The scene shows ${rawSubject}`),
    action:[showdownAction,graphicAction].filter(Boolean).join('. '),
    environment:treatment==='LIVE_ACTION_T2V'?[/\b(?:is|are|inside|within|across|on the|in the)\b/i.test(rawEnvironment)?rawEnvironment:`Set the shot in ${rawEnvironment}`,inferred].filter(Boolean).join('. '):'Use a clean neutral technical space with no literal factory set, map, interface, or readable annotation',
    style_lighting:graphicSpec?'Use geometric silhouettes, minimal texture, restrained outlines, two- or three-tone cel shading, pale cyan and sky blue, cool gray and charcoal, one red annotation accent, and limited yellow-orange only for active heat or energy':treatment==='LIVE_ACTION_T2V'?(/^(?:use|render|light|keep)\b/i.test(rawStyle)?rawStyle:`Use ${rawStyle}`):'Use restrained documentary colors, precise edges, controlled depth, and physically plausible material shading',
    product_state:productState,
    sound,
    exclusions:naturalList(uniqueStrings([cleanExclusions,treatment!=='LIVE_ACTION_T2V'?['readable labels','numbers','logos','maps','fake user interfaces','precise generated data']:[],graphicSpec?['blank label cards or editor placeholders','typography or speech bubbles','photorealistic or cinematic 3D materials','moving backgrounds','morphing or duplicated geometry','childish cartoon proportions']:[],visibility==='NONE'?['the finished product or product silhouette']:[],operational?['weapon discharge','explosions or active combat','impossible aerobatics','changing product configuration','invented unit markings','exact event recreation','identifiable location claims']:[],direction.showdown_role?['morphing aircraft geometry','impossible camera paths','camera passing through the aircraft','unnatural sideways sliding','unverified flares or external stores']:[]])),
  };
  return {sections,resolved};
}

export function compileOmniPrompt(sections:OmniPromptSections,direction:SceneDirection):string {
  const parts=[`${Number(generatedClipDuration(direction).toFixed(3))}-second continuous shot.`,sentence(sections.cinematography),sentence(sections.subject),sentence(sections.action),sentence(sections.environment),sentence(sections.style_lighting),sentence(sections.product_state),sentence(sections.sound),sentence('Exclude dialogue, narration, music, and readable generated text'),sections.exclusions?sentence(`Exclude ${sections.exclusions.replace(/^(exclude|no|avoid)\s+/i,'')}`):''];
  const seen=new Set<string>();
  return parts.filter(Boolean).filter(part=>{const normalized=key(part);if(seen.has(normalized))return false;seen.add(normalized);return true;}).join(' ').replace(/\s+/g,' ').replace(/\.\s*\./g,'.').replace(/Exclude\s+(?:Do not|No|Avoid)\s+/gi,'Exclude ').trim();
}

export function recompileOmniPrompts(prompts:T2VPrompt[],directions:SceneDirection[],topic:TopicBrief|null):T2VPrompt[] {
  const byNumber=new Map(directions.map(direction=>[direction.number,direction]));
  return prompts.map(prompt=>{
    const direction=byNumber.get(prompt.number);
    if(!direction)return prompt;
    const {sections}=normalizeOmniSections(prompt.omniSections||{},direction,topic);
    return {...prompt,video_prompt:compileOmniPrompt(sections,direction),voiceover:direction.voiceover,omniSections:sections};
  }).sort((a,b)=>a.number-b.number);
}
