import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, RefreshCw, Wrench } from 'lucide-react';
import type { AppState, ProductionBatchState } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatTimestamp } from '../lib/timedTranscript';
import { productionOperationLabel, scenePresentationState } from '../lib/uiPresentation';

const titleCase=(value:string|undefined)=>value?value.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase()):'Preparing';

interface HealthProps {families:number;graphics:number;longestRun:number;prompts:number;total:number;warnings:number;blockers:number;}
export function ProductionHealthSummary({families,graphics,longestRun,prompts,total,warnings,blockers}:HealthProps){
  const issueCount=warnings+blockers;
  const label=blockers?`${blockers} repair${blockers===1?'':'s'} needed`:warnings?`${warnings} warning${warnings===1?'':'s'}`:'Good';
  return <details className={`health-summary group rounded-xl border bg-background/35 ${issueCount?'border-amber-500/25':'border-border/60'}`}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <span className="text-sm font-semibold">Production health</span>
      <span className={`flex items-center gap-2 text-xs font-medium ${blockers?'text-destructive':warnings?'text-amber-500':'text-emerald-500'}`}>{issueCount?<AlertTriangle className="h-3.5 w-3.5"/>:<CheckCircle2 className="h-3.5 w-3.5"/>}{label}<ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"/></span>
    </summary>
    <div className="grid grid-cols-2 gap-px border-t border-border/50 bg-border/50 sm:grid-cols-5"><Metric label="Visual families" value={families}/><Metric label="Graphics" value={`${graphics}%`}/><Metric label="Longest repeat" value={longestRun}/><Metric label="Prompts" value={`${prompts}/${total}`}/><Metric label="Open issues" value={issueCount}/></div>
  </details>;
}

const Metric=({label,value}:{label:string;value:string|number})=><div className="bg-card px-3 py-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold">{value}</div></div>;

interface BatchListProps {state:AppState;running:boolean;showDiagnostics:boolean;onRepair:(number:number,kind:'prompt'|'direction')=>void;onRedirectBatch:(batchId:string)=>void;}
export function ProductionBatchList({state,running,showDiagnostics,onRepair,onRedirectBatch}:BatchListProps){
  const session=state.generationSession;
  return <div className="space-y-2">{session.batches.map(batch=><BatchRow key={batch.id} batch={batch} state={state} running={running} showDiagnostics={showDiagnostics} active={batch.id===session.activeBatchId} onRepair={onRepair} onRedirectBatch={onRedirectBatch}/>)}</div>;
}

