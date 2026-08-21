import { AppState, T2VPrompt } from '../types';
import { resplitTranscription } from './timedTranscript';
import { ensureRequiredVisibleFeatures, validateSceneDirections } from './sceneDirections';
import { deriveGraphicSceneSpec, resolvePlannedState } from './scenePlanner';
import { projectOrTranscriptSceneDuration } from './sceneDuration';
import { normalizeGenerationSession } from './generationSession';
import { createResumableProductionSession, synchronizeProductionSession } from './productionSession';

export type MigrationResult = { state: AppState | null; message?: string; error?: string };

export function projectSceneDuration(raw: any, fallback: number): number {
  return projectOrTranscriptSceneDuration(raw, fallback);
}

export function migrateProject(raw: any, initial: AppState, sceneDuration: number): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state: null, error: 'Invalid project file.' };
  if (raw.projectFormat && raw.projectFormat !== 'standard-lifecycle') return { state: null, error: 'Unsupported production format.' };
  if (raw.creationMode && raw.creationMode !== 'standard-pacing') return { state: null, error: 'Rapid and Hybrid projects are no longer supported.' };

  sceneDuration = projectSceneDuration(raw, sceneDuration);
  let transcription = raw.voiceoverTranscription || null;
  let timingChanged = false;
  if (transcription && transcription.sceneDurationSeconds !== sceneDuration) {
    transcription = resplitTranscription(transcription, sceneDuration);
    timingChanged = true;
  }
  const rawPlan = Array.isArray(raw.plannedScenes) ? raw.plannedScenes.map((item:any,index:number)=>{
    const base={...item,state:resolvePlannedState(raw.topic,item?.stage_id,item?.product_visibility)};
    const timed=transcription?.scenes?.find((scene:any)=>Number(scene.number)===Number(item?.number))||transcription?.scenes?.[index];
    return {...base,graphic_spec:item?.graphic_spec??(timed?deriveGraphicSceneSpec(raw.topic,timed,base):null),alignmentFingerprint:item?.alignmentFingerprint||(raw.projectSchemaVersion<14?'legacy-preserved-v13':undefined)};
  }) : [];
  const showdownRoles=['ANTICIPATION','GROUND_REVEAL','HUMAN_SCALE','PREPARATION','DEPARTURE','AIRBORNE_ESTABLISHMENT','PERFORMANCE_PASS','COCKPIT_IMMERSION','ENVIRONMENTAL_SPECTACLE','OPERATIONAL_RESET','SECOND_PEAK','CONTROLLED_RETURN'];
  const cameraPlatforms=['GROUND_TRIPOD','GROUND_HANDHELD','RUNWAY_LONG_LENS','DISTANT_OBSERVATION','CHASE_AIRCRAFT','COCKPIT_MOUNTED','CANOPY_SIDE','VEHICLE_OR_DECK_MOUNTED'];
  const graphicSubtypes=['COMPONENT_HIGHLIGHT','TECHNICAL_CUTAWAY','PROCESS_FLOW','MECHANICAL_RELATIONSHIP','LAYER_EXPLANATION','SCALE_COMPARISON','SENSOR_SIGNAL','HEAT_OR_ENERGY_FLOW','FACTORY_SCHEMATIC','SYMBOLIC_LOCATION','CONCEPTUAL_TRANSITION'];
  const graphicSpecValid=(item:any)=>item?.graphic_spec===null||(
    graphicSubtypes.includes(item?.graphic_spec?.graphic_subtype)&&item?.graphic_spec?.visual_claim&&item?.graphic_spec?.composition&&item?.graphic_spec?.motion_pattern
    &&Array.isArray(item?.graphic_spec?.annotation_devices)&&[1,2,3].includes(item?.graphic_spec?.maximum_animated_elements)&&item?.graphic_spec?.text_policy==='NO_GENERATED_TEXT'
  );
  // Schema 12 introduces global monotonic chapter alignment, lifecycle-aware
  // VO fallback routing, and a semantic gate before directions can reach Phase 3.
  const seenPlanNumbers=new Set<number>();
  const planValid = raw.projectSchemaVersion >= 12 && !!transcription && rawPlan.length <= transcription.scenes.length && rawPlan.every((item:any)=>{
    const number=Number(item?.number),validNumber=Number.isInteger(number)&&number>=1&&number<=transcription.scenes.length&&!seenPlanNumbers.has(number);if(validNumber)seenPlanNumbers.add(number);
    return validNumber&&item?.chapter_id&&item?.beat_id&&item?.visual_family&&item?.story_function&&item?.visual_treatment&&item?.product_visibility&&item?.stage_id&&item?.environment_ref&&['A','B','C'].includes(item?.state)
    &&(item?.showdown_role===null||showdownRoles.includes(item?.showdown_role))&&['LOW','MEDIUM','HIGH'].includes(item?.energy_level)
    &&(item?.camera_platform===null||cameraPlatforms.includes(item?.camera_platform))&&graphicSpecValid(item)&&['ENGINE_BEAT','VO_FALLBACK'].includes(item?.alignment_source)
    &&typeof item?.alignment_claim==='string'&&Array.isArray(item?.reference_asset_ids)&&Array.isArray(item?.required_visible_features)&&Array.isArray(item?.forbidden_elements)&&Array.isArray(item?.continuity_requirements);
  });
  const rawDirections = Array.isArray(raw.sceneDirections) ? raw.sceneDirections : [];
  const planByNumber = new Map(rawPlan.map((item:any)=>[Number(item.number),item]));
  const repairedDirections = planValid ? rawDirections.map((item:any)=>{
    const plan:any=planByNumber.get(Number(item?.number));
    return plan ? {...item,generation_duration_seconds:sceneDuration,chapter_id:plan.chapter_id,beat_id:plan.beat_id,visual_family:plan.visual_family,story_function:plan.story_function,visual_treatment:plan.visual_treatment,product_visibility:plan.product_visibility,showdown_role:plan.showdown_role,energy_level:plan.energy_level,camera_platform:plan.camera_platform,graphic_spec:plan.graphic_spec,reference_asset_ids:plan.reference_asset_ids,alignment_source:plan.alignment_source,alignment_confidence:plan.alignment_confidence,alignment_claim:plan.alignment_claim,stage_id:plan.stage_id,environment_ref:plan.environment_ref,state:plan.state,required_visible_features:ensureRequiredVisibleFeatures(item,plan),forbidden_elements:[...new Set([...(plan.forbidden_elements||[]),...(item.forbidden_elements||[])])],operationFingerprint:item.operationFingerprint||(raw.projectSchemaVersion<14?'legacy-preserved-v13':undefined)} : item;
  }) : rawDirections;
  const directionPrefixValid = planValid && !!transcription && repairedDirections.length <= transcription.scenes.length&&validateSceneDirections(repairedDirections,transcription.scenes,rawPlan,sceneDuration,{allowPartial:true}).length===0;
  const directionsValid = directionPrefixValid && repairedDirections.length === transcription.scenes.length;
  const imageMode = raw.phase4Mode === 'image-animation';
  const legacyVeoProject=raw.t2vPromptProfile==='veo-flow';
  const rawPrompts = Array.isArray(raw.visualPrompts) ? raw.visualPrompts : [];
  const promptNumbers = new Set<number>();
  const promptsCompatible = raw.projectSchemaVersion >= 12 && directionPrefixValid && rawPrompts.every((item:any) => {
    const number = Number(item?.number);
    const valid = Number.isInteger(number) && repairedDirections.some((direction:any)=>Number(direction.number)===number) && !promptNumbers.has(number) && typeof item?.video_prompt === 'string' && item.video_prompt.trim();
    if (valid) promptNumbers.add(number);
    return Boolean(valid);
  });
  const compatiblePrompts: T2VPrompt[] = directionPrefixValid && !imageMode && promptsCompatible
    ? rawPrompts.map((item: any) => {
        const number=Number(item.number);
        const base:T2VPrompt={
        number, stage_id: item.stage_id || item.stage_ref, state: item.state,
        continuity_notes: item.continuity_notes, quality_flags: item.quality_flags,
        action_description: String(item.action_description || ''), video_prompt: String(item.video_prompt || ''),
        voiceover: transcription.scenes[number - 1]?.text || '', stock_keywords: String(item.stock_keywords || ''),
        omniSections:item.omniSections,operationFingerprint:raw.projectSchemaVersion<15?'legacy-preserved-v13':item.operationFingerprint,generationSource:item.generationSource||(raw.projectSchemaVersion<15?'LEGACY':undefined),
      };
      return base;
    })
    : [];
  const preserveOutput = compatiblePrompts.length > 0;
  const productionComplete=!!transcription&&compatiblePrompts.length===transcription.scenes.length&&directionsValid;
  const phase = productionComplete?3:(raw.topic&&transcription?2:1);
  let generationSession = normalizeGenerationSession(raw.generationSession,compatiblePrompts.length);
  if(raw.projectSchemaVersion<13||!generationSession.batches.length)generationSession=createResumableProductionSession(transcription?.scenes||[],planValid?rawPlan:[],directionPrefixValid?repairedDirections:[],compatiblePrompts);
  if (!raw.generationSession && directionsValid && compatiblePrompts.length === repairedDirections.length && compatiblePrompts.length > 0) {
    generationSession.status = 'complete';
    generationSession.completedScenes = compatiblePrompts.length;
  }
  const state: AppState = {
    ...initial,
    id: raw.id,
    projectName: raw.projectName || initial.projectName,
    handoffFileName:raw.handoffFileName,
    projectFormat: 'standard-lifecycle',
    phase: phase as 1 | 2 | 3,
    topic: raw.topic || null,
    masterVoiceoverScript: transcription?.text || '',
    voiceoverTranscription: transcription,
    plannedScenes: planValid ? rawPlan : [],
    sceneDirections: directionPrefixValid ? repairedDirections : [],
    visualPrompts: preserveOutput ? compatiblePrompts.sort((a,b)=>a.number-b.number) : [],
    generationSession,
    projectSchemaVersion: 15,
  };
  generationSession=synchronizeProductionSession(generationSession,state);state.generationSession=productionComplete?{...generationSession,status:'complete',operation:'COMPLETE'}:generationSession;
  const reset = timingChanged || imageMode || (!directionPrefixValid && repairedDirections.length > 0) || (rawPrompts.length > 0 && !preserveOutput);
  const planningUpgrade = raw.projectSchemaVersion < 12 && rawPlan.length > 0;
  const resumableDirections = directionPrefixValid && (repairedDirections.length < (transcription?.scenes.length || 0)||compatiblePrompts.length<repairedDirections.length);
  return { state, message: planningUpgrade
    ? 'Project content and transcript were preserved. Phase 2 output was reset for global chapter, lifecycle, and VO/visual realignment.'
    : resumableDirections ? `Restored durable production work: ${repairedDirections.length} directions and ${compatiblePrompts.length} prompts. Resume from ${state.generationSession.operation.replaceAll('_',' ')}.${legacyVeoProject?' Future generation now uses Omni Flash.':''}`
    : legacyVeoProject ? 'Legacy project imported safely. Compatible historical prompts were preserved; future generation uses Omni Flash.'
    : reset && raw.topic ? 'Project migrated to the timestamped T2V pipeline; incompatible downstream output was reset.' : undefined };
}
