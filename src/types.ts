import type { AnyVisualProductionHandoff, ProductVisibility, StoryFunction, VisualFamily } from './types/visualProductionV2';
export type { ProductVisibility, StoryFunction, VisualFamily } from './types/visualProductionV2';

export type PhaseType = 1 | 2 | 3;
export type ProjectFormatId = 'standard-lifecycle';
export interface Settings {
  apiKey: string;
  model: string;
  defaultDuration: string;
  defaultStyle: string;
  sceneDurationSeconds: number;
  productionTemplate?: Record<string, any>;
  productionTemplateName?: string;
  productionTemplateImportedAt?: string;
  showProductionDiagnostics: boolean;
}
export interface OmniPromptSections {
  cinematography: string;
  subject: string;
  action: string;
  environment: string;
  style_lighting: string;
  product_state: string;
  sound: string;
  exclusions: string;
}
export interface TopicBrief {
  schema_version?: string;
  topic: { 
    title: string; 
    product?: string; 
    category: string; 
    manufacturer?: string;
    suggested_duration?: string | number;
    platform_risk?: string;
  };
  source_integrity?: {
    source_quality_summary?: string;
    evidence_confidence_summary?: string;
    allowed_claim_confidence?: string[];
    disallowed_claim_confidence?: string[];
    research_ledger_note?: string;
  };
  global_visual_constants: string;
  /**
   * The full anchor text (legacy single-field format).
   * May contain both positive descriptions and "NOT / NO" exclusion clauses.
   * The prompt engine automatically splits this via parseAnchorComponents().
   * You may also provide the split fields below directly.
   */
  anti_hallucination_anchor?: string;
  /**
   * Optional: positive-only visual specification for the finished product.
   * If provided, takes precedence over parsing anti_hallucination_anchor.
   */
  visual_lock?: string;
  /**
   * Optional: comma-separated list of what the product is NOT / does NOT have.
   * Added to negative prompts section only, never injected into positive subject.
   */
  visual_exclusions?: string;
  product_identity_lock?: {
    core_geometry: string;
    surface_finish: string;
    markings: string;
    scale_reference: string;
    distinctive_features: string[];
    must_remain_consistent_across_all_scenes: boolean;
  };
  master_voiceover_script?: string;
  global_negative_prompts?: string;
  negative_prompt_global?: string[];
  cinematography_rules?: {
    camera_style: string;
    lens_language: string;
    lighting_style: string;
    color_grade: string;
    motion_rules: string;
  };
  scene_continuity_rules?: {
    lifecycle_progression: string;
    state_consistency: string;
    environment_logic: string;
    markings_consistency: string;
    scale_consistency: string;
    no_stage_skipping: boolean;
  };
  lifecycle_stage_count?: number | string;
  quality_control?: any;
  _production_handoff?: AnyVisualProductionHandoff;
  environments: Array<{
    environment_id?: string;
    stage_ref?: string;
    name: string;
    environment_type?: string;
    visual_details: string;
    confirmed_visuals?: string;
    inferred_visuals?: string;
    reference_confidence?: {
      visual_reference?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
      manufacturing_accuracy?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
      inference_level?: string;
    };
    do_not_show?: string[];
    nation?: string;
  }>;
  lifecycle_stages?: Array<{
    stage_id?: string;
    stage_name: string;
    environment_ref: string;
    stage_function?: string;
    evidence_confidence?: string;
    action: string;
    product_visual_state: string;
    /**
     * Explicit state classification for this lifecycle stage.
     * A = raw materials / logistics (no finished product present)
     * B = mid-fabrication / sub-assembly (partial geometry only)
     * C = finished product visible (convoy, deployment, final cleanroom)
     * When provided, this label is injected into the Production shot list
     * and travels into Phase 4 batches, eliminating per-batch LLM guessing.
    */
    state?: 'A' | 'B' | 'C';
    primary_camera_shot?: string;
    secondary_detail_shots?: string[];
    motion_direction?: string;
    quality_control_focus?: string;
    continuity_from_previous_stage?: string;
    transition_to_next_stage?: string;
    visual_risk_notes?: string;
    source_claim_refs?: string[];
  }>;
  shot_plan?: Array<{
    stage_ref: string;
    shot_number: number;
    shot_type: string;
    purpose: string;
    camera_motion: string;
    approx_duration_seconds?: string | number;
    continuity_notes?: string;
  }>;
}
export interface TimedWord { text: string; start: number; end: number; probability: number; }
export interface TimedTranscriptSegment { text: string; start: number; end: number; words: TimedWord[]; }
export interface TimedScene { number: number; start: number; end: number; duration: number; text: string; silent: boolean; }
export interface VoiceoverTranscription {
  audioFileName: string;
  duration: number;
  language: 'en';
  languageProbability: number;
  model: string;
  computeType: string;
  text: string;
  segments: TimedTranscriptSegment[];
  words: TimedWord[];
  sceneDurationSeconds: number;
  scenes: TimedScene[];
  importedAt: string;
}
/** Graphic values are parse-only legacy compatibility; new production always uses LIVE_ACTION_T2V. */
export type VisualTreatment = 'LIVE_ACTION_T2V' | 'STATIC_GRAPHIC_T2V' | 'MOTION_GRAPHIC_T2V';
export type ShowdownRole =
  | 'ANTICIPATION'
  | 'GROUND_REVEAL'
  | 'HUMAN_SCALE'
  | 'PREPARATION'
  | 'DEPARTURE'
  | 'AIRBORNE_ESTABLISHMENT'
  | 'PERFORMANCE_PASS'
  | 'COCKPIT_IMMERSION'
  | 'ENVIRONMENTAL_SPECTACLE'
  | 'OPERATIONAL_RESET'
  | 'SECOND_PEAK'
  | 'CONTROLLED_RETURN';
