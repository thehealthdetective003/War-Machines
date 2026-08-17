import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, ProjectCheckpointReason, T2VPrompt, T2VPromptProfile } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useSettings } from './SettingsContext';
import { copyToClipboard } from '@/lib/utils';
import { formatTimestamp } from '../lib/timedTranscript';
import { buildFlowContext, finalizeFlowPrompt, profileInstruction } from '../lib/flowPrompt';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { createDirectionBatches, missingDirections, PromptBatchError, runSequentialBatches, T2V_BATCH_SIZE, validateBatchNumbers, validateBatchResponse } from '../lib/promptBatch';
import { compileOmniPrompt, normalizeOmniSections, recompileOmniPrompts } from '../lib/omniPromptCompiler';
import { clampPromptPage, PROMPT_PAGE_SIZE, promptPageCount, promptPageItems } from '../lib/pagination';
import { Input } from '@/components/ui/input';
import { idleGenerationSession } from '../lib/generationSession';

interface Props {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  commitProjectState: (state: AppState, checkpointReason?: ProjectCheckpointReason) => Promise<AppState>;
  resumeAfterRecovery: boolean;
  onResumeAfterRecoveryConsumed: () => void;
}
const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['number','action_description','video_prompt','stock_keywords'], properties: {
  number: { type: Type.INTEGER }, action_description: { type: Type.STRING }, video_prompt: { type: Type.STRING }, stock_keywords: { type: Type.STRING },
  continuity_notes: { type: Type.STRING }, quality_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
}}};
const omniSectionsProperties = {
  cinematography:{type:Type.STRING},subject:{type:Type.STRING},action:{type:Type.STRING},environment:{type:Type.STRING},style_lighting:{type:Type.STRING},product_state:{type:Type.STRING},sound:{type:Type.STRING},exclusions:{type:Type.STRING},
};
const omniResponseSchema = { type:Type.ARRAY, items:{type:Type.OBJECT,required:['number','action_description','prompt_sections','stock_keywords'],properties:{
  number:{type:Type.INTEGER},action_description:{type:Type.STRING},stock_keywords:{type:Type.STRING},continuity_notes:{type:Type.STRING},prompt_sections:{type:Type.OBJECT,required:Object.keys(omniSectionsProperties),properties:omniSectionsProperties},
}}};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const download = (name: string, text: string, type: string) => { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); };

