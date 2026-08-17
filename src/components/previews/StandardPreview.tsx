import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TopicBrief } from '../../types';
import { getLifecycleStageCount, getNegativePromptGlobal } from '../../lib/adaptiveSchema';

interface StandardPreviewProps {
  data: TopicBrief;
}

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
    {typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)}
  </pre>
);

export const StandardPreview: React.FC<StandardPreviewProps> = ({ data }) => {
  if (!data) return null;
  const stages = data.lifecycle_stages || [];
  const environments = data.environments || [];
  const negatives = getNegativePromptGlobal(data);
  const qcText = JSON.stringify(data.quality_control || {});
  const qcPass = !/\b(?:FAIL|FLAGGED)\b/i.test(qcText);

  return (
    <div className="space-y-6 text-foreground">
      <div className="border-b border-border/20 pb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge variant="outline" className="font-mono text-[10px]">Schema {data.schema_version || 'legacy'}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">{getLifecycleStageCount(data)} stages</Badge>
          <Badge variant="outline" className={`font-mono text-[10px] ${qcPass ? 'text-green-400 border-green-500/30' : 'text-amber-400 border-amber-500/30'}`}>
            QC {qcPass ? 'PASS/OK' : 'CHECK'}
          </Badge>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Project Overview</span>
        <h3 className="text-xl font-bold tracking-tight mt-1">{data.topic?.title || 'Untitled Project'}</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
          <p>Product: <span className="text-foreground font-medium">{data.topic?.product || 'N/A'}</span></p>
          <p>Category: <span className="text-foreground font-medium">{data.topic?.category || 'N/A'}</span></p>
          <p>Manufacturer: <span className="text-foreground font-medium">{data.topic?.manufacturer || 'N/A'}</span></p>
          <p>Duration: <span className="text-foreground font-medium">{data.topic?.suggested_duration || 'N/A'}</span></p>
          <p>Risk: <span className="text-foreground font-medium">{data.topic?.platform_risk || 'N/A'}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <section className="p-4 rounded-lg border border-border/20 bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-primary font-mono block mb-1">Product Identity Lock</span>
            <JsonBlock value={data.product_identity_lock || 'No product identity lock specified.'} />
          </section>
          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-primary font-mono block mb-1">Visual Lock</span>
            <JsonBlock value={data.visual_lock || 'No visual lock specified.'} />
          </section>
          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Visual Exclusions + Global Negatives</span>
            <JsonBlock value={{ visual_exclusions: data.visual_exclusions || '', negative_prompt_global: negatives }} />
          </section>
          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Cinematography + Continuity</span>
            <JsonBlock value={{ cinematography_rules: data.cinematography_rules, scene_continuity_rules: data.scene_continuity_rules }} />
          </section>
          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Source Integrity</span>
            <JsonBlock value={data.source_integrity || 'No source integrity summary.'} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-2">Environments</span>
            <div className="space-y-3 max-h-[260px] overflow-y-auto pr-2">
              {environments.map((env, i) => (
                <div key={i} className="text-xs border-b border-border/10 pb-2 last:border-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-amber-500 font-semibold">{env.environment_id || `E${i + 1}`}</span>
                    <span className="font-semibold">{env.name}</span>
                    {env.reference_confidence?.visual_reference && <Badge variant="outline" className="text-[9px]">{env.reference_confidence.visual_reference}</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-1">{env.visual_details}</p>
                  {env.do_not_show?.length ? <p className="text-amber-400/80 mt-1">Do not show: {env.do_not_show.join(', ')}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-2">Lifecycle Stages</span>
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2">
              {stages.map((stage, idx) => (
                <div key={idx} className="text-xs border-b border-border/10 pb-3 last:border-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-primary/80 font-bold">{stage.stage_id || `S${idx + 1}`}</span>
                    <Badge variant="outline" className="text-[9px]">STATE {stage.state || '?'}</Badge>
                    <h4 className="font-semibold text-foreground/90 uppercase text-[11px] tracking-wider">{stage.stage_name}</h4>
                  </div>
                  <p className="text-muted-foreground mt-1"><span className="text-foreground/75">Env:</span> {stage.environment_ref}</p>
                  <p className="text-muted-foreground mt-1"><span className="text-foreground/75">Camera:</span> {stage.primary_camera_shot || 'N/A'} | {stage.motion_direction || 'N/A'}</p>
                  <p className="text-muted-foreground mt-1"><span className="text-foreground/75">QC:</span> {stage.quality_control_focus || 'N/A'}</p>
                  <p className="text-muted-foreground mt-1"><span className="text-foreground/75">Risk:</span> {stage.visual_risk_notes || 'N/A'}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="p-4 rounded-lg border border-border/20 bg-muted/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Shot Plan + Quality Control</span>
            <JsonBlock value={{ shot_plan_count: data.shot_plan?.length || 0, quality_control: data.quality_control || null }} />
          </section>
        </div>
      </div>
    </div>
  );
};
