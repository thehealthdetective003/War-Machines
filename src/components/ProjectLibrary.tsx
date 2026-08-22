import React, { useState, useEffect, useMemo } from 'react';
import { 
  FolderOpen, 
  Search, 
  Plus, 
  Trash2, 
  Loader2, 
  Database,
  X,
  FileText,
  Code,
  Calculator,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle,
  SheetDescription,
  SheetClose
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  getAllProjects, 
  deleteProject, 
  calculateStorageUsage 
} from '../lib/storageUtils';
import { AppState, SavedProject, PhaseType } from '../types';
import { toast } from 'sonner';

interface ProjectLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentState: AppState;
  onLoadProject: (id: string) => void;
  onNewProject: () => void;
}

export function ProjectLibrary({ 
  open, 
  onOpenChange, 
  currentState,
  onLoadProject,
  onNewProject
}: ProjectLibraryProps) {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [storage, setStorage] = useState({ usedKb: 0, totalKb: 0, percent: 0, persisted: false, available: false });

  useEffect(() => {
    if (open) {
      void refreshList();
    }
  }, [open]);

  const refreshList = async () => {
    setLoading(true);
    try {
      const [nextProjects, nextStorage] = await Promise.all([getAllProjects(), calculateStorageUsage()]);
      setProjects(nextProjects);
      setStorage(nextStorage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read project storage.');
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [projects, search]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteProject(id);
    await refreshList();
    setDeleteConfirm(null);
    toast.success("Project deleted");
  };

  const getPhaseInfo = (phase: PhaseType) => {
    switch (phase) {
      case 1: return { label: 'SETUP', color: 'bg-slate-500/10 text-slate-500 border-slate-500/20', icon: <FileText className="h-3 w-3 mr-1" /> };
      case 2: return { label: 'PRODUCTION', color: 'bg-primary/10 text-primary border-primary/20', icon: <Code className="h-3 w-3 mr-1" /> };
      case 3: return { label: 'REVIEW & EXPORT', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium', icon: <CheckCircle2 className="h-3 w-3 mr-1" /> };
      default: return { label: 'UNKNOWN', color: 'bg-slate-500/10 text-slate-500', icon: null };
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="sm:max-w-[480px] p-0 flex flex-col bg-card" showCloseButton={false}>
        <SheetHeader className="p-6 pb-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center justify-between mb-4">
            <SheetTitle className="text-xl font-extrabold tracking-tight flex items-center gap-3">
              <span className="section-icon"><FolderOpen className="h-5 w-5" /></span> Project library
            </SheetTitle>
            <SheetClose 
              id="library-close-button"
              render={
                <Button variant="ghost" size="icon-sm" className="opacity-70 hover:opacity-100">
                  <X className="h-4 w-4" />
                </Button>
              }
            />
          </div>
          
          <Button 
            id="new-project-button-library"
            onClick={onNewProject}
            className="w-full font-semibold h-11 tracking-wide"
          >
            <Plus className="h-4 w-4 mr-2" /> NEW PROJECT
          </Button>

          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <Input 
              id="project-search-input"
              placeholder="Search projects..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-muted/30 border-muted-foreground/20 text-xs h-9"
            />
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-4 py-4">
            {loading ? (
              <div className="h-[400px] flex items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : filteredProjects.length === 0 ? (
              <div className="h-[400px] flex flex-col items-center justify-center text-center space-y-4">
                <div className="h-16 w-16 rounded-2xl border border-primary/20 bg-primary/5 flex items-center justify-center text-primary/60">
                   <FolderOpen className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="font-bold text-muted-foreground">No saved projects yet</h4>
                  <p className="text-xs text-muted-foreground/60 mt-1">Your work auto-saves as you go.</p>
                </div>
              </div>
            ) : (
              filteredProjects.map((project) => {
                const phaseInfo = getPhaseInfo(project.phase);
                const isConfirming = deleteConfirm === project.id;
                
                return (
                  <div 
                    key={project.id}
                    className="p-4 rounded-xl bg-muted/20 border border-border/60 hover:border-primary/30 hover:bg-primary/[0.035] transition-colors group overflow-hidden"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1">
                        <h4 className="font-bold text-sm truncate" title={project.title}>
                          {project.title.length > 45 ? project.title.substring(0, 45) + '...' : project.title}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 opacity-70 font-mono">
                            {project.category}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] py-0 px-1.5 font-mono ${phaseInfo.color}`}>
                            {phaseInfo.icon}
                            {phaseInfo.label}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-mono opacity-80">
                            {project.sceneCount === 0 ? '—' : `${project.sceneCount} scenes`}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground/60 italic">
                          Saved {formatDistanceToNow(new Date(project.savedAt), { addSuffix: true })}
                        </span>
                        
                        <div className="flex items-center gap-2">
                          {isConfirming ? (
                            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-200">
                              <span className="text-[10px] font-bold text-red-500 mr-1 uppercase">Delete?</span>
                              <Button 
                                variant="destructive" 
                                size="xs"
                                className="h-6 px-3 text-[10px]"
                                onClick={(e) => void handleDelete(project.id, e)}
                              >
                                YES
                              </Button>
                              <Button 
                                variant="outline" 
                                size="xs"
                                className="h-6 px-3 text-[10px]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirm(null);
                                }}
                              >
                                NO
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button 
                                id={`load-project-${project.id}`}
                                size="sm" 
                                variant="secondary" 
                                className="h-7 px-3 text-[10px] font-bold hover:bg-primary hover:text-primary-foreground group-hover:bg-primary/20"
                                onClick={() => {
                                  onLoadProject(project.id);
                                  onOpenChange(false);
                                }}
                              >
                                LOAD
                              </Button>
                              <Button 
                                id={`delete-project-trigger-${project.id}`}
                                variant="ghost" 
                                size="icon-sm"
                                className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirm(project.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="p-6 border-t border-border/60 bg-muted/20">
           <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-2">
             <div className="flex items-center gap-1.5">
               <Database className="h-3 w-3" />
               <span>STORAGE USAGE</span>
             </div>
             <span>{storage.available ? `${sizeToString(storage.usedKb * 1024)} / ${sizeToString(storage.totalKb * 1024)}` : 'Estimate unavailable'}</span>
           </div>
           <Progress 
             id="storage-usage-bar"
             value={storage.percent} 
             className="h-1 bg-muted-foreground/10" 
             indicatorClassName={storage.percent > 90 ? 'bg-red-500' : 'bg-primary'} 
           />
           <div className="mt-2 text-[10px] text-muted-foreground/70">{storage.persisted ? 'Persistent browser storage enabled' : 'Browser-managed storage'}</div>
           {storage.percent > 90 && (
             <div className="mt-2 flex items-center gap-2 text-[10px] text-red-500 animate-pulse">
               <AlertCircle className="h-3 w-3" />
               <span className="font-bold uppercase">Storage full soon. Delete old projects.</span>
             </div>
           )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function sizeToString(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
