import React, { useState } from 'react';
import { 
  Wrench, 
  Sliders, 
  Clock, 
  X,
  Brain,
  Lock,
  FileUp,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

import { useSettings } from './SettingsContext';
import { AppState } from '../types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_PRODUCTION_TEMPLATE } from '../lib/productionTemplate';
import { HandoffValidationResult, validateVisualProductionHandoff } from '../lib/handoffValidation';
import { positiveSceneDuration } from '../lib/sceneDuration';

interface SettingsPanelProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ state, setState, open, onOpenChange }: SettingsPanelProps) {
  const { settings, setSettings } = useSettings();
  const productionTemplateStatus = validateVisualProductionHandoff(settings.productionTemplate || DEFAULT_PRODUCTION_TEMPLATE);
  const [templateImportResult, setTemplateImportResult] = useState<HandoffValidationResult | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent id="toolbox-sidebar" className="bg-card border-l border-border/60 w-[440px] max-w-full p-0 flex flex-col text-foreground" showCloseButton={false}>
        
        {/* Header */}
        <SheetHeader className="p-6 border-b border-border/60 bg-gradient-to-br from-primary/10 via-transparent to-cyan-500/5">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <SheetTitle className="text-base font-extrabold tracking-tight text-foreground flex items-center gap-2">
                <span className="section-icon"><Wrench className="w-4 h-4" /></span>
                Studio settings
              </SheetTitle>
              <SheetDescription className="text-[10px] text-muted-foreground/80 tracking-wide uppercase">
                Production controls and project utilities
              </SheetDescription>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => onOpenChange(false)} 
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">

          {/* Section: Gemini API Configuration */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/10 pb-2">
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase font-bold flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5" />
                01 / GEMINI API CONFIG
              </span>
            </div>

            <div className="space-y-3 content-panel p-4">
              <div className="flex items-start gap-2.5">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-[10px] text-foreground font-bold uppercase tracking-wider block">Managed API Key</span>
                  <p className="text-[10px] text-muted-foreground leading-normal uppercase">
                    API Key is managed securely by your Google AI Studio environment.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-border/30">
                <Label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">OPTIONAL BROWSER API KEY</Label>
                <Input type="password" autoComplete="off" value={settings.apiKey} onChange={event => setSettings(previous => ({ ...previous, apiKey: event.target.value.trim() }))} placeholder="Only needed outside managed AI Studio" className="font-mono text-xs" />
                <p className="text-[10px] text-muted-foreground normal-case">Saved only in this browser. It is never included in project JSON exports.</p>
              </div>
            </div>

            <div className="space-y-1.5 mt-2">
              <Label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                DEFAULT MODEL PIPELINE
              </Label>
              <Select value={settings.model} onValueChange={(val) => setSettings(s => ({...s, model: val}))}>
                <SelectTrigger className="bg-muted/20 border border-border/40 h-9 font-mono text-xs focus:ring-primary/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border/40 font-mono text-xs">
                  <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash (Balanced speed)</SelectItem>
                  <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (Deep reasoning)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section: Timeline Calibration */}
          <div className="space-y-4">
            <div className="border-b border-border/10 pb-2">
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                02 / TIMELINE CALIBRATION
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  BASE SCENE DURATION
                </Label>
                <Input 
                  type="text" 
                  readOnly 
                  value={`${settings.sceneDurationSeconds} SECS`}
                  className="bg-muted/20 border-border/40 font-mono text-xs text-foreground select-none cursor-default h-9"
                />
              </div>

            </div>

            <div className="p-3.5 content-panel">
              <p className="text-[10px] text-muted-foreground leading-relaxed uppercase">
                Base clips follow the global {settings.sceneDurationSeconds}-second timing. Full Phase 3 generation runs automatically in fixed sequential batches of 30 scenes.
              </p>
            </div>
          </div>

          {/* Section: Global Negative Prompts Defaults Removed */}

          <div className="space-y-4">
            <div className="border-b border-border/10 pb-2">
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase font-bold">03 / VO TIMING</span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">SCENE DURATION</Label>
                <Input
                  type="number"
                  min="0.001"
                  step="any"
                  value={settings.sceneDurationSeconds}
                  onChange={(event) => {
                    const duration = positiveSceneDuration(event.target.value);
                    if (duration !== null) setSettings(prev => ({ ...prev, sceneDurationSeconds: duration }));
                  }}
                  className="bg-muted/20 border-border/40 h-9 font-mono text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed normal-case">Enter any positive clip duration. V2 handoffs synchronize this value automatically. Changing it re-splits existing timestamps and clears generated downstream output.</p>
          </div>

          <div className="space-y-4">
            <div className="border-b border-border/10 pb-2">
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase font-bold flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5" />
                04 / PRODUCTION JSON TEMPLATE
              </span>
            </div>
            <div className="space-y-3 content-panel p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider">{settings.productionTemplateName || 'Bundled template'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 normal-case">
                    {settings.productionTemplateImportedAt
                      ? `Imported ${new Date(settings.productionTemplateImportedAt).toLocaleString()}`
                      : 'Bundled Modus Visual Production Handoff v2.0.0'}
                  </p>
                  <p className={`text-[10px] mt-1 font-bold ${productionTemplateStatus.valid ? 'text-green-500' : 'text-destructive'}`}>
                    {productionTemplateStatus.status}{productionTemplateStatus.version ? ` · ${productionTemplateStatus.version}` : ''}
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed normal-case">
                Importing replaces the blank Standard Lifecycle template and its generated research prompt. Filled handoff files are converted into the app's stage, environment, geometry-lock, continuity, and negative-prompt fields when loaded in Phase 1.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="relative h-9 text-[10px] font-mono">
                  <FileUp className="h-3.5 w-3.5 mr-2" /> IMPORT JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        try {
                          const parsed = JSON.parse(String(reader.result));
                          const result = validateVisualProductionHandoff(parsed);
                          setTemplateImportResult(result);
                          if (!result.valid || (result.format !== 'v1' && result.format !== 'v2')) {
                            const details = result.errors.slice(0, 3).map(item => `${item.path}: ${item.message}`).join(' ');
                            toast.error(`Template not activated (${result.status}). ${details}`);
                            return;
                          }
                          setSettings(prev => ({
                            ...prev,
                            productionTemplate: parsed,
                            productionTemplateName: parsed.schema?.name || file.name,
                            productionTemplateImportedAt: new Date().toISOString(),
                          }));
                          toast.success(`${result.status} template imported and activated.`);
                        } catch {
                          setTemplateImportResult(validateVisualProductionHandoff(null));
                          toast.error('The selected file is not valid JSON.');
                        } finally {
                          input.value = '';
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-[10px] font-mono"
                  onClick={() => {
                    setSettings(prev => ({ ...prev, productionTemplate: DEFAULT_PRODUCTION_TEMPLATE, productionTemplateName: 'Modus Visual Production Handoff V2', productionTemplateImportedAt: undefined }));
                    setTemplateImportResult(validateVisualProductionHandoff(DEFAULT_PRODUCTION_TEMPLATE));
                    toast.success('Bundled V2 production template restored.');
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-2" /> RESTORE
                </Button>
              </div>
              {templateImportResult && !templateImportResult.valid && (
                <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-[10px] text-destructive normal-case">
                  <p className="font-bold uppercase tracking-wider">Invalid</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {templateImportResult.errors.map((item, index) => (
                      <li key={`${item.path}-${item.code}-${index}`}><span className="font-bold">{item.path}</span>: {item.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border/60 text-center bg-muted/20 mt-auto">
          <h4 className="text-xs font-extrabold text-foreground tracking-[0.2em]">ASSEMBLY LINE</h4>
          <div className="text-[9px] text-muted-foreground mt-1 uppercase tracking-widest">Version 2.2.0 · Local production studio</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
