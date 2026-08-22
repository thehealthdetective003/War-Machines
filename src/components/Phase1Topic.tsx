import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Download, Copy, AlertCircle, AlertTriangle, ArrowRight, FileJson, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AppState, TopicBrief } from '../types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn, copyToClipboard } from '@/lib/utils';
import { normalizeTopicBrief, validateAdaptiveBrief, validateAdaptiveWarnings } from '../lib/adaptiveSchema';
import { useSettings } from './SettingsContext';
import { DEFAULT_PRODUCTION_TEMPLATE, isProductionHandoff, normalizeProductionHandoff, productionTemplatePrompt } from '../lib/productionTemplate';
import { HandoffValidationResult, validateVisualProductionHandoff } from '../lib/handoffValidation';
import { v2HandoffSceneDuration } from '../lib/sceneDuration';
import { idleGenerationSession } from '../lib/generationSession';
import { TranscriptionImportPanel } from './TranscriptionImportPanel';
import { validateProductionReadiness } from '../lib/setupValidation';
import { buildDocumentaryScenePlan } from '../lib/scenePlanner';
import { createProductionSession } from '../lib/productionSession';
import { AdvancedDetails } from './AdvancedDetails';
import { handoffSummary, validationPresentation } from '../lib/uiPresentation';
interface Phase1TopicProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}
export function Phase1Topic({ state, setState }: Phase1TopicProps) {
  const { settings, setSettings } = useSettings();
  const activeProductionTemplate = settings.productionTemplate || DEFAULT_PRODUCTION_TEMPLATE;
  const standardBlankTemplate = JSON.stringify(activeProductionTemplate, null, 2);
  const [jsonInput, setJsonInput] = useState('');
  const [showPasteEditor, setShowPasteEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [parsedBrief, setParsedBrief] = useState<TopicBrief | null>(null);
  const [validationResult, setValidationResult] = useState<HandoffValidationResult | null>(null);
  const [importedFileName,setImportedFileName]=useState('');
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
  const loadBrief=(brief:TopicBrief,fileName:string)=>{
    const handoffDuration=v2HandoffSceneDuration(brief);if(handoffDuration!==null)setSettings(previous=>({...previous,sceneDurationSeconds:handoffDuration}));
    setState(prev=>({...prev,topic:brief,masterVoiceoverScript:prev.voiceoverTranscription?.text||brief.master_voiceover_script||'',projectName:brief.topic?.product||brief.topic?.title||'Untitled',handoffFileName:fileName||prev.handoffFileName||'Pasted production handoff.json',plannedScenes:[],sceneDirections:[],visualPrompts:[],generationSession:idleGenerationSession(),phase:1}));
  };
  const handleImportBrief = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      setImportedFileName(file.name);
      setJsonInput(JSON.stringify(parsed, null, 2));
      setShowPasteEditor(false);
      const result = validateVisualProductionHandoff(parsed);
      setValidationResult(result);
      setIsValid(false); setParsedBrief(null); setError(null); setWarnings([]);
      if (result.valid){
        const normalized=isProductionHandoff(parsed)?normalizeProductionHandoff(parsed):normalizeTopicBrief(parsed),missing=validateAdaptiveBrief(normalized),adaptiveWarnings=validateAdaptiveWarnings(normalized);setWarnings([...missing.map(item=>`Missing: ${item}`),...adaptiveWarnings]);setParsedBrief(normalized as TopicBrief);setIsValid(true);loadBrief(normalized as TopicBrief,file.name);toast.success('Visual Production Handoff validated and loaded.');
      }
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
    loadBrief(parsedBrief,importedFileName||state.handoffFileName||'Pasted production handoff.json');
  };
  const startProduction=()=>{
    const current=validateProductionReadiness(state);if(!current.ready)return toast.error(current.errors[0]);
    if(!(settings.apiKey||process.env.GEMINI_API_KEY))return toast.error('Add a Gemini API key in Settings before starting production.');
    const scenes=state.voiceoverTranscription!.scenes,previewPlan=buildDocumentaryScenePlan(state.topic!,scenes),generationSession=createProductionSession(scenes,previewPlan);
    setState(previous=>({...previous,phase:2,plannedScenes:[],sceneDirections:[],visualPrompts:[],generationSession:{...generationSession,status:'running',startedAt:new Date().toISOString()}}));
  };
  const summary=handoffSummary(state.topic),hasApiKey=Boolean(settings.apiKey||process.env.GEMINI_API_KEY),validState=validationPresentation(Boolean(state.topic)),failedState=validationPresentation(false,validationResult?.errors.length||0);
  return (
    <div className="phase-canvas space-y-5 pb-4">
      <div className="setup-input-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><div className="eyebrow">Input 01</div><h2 className="mt-1 text-base font-semibold">Visual Production Handoff</h2>{state.topic?<><p className="mt-1 truncate text-sm text-foreground/90">{state.handoffFileName||'Imported production handoff.json'}</p><p className="mt-1 text-xs text-muted-foreground">{summary.label}</p></>:<p className="mt-1 text-xs text-muted-foreground">Import the completed Engine handoff JSON.</p>}</div>
          {state.topic?<div className="status-success"><CheckCircle2 className="h-4 w-4"/>{validState.label}</div>:<div className="text-xs font-medium text-muted-foreground">Required</div>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={state.topic?'outline':'default'} className="relative min-h-10"><Upload className="mr-2 h-4 w-4"/>{state.topic?'Replace handoff':'Import handoff'}<input type="file" accept=".json,application/json" aria-label="Import Engine production JSON" className="absolute inset-0 cursor-pointer opacity-0" onChange={event=>{const file=event.target.files?.[0];if(file)void handleImportBrief(file);event.currentTarget.value='';}}/></Button>
          <Button variant="ghost" onClick={()=>setShowPasteEditor(value=>!value)}>{showPasteEditor?'Close raw editor':'Paste or view raw data'}</Button>
        </div>
        {showPasteEditor&&<div className="mt-4 space-y-3"><Textarea value={jsonInput} onChange={event=>{setJsonInput(event.target.value);setIsValid(false);setParsedBrief(null);setError(null);setWarnings([]);setValidationResult(null);}} placeholder="Paste the completed handoff JSON" className="h-[340px] resize-y font-mono text-xs"/><Button onClick={isValid&&parsedBrief?handleLockTopic:handleValidate}>{isValid&&parsedBrief?'Load validated handoff':'Validate JSON'}</Button></div>}
        {(error||validationResult&&!validationResult.valid)&&<div className="error-surface mt-4" role="alert"><div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4"/>{failedState.label}</div>{error&&<p className="mt-1 text-sm">{error}</p>}{validationResult&&!validationResult.valid&&<ul className="mt-3 space-y-1.5 text-xs">{validationResult.errors.map((item,index)=><li key={`${item.path}-${item.code}-${index}`}><strong>{item.path}</strong>: {item.message}</li>)}</ul>}</div>}
        {warnings.length>0&&<AdvancedDetails summary={`${warnings.length} handoff warning${warnings.length===1?'':'s'}`} className="mt-4 border-amber-500/25"><div className="space-y-1 text-xs text-amber-500">{warnings.map(item=><div key={item}>• {item}</div>)}</div></AdvancedDetails>}
        {settings.showProductionDiagnostics&&state.topic&&<AdvancedDetails summary="Handoff diagnostics" className="mt-4"><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{JSON.stringify(state.topic,null,2)}</pre></AdvancedDetails>}
      </div>

      <div className="setup-input-card">
        <div className="mb-4 flex items-center justify-between gap-3"><div><div className="eyebrow">Input 02</div><h2 className="mt-1 text-base font-semibold">Timestamped Transcript</h2></div>{state.voiceoverTranscription?<div className="status-success"><CheckCircle2 className="h-4 w-4"/>Validated</div>:<div className="text-xs font-medium text-muted-foreground">Required</div>}</div>
        <TranscriptionImportPanel state={state} setState={setState}/>
      </div>

      <div className="setup-action-panel">
        {!readiness.ready&&<p className="mb-3 text-sm text-muted-foreground">{readiness.errors[0]||'Add both validated inputs to continue.'}</p>}
        {readiness.ready&&!hasApiKey&&<p className="mb-3 text-sm text-amber-500">Add a Gemini API key in Settings before starting.</p>}
        <Button size="lg" className="h-12 w-full text-sm font-bold tracking-[0.08em]" disabled={!readiness.ready||!hasApiKey} onClick={startProduction}>START PRODUCTION<ArrowRight className="ml-2 h-4 w-4"/></Button>
      </div>

      <AdvancedDetails summary="Handoff tools"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={handleDownloadTemplate}><Download className="mr-2 h-3.5 w-3.5"/>Download blank template</Button><Button variant="outline" size="sm" onClick={handleCopyPrompt}><Copy className="mr-2 h-3.5 w-3.5"/>Copy Engine research prompt</Button></div></AdvancedDetails>
    </div>
  );
}