interface BatchRowProps extends BatchListProps {key?:string;batch:ProductionBatchState;active:boolean;}
function BatchRow({batch,state,running,showDiagnostics,active,onRepair,onRedirectBatch}:BatchRowProps){
  const [expanded,setExpanded]=useState(active&&batch.operation!=='COMPLETE');
  const session=state.generationSession;
  const blockers=session.deferredRepairs.filter(item=>batch.sceneNumbers.includes(item.sceneNumber));
  const promptCount=batch.promptCompletedSceneNumbers.length;
  const status=blockers.length?`${blockers.length} repair${blockers.length===1?'':'s'} needed`:batch.operation==='COMPLETE'?'Complete':active?`${productionOperationLabel(session.operation)} · ${promptCount}/${batch.sceneNumbers.length}`:'Queued';
  return <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)} className={`batch-row group rounded-xl border bg-background/35 ${blockers.length?'border-amber-500/30':active?'border-primary/30':'border-border/60'}`}>
    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${batch.operation==='COMPLETE'&&!blockers.length?'bg-emerald-500/10 text-emerald-500':active?'bg-primary/10 text-primary':'bg-muted text-muted-foreground'}`}>{batch.operation==='COMPLETE'&&!blockers.length?<CheckCircle2 className="h-4 w-4"/>:<Clock3 className="h-4 w-4"/>}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Batch {String(batch.index).padStart(2,'0')} · Scenes {batch.sceneNumbers[0]}–{batch.sceneNumbers.at(-1)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{status}</span></span>
      {showDiagnostics&&<Badge variant="outline" className="hidden sm:inline-flex">{batch.operation}</Badge>}
      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"/>
    </summary>
    {expanded&&<div className="space-y-2 border-t border-border/50 p-2 sm:p-3">
      {batch.sceneNumbers.map(number=><SceneRow key={number} number={number} state={state} running={running} showDiagnostics={showDiagnostics} onRepair={onRepair}/>)}
      {!running&&batch.directionCompletedSceneNumbers.length>0&&<Button variant="ghost" size="sm" onClick={()=>onRedirectBatch(batch.id)}><RefreshCw className="mr-2 h-3 w-3"/>Redirect batch</Button>}
      {showDiagnostics&&<div className="rounded-lg bg-muted/20 p-2 font-mono text-[10px] text-muted-foreground">Directions {batch.directionCompletedSceneNumbers.length}/{batch.sceneNumbers.length} · Prompts {batch.promptCompletedSceneNumbers.length}/{batch.sceneNumbers.length} · QA {batch.qaCompletedSceneNumbers.length}/{batch.sceneNumbers.length}</div>}
    </div>}
  </details>;
}

interface SceneRowProps {key?:number;number:number;state:AppState;running:boolean;showDiagnostics:boolean;onRepair:(number:number,kind:'prompt'|'direction')=>void;}
function SceneRow({number,state,running,showDiagnostics,onRepair}:SceneRowProps){
  const [expanded,setExpanded]=useState(false);
  const timed=state.voiceoverTranscription?.scenes.find(item=>item.number===number);
  const plan=state.plannedScenes.find(item=>item.number===number);
  const direction=state.sceneDirections.find(item=>item.number===number);
  const prompt=state.visualPrompts.find(item=>item.number===number);
  const warning=state.generationSession.validationWarnings.find(item=>item.sceneNumber===number);
  const blocker=state.generationSession.deferredRepairs.find(item=>item.sceneNumber===number);
  const presentation=scenePresentationState({hasDirection:Boolean(direction),hasPrompt:Boolean(prompt),hasWarning:Boolean(warning),hasBlocker:Boolean(blocker)});
  return <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)} className="scene-row group/scene rounded-lg border border-border/50 bg-card/55">
    <summary className="grid cursor-pointer list-none items-center gap-3 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:grid-cols-[95px_minmax(0,1fr)_auto]">
      <div><div className="text-xs font-semibold">Scene {number}</div><div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatTimestamp(timed?.start||0)}–{formatTimestamp(timed?.end||0)}</div></div>
      <div className="min-w-0"><p className="truncate text-xs text-foreground/90">{timed?.text||'[Silent scene]'}</p><p className="mt-1 text-[11px] text-muted-foreground">{titleCase(plan?.visual_family)}</p></div>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${presentation.state==='READY'?'text-emerald-500':presentation.state==='WARNING'?'text-amber-500':presentation.state==='BLOCKED'?'text-destructive':'text-muted-foreground'}`}>{presentation.state==='READY'?<CheckCircle2 className="h-3.5 w-3.5"/>:presentation.state==='WARNING'||presentation.state==='BLOCKED'?<AlertTriangle className="h-3.5 w-3.5"/>:<Clock3 className="h-3.5 w-3.5"/>}{presentation.label}<ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground transition-transform group-open/scene:rotate-180"/></div>
    </summary>
    {expanded&&<div className="space-y-3 border-t border-border/50 p-3">
      {blocker&&<div className="rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3 text-xs"><div className="font-semibold text-destructive">This scene needs repair</div><p className="mt-1 text-muted-foreground">Automatic repair could not safely resolve it. Unrelated production work remains saved.</p>{showDiagnostics&&<div className="mt-2 font-mono text-[10px] text-muted-foreground">{blocker.validationCode} · {blocker.lastError}</div>}</div>}
      {warning&&<div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-500">Review suggested{showDiagnostics?` · ${warning.code}`:''}</div>}
      {direction&&<div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scene direction</div><p className="text-xs leading-relaxed">{direction.primary_action}</p>{showDiagnostics&&<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 font-mono text-[10px] text-muted-foreground">{JSON.stringify(direction,null,2)}</pre>}</div>}
      {prompt&&<div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Final prompt</div><Textarea readOnly value={prompt.video_prompt} className="min-h-32 text-xs"/>{showDiagnostics&&<div className="mt-2 break-all font-mono text-[10px] text-muted-foreground">Stage {prompt.stage_id||'—'} · State {prompt.state||'—'} · Source {prompt.generationSource||'—'} · Fingerprint {prompt.operationFingerprint||'—'}</div>}</div>}
      {!running&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!direction} onClick={()=>onRepair(number,'prompt')}><Wrench className="mr-1 h-3 w-3"/>Repair prompt</Button><Button size="sm" variant="outline" disabled={!plan} onClick={()=>onRepair(number,'direction')}><RefreshCw className="mr-1 h-3 w-3"/>Redirect scene</Button></div>}
    </div>}
  </details>;
}
