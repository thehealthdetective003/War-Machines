import { Dispatch, SetStateAction, useRef } from 'react';
import { CheckCircle2, FileJson, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AppState } from '../types';
import { useSettings } from './SettingsContext';
import { formatTimestamp } from '../lib/timedTranscript';
import { importTranscriptionJson } from '../lib/transcriptionImport';
import { createResumableProductionSession, firstChangedTranscriptionScene, invalidateFromScene, synchronizeProductionSession } from '../lib/productionSession';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { AdvancedDetails } from './AdvancedDetails';
import { transcriptSummary } from '../lib/uiPresentation';

interface Props { state: AppState; setState: Dispatch<SetStateAction<AppState>>; }
export function TranscriptionImportPanel({ state, setState }: Props) {
  const { settings } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const transcript = state.voiceoverTranscription;
  const importFile = async (file: File) => {
    try {
      const imported = importTranscriptionJson(JSON.parse(await file.text()), file.name, settings.sceneDurationSeconds);
      setState(prev => {const changed=firstChangedTranscriptionScene(prev.voiceoverTranscription?.scenes||[],imported.scenes)||1,invalidated=invalidateFromScene(prev,changed),draft={...invalidated,phase:1 as const,masterVoiceoverScript:imported.text,voiceoverTranscription:imported},session=createResumableProductionSession(imported.scenes,draft.plannedScenes,draft.sceneDirections,draft.visualPrompts);return {...draft,generationSession:synchronizeProductionSession(session,draft)} as AppState;});
      toast.success(`Imported ${imported.words.length} timed words into ${imported.scenes.length} scenes.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import transcription JSON.'); }
    finally { if (inputRef.current) inputRef.current.value = ''; }
  };
  const updateSceneText = (number: number, text: string) => setState(prev => {
    if (!prev.voiceoverTranscription) return prev;
    const scenes = prev.voiceoverTranscription.scenes.map(scene => scene.number === number ? { ...scene, text, silent: !text.trim() } : scene);
    const masterVoiceoverScript = scenes.map(scene => scene.text).filter(Boolean).join(' ');
    const invalidated=invalidateFromScene(prev,number);return { ...invalidated, phase: 1, masterVoiceoverScript, voiceoverTranscription: { ...prev.voiceoverTranscription, scenes, text: masterVoiceoverScript } };
  });
  return <div className="space-y-4">
    {transcript&&<div><p className="break-all text-sm font-medium">{transcript.audioFileName}</p><p className="mt-1 text-xs text-muted-foreground">{transcriptSummary(transcript)}</p></div>}
    <Button variant="outline" className="relative min-h-10"><Upload className="mr-2 h-4 w-4"/>{transcript?'Replace transcript':'Import transcript'}<input ref={inputRef} type="file" accept=".json,application/json" aria-label="Import timestamped transcript JSON" className="absolute inset-0 cursor-pointer opacity-0" onChange={event=>event.target.files?.[0]&&void importFile(event.target.files[0])}/></Button>
    {transcript&&<AdvancedDetails summary={settings.showProductionDiagnostics?'Transcript diagnostics':'Review transcript scenes'} defaultOpen={settings.showProductionDiagnostics}><div className="mb-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{transcript.scenes.length} scenes</span>{settings.showProductionDiagnostics&&<><span>·</span><span>{transcript.words.length} timed words</span><span>·</span><span>{transcript.model}</span></>}</div><div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{transcript.scenes.map(scene=><div key={scene.number} className="grid gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 sm:grid-cols-[105px_1fr]"><div className="text-[10px]"><div className="font-semibold">Scene {scene.number}</div><div className="mt-1 font-mono text-muted-foreground">{formatTimestamp(scene.start)}–{formatTimestamp(scene.end)}</div></div><Textarea value={scene.text} placeholder="Silent VO window" onChange={event=>updateSceneText(scene.number,event.target.value)} className="min-h-[58px] text-xs"/></div>)}</div></AdvancedDetails>}
  </div>;
}
