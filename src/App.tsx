import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Sun, CheckCircle2, FilePlus, FolderOpen, AlertCircle, FileUp, FileDown, Wrench, Boxes, AudioLines, WandSparkles, CircleDot, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { AppState, PhaseType, ProjectCheckpoint, ProjectCheckpointReason } from './types';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings } from './components/SettingsContext';
import { ProjectLibrary } from './components/ProjectLibrary';
import { clearActiveProjectId, exportActiveProject, getActiveProjectId, getProjectCheckpoints, initializeProjectStorage, loadProject, recordDiagnostic, restoreCheckpoint, saveProject } from './lib/storageUtils';
import { toast } from 'sonner';
import { resplitTranscription, resetDownstreamForTiming } from './lib/timedTranscript';
import { migrateProject, projectSceneDuration } from './lib/projectMigration';
import { idleGenerationSession } from './lib/generationSession';

const Phase1Topic = lazy(() => import('./components/Phase1Topic').then(module => ({ default: module.Phase1Topic })));
const Phase2Script = lazy(() => import('./components/Phase2Script').then(module => ({ default: module.Phase2Script })));
const Phase4Visuals = lazy(() => import('./components/Phase4Visuals').then(module => ({ default: module.Phase4Visuals })));

const PHASES = [
  { id: 1, label: 'Topic Brief', eyebrow: 'Foundation', description: 'Define the manufacturing subject', icon: Boxes, tone: 'violet' },
  { id: 2, label: 'Voice & Direction', eyebrow: 'Production', description: 'Synchronize narration and scenes', icon: AudioLines, tone: 'cyan' },
  { id: 3, label: 'T2V Prompts', eyebrow: 'Generation', description: 'Create production-ready prompts', icon: WandSparkles, tone: 'amber' },
];

function WorkspaceLoader({ label = 'Preparing your project workspace' }: { label?: string }) {
  return (
    <div className="min-h-[420px] grid place-items-center p-8" role="status" aria-live="polite">
      <div className="text-center space-y-4">
        <div className="brand-mark mx-auto animate-pulse"><Layers3 className="h-5 w-5" /></div>
        <div>
          <div className="font-bold">{label}</div>
          <div className="text-sm text-muted-foreground mt-1">Loading saved data and recovery checkpoints…</div>
        </div>
      </div>
    </div>
  );
}
export const INITIAL_STATE: AppState = {
  projectSchemaVersion: 12,
  id: undefined,
  projectName: 'Untitled Manufacturing Sequence',
  projectFormat: 'standard-lifecycle',
  phase: 1,
  topic: null,
  plannedScenes: [],
  sceneDirections: [],
  masterVoiceoverScript: '',
  voiceoverTranscription: null,
  t2vPromptProfile: 'omni-flash',
  visualPrompts: [],
  demoState: 'idle',
  demoScenes: [],
  demoSceneNumbers: [],
  generationSession: idleGenerationSession(),
};