export type CinematicEnergy = 'LOW' | 'MEDIUM' | 'HIGH';
export type CameraPlatform =
  | 'GROUND_TRIPOD'
  | 'GROUND_HANDHELD'
  | 'RUNWAY_LONG_LENS'
  | 'DISTANT_OBSERVATION'
  | 'CHASE_AIRCRAFT'
  | 'COCKPIT_MOUNTED'
  | 'CANOPY_SIDE'
  | 'VEHICLE_OR_DECK_MOUNTED';
/** Legacy project-history schema retained so old paid output can round-trip without loss. */
export type GraphicSubtype =
  | 'COMPONENT_HIGHLIGHT'
  | 'TECHNICAL_CUTAWAY'
  | 'PROCESS_FLOW'
  | 'MECHANICAL_RELATIONSHIP'
  | 'LAYER_EXPLANATION'
  | 'SCALE_COMPARISON'
  | 'SENSOR_SIGNAL'
  | 'HEAT_OR_ENERGY_FLOW'
  | 'FACTORY_SCHEMATIC'
  | 'SYMBOLIC_LOCATION'
  | 'CONCEPTUAL_TRANSITION';
export type GraphicComposition =
  | 'SINGLE_SUBJECT'
  | 'ORTHOGRAPHIC_CUTAWAY'
  | 'LEFT_TO_RIGHT_FLOW'
  | 'LAYERED_SEPARATION'
  | 'TWO_PANEL_COMPARISON'
  | 'CONCENTRIC_SIGNAL_FIELD'
  | 'SCHEMATIC_FACTORY'
  | 'SYMBOLIC_ROUTE'
  | 'MATCHED_SHAPE_TRANSITION';
export type GraphicMotionPattern =
  | 'MINIMAL_PARALLAX'
  | 'HIGHLIGHT_PULSE'
  | 'FLOW_DRAW_ON'
  | 'COMPONENT_TRANSLATION'
  | 'LAYER_SEPARATION'
  | 'SIGNAL_SWEEP'
  | 'HEAT_ZONE_PROGRESSION'
  | 'CONTROLLED_ASSEMBLY'
  | 'MATCH_ANCHOR';
