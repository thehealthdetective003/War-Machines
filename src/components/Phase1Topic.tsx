import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Download, Copy, ChevronDown, ChevronUp, AlertCircle, AlertTriangle, ArrowRight, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, TopicBrief } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, copyToClipboard } from '@/lib/utils';
import { normalizeTopicBrief, validateAdaptiveBrief, validateAdaptiveWarnings, getLifecycleStageCount, getNegativePromptGlobal } from '../lib/adaptiveSchema';
import { StandardPreview } from './previews/StandardPreview';
import { useSettings } from './SettingsContext';
import { DEFAULT_PRODUCTION_TEMPLATE, isProductionHandoff, normalizeProductionHandoff, productionTemplatePrompt } from '../lib/productionTemplate';
import { HandoffValidationResult, validateVisualProductionHandoff } from '../lib/handoffValidation';
import { v2HandoffSceneDuration } from '../lib/sceneDuration';
import { idleGenerationSession } from '../lib/generationSession';
import { TranscriptionImportPanel } from './TranscriptionImportPanel';
import { validateProductionReadiness } from '../lib/setupValidation';
import { buildDocumentaryScenePlan } from '../lib/scenePlanner';
import { createProductionSession } from '../lib/productionSession';
interface Phase1TopicProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}
export function Phase1Topic({ state, setState }: Phase1TopicProps) {
  const { settings, setSettings } = useSettings();
  const activeProductionTemplate = settings.productionTemplate || DEFAULT_PRODUCTION_TEMPLATE;
  const standardBlankTemplate = JSON.stringify(activeProductionTemplate, null, 2);
  const [jsonInput, setJsonInput] = useState('');
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [showPasteEditor, setShowPasteEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [parsedBrief, setParsedBrief] = useState<TopicBrief | null>(null);
  const [validationResult, setValidationResult] = useState<HandoffValidationResult | null>(null);
  const readiness=validateProductionReadiness(state);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (isValid && parsedBrief) {
          handleLockTopic();
        } else {
          handleValidate();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isValid, parsedBrief, jsonInput]);
  useEffect(() => {
    if (state.topic && !jsonInput) {
      setJsonInput(JSON.stringify(state.topic, null, 2));
      setParsedBrief(state.topic);
      const result = validateVisualProductionHandoff(state.topic);
      setValidationResult(result);
      setIsValid(result.valid);
    } else if (!state.topic && !jsonInput) {
      setJsonInput(standardBlankTemplate);
    }
  }, [state.topic, jsonInput, standardBlankTemplate]);
  const handleDownloadTemplate = () => {
    const template = standardBlankTemplate;
    const blob = new Blob([template], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'standard-lifecycle_brief_template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };
  const handleCopyPrompt = async () => {
    const promptText = productionTemplatePrompt(activeProductionTemplate);
    const success = await copyToClipboard(promptText);
    if (success) {
      toast.success('Research prompt copied to clipboard');
    } else {
      toast.error('Copy failed. Please copy manually.');
    }
  };
  const handleImportBrief = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      setJsonInput(JSON.stringify(parsed, null, 2));
      setShowPasteEditor(true);
      const result = validateVisualProductionHandoff(parsed);
      setValidationResult(result);
      setIsValid(false); setParsedBrief(null); setError(null); setWarnings([]);
      if (result.valid) toast.success(`${result.status} imported. Validate and load it to continue.`);
      else {
        setError('Invalid production JSON. Fix the listed errors before loading it.');
        toast.error('Invalid production JSON. The current project was not changed.');
      }
    } catch {
      setValidationResult(validateVisualProductionHandoff(null));
      setError('Invalid JSON file. Check its syntax and try again.');
    }
  };
  const handleValidate = () => {
    setError(null);
    setWarnings([]);
    setIsValid(false);
    setParsedBrief(null);
    setValidationResult(null);
    if (!jsonInput.trim()) {
      setError('Please paste some JSON first.');
      return;
    }
    try {
      const parsed = JSON.parse(jsonInput);
      const result = validateVisualProductionHandoff(parsed);
      setValidationResult(result);
      if (!result.valid) {
        setError('Invalid production JSON. Fix the listed schema or reference errors before loading it.');
        return;
      }
      const normalized = isProductionHandoff(parsed) ? normalizeProductionHandoff(parsed) : normalizeTopicBrief(parsed);
      const missing = validateAdaptiveBrief(normalized);
      const adaptiveWarnings = validateAdaptiveWarnings(normalized);
      
      if (missing.length > 0) {
        setWarnings([...missing.map(item => `Missing: ${item}`), ...adaptiveWarnings]);
        // We still allow it if it's valid JSON, but user needs to be aware
        setParsedBrief(normalized as TopicBrief);
        setIsValid(true);
      } else {
        setWarnings(adaptiveWarnings);
        setParsedBrief(normalized as TopicBrief);
        setIsValid(true);
      }
    } catch (e) {
      setValidationResult(validateVisualProductionHandoff(null));
      setError('Invalid JSON. Check your brackets and quotes.');
    }
  };
  const handleLockTopic = () => {
    if (!parsedBrief) return;
    const handoffDuration = v2HandoffSceneDuration(parsedBrief);
    if (handoffDuration !== null) {
      setSettings(previous => ({ ...previous, sceneDurationSeconds: handoffDuration }));
    }
    
    setState((prev) => ({
      ...prev,
      topic: parsedBrief,
      masterVoiceoverScript: prev.voiceoverTranscription?.text || parsedBrief.master_voiceover_script || '',
      projectName: parsedBrief.topic?.product || parsedBrief.topic?.title || "Untitled",
      plannedScenes: [], sceneDirections: [], visualPrompts: [], demoScenes: [], demoSceneNumbers: [], demoState: 'idle',
      generationSession: idleGenerationSession(),
      phase: 1,
    }));
  };
  const startProduction=()=>{
    const current=validateProductionReadiness(state);if(!current.ready)return toast.error(current.errors[0]);
    if(!(settings.apiKey||process.env.GEMINI_API_KEY))return toast.error('Add a Gemini API key in Settings before starting production.');
    const scenes=state.voiceoverTranscription!.scenes,previewPlan=buildDocumentaryScenePlan(state.topic!,scenes),generationSession=createProductionSession(scenes,previewPlan);
    setState(previous=>({...previous,phase:2,plannedScenes:[],sceneDirections:[],visualPrompts:[],demoState:'idle',demoScenes:[],demoSceneNumbers:[],generationSession:{...generationSession,status:'running',startedAt:new Date().toISOString()}}));
  };
  return (
    <div className="phase-canvas flex flex-col h-full w-full space-y-6 pb-8">
      {/* 1. TOP SECTION - Instructions */}
      <Collapsible
        open={isHowToOpen}
        onOpenChange={setIsHowToOpen}
        className="content-panel overflow-hidden"
      >
        <CollapsibleTrigger className="w-full flex justify-between items-center p-4 h-auto hover:bg-primary/5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-all">
          <span className="font-mono text-primary font-bold tracking-widest text-xs">QUICK START GUIDE</span>
          {isHowToOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Complete the Engine research workflow in an LLM, including reference-media
            analysis, then import its production JSON here. The app validates the evidence
            and uses it automatically when synchronizing narration, directing scenes, and
            generating prompts.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDownloadTemplate}
              className="font-mono text-[10px] h-8 bg-muted/20 border-border hover:bg-muted/40"
            >
              <Download className="h-3 w-3 mr-2" />
              Download blank template
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleCopyPrompt}
              className="font-mono text-[10px] h-8 bg-muted/20 border-border hover:bg-muted/40"
            >
              <Copy className="h-3 w-3 mr-2" />
              Copy LLM prompt
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {/* 2. MIDDLE SECTION - JSON Paste */}
      <div className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <Button className="relative h-14 font-bold tracking-widest shadow-lg shadow-primary/20">
            <FileJson className="h-5 w-5 mr-2"/>IMPORT PRODUCTION JSON
            <input type="file" accept=".json,application/json" aria-label="Import Engine production JSON" className="absolute inset-0 opacity-0 cursor-pointer" onChange={event=>{const file=event.target.files?.[0]; if(file) handleImportBrief(file); event.currentTarget.value='';}}/>
          </Button>
          <Button variant="outline" className="h-14" onClick={()=>setShowPasteEditor(value=>!value)}>{showPasteEditor?'HIDE JSON EDITOR':'PASTE JSON (OPTIONAL)'}</Button>
        </div>
        <div className="space-y-2 block">
          {/* Left Column: Existing JSON Blueprint Box */}
          <div className="space-y-2 block">
            {showPasteEditor && <><label className="text-xs font-mono font-bold tracking-wider text-primary uppercase">
              PROJECT JSON BLUEPRINT [IMPORT REVIEW / OPTIONAL PASTE]
            </label>
            <div className="relative block">
              <Textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  setIsValid(false);
                  setParsedBrief(null);
                  setError(null);
                  setWarnings([]);
                  setValidationResult(null);
                }}
                placeholder="{ paste your completed topic brief JSON here... }"
                className="h-[500px] overflow-y-auto resize-none font-mono text-xs bg-slate-950/[0.03] dark:bg-slate-950/60 border-border/60 hover:border-primary/30 focus-visible:ring-primary/30 p-4 text-foreground shadow-inner focus-visible:border-primary/50 rounded-2xl"
              />
              <div className="absolute top-3 right-3 text-primary/20 pointer-events-none">
                <FileJson className="h-8 w-8" />
              </div>
            </div></>}
          </div>
        </div>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-xs font-mono"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        )}
        {validationResult && (
          <div className={cn(
            'rounded-md border p-3 font-mono text-xs',
            validationResult.valid
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          )}>
            <div className="font-bold uppercase tracking-wider">{validationResult.status}</div>
            {!validationResult.valid && validationResult.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validationResult.errors.map((item, index) => (
                  <li key={`${item.path}-${item.code}-${index}`}><span className="font-bold">{item.path}</span>: {item.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {warnings.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-500 text-xs font-mono space-y-1"
          >
            <div className="flex items-center gap-2 font-bold mb-1">
              <AlertTriangle className="h-4 w-4" />
              REVIEW WARNINGS
            </div>
            <ul className="list-disc list-inside grid grid-cols-2 gap-x-4">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </motion.div>
        )}
        <div className="relative">
          <Button
            onClick={handleValidate}
            className={cn(
              "w-full h-14 font-bold text-lg tracking-widest transition-all duration-300",
              isValid 
                ? "bg-green-600 hover:bg-green-700 text-white" 
                : "bg-amber-500 hover:bg-amber-600 text-amber-950"
            )}
          >
            {isValid ? (
              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex items-center">
                <CheckCircle2 className="h-5 w-5 mr-2" />
                VALIDATED
              </motion.div>
            ) : (
              'VALIDATE & LOAD'
            )}
          </Button>
          <div className="absolute -bottom-5 inset-x-0 text-center text-[10px] text-muted-foreground/60 hidden md:block">
            Shortcut: Ctrl+Enter
          </div>
        </div>
      </div>
      {/* 3. BOTTOM SECTION - Preview Panel */}
      <AnimatePresence>
        {isValid && parsedBrief && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">
                    {validationResult?.status.toUpperCase() || 'VALID LEGACY V1'}
                  </Badge>
                  {validationResult?.format === 'v2' && (() => {
                    const source = parsedBrief._production_handoff as any;
                    const chapters = source?.visual_story_plan?.chapters || [];
                    const beatCount = chapters.reduce((total: number, chapter: any) => total + (chapter.visual_beats?.length || 0), 0);
                    return <>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">V{validationResult.version}</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{chapters.length} CHAPTERS</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{beatCount} BEATS</Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">{source?.environments?.length || 0} ENVIRONMENTS</Badge>
                    </>;
                  })()}
                  <Badge variant="outline" className="font-mono text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">
                    {getLifecycleStageCount(parsedBrief)} STAGES
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${parsedBrief.visual_lock ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-destructive/30 text-destructive bg-destructive/5'}`}>
                    VISUAL LOCK {parsedBrief.visual_lock ? 'PRESENT' : 'MISSING'}
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${parsedBrief.product_identity_lock ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-amber-500/30 text-amber-400 bg-amber-500/5'}`}>
                    PRODUCT IDENTITY {parsedBrief.product_identity_lock ? 'PRESENT' : 'MISSING'}
                  </Badge>
                  <Badge variant="outline" className={`font-mono text-[10px] ${getNegativePromptGlobal(parsedBrief).length > 0 ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-amber-500/30 text-amber-400 bg-amber-500/5'}`}>
                    GLOBAL NEGATIVES {getNegativePromptGlobal(parsedBrief).length}
                  </Badge>
                </div>
                <div className="content-panel p-6">
                  <StandardPreview data={parsedBrief as any} />
                </div>
            </div>
            <div className="relative">
              <Button 
                size="lg"
                onClick={handleLockTopic}
                className="w-full h-14 font-bold xl:text-lg tracking-widest shadow-xl shadow-primary/20"
              >
                LOAD HANDOFF INTO SETUP
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <div className="absolute -top-5 inset-x-0 text-center text-[10px] text-muted-foreground/60 hidden md:block">
                Shortcut: Ctrl+Enter
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {state.topic&&<div className="space-y-4">
        <TranscriptionImportPanel state={state} setState={setState}/>
        <div className="content-panel p-5 space-y-3">
          <div className="eyebrow">Setup compatibility</div>
          {readiness.errors.length?readiness.errors.map(item=><div key={item} className="text-xs text-amber-500">• {item}</div>):<div className="text-xs text-emerald-500 flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/>Handoff, transcription, scene duration, timeline, and downstream dependencies are compatible.</div>}
          {readiness.warnings.map(item=><div key={item} className="text-xs text-muted-foreground">• {item}</div>)}
          <Button className="w-full h-14 font-bold tracking-widest" disabled={!readiness.ready} onClick={startProduction}>START PRODUCTION<ArrowRight className="ml-2 h-5 w-5"/></Button>
        </div>
      </div>}
    </div>
  );
}