export default function App() {
  const { theme, setTheme } = useTheme();
  const { settings, setSettings, isLoaded } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStepperOpen, setIsStepperOpen] = useState(true);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'new' | 'load', id?: string } | null>(null);
  const savedStateRef = useRef<AppState>(INITIAL_STATE);
  const currentStateRef = useRef<AppState>(INITIAL_STATE);
  const hydrationStartedRef = useRef(false);
  const [, setSaveMarker] = useState(0);
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{project:AppState;checkpoints:ProjectCheckpoint[]}|null>(null);
  const [resumeAfterRecovery, setResumeAfterRecovery] = useState(false);
  
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const activePhase = PHASES.find((p) => p.id === state.phase);
  currentStateRef.current=state;
  const isDirty = state !== savedStateRef.current;
  useEffect(() => {
    setState(prev => {
      const transcript = prev.voiceoverTranscription;
      if (!transcript || transcript.sceneDurationSeconds === settings.sceneDurationSeconds) return prev;
      const reset = resetDownstreamForTiming(prev);
      return { ...reset, voiceoverTranscription: resplitTranscription(transcript, settings.sceneDurationSeconds) } as AppState;
    });
  }, [settings.sceneDurationSeconds, state.voiceoverTranscription?.sceneDurationSeconds]);
  // Smooth scroll to top when phase changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state.phase]);
  // Autofill project name from topic product name
  useEffect(() => {
    if (state.topic?.topic?.product && state.projectName === 'Untitled Manufacturing Sequence') {
      setState(s => ({ ...s, projectName: s.topic?.topic?.product || 'Untitled Manufacturing Sequence' }));
    }
  }, [state.topic]);
  const persistSnapshot = useCallback(async (snapshot:AppState, checkpointReason?:ProjectCheckpointReason) => {
    try {
      const savedId=await saveProject(snapshot,checkpointReason?{checkpointReason}:{});
      const persisted=snapshot.id===savedId?snapshot:{...snapshot,id:savedId};
      savedStateRef.current=persisted;
      if(currentStateRef.current===snapshot&&persisted!==snapshot)setState(persisted);
      setSaveMarker(value=>value+1);
      setStorageError(null);
      return persisted;
    } catch(error) {
      const message=error instanceof Error?error.message:'Project storage failed.';
      setStorageError(message);
      void recordDiagnostic('project-save',error,{projectId:snapshot.id,checkpointReason});
      throw error;
    }
  },[]);

  // Initialize IndexedDB and hydrate the active project exactly once.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    if(!isLoaded||hydrationStartedRef.current)return;
    hydrationStartedRef.current=true;
    void (async()=>{
      try{
        const migrationReport=await initializeProjectStorage();
        if(migrationReport.migratedProjects)toast.success(`Migrated ${migrationReport.migratedProjects} project${migrationReport.migratedProjects===1?'':'s'} to reliable browser storage.`);
        if(migrationReport.corruptKeys.length)toast.warning(`${migrationReport.corruptKeys.length} legacy storage record${migrationReport.corruptKeys.length===1?'':'s'} could not be migrated and was left untouched.`);
        const activeId=getActiveProjectId();
        const raw=activeId?await loadProject(activeId):null;
        if(raw){
          const duration=projectSceneDuration(raw,settings.sceneDurationSeconds);
          const migration=migrateProject(raw,INITIAL_STATE,duration);
          if(migration.state){
            const migrated=migration.message?await persistSnapshot(migration.state):migration.state;
            const interrupted=migrated.generationSession.status==='running';
            const hydrated=interrupted?{...migrated,generationSession:{...migrated.generationSession,status:'interrupted' as const,error:'Generation was interrupted before the current batch committed.'}}:migrated;
            savedStateRef.current=hydrated;currentStateRef.current=hydrated;setState(hydrated);
            setSettings(previous=>({...previous,sceneDurationSeconds:duration}));
            if(interrupted)setRecovery({project:hydrated,checkpoints:await getProjectCheckpoints(hydrated.id!)});
            if(migration.message)toast.info(migration.message);
          }
        }
      }catch(error){
        const message=error instanceof Error?error.message:'Project storage initialization failed.';
        setStorageError(message);void recordDiagnostic('storage-initialize',error);
      }finally{setIsHydrated(true);}
    })();
  },[isLoaded,persistSnapshot,setSettings,settings.sceneDurationSeconds]);

  const handleSave = useCallback(async () => {
    try {
      await persistSnapshot(currentStateRef.current);
      setShowSavedFlash(true);
      setTimeout(() => setShowSavedFlash(false), 1500);
    } catch {/* Persistent banner provides recovery actions. */}
  }, [persistSnapshot]);

  // Debounced autosave for edits. Generated batches use explicit durable checkpoints.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isHydrated||!isDirty) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void persistSnapshot(state).catch(()=>undefined);
    }, 750);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state,isDirty,isHydrated,persistSnapshot]);

  useEffect(()=>{
    if(!isHydrated)return;
    const flush=()=>{if(currentStateRef.current!==savedStateRef.current)void persistSnapshot(currentStateRef.current).catch(()=>undefined);};
    const visibility=()=>{if(document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',visibility);};
  },[isHydrated,persistSnapshot]);
  const handleNewProject = () => {
    if (isDirty && state.topic) {
      setPendingAction({ type: 'new' });
    } else {
      const resetState: AppState = { ...INITIAL_STATE, generationSession: idleGenerationSession() };
      clearActiveProjectId();
      savedStateRef.current = resetState;
      currentStateRef.current = resetState;
      setState(resetState);
      setSaveMarker(value => value + 1);
    }
  };
  const confirmNewProject = async (saveBefore: boolean) => {
    if (saveBefore) await handleSave();
    const resetState: AppState = { ...INITIAL_STATE, generationSession: idleGenerationSession() };
    clearActiveProjectId();
    savedStateRef.current = resetState;
    currentStateRef.current = resetState;
    setState(resetState);
    setSaveMarker(value => value + 1);
    setPendingAction(null);
  };
  const handleLoadProject = (id: string) => {
    if (isDirty && state.topic) {
      setPendingAction({ type: 'load', id });
    } else {
      void executeLoad(id);
    }
  };
  const executeLoad = async (id: string) => {
    try {
      const loaded = await loadProject(id);
      if (!loaded) {
        toast.error('Failed to load project. The saved record may be unavailable in this browser profile.');
        return;
      }
      const duration = projectSceneDuration(loaded, settings.sceneDurationSeconds);
      const migration = migrateProject(loaded, INITIAL_STATE, duration);
      if (!migration.state) {
        toast.error('This project uses an unsupported production format. Only Standard Lifecycle projects can be loaded.');
        return;
      }
      const merged = migration.message ? await persistSnapshot(migration.state) : migration.state;
      savedStateRef.current = merged;
      currentStateRef.current = merged;
      setState(merged);
      setSettings(previous => ({ ...previous, sceneDurationSeconds: duration }));
      setSaveMarker(value => value + 1);
      toast.success(`Loaded: ${merged.topic?.topic?.title || merged.projectName}`);
      if (migration.message) toast.info(migration.message);
      setIsLibraryOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Project loading failed.';
      toast.error(message);
      void recordDiagnostic('project-load', error, { projectId: id });
    } finally {
      setPendingAction(null);
    }
  };

  const commitProjectState = useCallback(async (nextState: AppState, checkpointReason?: ProjectCheckpointReason) => {
    const persisted = await persistSnapshot(nextState, checkpointReason);
    currentStateRef.current = persisted;
    setState(persisted);
    return persisted;
  }, [persistSnapshot]);

  const downloadState = useCallback((snapshot: AppState) => {
    const data = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(snapshot.topic?.topic?.title || snapshot.projectName || 'Project').replace(/\s+/g, '_')}_AssemblyLine.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);
  const isPhaseComplete = (phaseId: number) => {
    switch (phaseId) {
      case 1: return state.topic !== null;
      case 2: return state.sceneDirections.length > 0 && state.sceneDirections.length === state.voiceoverTranscription?.scenes.length;
      case 3: return state.visualPrompts.length > 0 && state.visualPrompts.length === state.sceneDirections.length;
      default: return false;
    }
  };
  const completedPhaseCount = PHASES.filter(phase => isPhaseComplete(phase.id)).length;
  if (!isLoaded || !isHydrated) {
    return <div className="app-shell min-h-screen bg-background text-foreground"><WorkspaceLoader /></div>;
  }
  return (
    <div className="app-shell min-h-screen bg-background text-foreground flex flex-col relative">
      <SettingsPanel state={state} setState={setState} open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <ProjectLibrary 
        open={isLibraryOpen} 
        onOpenChange={setIsLibraryOpen} 
        currentState={state}
        onLoadProject={handleLoadProject}
        onNewProject={handleNewProject}
      />
      {/* Confirmation Dialog */}
      <Dialog open={pendingAction !== null} onOpenChange={(o) => !o && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save progress?</DialogTitle>
            <DialogDescription>
              {pendingAction?.type === 'new' 
                ? "You're about to start a new project. Would you like to save your current work first?"
                : "You have unsaved changes. Would you like to save before loading the selected project?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button 
              variant="default" 
              className="bg-primary text-black font-bold"
              onClick={() => void (async () => {
                if (pendingAction?.type === 'new') await confirmNewProject(true);
                else if (pendingAction?.id) {
                   await handleSave();
                   await executeLoad(pendingAction.id);
                }
              })()}
            >
              SAVE & CONTINUE
            </Button>
            <Button 
              variant="outline"
              onClick={() => {
                if (pendingAction?.type === 'new') void confirmNewProject(false);
                else if (pendingAction?.id) void executeLoad(pendingAction.id);
              }}
            >
              DISCARD & CONTINUE
            </Button>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>CANCEL</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Interrupted generation recovery */}
      <Dialog open={recovery !== null} onOpenChange={() => undefined}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recover interrupted generation</DialogTitle>
            <DialogDescription>
              Batch {recovery?.project.generationSession.currentBatch ?? 0} is the last durable batch and contains {recovery?.project.generationSession.completedScenes ?? 0} of {recovery?.project.sceneDirections.length ?? 0} scenes
              {recovery?.project.generationSession.lastCommittedAt ? ` and was saved ${new Date(recovery.project.generationSession.lastCommittedAt).toLocaleString()}` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button className="w-full" onClick={() => {
              if (!recovery) return;
              const resumed = { ...recovery.project, phase: 3 as PhaseType, generationSession: { ...recovery.project.generationSession, status: 'paused' as const, error: null } };
              setState(resumed); currentStateRef.current = resumed; setRecovery(null); setResumeAfterRecovery(true);
            }}>RESUME MISSING SCENES</Button>
            <Button variant="outline" className="w-full" onClick={() => {
              if (!recovery) return;
              const opened = { ...recovery.project, phase: 3 as PhaseType, generationSession: { ...recovery.project.generationSession, status: 'paused' as const } };
              setState(opened); currentStateRef.current = opened; setRecovery(null);
            }}>OPEN WITHOUT RESUMING</Button>
            {recovery?.checkpoints.map((checkpoint, index) => (
              <Button key={checkpoint.id} variant="ghost" className="w-full justify-start" onClick={() => void (async () => {
                const restored = await restoreCheckpoint(checkpoint.id);
                if (!restored) return;
                const duration = projectSceneDuration(restored, settings.sceneDurationSeconds);
                const migration = migrateProject(restored, INITIAL_STATE, duration);
                if (!migration.state) return;
                const migrated = migration.message ? await persistSnapshot(migration.state) : migration.state;
                savedStateRef.current = migrated; currentStateRef.current = migrated; setState(migrated);
                setSettings(previous => ({ ...previous, sceneDurationSeconds: duration })); setSaveMarker(value => value + 1); setRecovery(null);
                toast.success(`Restored checkpoint ${index + 1} from ${new Date(checkpoint.savedAt).toLocaleString()}.`);
              })()}>RESTORE CHECKPOINT {index + 1} · {new Date(checkpoint.savedAt).toLocaleString()}</Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {/* Storage Failure Banner */}
      {storageError && (
        <div className="bg-red-600 text-white p-3 text-sm font-bold flex items-center justify-center gap-4 z-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>PROJECT STORAGE PAUSED: {storageError}</span>
          </div>
          <Button variant="outline" size="sm" className="bg-white/10 border-white/20 hover:bg-white/20 text-white h-7 px-3 text-xs" onClick={() => void persistSnapshot(currentStateRef.current).catch(() => undefined)}>RETRY</Button>
          <Button variant="outline" size="sm" className="bg-white/10 border-white/20 hover:bg-white/20 text-white h-7 px-3 text-xs" onClick={() => void exportActiveProject().catch(() => downloadState(currentStateRef.current))}>EXPORT JSON</Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-white/10 border-white/20 hover:bg-white/20 text-white h-7 px-3 text-xs"
            onClick={() => setIsLibraryOpen(true)}
          >
            MANAGE PROJECTS →
          </Button>
        </div>
      )}
      {/* Top Bar */}
      <header className="app-header sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between max-w-[1600px]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="brand-mark"><Layers3 className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-[0.14em] uppercase">Assembly Line</span>
                <Badge className="hidden sm:inline-flex h-5 bg-primary/10 text-primary border-primary/20 text-[9px]">STUDIO</Badge>
              </div>
              <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
                <span className={`status-dot ${isDirty ? 'status-dot--pending' : 'status-dot--saved'}`} />
                <span className="truncate max-w-[150px] sm:max-w-[260px]">{state.id ? (state.topic?.topic?.product || state.projectName) : 'Untitled project'}</span>
                <span className="hidden sm:inline text-border">•</span>
                <span className="hidden sm:inline font-mono">{isDirty ? 'Saving changes' : 'All changes saved'}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              id="projects-drawer-trigger"
              variant="ghost" 
              size="sm" 
              onClick={() => setIsLibraryOpen(true)} 
              className="flex text-muted-foreground hover:text-foreground h-9 rounded-xl"
              aria-label="Open project library"
            >
              <FolderOpen className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">Library</span>
            </Button>
            
            <Button 
              id="new-project-button-header"
              variant="ghost" 
              size="sm" 
              onClick={handleNewProject} 
              className="hidden lg:flex text-muted-foreground hover:text-foreground h-9 rounded-xl"
            >
              <FilePlus className="h-4 w-4 mr-1.5" />
              New Draft
            </Button>
            {/* IMPORT PROJECT (LOAD) */}
            <Button 
              id="load-project-file-header"
              variant="outline" 
              size="sm" 
              className="hidden xl:flex text-xs font-mono border-primary/20 text-primary hover:bg-primary/10 h-9 relative animate-fade-in rounded-xl"
            >
              <FileUp className="h-4 w-4 mr-1.5" />
              LOAD PROJECT
              <input 
                type="file" 
                accept=".json" 
                aria-label="Load Assembly Line project JSON"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (event) => void (async () => {
                    try {
                      const importedData = JSON.parse(event.target?.result as string);
                      
                      // Validation: check for the core fields of AppState
                      if (importedData && typeof importedData === 'object' && 'phase' in importedData) {
                        if (typeof importedData.phase === 'number' && 'projectName' in importedData) {
                          const duration = projectSceneDuration(importedData, settings.sceneDurationSeconds);
                          const migration = migrateProject(importedData, INITIAL_STATE, duration);
                          const merged = migration.state;
                          if (!merged) {
                            toast.error('Unsupported production format. Only Standard Lifecycle projects can be loaded.');
                            return;
                          }
                          const persisted = await persistSnapshot(merged);
                          currentStateRef.current = persisted;
                          setState(persisted);
                          setSettings(previous => ({ ...previous, sceneDurationSeconds: duration }));
                          toast.success("Project file loaded and synchronized.");
                          if (migration.message) toast.info(migration.message);
                        } else {
                          toast.error("Invalid project file format");
                        }
                      } else {
                        toast.error("File is not a valid Assembly Line project");
                      }
                    } catch (error) {
                      toast.error("Failed to parse project file");
                    }
                  })();
                  reader.readAsText(file);
                  e.target.value = ''; // Reset file input
                }}
              />
            </Button>
            {/* EXPORT PROJECT (SAVE) */}
            <Button 
              id="save-project-file-header"
              variant="outline" 
              size="sm" 
              onClick={() => {
                downloadState(state);
                toast.success("Project JSON downloaded successfully");
              }} 
              className="hidden xl:flex text-xs font-mono border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 h-9 rounded-xl"
            >
              <FileDown className="h-4 w-4 mr-1.5" />
              SAVE PROJECT
            </Button>
            <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
            <Button 
              id="theme-toggle"
              variant="ghost" 
              size="icon" 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="h-9 w-9 text-muted-foreground hover:text-foreground rounded-xl border border-transparent hover:border-border/70"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
            
            {/* TOOLBOX TRIGGER */}
            <Button 
              id="settings-trigger"
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSettingsOpen(true)} 
              className="h-9 w-9 text-primary hover:text-primary hover:bg-primary/10 rounded-xl border border-primary/15"
              title="Factory Toolbox"
              aria-label="Open factory toolbox and settings"
            >
              <Wrench className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <main className="flex-1 mx-auto w-full max-w-[1600px] px-4 sm:px-6 py-5 sm:py-7">
        <div className="grid lg:grid-cols-[270px_minmax(0,1fr)] gap-5 xl:gap-7 items-start">
          <aside className="lg:sticky lg:top-[96px] space-y-4">
            <div className="workflow-panel">
              <button onClick={() => setIsStepperOpen(open => !open)} className="lg:hidden w-full flex items-center justify-between p-4" aria-expanded={isStepperOpen} aria-controls="production-workflow-steps">
                <div className="text-left"><div className="eyebrow">Production workflow</div><div className="font-bold mt-1">Phase {activePhase?.id}: {activePhase?.label}</div></div>
                <span className={`transition-transform ${isStepperOpen ? 'rotate-180' : ''}`}><svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              </button>
              <div className="hidden lg:block p-5 pb-3">
                <div className="eyebrow">Production workflow</div>
                <div className="flex items-end justify-between mt-2"><span className="text-2xl font-extrabold">{completedPhaseCount}<span className="text-muted-foreground/50">/3</span></span><span className="text-[11px] text-muted-foreground">phases ready</span></div>
                <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full workflow-progress" style={{width:`${(completedPhaseCount/3)*100}%`}} /></div>
              </div>
              <div id="production-workflow-steps" className={`${isStepperOpen ? 'block' : 'hidden'} lg:block border-t border-border/50 p-2.5`}>
                {PHASES.map((phase) => {
                  const PhaseIcon = phase.icon;
                  const isActive = state.phase === phase.id;
                  const completed = isPhaseComplete(phase.id);
                  const isAvailable = phase.id === 1 || (phase.id === 2 ? Boolean(state.topic) : isPhaseComplete(2));
                  const unavailableReason = phase.id === 2 ? 'Import and validate a production brief first.' : 'Complete and approve scene directions first.';
                  return <button key={phase.id} data-tone={phase.tone} disabled={!isAvailable} aria-current={isActive ? 'step' : undefined} title={isAvailable ? phase.description : unavailableReason} onClick={() => setState(s => ({...s,phase:phase.id as PhaseType}))} className={`phase-nav-item ${isActive ? 'is-active' : ''}`}>
                    <span className="phase-nav-icon"><PhaseIcon className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1 text-left"><span className="block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">0{phase.id} · {phase.eyebrow}</span><span className="block font-semibold mt-0.5">{phase.label}</span><span className="block text-[11px] text-muted-foreground mt-1 truncate">{phase.description}</span></span>
                    {completed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : isActive ? <CircleDot className="h-4 w-4 text-primary" /> : null}
                  </button>;
                })}
              </div>
            </div>
            <div className="hidden lg:block rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm">
              <div className="eyebrow">Project snapshot</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="metric-tile"><span>Scenes</span><strong>{state.sceneDirections.length || '—'}</strong></div>
                <div className="metric-tile"><span>Prompts</span><strong>{state.visualPrompts.length || '—'}</strong></div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground"><span>Clip duration</span><span className="font-mono font-bold text-foreground">{settings.sceneDurationSeconds}s</span></div>
            </div>
          </aside>

          {/* Phase Content Area */}
          <div className="min-w-0 relative pb-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={state.phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <Card className="workspace-card border border-border/60 bg-card/90 shadow-xl shadow-slate-950/5 dark:shadow-black/20 rounded-3xl relative overflow-hidden gap-0 py-0">
                <CardHeader className={`workspace-header phase-tone-${activePhase?.id} border-b border-border/50 py-6 sm:py-7 px-5 sm:px-8`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="eyebrow">Phase 0{activePhase?.id} · {activePhase?.eyebrow}</div>
                      <CardTitle className="text-2xl sm:text-3xl font-extrabold tracking-[-0.03em] flex items-center gap-3">
                        <span>{activePhase?.label}</span>
                      </CardTitle>
                      <CardDescription className="text-sm text-muted-foreground max-w-xl">
                        {activePhase?.description}
                      </CardDescription>
                    </div>
                    {isDirty && (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25 font-mono text-[10px] w-fit px-3 py-1.5 rounded-full">
                        SAVING CHANGES
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className={`workspace-body min-h-[500px] ${activePhase?.id !== 1 && activePhase?.id !== 2 && activePhase?.id !== 3 ? "flex items-center justify-center border-y border-border/50 bg-muted/10 m-6 rounded-md border-dashed" : "p-5 sm:p-8"}`}>
                  <Suspense fallback={<WorkspaceLoader label={`Loading ${activePhase?.label || 'workspace'}`} />}>
                    {activePhase?.id === 1 ? (
                      <Phase1Topic state={state} setState={setState} />
                    ) : activePhase?.id === 2 ? (
                      <Phase2Script state={state} setState={setState} commitProjectState={commitProjectState} />
                    ) : activePhase?.id === 3 ? (
                      <Phase4Visuals
                        state={state}
                        setState={setState}
                        commitProjectState={commitProjectState}
                        resumeAfterRecovery={resumeAfterRecovery}
                        onResumeAfterRecoveryConsumed={() => setResumeAfterRecovery(false)}
                      />
                    ) : null}
                  </Suspense>
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </main>
      {/* Persistent Saved Indicator */}
      <AnimatePresence>
        {showSavedFlash && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-6 right-6 z-50 bg-background/80 backdrop-blur-sm border border-border px-3 py-1 rounded-full shadow-lg"
          >
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-500" /> Saved
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