export type GraphicAnnotationDevice = 'DIRECTIONAL_ARROWS'|'FLOW_LINES'|'HIGHLIGHT_RING'|'COLORED_ZONE'|'SIGNAL_WAVES'|'MEASUREMENT_BASELINE';
export interface GraphicSceneSpec {
  graphic_subtype: GraphicSubtype;
  visual_claim: string;
  composition: GraphicComposition;
  motion_pattern: GraphicMotionPattern;
  annotation_devices: GraphicAnnotationDevice[];
  palette_profile: 'PREMIUM_TECHNICAL_VECTOR';
  maximum_animated_elements: 1 | 2 | 3;
  transition_anchor: string | null;
  text_policy: 'NO_GENERATED_TEXT';
}
export interface PlannedScene {
  number: number;
  chapter_id: string;
  beat_id: string;
  visual_family: VisualFamily;
  story_function: StoryFunction;
  visual_treatment: VisualTreatment;
  product_visibility: ProductVisibility;
  stage_id: string;
  environment_ref: string;
  state: 'A' | 'B' | 'C';
  showdown_role: ShowdownRole | null;
  energy_level: CinematicEnergy;
  camera_platform: CameraPlatform | null;
  /** Import/export compatibility only. New and regenerated plans always store null. */
  graphic_spec: GraphicSceneSpec | null;
  /** Engine-owned evidence and constraints copied locally so Gemini cannot discard them. */
  reference_asset_ids?: string[];
  required_visible_features?: string[];
  forbidden_elements?: string[];
  continuity_requirements?: string[];
  alignment_source?: 'ENGINE_BEAT' | 'VO_FALLBACK';
  alignment_confidence?: number;
  alignment_claim?: string;
  /** Group-level semantic context is advisory; scene-level allocation remains authoritative. */
  semantic_group_id?: string;
  semantic_group_beat_id?: string | null;
  semantic_group_intent?: string;
  /** Deterministic dependency fingerprint for the paid alignment that produced this assignment. */
  alignmentFingerprint?: string;
  /** Raw Engine beat used to resolve constraints when the displayed beat ID is a deterministic fallback ID. */
  contract_beat_id?: string;
  constraint_resolver_version?: number;
  constraint_sources?: {environment:string;state:string;visualFamily:string;productVisibility:string;references:string;camera:string};
  allowed_environment_ids?: string[];
}
export interface TemporalAction {
  opening_state: string;
  primary_motion: string;
  physical_interaction: string;
  mid_shot_progression: string;
  ending_state: string;
}
export interface SceneDirection {
  number: number;
  start: number;
  end: number;
  duration: number;
  /** Full generated clip length; may exceed duration for the final partial transcript window. */
  generation_duration_seconds?: number;
  voiceover: string;
  silent: boolean;
  chapter_id?: string;
  beat_id?: string;
  visual_family?: VisualFamily;
  story_function?: StoryFunction;
  visual_treatment?: VisualTreatment;
  product_visibility?: ProductVisibility;
  showdown_role?: ShowdownRole | null;
  energy_level?: CinematicEnergy;
  camera_platform?: CameraPlatform | null;
  graphic_spec?: GraphicSceneSpec | null;
  reference_asset_ids?: string[];
  alignment_source?: 'ENGINE_BEAT' | 'VO_FALLBACK';
  alignment_confidence?: number;
  alignment_claim?: string;
  stage_id: string;
  state: 'A' | 'B' | 'C';
  subject: string;
  product_visual_state: string;
  primary_action: string;
  supporting_motion: string;
  environment_ref: string;
  environment_description: string;
  camera: { shot_scale: string; lens: string; angle: string; movement: string; movement_speed: string };
  lighting_and_material: string;
  continuity_from_previous: string;
  transition_to_next: string;
  required_visible_features: string[];
  forbidden_elements: string[];
  temporal_action?: TemporalAction;
  /** Deterministic dependency fingerprint for the paid direction result. */
  operationFingerprint?: string;
  contract_beat_id?: string;
  constraint_resolver_version?: number;
  constraint_sources?: PlannedScene['constraint_sources'];
  allowed_environment_ids?: string[];
}
export interface T2VPrompt {
  number: number;
  stage_id?: string;
  state?: 'A' | 'B' | 'C';
  continuity_notes?: string;
  quality_flags?: string[];
  action_description: string;
  video_prompt: string;
  voiceover: string;
  stock_keywords: string;
  omniSections?: OmniPromptSections;
  /** Deterministic dependency fingerprint for the paid or locally compiled prompt result. */
  operationFingerprint?: string;
  /** LOCAL_GRAPHIC is a historical import value and is never emitted by current production. */
  generationSource?: 'API'|'LOCAL_GRAPHIC'|'LOCAL_FALLBACK'|'LEGACY';
}
export type ValidationSeverity='PASS'|'WARNING'|'REPAIRABLE_ERROR'|'BLOCKING_ERROR';
export interface ValidationFinding {
  code:string;
  severity:ValidationSeverity;
  sceneNumber:number;
  message:string;
  structuredRuleSource?:string;
  expected?:unknown;
  actual?:unknown;
  repairHint?:string;
  constraintSource?:'BEAT'|'STAGE'|'GLOBAL'|'PLAN'|'NONE';
  allowedEnvironmentIds?:string[];
  actualEnvironmentId?:string;
  beatId?:string|null;
  stageId?:string|null;
}
export interface DeferredRepair {
  sceneNumber:number;
  operation:'DIRECTION'|'PROMPT';
  validationCode:string;
  severity:'BLOCKING_ERROR';
  attempts:number;
  lastError:string;
  dependencies:string[];
  finding?:ValidationFinding;
}
export interface SceneReviewItem {
  sceneNumber:number;
  operation:'DIRECTION'|'PROMPT';
  status:'NEEDS_REVIEW';
  repairAttempted:true;
  validationCodes:string[];
  message:string;
  findings:ValidationFinding[];
  dependencyFingerprint?:string;
  candidateSource:'ORIGINAL'|'CORRECTION'|'LOCAL_FALLBACK'|'MIGRATED';
  updatedAt:string;
}
export type GenerationSessionStatus = 'idle' | 'running' | 'paused' | 'interrupted' | 'failed' | 'complete'|'complete_with_warnings'|'deferred_repairs';
export type ProductionOperation = 'QUEUED'|'PLANNING'|'PLANNED'|'ALIGNING'|'ALIGNED'|'DIRECTING'|'DIRECTION_CORRECTION'|'DIRECTED'|'GENERATING_PROMPTS'|'PROMPTS_GENERATED'|'PROMPT_CORRECTION'|'QA'|'COMPLETE';
export type ProductionPauseReason = 'user'|'quota'|'rate_limit'|'storage'|'error'|null;
export interface PersistedAlignmentSelection {
  group_id:string;
  source:'ENGINE_BEAT'|'VO_FALLBACK';
  beat_id:string|null;
  confidence:number;
  visual_claim:string;
  /** Legacy alignment keys accepted on import but ignored by cinematic production. */
  graphic_required?:boolean;
  graphic_scene_numbers?:number[];
  operationFingerprint:string;
}
export interface ProductionBatchState {
  id:string;
  index:number;
  sceneNumbers:number[];
  operation:ProductionOperation;
  directionCompletedSceneNumbers:number[];
  promptCompletedSceneNumbers:number[];
  qaCompletedSceneNumbers:number[];
  directionCorrectionCandidates:SceneDirection[];
  promptCorrectionCandidates:T2VPrompt[];
  promptCorrectionSceneNumbers:number[];
  directionCorrectionSceneNumbers:number[];
  correctionIssues:Record<string,string[]>;
  alignmentSelections:PersistedAlignmentSelection[];
  contextSnapshot:ProductionContext|null;
  correctionReason:string|null;
  lastCommittedAt:string|null;
  error:string|null;
}
export interface ProductionContext {
  lifecycleState:'A'|'B'|'C'|null;
  recentVisualFamilies:VisualFamily[];
  previousEnvironment:string|null;
  previousCameraTreatment:string|null;
  /** Legacy context key retained for fingerprint/import shape; current sessions always store an empty array. */
  recentGraphicSceneNumbers:number[];
  recentBeatIds:string[];
  previousVisualClaim:string|null;
  productConfiguration:string|null;
  continuityRequirements:string[];
  unresolvedBridge:string|null;
  visualFamilyCounts:Record<string,number>;
  completedSceneNumbers:number[];
}
export interface GenerationSession {
  status: GenerationSessionStatus;
  totalBatches: number;
  currentBatch: number;
  batchStartScene: number | null;
  batchEndScene: number | null;
  completedScenes: number;
  startedAt: string | null;
  lastCommittedAt: string | null;
  error: string | null;
  operation: ProductionOperation;
  activeBatchId: string | null;
  batches: ProductionBatchState[];
  completedSceneNumbers: number[];
  pendingSceneNumbers: number[];
  directionCompletedSceneNumbers: number[];
  promptCompletedSceneNumbers: number[];
  qaCompletedSceneNumbers: number[];
  correctionPendingSceneNumbers: number[];
  pauseReason: ProductionPauseReason;
  context: ProductionContext;
  validationWarnings:ValidationFinding[];
  sceneReviews:SceneReviewItem[];
  /** Legacy import-only field. New scene validation issues use sceneReviews. */
  deferredRepairs:DeferredRepair[];
}
export interface AppState {
  projectSchemaVersion: number;
  id?: string;
  projectName: string;
  handoffFileName?: string;
  projectFormat: ProjectFormatId;
  phase: PhaseType;
  topic: TopicBrief | null;
  plannedScenes: PlannedScene[];
  sceneDirections: SceneDirection[];
  masterVoiceoverScript: string;
  voiceoverTranscription: VoiceoverTranscription | null;
  visualPrompts: T2VPrompt[];
  generationSession: GenerationSession;
}
export interface SavedProject {
  id: string;
  name: string;
  title: string;
  category: string;
  phase: PhaseType;
  sceneCount: number;
  savedAt: string;
  createdAt: string;
}
export interface FullProjectData extends AppState {
  id: string;
  savedAt: string;
  createdAt: string;
}
export type ProjectCheckpointReason = 'batch' | 'manual' | 'migration';
export interface ProjectCheckpoint {
  id: string;
  projectId: string;
  sequence: number;
  reason: ProjectCheckpointReason;
  savedAt: string;
  state: FullProjectData;
}
