import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AlertCircle, CheckCircle2, Download, Loader2, Pause, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { AppState, PersistedAlignmentSelection, PlannedScene, ProductionBatchState, ProjectCheckpointReason, SceneDirection, TimedScene } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useSettings } from './SettingsContext';
import { buildDocumentaryScenePlan } from '../lib/scenePlanner';
import { applyVisualAlignments, buildAlignmentRequests } from '../lib/visualAlignment';
import { validateSceneDirections } from '../lib/sceneDirections';
import { auditVisualBalance } from '../lib/visualBalance';
import { createProductionSession, deriveProductionContext, isQuotaOrRateLimitError, mergeByNumber, synchronizeProductionSession, updateProductionBatch } from '../lib/productionSession';
import { partitionReusablePrompts, requestPromptAttempt } from '../lib/productionPrompt';
import { alignmentOperationFingerprint, directionOperationFingerprint, ItemFailure, partitionAlignmentResponse, partitionDirectionResponse, partitionReusableAlignmentSelections, partitionReusableDirections } from '../lib/productionApi';
import { buildFocusedProductionContext, focusedContextCharacterSavings } from '../lib/flowPrompt';
import { composeAlignmentInstruction, composeDirectionInstruction } from '../lib/productionInstructions';
import { recordApiCall, recordFingerprintReuse, recordPartialAcceptance } from '../lib/apiDiagnostics';

interface Props {state:AppState;setState:Dispatch<SetStateAction<AppState>>;commitProjectState:(state:AppState,checkpointReason?:ProjectCheckpointReason)=>Promise<AppState>;}
const directionSchema={type:Type.ARRAY,items:{type:Type.OBJECT,required:['number','subject','product_visual_state','primary_action','supporting_motion','environment_description','camera','lighting_and_material','continuity_from_previous','transition_to_next','required_visible_features','forbidden_elements','temporal_action'],properties:{number:{type:Type.INTEGER},subject:{type:Type.STRING},product_visual_state:{type:Type.STRING},primary_action:{type:Type.STRING},supporting_motion:{type:Type.STRING},environment_description:{type:Type.STRING},camera:{type:Type.OBJECT,required:['shot_scale','lens','angle','movement','movement_speed'],properties:{shot_scale:{type:Type.STRING},lens:{type:Type.STRING},angle:{type:Type.STRING},movement:{type:Type.STRING},movement_speed:{type:Type.STRING}}},lighting_and_material:{type:Type.STRING},continuity_from_previous:{type:Type.STRING},transition_to_next:{type:Type.STRING},required_visible_features:{type:Type.ARRAY,items:{type:Type.STRING}},forbidden_elements:{type:Type.ARRAY,items:{type:Type.STRING}},temporal_action:{type:Type.OBJECT,required:['opening_state','primary_motion','physical_interaction','mid_shot_progression','ending_state'],properties:{opening_state:{type:Type.STRING},primary_motion:{type:Type.STRING},physical_interaction:{type:Type.STRING},mid_shot_progression:{type:Type.STRING},ending_state:{type:Type.STRING}}}}}};
const alignmentSchema={type:Type.ARRAY,items:{type:Type.OBJECT,required:['group_id','source','beat_id','confidence','visual_claim','graphic_required','graphic_scene_numbers'],properties:{group_id:{type:Type.STRING},source:{type:Type.STRING,enum:['ENGINE_BEAT','VO_FALLBACK']},beat_id:{type:Type.STRING,nullable:true},confidence:{type:Type.NUMBER},visual_claim:{type:Type.STRING},graphic_required:{type:Type.BOOLEAN},graphic_scene_numbers:{type:Type.ARRAY,items:{type:Type.INTEGER}}}}};