export function Phase4Visuals({ state, setState, commitProjectState, resumeAfterRecovery, onResumeAfterRecoveryConsumed }: Props) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState<'demo'|'full'|null>(null);
  const [batchProgress, setBatchProgress] = useState<{ batch:number; total:number; start:number; end:number; completed:number; error?:string } | null>(null);
  const [promptPage, setPromptPage] = useState(1);
  const [sceneJump, setSceneJump] = useState('');
  const autoResumeHandledRef = useRef(false);
  const directions = state.sceneDirections;

  const requestPrompts = async (ai: GoogleGenAI, selected: typeof directions): Promise<T2VPrompt[]> => {
    const omni=state.t2vPromptProfile==='omni-flash';
    const response = await ai.models.generateContent({ model: settings.model, contents: JSON.stringify(buildFlowContext(state.topic, selected, state.t2vPromptProfile)), config: {
      responseMimeType:'application/json', responseSchema:omni?omniResponseSchema:responseSchema,
      systemInstruction:omni
        ? `Return one structured Omni Flash direction for every supplied scene and copy each scene number exactly. Fill prompt_sections with complete natural-language clauses for cinematography, subject, literal visible action, environment, style_lighting, product_state, synchronized ambient sound, and concise scene exclusions. Honor visual_treatment, visual_family, product_visibility, showdown_role, energy_level, camera_platform, and graphic_spec exactly. LIVE_ACTION_T2V is physical documentary footage. For STATIC_GRAPHIC_T2V and MOTION_GRAPHIC_T2V, explain only graphic_spec.visual_claim with its assigned flat-vector composition, motion pattern, nonverbal annotation devices, and maximum animated-element count. Use one clear concept, a static background, stable simplified geometry, limited keyframed motion, and a final-quarter comprehension hold. The graphic must be complete without editor work: never request labels, blank cards, later typography, numbers, maps with readable locations, speech bubbles, fake HUDs, or precise generated data. For an aviation showdown scene, use the supplied physically credible filming platform, one continuous aerodynamically plausible action, stable scale and geometry, environmental response caused by the aircraft, and a settled ending. The role controls the shot's narrative function: establish before release, vary exterior and operator perspective, use grounded resets, make a later peak materially stronger, and resolve through stable return. Never turn a scene with the supplied generation duration into a rapid internal montage. OPERATIONAL_CONTEXT, DYNAMIC_TESTING, and DELIVERY_AND_ROLLOUT must preserve the supplied starting state, one physically plausible maneuver, propulsion or control behavior, environmental response, one achievable camera, and a stable ending configuration across the full clip. Never add weapon discharge, explosions, active combat, impossible aerobatics, unverified flares or stores, invented unit markings, or exact-event/location claims. For NONE visibility omit the product; DETAIL_ONLY stays module-scoped; PARTIAL preserves incompleteness; FULL preserves canonical identity. The application compiles final prose and temporal progression. Use one primary action and camera behavior. Treat the handoff as authoritative; preserve counts, state, geometry, chronology, and continuity. Never invent internals, future components, readable graphic text, labels, logos, maps, or precise generated data. Do not return voiceover, duration, headings, raw JSON text, or abstract narration.`
        : `Create direct text-to-video prompts only. Return exactly one item per supplied scene and copy its number. Do not return or rewrite voiceover. Use the supplied subject, primary action, supporting motion, environment, camera, lighting, material, transition, continuity, visible features and assembly state. Do not invent components or extra actions. ${profileInstruction(state.t2vPromptProfile)}`,
    }});
    const parsed=JSON.parse(response.text || '[]');
    const raw = omni?validateBatchNumbers(parsed,selected):validateBatchResponse(parsed, selected);
    const byNumber = new Map(raw.map(item=>[Number(item.number),item]));
    return selected.map(direction => { const item=byNumber.get(direction.number);
      if(!omni) return { number:direction.number, stage_id:direction.stage_id, state:direction.state, action_description:String(item.action_description||direction.primary_action), video_prompt:finalizeFlowPrompt(String(item.video_prompt),direction,state.topic,state.t2vPromptProfile), voiceover:direction.voiceover, stock_keywords:String(item.stock_keywords||''), continuity_notes:String(item.continuity_notes||direction.continuity_from_previous), quality_flags:Array.isArray(item.quality_flags)?item.quality_flags:[] };
      if(!item?.prompt_sections||typeof item.prompt_sections!=='object') throw new Error(`Scene ${direction.number} has no structured Omni prompt sections.`);
      const {sections}=normalizeOmniSections(item.prompt_sections,direction,state.topic);
      const video_prompt=compileOmniPrompt(sections,direction);
      return {number:direction.number,stage_id:direction.stage_id,state:direction.state,action_description:String(item.action_description||direction.primary_action),video_prompt,voiceover:direction.voiceover,stock_keywords:String(item.stock_keywords||''),continuity_notes:String(item.continuity_notes||direction.continuity_from_previous),quality_flags:[],omniSections:sections};
    });
  };

  const generate = async (demo: boolean, resume = false) => {
    if (!directions.length) return toast.error('Approve valid Phase 2 directions first.');
    const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return toast.error('Add a Gemini API key in Settings.');
    setLoading(demo ? 'demo' : 'full');
    setBatchProgress(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      if (demo) {
        const selected = directions.slice(0, Math.min(3,directions.length));
        const prompts = await requestPrompts(ai, selected);
        setState(p=>({...p,demoState:'generated',demoScenes:prompts,demoSceneNumbers:prompts.map(x=>x.number)}));
        toast.success('Demo T2V prompts generated.');
      } else {
        const existing = resume ? state.visualPrompts : [];
        const remaining = missingDirections(directions, existing);
        const batches = createDirectionBatches(remaining);
        const totalProjectBatches = Math.ceil(directions.length / T2V_BATCH_SIZE);
        const startedAt = resume && state.generationSession.startedAt ? state.generationSession.startedAt : new Date().toISOString();
        let durableState = await commitProjectState({
          ...state,
          visualPrompts: existing,
          demoScenes: [],
          demoSceneNumbers: [],
          demoState: 'idle',
          generationSession: {
            status: 'running',
            totalBatches: totalProjectBatches,
            currentBatch: state.generationSession.currentBatch,
            batchStartScene: null,
            batchEndScene: null,
            completedScenes: existing.length,
            startedAt,
            lastCommittedAt: state.generationSession.lastCommittedAt,
            error: null,
          },
        });
        let accumulated:T2VPrompt[];
        try {
          accumulated = await runSequentialBatches(batches,existing,batch=>requestPrompts(ai,batch),async(batch,items)=>{
            const batchNumber=Math.floor((batch[0].number-1)/T2V_BATCH_SIZE)+1;
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:batch[0].number,end:batch.at(-1)!.number,completed:items.length});
            durableState = await commitProjectState({...durableState,generationSession:{...durableState.generationSession,status:'running',currentBatch:batchNumber,batchStartScene:batch[0].number,batchEndScene:batch.at(-1)!.number,error:null}});
          },async(batch,items)=>{
            const batchNumber=Math.floor((batch[0].number-1)/T2V_BATCH_SIZE)+1;
            const complete = missingDirections(directions, items).length === 0;
            durableState = await commitProjectState({
              ...durableState,
              visualPrompts: items,
              demoState: 'approved',
              demoScenes: [],
              demoSceneNumbers: [],
              generationSession: {
                ...durableState.generationSession,
                status: complete ? 'complete' : 'running',
                currentBatch: batchNumber,
                batchStartScene: batch[0].number,
                batchEndScene: batch.at(-1)!.number,
                completedScenes: items.length,
                lastCommittedAt: new Date().toISOString(),
                error: null,
              },
            }, 'batch');
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:batch[0].number,end:batch.at(-1)!.number,completed:items.length});
          });
        } catch(error) {
          if(error instanceof PromptBatchError){
            const batchNumber=Math.floor((error.batch[0].number-1)/T2V_BATCH_SIZE)+1;
            setBatchProgress({batch:batchNumber,total:totalProjectBatches,start:error.batch[0].number,end:error.batch.at(-1)!.number,completed:error.accumulated.length,error:error.message});
            const failedState = {...durableState,visualPrompts:error.accumulated,generationSession:{...durableState.generationSession,status:'failed' as const,completedScenes:error.accumulated.length,error:error.message}};
            setState(failedState);
            void commitProjectState(failedState).catch(()=>undefined);
            toast.error(`Batch ${batchNumber} paused: ${error.message}`); return;
          }
          throw error;
        }
        toast.success(`All ${accumulated.length} T2V prompts generated in ${totalProjectBatches} batch${totalProjectBatches===1?'':'es'}.`);
      }
    } catch(error) { toast.error(error instanceof Error?error.message:'T2V generation failed.'); }
    finally { setLoading(null); }
  };
  const completedNumbers = new Set(state.visualPrompts.map(prompt=>prompt.number).filter(number=>directions.some(direction=>direction.number===number)));
  const isComplete = directions.length > 0 && completedNumbers.size === directions.length && state.generationSession.status === 'complete';
  const isPartial = completedNumbers.size > 0 && !isComplete;
  const canResume = !isComplete && (isPartial || Boolean(batchProgress?.error));
  const shown = state.visualPrompts.length ? state.visualPrompts : state.demoScenes;
  const orderedShown = [...shown].sort((a,b)=>a.number-b.number);
  const pageCount = promptPageCount(orderedShown.length);
  const pagePrompts = promptPageItems(orderedShown,promptPage);
  useEffect(()=>setPromptPage(page=>clampPromptPage(page,orderedShown.length)),[orderedShown.length]);
  useEffect(()=>{
    if(!resumeAfterRecovery||autoResumeHandledRef.current)return;
    autoResumeHandledRef.current=true;
    onResumeAfterRecoveryConsumed();
    void generate(false,true);
  },[resumeAfterRecovery]);
  const update = (number:number,field:'video_prompt'|'action_description'|'stock_keywords',value:string) => setState(p=>({ ...p, visualPrompts:p.visualPrompts.map(x=>x.number===number?{...x,[field]:value}:x), demoScenes:p.demoScenes.map(x=>x.number===number?{...x,[field]:value}:x) }));
  const profileLabel = state.t2vPromptProfile === 'omni-flash' ? 'Gemini Omni Flash' : 'Veo / Google Flow';
  const allText = orderedShown.map(prompt=>`${prompt.number}: ${prompt.video_prompt}`).join('\n\n');
  const exportCsv = () => download('t2v-prompts.csv', ['profile,number,start,end,transcript_duration,generation_duration,chapter,beat,visual_family,story_function,visual_treatment,product_visibility,showdown_role,energy_level,camera_platform,graphic_subtype,graphic_claim,graphic_composition,graphic_motion,stage,state,action,voiceover,t2v_prompt,keywords,continuity,quality_flags',...state.visualPrompts.map(p=>{const d=directions[p.number-1];return [state.t2vPromptProfile,p.number,d?.start,d?.end,d?.duration,d?.generation_duration_seconds,d?.chapter_id,d?.beat_id,d?.visual_family,d?.story_function,d?.visual_treatment,d?.product_visibility,d?.showdown_role,d?.energy_level,d?.camera_platform,d?.graphic_spec?.graphic_subtype,d?.graphic_spec?.visual_claim,d?.graphic_spec?.composition,d?.graphic_spec?.motion_pattern,p.stage_id,p.state,p.action_description,p.voiceover,p.video_prompt,p.stock_keywords,p.continuity_notes,(p.quality_flags||[]).join('|')].map(csvCell).join(',')})].join('\n'),'text/csv');
  const exportVo = () => download('timestamped-vo.txt', directions.map(d=>`[${formatTimestamp(d.start)} - ${formatTimestamp(d.end)}] Scene ${d.number}${d.silent?' [SILENT]':''}\n${d.voiceover}`).join('\n\n'),'text/plain');
  const recompileAll = () => {
    if(state.t2vPromptProfile!=='omni-flash')return;
    const promptCount=state.visualPrompts.length||state.demoScenes.length;
    if(!promptCount)return;
    setState(previous=>({
      ...previous,
      visualPrompts:recompileOmniPrompts(previous.visualPrompts,directions,previous.topic),
      demoScenes:recompileOmniPrompts(previous.demoScenes,directions,previous.topic),
    }));
    toast.success(`Recompiled ${promptCount} Omni prompt${promptCount===1?'':'s'} locally. No API request was made.`);
  };

  return <div className="phase-canvas space-y-6">
    <Button variant="link" className="p-0 text-muted-foreground" onClick={()=>setState(s=>({...s,phase:2}))}><ArrowLeft className="h-3 w-3 mr-1"/>Review Directions</Button>
    <div className="section-intro section-intro--amber"><div className="eyebrow text-amber-600 dark:text-amber-400">Prompt studio</div><h2 className="text-xl font-bold mt-1">Generate, refine, and export</h2><p className="text-sm text-muted-foreground mt-1">Direct timestamped video prompts with the exact imported VO attached locally.</p></div>
    <div className="content-panel content-panel--amber p-4 sm:p-5 space-y-3">
      <label className="eyebrow">Google Flow target profile</label>
      <Select value={state.t2vPromptProfile} onValueChange={(value) => setState(previous => ({ ...previous, t2vPromptProfile:value as T2VPromptProfile, visualPrompts:[], demoScenes:[], demoSceneNumbers:[], demoState:'idle', generationSession:idleGenerationSession() }))}>
        <SelectTrigger className="max-w-md"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="omni-flash">Gemini Omni Flash</SelectItem><SelectItem value="veo-flow">Veo / Google Flow</SelectItem></SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">Changing profile clears only generated Phase 3 output. Select the matching {directions[0]?.generation_duration_seconds ?? directions[0]?.duration ?? 6}s generation length in Flow; available lengths depend on the active Flow model.</p>
    </div>
    {!state.visualPrompts.length && !batchProgress?.error && <div className="grid md:grid-cols-2 gap-3"><Button variant="outline" className="h-12" disabled={!!loading} onClick={()=>generate(true)}>{loading==='demo'?<Loader2 className="animate-spin mr-2"/>:<Play className="h-4 w-4 mr-2"/>}GENERATE 3-SCENE DEMO</Button><Button className="h-12 font-bold shadow-lg shadow-primary/20" disabled={!!loading} onClick={()=>generate(false,false)}>{loading==='full'&&<Loader2 className="animate-spin mr-2"/>}GENERATE ALL · BATCHES OF 30</Button></div>}
    {state.demoScenes.length>0&&!state.visualPrompts.length&&!batchProgress?.error&&<Button className="w-full" disabled={!!loading} onClick={()=>generate(false,false)}>DEMO APPROVED — GENERATE FULL SET IN BATCHES</Button>}
    {canResume && !loading && <div className="grid md:grid-cols-2 gap-3"><Button className="h-12 font-bold" onClick={()=>generate(false,true)}><RefreshCw className="h-4 w-4 mr-2"/>RESUME FROM SCENE {missingDirections(directions,state.visualPrompts)[0]?.number}</Button><Button variant="outline" className="h-12" onClick={()=>generate(false,false)}>RESTART FULL GENERATION</Button></div>}
    {batchProgress && <div className={`rounded-2xl border p-5 space-y-3 ${batchProgress.error?'border-red-500/40 bg-red-500/5':'border-primary/30 bg-primary/5'}`}>
      <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-bold">{batchProgress.error?'GENERATION PAUSED':isComplete?'GENERATION COMPLETE':`BATCH ${batchProgress.batch} OF ${batchProgress.total}`}</span><span>{batchProgress.completed} / {directions.length} scenes completed</span></div>
      <Progress value={directions.length ? (batchProgress.completed/directions.length)*100 : 0}/>
      <div className="text-[10px] text-muted-foreground">Scenes {batchProgress.start}–{batchProgress.end} · fixed {T2V_BATCH_SIZE}-scene sequential batches</div>
      {batchProgress.error&&<div className="flex gap-2 text-xs text-red-400"><AlertCircle className="h-4 w-4 shrink-0"/>{batchProgress.error}</div>}
    </div>}
    {isComplete && !batchProgress && <Badge className="bg-green-600/20 text-green-500 border-green-500/30">GENERATION COMPLETE · {directions.length} SCENES</Badge>}
    {shown.length>0 && <div className="content-panel flex flex-wrap gap-2 p-3"><Button variant="outline" onClick={async()=>toast[await copyToClipboard(allText)?'success':'error'](`Copied ${shown.length} prompt${shown.length===1?'':'s'} in scene order.`)}><Copy className="h-4 w-4 mr-2"/>COPY ALL PROMPTS</Button>{state.t2vPromptProfile==='omni-flash'&&<Button variant="outline" onClick={recompileAll}><RefreshCw className="h-4 w-4 mr-2"/>RECOMPILE ALL PROMPTS</Button>}{isComplete&&<><Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2"/>CSV</Button><Button variant="outline" onClick={exportVo}><Download className="h-4 w-4 mr-2"/>TIMESTAMPED VO</Button></>}</div>}
    {shown.length>0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={promptPage<=1} onClick={()=>setPromptPage(page=>page-1)}><ChevronLeft className="h-4 w-4"/>PREVIOUS</Button>
        <span className="text-xs text-muted-foreground">Page {promptPage} of {pageCount} · {PROMPT_PAGE_SIZE} prompts maximum</span>
        <Button variant="outline" size="sm" disabled={promptPage>=pageCount} onClick={()=>setPromptPage(page=>page+1)}>NEXT<ChevronRight className="h-4 w-4"/></Button>
      </div>
      <form className="flex items-center gap-2" onSubmit={event=>{event.preventDefault();const number=Number(sceneJump);const index=orderedShown.findIndex(prompt=>prompt.number===number);if(index<0)return toast.error(`Scene ${sceneJump} is not available.`);setPromptPage(Math.floor(index/PROMPT_PAGE_SIZE)+1);}}>
        <Input aria-label="Scene number" type="number" min={1} value={sceneJump} onChange={event=>setSceneJump(event.target.value)} placeholder="Scene #" className="h-9 w-24"/>
        <Button type="submit" variant="outline" size="sm">GO</Button>
      </form>
    </div>}
    <div className="space-y-4">{pagePrompts.map(prompt=>{const d=directions[prompt.number-1];return <div key={prompt.number} className="prompt-card border rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap gap-2"><Badge>SCENE {prompt.number}</Badge><Badge variant="outline">{profileLabel}</Badge><Badge variant="outline">{formatTimestamp(d?.start||0)}–{formatTimestamp(d?.end||0)}</Badge><Badge variant="outline">{prompt.stage_id}</Badge><Badge variant="secondary">STATE {prompt.state}</Badge></div>
      <label className="text-[10px] text-muted-foreground">ACTION</label><Textarea value={prompt.action_description} onChange={e=>update(prompt.number,'action_description',e.target.value)} className="min-h-[65px]"/>
      <label className="text-[10px] text-primary font-bold">T2V PROMPT</label><Textarea value={prompt.video_prompt} onChange={e=>update(prompt.number,'video_prompt',e.target.value)} className="min-h-[180px]"/>
      <div className="bg-cyan-500/[0.06] border border-cyan-500/15 p-3.5 rounded-xl text-xs"><div className="text-[10px] text-cyan-700 dark:text-cyan-300 font-bold mb-1">EXACT IMPORTED VO {d?.silent?'· SILENT WINDOW':''}</div>{prompt.voiceover||'[SILENT]'}</div>
      <label className="text-[10px] text-muted-foreground">STOCK KEYWORDS</label><Textarea value={prompt.stock_keywords} onChange={e=>update(prompt.number,'stock_keywords',e.target.value)} className="min-h-[52px]"/>
    </div>})}</div>
  </div>;
}
