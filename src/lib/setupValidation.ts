import type { AppState } from '../types';
import { validateVisualProductionHandoff } from './handoffValidation';
import { positiveSceneDuration } from './sceneDuration';

export interface ProductionReadiness { ready:boolean; errors:string[]; warnings:string[]; }

export function validateProductionReadiness(state:Pick<AppState,'topic'|'voiceoverTranscription'|'plannedScenes'|'sceneDirections'|'visualPrompts'>):ProductionReadiness{
  const errors:string[]=[],warnings:string[]=[];
  if(!state.topic)errors.push('Import and validate the Engine / Visual Production Handoff JSON.');
  else {const handoff=validateVisualProductionHandoff(state.topic);if(!handoff.valid)errors.push('The loaded production handoff is no longer structurally valid.');}
  const transcript=state.voiceoverTranscription;
  if(!transcript)errors.push('Import a valid Transcription JSON.');
  else {
    if(positiveSceneDuration(transcript.sceneDurationSeconds)===null)errors.push('Scene duration must be a positive number.');
    if(!Number.isFinite(transcript.duration)||transcript.duration<=0||!transcript.scenes.length)errors.push('The transcription cannot produce scene windows.');
    transcript.scenes.forEach((scene,index)=>{const expected=index+1,previous=transcript.scenes[index-1];if(scene.number!==expected)errors.push(`Transcription scene ${expected} has an incoherent scene number.`);if(!Number.isFinite(scene.start)||!Number.isFinite(scene.end)||scene.end<=scene.start)errors.push(`Transcription scene ${expected} has invalid timestamps.`);if(previous&&Math.abs(previous.end-scene.start)>0.011)errors.push(`Transcription scenes ${index} and ${expected} do not form a coherent timeline.`);});
    if(transcript.scenes.at(-1)&&Math.abs(transcript.scenes.at(-1)!.end-transcript.duration)>0.011)errors.push('The final scene timestamp does not match the transcription duration.');
    const validNumbers=new Set(transcript.scenes.map(scene=>scene.number));
    if([...state.plannedScenes,...state.sceneDirections,...state.visualPrompts].some(item=>!validNumbers.has(item.number)))errors.push('Downstream project data references scenes outside the imported transcription.');
    if(state.visualPrompts.some(prompt=>!state.sceneDirections.some(direction=>direction.number===prompt.number)))errors.push('A saved prompt has no compatible scene direction.');
  }
  if(state.topic&&transcript&&state.topic.master_voiceover_script&&state.topic.master_voiceover_script.trim()!==transcript.text.trim())warnings.push('The handoff contains a master VO script that differs from the imported timed transcription; imported timestamps remain authoritative.');
  return {ready:errors.length===0,errors:[...new Set(errors)],warnings};
}