const parseResponse=(text:string|undefined):unknown=>{try{return JSON.parse(text||'[]');}catch{return null;}};
const issueRecord=(failures:ItemFailure[])=>Object.fromEntries(failures.map(item=>[item.id,item.issues]));
const feedback=(failures:ItemFailure[])=>failures.map(item=>`${item.id}: ${item.issues.join(', ')}`).join('; ');
const productText=(state:AppState)=>`${(state.topic as any)?._production_handoff?.product?.product_class||''} ${state.topic?.topic?.product||''}`;
const exportProject=(state:AppState)=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`${(state.projectName||'production').replace(/\s+/g,'_')}_resume.json`;anchor.click();URL.revokeObjectURL(url);};

class DurableCommitError extends Error {constructor(public readonly snapshot:AppState,cause:unknown){super(cause instanceof Error?cause.message:'Project storage failed after a paid result.');this.name='DurableCommitError';}}

export function ProductionPipeline({state,setState,commitProjectState}:Props){
  const {settings}=useSettings();
  const pauseRequested=useRef(false),started=useRef(false);
  const [running,setRunning]=useState(false),[statusText,setStatusText]=useState('Preparing production');
  const scenes=state.voiceoverTranscription?.scenes||[],session=state.generationSession,completed=state.visualPrompts.length,total=scenes.length;

  const persistStep=async(current:AppState,batchId:string,operation:Parameters<typeof updateProductionBatch>[2],data:Partial<AppState>={},batchPatch:Partial<ProductionBatchState>={},checkpoint=false)=>{
    let next={...current,...data,generationSession:updateProductionBatch(current.generationSession,batchId,operation,batchPatch)} as AppState;
    next={...next,generationSession:synchronizeProductionSession(next.generationSession,next)};
    try{return await commitProjectState(next,checkpoint?'batch':undefined);}catch(error){throw new DurableCommitError(next,error);}
  };
  const shouldPause=async(current:AppState)=>{if(!pauseRequested.current)return false;const paused={...current,generationSession:{...current.generationSession,status:'paused' as const,pauseReason:'user' as const,error:null}};await commitProjectState(paused);setStatusText('Paused safely after the last durable operation');return true;};

  const requestAlignments=async(ai:GoogleGenAI,current:AppState,requests:ReturnType<typeof buildAlignmentRequests>,batchPlan:PlannedScene[],context:ProductionBatchState['contextSnapshot'],correctionFailures:ItemFailure[]=[])=>{
    const focused=buildFocusedProductionContext(current.topic,batchPlan),fingerprints=new Map(requests.map(request=>[request.group_id,alignmentOperationFingerprint(settings.model,request,focused,context)]));
    recordApiCall('alignment',requests.length,{correction:Boolean(correctionFailures.length),estimatedInputCharactersAvoided:focusedContextCharacterSavings(current.topic,focused)});
    const response=await ai.models.generateContent({model:settings.model,contents:JSON.stringify({production_context:focused,persistent_context:context,groups:requests,correction_feedback:correctionFailures.length?issueRecord(correctionFailures):undefined}),config:{responseMimeType:'application/json',responseSchema:alignmentSchema,systemInstruction:composeAlignmentInstruction(correctionFailures.length?feedback(correctionFailures):undefined)}});
    const result=partitionAlignmentResponse(requests,parseResponse(response.text),fingerprints);recordPartialAcceptance(result.accepted.length,result.failed.length,Boolean(correctionFailures.length));return result;
  };

  const requestDirections=async(ai:GoogleGenAI,current:AppState,targetScenes:TimedScene[],targetPlan:PlannedScene[],context:ProductionBatchState['contextSnapshot'],correctionFailures:ItemFailure[]=[])=>{
    const focused=buildFocusedProductionContext(current.topic,targetPlan),fingerprints=new Map(targetScenes.map(scene=>{const plan=targetPlan.find(item=>item.number===scene.number)!;return [scene.number,directionOperationFingerprint(current,settings.model,scene,plan,context)];}));
    const prior=current.sceneDirections.filter(item=>item.number<(targetScenes[0]?.number||0)).at(-1)||null;
    const plannedScenes=targetPlan.map(plan=>({...plan,...targetScenes.find(item=>item.number===plan.number),voiceover:targetScenes.find(item=>item.number===plan.number)?.text}));
    const failedScenes=correctionFailures.map(failure=>({planned_scene:plannedScenes.find(item=>item.number===failure.number),rejected_direction:failure.candidate||null,validation_failures:failure.issues}));
    recordApiCall('direction',targetScenes.length,{correction:Boolean(correctionFailures.length),estimatedInputCharactersAvoided:focusedContextCharacterSavings(current.topic,focused)});
    const response=await ai.models.generateContent({model:settings.model,contents:JSON.stringify({production_context:focused,persistent_context:context,prior_scene:prior,...(correctionFailures.length?{failed_scenes:failedScenes}:{planned_scenes:plannedScenes})}),config:{responseMimeType:'application/json',responseSchema:directionSchema,systemInstruction:composeDirectionInstruction(targetPlan,productText(current),correctionFailures.length?feedback(correctionFailures):undefined)}});
    const result=partitionDirectionResponse(parseResponse(response.text),targetScenes,targetPlan,current.voiceoverTranscription!.sceneDurationSeconds,fingerprints);recordPartialAcceptance(result.accepted.length,result.failed.length,Boolean(correctionFailures.length));return result;
  };

  const run=async()=>{
    if(running||!state.topic||!state.voiceoverTranscription)return;
    const apiKey=settings.apiKey||process.env.GEMINI_API_KEY;if(!apiKey)return toast.error('Add a Gemini API key in Settings.');
    setRunning(true);pauseRequested.current=false;let durable=state;
    try{
      const ai=new GoogleGenAI({apiKey}),basePlan=buildDocumentaryScenePlan(state.topic,scenes);
      if(!durable.generationSession.batches.length)durable={...durable,generationSession:createProductionSession(scenes,basePlan)};
      durable=await commitProjectState({...durable,generationSession:{...durable.generationSession,status:'running',pauseReason:null,error:null,startedAt:durable.generationSession.startedAt||new Date().toISOString()}});
      for(const originalBatch of durable.generationSession.batches){
        let batch=durable.generationSession.batches.find(item=>item.id===originalBatch.id)!;
        if(batch.operation==='COMPLETE')continue;
        const numbers=new Set(batch.sceneNumbers),batchScenes=scenes.filter(item=>numbers.has(item.number));
        if(!batch.contextSnapshot){durable=await persistStep(durable,batch.id,batch.operation,{}, {contextSnapshot:deriveProductionContext(durable)},true);batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;}
        const context=batch.contextSnapshot;

        let batchPlan=durable.plannedScenes.filter(item=>numbers.has(item.number));
        if(batchPlan.length!==batchScenes.length){setStatusText(`Batch ${batch.index}: planning scenes ${batch.sceneNumbers[0]}–${batch.sceneNumbers.at(-1)}`);durable=await persistStep(durable,batch.id,'PLANNING');batchPlan=basePlan.filter(item=>numbers.has(item.number));durable=await persistStep(durable,batch.id,'PLANNED',{plannedScenes:mergeByNumber(durable.plannedScenes,batchPlan)}, {},true);if(await shouldPause(durable))return;}
        batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;batchPlan=durable.plannedScenes.filter(item=>numbers.has(item.number));

        const pastAlignment=['ALIGNED','DIRECTING','DIRECTION_CORRECTION','DIRECTED','GENERATING_PROMPTS','PROMPTS_GENERATED','PROMPT_CORRECTION','QA','COMPLETE'].includes(batch.operation);
        if(!pastAlignment){
          const requests=buildAlignmentRequests(durable.topic!,batchScenes,batchPlan),focused=buildFocusedProductionContext(durable.topic,batchPlan),reuse=partitionReusableAlignmentSelections(batch.alignmentSelections,requests,settings.model,focused,context),expected=reuse.fingerprints,reusable=reuse.reusable;
          if(reusable.length)recordFingerprintReuse(reusable.length);
          let selections=[...reusable],missing=reuse.missingRequests;
          if(missing.length){setStatusText(`Batch ${batch.index}: aligning ${missing.length} semantic group${missing.length===1?'':'s'}`);durable=await persistStep(durable,batch.id,'ALIGNING');const first=await requestAlignments(ai,durable,missing,batchPlan,context);selections=[...selections,...first.accepted];durable=await persistStep(durable,batch.id,'ALIGNING',{}, {alignmentSelections:selections,correctionIssues:issueRecord(first.failed)},true);if(await shouldPause(durable))return;
            if(first.failed.length){const failedIds=new Set(first.failed.map(item=>item.id)),retryRequests=missing.filter(request=>failedIds.has(request.group_id));setStatusText(`Batch ${batch.index}: correcting ${retryRequests.length} alignment group${retryRequests.length===1?'':'s'}`);const retry=await requestAlignments(ai,durable,retryRequests,batchPlan,context,first.failed);selections=[...selections,...retry.accepted];durable=await persistStep(durable,batch.id,'ALIGNING',{}, {alignmentSelections:selections,correctionIssues:issueRecord(retry.failed)},true);if(retry.failed.length)throw new Error(`Alignment correction remains invalid: ${feedback(retry.failed)}`);if(await shouldPause(durable))return;}}
          const aligned=applyVisualAlignments(durable.topic!,batchScenes,batchPlan,requests,selections as PersistedAlignmentSelection[]).map(plan=>{const request=requests.find(item=>item.scene_numbers.includes(plan.number)),fingerprint=request?expected.get(request.group_id):undefined;return {...plan,alignmentFingerprint:fingerprint};});
          batchPlan=aligned;durable=await persistStep(durable,batch.id,'ALIGNED',{plannedScenes:mergeByNumber(durable.plannedScenes,aligned)},{alignmentSelections:selections,correctionIssues:{}},true);if(await shouldPause(durable))return;
        }
        batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;batchPlan=durable.plannedScenes.filter(item=>numbers.has(item.number));

        const directionReuse=partitionReusableDirections(durable.sceneDirections.filter(item=>numbers.has(item.number)),batchScenes,batchPlan,durable,settings.model,context),reusableDirections=directionReuse.reusable,staleDirectionNumbers=new Set(directionReuse.staleSceneNumbers);
        if(reusableDirections.length)recordFingerprintReuse(reusableDirections.length);
        if(staleDirectionNumbers.size){durable=await persistStep(durable,batch.id,'DIRECTING',{sceneDirections:durable.sceneDirections.filter(item=>!staleDirectionNumbers.has(item.number)),visualPrompts:durable.visualPrompts.filter(item=>!staleDirectionNumbers.has(item.number))},{directionCorrectionCandidates:[],directionCorrectionSceneNumbers:[],promptCorrectionSceneNumbers:[],correctionIssues:{}},true);}

        batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;
        if(batch.directionCorrectionSceneNumbers.length){
          const pending=new Set(batch.directionCorrectionSceneNumbers),targetScenes=batchScenes.filter(item=>pending.has(item.number)),targetPlan=batchPlan.filter(item=>pending.has(item.number)),failures:ItemFailure[]=targetScenes.map(scene=>({id:String(scene.number),number:scene.number,issues:batch.correctionIssues[String(scene.number)]||['RETRY_REQUIRED'],candidate:batch.directionCorrectionCandidates.find(item=>item.number===scene.number)}));
          setStatusText(`Batch ${batch.index}: correcting ${targetScenes.length} direction${targetScenes.length===1?'':'s'}`);durable=await persistStep(durable,batch.id,'DIRECTION_CORRECTION');const retry=await requestDirections(ai,durable,targetScenes,targetPlan,context,failures);const remaining=retry.failed.map(item=>item.number!);durable=await persistStep(durable,batch.id,remaining.length?'DIRECTION_CORRECTION':'DIRECTED',{sceneDirections:mergeByNumber(durable.sceneDirections,retry.accepted)},{directionCorrectionCandidates:retry.failed.flatMap(item=>item.candidate?[item.candidate]:[]),directionCorrectionSceneNumbers:remaining,correctionIssues:issueRecord(retry.failed)},true);if(remaining.length)throw new Error(`Direction correction remains invalid: ${feedback(retry.failed)}`);if(await shouldPause(durable))return;
        }

        const directedNumbers=new Set(durable.sceneDirections.map(item=>item.number)),missingDirectionScenes=batchScenes.filter(item=>!directedNumbers.has(item.number));
        if(missingDirectionScenes.length){
          setStatusText(`Batch ${batch.index}: directing ${missingDirectionScenes.length} scene${missingDirectionScenes.length===1?'':'s'}`);durable=await persistStep(durable,batch.id,'DIRECTING');const missingPlan=batchPlan.filter(item=>missingDirectionScenes.some(scene=>scene.number===item.number)),first=await requestDirections(ai,durable,missingDirectionScenes,missingPlan,context);let remaining=first.failed.map(item=>item.number!);durable=await persistStep(durable,batch.id,remaining.length?'DIRECTION_CORRECTION':'DIRECTED',{sceneDirections:mergeByNumber(durable.sceneDirections,first.accepted)},{directionCorrectionCandidates:first.failed.flatMap(item=>item.candidate?[item.candidate]:[]),directionCorrectionSceneNumbers:remaining,correctionIssues:issueRecord(first.failed)},true);if(await shouldPause(durable))return;
          if(remaining.length){const failedSet=new Set(remaining),retryScenes=missingDirectionScenes.filter(item=>failedSet.has(item.number)),retryPlan=missingPlan.filter(item=>failedSet.has(item.number));setStatusText(`Batch ${batch.index}: correcting only ${retryScenes.length} failed direction${retryScenes.length===1?'':'s'}`);const retry=await requestDirections(ai,durable,retryScenes,retryPlan,context,first.failed);remaining=retry.failed.map(item=>item.number!);durable=await persistStep(durable,batch.id,remaining.length?'DIRECTION_CORRECTION':'DIRECTED',{sceneDirections:mergeByNumber(durable.sceneDirections,retry.accepted)},{directionCorrectionCandidates:retry.failed.flatMap(item=>item.candidate?[item.candidate]:[]),directionCorrectionSceneNumbers:remaining,correctionIssues:issueRecord(retry.failed)},true);if(remaining.length)throw new Error(`Direction correction remains invalid: ${feedback(retry.failed)}`);if(await shouldPause(durable))return;}
        }
        durable=await persistStep(durable,batch.id,'DIRECTED',{}, {directionCorrectionCandidates:[],directionCorrectionSceneNumbers:[],correctionIssues:{}},true);
        batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;const batchDirections=durable.sceneDirections.filter(item=>numbers.has(item.number));

        const promptReuse=partitionReusablePrompts(durable.visualPrompts.filter(item=>numbers.has(item.number)),batchDirections,durable,settings.model,context||undefined),reusablePrompts=promptReuse.reusable,stalePromptNumbers=new Set(promptReuse.staleSceneNumbers);
        if(reusablePrompts.length)recordFingerprintReuse(reusablePrompts.length);
        if(stalePromptNumbers.size)durable=await persistStep(durable,batch.id,'GENERATING_PROMPTS',{visualPrompts:durable.visualPrompts.filter(item=>!stalePromptNumbers.has(item.number))},{promptCorrectionSceneNumbers:[],correctionIssues:{}},true);

        batch=durable.generationSession.batches.find(item=>item.id===batch.id)!;
        if(batch.promptCorrectionSceneNumbers.length){
          const pending=new Set(batch.promptCorrectionSceneNumbers),retryDirections=batchDirections.filter(item=>pending.has(item.number)),retryFeedback=retryDirections.map(item=>`Scene ${item.number}: ${(batch.correctionIssues[String(item.number)]||['RETRY_REQUIRED']).join(', ')}`).join('; ');
          setStatusText(`Batch ${batch.index}: correcting only ${retryDirections.length} failed prompt${retryDirections.length===1?'':'s'}`);durable=await persistStep(durable,batch.id,'PROMPT_CORRECTION');const retry=await requestPromptAttempt(ai as any,settings.model,durable,retryDirections,retryFeedback,context||undefined),remaining=retry.failed.map(item=>item.number);durable=await persistStep(durable,batch.id,remaining.length?'PROMPT_CORRECTION':'PROMPTS_GENERATED',{visualPrompts:mergeByNumber(durable.visualPrompts,retry.accepted)},{promptCorrectionSceneNumbers:remaining,correctionIssues:Object.fromEntries(retry.failed.map(item=>[String(item.number),item.issues])),correctionReason:retry.reason},true);if(remaining.length)throw new Error(`Prompt correction remains invalid: ${retry.reason}`);if(await shouldPause(durable))return;
        }

        const promptNumbers=new Set(durable.visualPrompts.map(item=>item.number)),missingPromptDirections=batchDirections.filter(item=>!promptNumbers.has(item.number));
        if(missingPromptDirections.length){
          setStatusText(`Batch ${batch.index}: compiling/generating ${missingPromptDirections.length} prompt${missingPromptDirections.length===1?'':'s'}`);durable=await persistStep(durable,batch.id,'GENERATING_PROMPTS');const first=await requestPromptAttempt(ai as any,settings.model,durable,missingPromptDirections,undefined,context||undefined);let remaining=first.failed.map(item=>item.number);durable=await persistStep(durable,batch.id,remaining.length?'PROMPT_CORRECTION':'PROMPTS_GENERATED',{visualPrompts:mergeByNumber(durable.visualPrompts,first.accepted)},{promptCorrectionSceneNumbers:remaining,correctionIssues:Object.fromEntries(first.failed.map(item=>[String(item.number),item.issues])),correctionReason:first.reason},true);if(await shouldPause(durable))return;
          const localFailureNumbers=new Set(first.failed.filter(item=>missingPromptDirections.find(direction=>direction.number===item.number)?.graphic_spec).map(item=>item.number));if(localFailureNumbers.size)throw new Error(`Deterministic graphic prompt QA failed for scene${localFailureNumbers.size===1?'':'s'} ${[...localFailureNumbers].join(', ')}; no redundant API correction was issued.`);
          if(remaining.length){const failedSet=new Set(remaining),retryDirections=missingPromptDirections.filter(item=>failedSet.has(item.number));setStatusText(`Batch ${batch.index}: correcting only ${retryDirections.length} failed prompt${retryDirections.length===1?'':'s'}`);const retry=await requestPromptAttempt(ai as any,settings.model,durable,retryDirections,first.reason||'Correct deterministic prompt QA failures',context||undefined);remaining=retry.failed.map(item=>item.number);durable=await persistStep(durable,batch.id,remaining.length?'PROMPT_CORRECTION':'PROMPTS_GENERATED',{visualPrompts:mergeByNumber(durable.visualPrompts,retry.accepted)},{promptCorrectionSceneNumbers:remaining,correctionIssues:Object.fromEntries(retry.failed.map(item=>[String(item.number),item.issues])),correctionReason:retry.reason},true);if(remaining.length)throw new Error(`Prompt correction remains invalid: ${retry.reason}`);if(await shouldPause(durable))return;}
        }

        setStatusText(`Batch ${batch.index}: finalizing QA`);durable=await persistStep(durable,batch.id,'QA');durable=await persistStep(durable,batch.id,'COMPLETE',{}, {qaCompletedSceneNumbers:batch.sceneNumbers,promptCorrectionSceneNumbers:[],correctionIssues:{},correctionReason:null},true);
      }
      const directionErrors=validateSceneDirections(durable.sceneDirections,scenes,durable.plannedScenes,durable.voiceoverTranscription!.sceneDurationSeconds);if(directionErrors.length)throw new Error(`Global direction audit failed: ${directionErrors[0]}`);
      const visualAudit=auditVisualBalance(durable.topic!,scenes,durable.plannedScenes);if(process.env.NODE_ENV!=='production'&&visualAudit.warnings.length)console.warn('Final production visual audit:',visualAudit);
      durable=await commitProjectState({...durable,phase:3,generationSession:{...synchronizeProductionSession(durable.generationSession,durable),status:'complete',operation:'COMPLETE',pauseReason:null,error:null,lastCommittedAt:new Date().toISOString()}},'batch');toast.success(`Production complete. ${durable.visualPrompts.length} prompts are durably saved.`);
    }catch(error){
      const storage=error instanceof DurableCommitError,base=storage?error.snapshot:durable,quota=!storage&&isQuotaOrRateLimitError(error),message=error instanceof Error?error.message:'Production failed.',failed={...base,generationSession:{...synchronizeProductionSession(base.generationSession,base),status:quota||storage?'paused' as const:'failed' as const,pauseReason:storage?'storage' as const:quota?'quota' as const:'error' as const,error:message}};durable=failed;
      if(!storage){try{durable=await commitProjectState(failed,'batch');}catch{/* Existing storage banner handles persistence failure. */}}
      setState(durable);toast.error(storage?'Browser storage failed after an API result. The result remains in memory: retry storage or export before closing this page.':quota?'API credits or quota are exhausted. Accepted work is saved; export or resume with another profile/API key.':`Production paused: ${message}`);
    }finally{setRunning(false);started.current=false;}
  };

  useEffect(()=>{if(state.phase===2&&state.generationSession.status==='running'&&!started.current){started.current=true;void run();}},[state.phase,state.generationSession.status]);
  const resume=()=>setState(previous=>({...previous,generationSession:{...previous.generationSession,status:'running',pauseReason:null,error:null}}));
  return <div className="phase-canvas space-y-6"><div className="section-intro section-intro--cyan"><div className="eyebrow">Automatic production</div><h2 className="text-xl font-bold mt-1">Durable credit-efficient pipeline</h2><p className="text-sm text-muted-foreground mt-1">Valid items are saved individually, failed subsets retry alone, and unchanged fingerprints prevent duplicate paid operations.</p></div>
    <div className="content-panel p-5 space-y-4"><div className="flex justify-between gap-3 text-sm"><strong>{running?statusText:session.status==='complete'?'Production complete':'Production paused'}</strong><span>{completed} / {total} prompts</span></div><Progress value={total?(completed/total)*100:0}/><div className="flex flex-wrap gap-2">{session.batches.map(batch=><Badge key={batch.id} variant={batch.operation==='COMPLETE'?'default':batch.id===session.activeBatchId?'secondary':'outline'}>{batch.id.replace('_',' ')} · {batch.sceneNumbers[0]}–{batch.sceneNumbers.at(-1)} · {batch.operation.replaceAll('_',' ')}</Badge>)}</div>{session.error&&<div className="text-xs text-red-400 flex gap-2"><AlertCircle className="h-4 w-4 shrink-0"/>{session.error}</div>}
      <div className="flex flex-wrap gap-2">{running?<Button variant="outline" onClick={()=>{pauseRequested.current=true;setStatusText('Pause requested; saving the current accepted results first')}}><Pause className="h-4 w-4 mr-2"/>PAUSE SAFELY</Button>:session.status!=='complete'&&<Button onClick={resume}><RefreshCw className="h-4 w-4 mr-2"/>RESUME EXACT OPERATION</Button>}<Button variant="outline" onClick={()=>exportProject(state)}><Download className="h-4 w-4 mr-2"/>EXPORT RESUMABLE PROJECT</Button></div>
    </div>{session.status==='complete'&&<div className="text-sm text-emerald-500 flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/>All batches passed the global audit and are ready for Review & Export.</div>}{running&&<div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/>Only currently missing or stale operations can issue API calls.</div>}</div>;
}
