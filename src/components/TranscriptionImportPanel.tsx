import { Dispatch, SetStateAction, useRef } from 'react';
import { CheckCircle2, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { AppState } from '../types';
import { useSettings } from './SettingsContext';
import { formatTimestamp } from '../lib/timedTranscript';
import { importTranscriptionJson } from '../lib/transcriptionImport';
import { createResumableProductionSession, firstChangedTranscriptionScene, invalidateFromScene, synchronizeProductionSession } from '../lib/productionSession';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

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
  return <div className="content-panel content-panel--cyan mb-8 p-5 sm:p-6 space-y-4">
    <div><h3 className="font-bold tracking-wide text-base flex items-center gap-2"><span className="section-icon section-icon--cyan"><FileJson className="h-4 w-4"/></span>Timestamped transcription</h3><p className="text-[11px] text-muted-foreground mt-2">Required · English · word-level timestamps · automatically split into {settings.sceneDurationSeconds}s scenes</p></div>
    <div className="rounded-xl border border-border/50 bg-background/55 p-3.5 text-xs text-muted-foreground">Upload your pre-split JSON with <code>duration</code> and a <code>scenes</code> array containing <code>start</code>, <code>end</code>, and <code>text</code> or <code>voiceover</code>. Word-timestamp JSON remains supported.</div>
    <Button variant="outline" className="relative"><FileJson className="h-4 w-4 mr-2"/>{transcript ? 'REPLACE TRANSCRIPTION JSON' : 'IMPORT TRANSCRIPTION JSON'}<input ref={inputRef} type="file" accept=".json,application/json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={event=>event.target.files?.[0]&&importFile(event.target.files[0])}/></Button>
    {transcript && <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[10px]"><Badge><CheckCircle2 className="h-3 w-3 mr-1"/>IMPORTED</Badge><Badge variant="outline">{transcript.audioFileName}</Badge><Badge variant="outline">{formatTimestamp(transcript.duration)}</Badge><Badge variant="outline">{transcript.scenes.length} scenes</Badge><Badge variant="outline">{transcript.words.length} words</Badge></div>
      <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">{transcript.scenes.map(scene=><div key={scene.number} className="grid grid-cols-[110px_1fr] gap-3 items-start p-3 rounded-xl border border-border/50 bg-background/55"><div className="text-[10px] font-mono"><div className="font-bold text-cyan-600 dark:text-cyan-400">SCENE {String(scene.number).padStart(3,'0')}</div><div className="text-muted-foreground mt-1">{formatTimestamp(scene.start)}<br/>{formatTimestamp(scene.end)}</div></div><Textarea value={scene.text} placeholder="Silent VO window" onChange={event=>updateSceneText(scene.number,event.target.value)} className="min-h-[58px] text-xs"/></div>)}</div>
    </div>}
  </div>;
}
