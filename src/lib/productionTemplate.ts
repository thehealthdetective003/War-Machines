import { TopicBrief } from '../types';
import { DEFAULT_V2_PRODUCTION_TEMPLATE, validateVisualProductionHandoff } from './handoffValidation';

const measurement = () => ({ value: null, unit: '', confidence: 'UNKNOWN' });

/** Bundled copy of Modus_Assembly_Visual_Production_JSON_Template.json. */
export const LEGACY_PRODUCTION_TEMPLATE: Record<string, any> = {
  schema: { name: 'Modus Assembly Visual Production Handoff', version: '1.0.0' },
  product: {
    official_name: '', exact_variant: '', product_class: '', manufacturer: '', aliases: [],
    overall_visual_description: '', immutable_identity_features: [],
    visually_similar_products_to_avoid: [], global_negative_constraints: [],
  },
  dimensions_and_proportions: {
    overall_length: measurement(), overall_width_or_wingspan: measurement(), overall_height: measurement(),
    important_proportion_rules: [], human_scale_reference: '',
  },
  geometry_modules: [{
    module_id: 'FULL_PRODUCT', module_name: '', required_visible_features: [], minimum_visible_anchor_count: 4,
    forbidden_geometry_changes: [], likely_wrong_substitutions: [],
  }],
  reference_assets: [{
    asset_id: '', product_or_component: '', exact_variant_or_configuration: '', production_stage: '', view_angle: '',
    source_page_url: '', direct_media_url_or_file_reference: '', publisher_or_owner: '', visual_verification: 'PASS',
    visible_geometry_features: [], allowed_usage: [], forbidden_usage: [], confidence: 'HIGH',
  }],
  environments: [{
    environment_id: '', environment_name: '', facility_type: '', factory_zone: '', floor: '', walls: '', ceiling: '',
    lighting: '', machinery: [], jigs_and_supports: [], tools: [], worker_roles: [], worker_uniforms_and_ppe: [],
    scale_references: [], allowed_background_activity: [], forbidden_elements: [],
  }],
  production_stages: [{
    stage_id: '', stage_number: 1, stage_name: '', product_state_code: 'A', stage_visual_summary: '', environment_id: '',
    product_state: { overall_form: '', recognizable_as_final_product: false, orientation: '', support_method: '', surface_condition: '', markings_condition: '', interior_visibility: '' },
    present_now: [], not_yet_installed: [], temporarily_exposed: [], open_interfaces: [], unfinished_edges_or_sections: [],
    geometry_control: {
      primary_geometry_module_id: '', secondary_geometry_module_ids: [], required_visible_anchors: [], minimum_visible_anchor_count: 0,
      corrective_positive_geometry: [], likely_wrong_substitutions: [], negative_constraints: [], immutable_during_clip: [], forbidden_transformations: [],
    },
    stage_actions: [{ action_id: '', action_description: '', primary_subject: '', primary_action: '', allowed_minor_motion: '', required_tools_or_machinery: [], required_worker_roles: [], forbidden_actions: [] }],
    camera_guidance: { preferred_views: [], safe_shot_scales: [], preferred_camera_movements: [], forbidden_camera_movements: [], high_risk_views: [] },
    visual_evidence: { confirmed_visual_details: [], analyst_inferred_visual_details: [], uncertain_visual_details: [], reference_asset_ids: [] },
    continuity: { previous_stage_end_state: '', current_stage_start_state: '', current_stage_end_state: '', next_stage_expected_state: '', features_that_must_remain_consistent: [], forbidden_regressions: [] },
    prompt_constraints: {
      one_stable_product_state: true, one_primary_action: true, no_component_appears_before_installation: true,
      no_automatic_completion_of_product: true, no_geometry_morphing: true, no_readable_generated_text: true,
      must_repeat_exact_product_and_variant: true, must_repeat_present_and_absent_components: true, must_include_view_specific_geometry: true,
    },
  }],
  stage_transitions: [{ from_stage_id: '', to_stage_id: '', components_added: [], components_enclosed_or_hidden: [], surface_changes: [], marking_changes: [], geometry_that_must_not_change: [], continuity_risks: [] }],
  global_prompt_rules: {
    use_positive_geometry_before_negative_constraints: true, use_smallest_relevant_geometry_module: true,
    treat_each_generated_clip_as_stateless: true, one_stable_state_per_clip: true, one_primary_action_per_clip: true,
    maximum_minor_supporting_actions: 1, maximum_camera_movements: 1, generated_readable_text_forbidden: true,
    geometry_transformation_forbidden: true, generic_product_fallback_forbidden: true, reference_asset_required_when_text_is_insufficient: true,
  },
};
export const DEFAULT_PRODUCTION_TEMPLATE: Record<string, any> = DEFAULT_V2_PRODUCTION_TEMPLATE;

const strings = (value: any): string[] => Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : [];
const describe = (record: any, omit: string[] = []) => Object.entries(record || {})
  .filter(([key, value]) => !omit.includes(key) && value !== '' && value !== null && (!Array.isArray(value) || value.length))
  .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join('; ');

export function validateProductionTemplate(data: any): string[] {
  return validateVisualProductionHandoff(data).errors.map(error=>`${error.path}: ${error.message}`);
}

export function productionTemplatePrompt(template: Record<string, any>): string {
  return `You are a manufacturing research and visual-continuity specialist. Fill this Modus Assembly Visual Production Handoff JSON for [PRODUCT].\nRULES:\n- Preserve every key and its data type; do not add or remove fields.\n- Fill arrays with as many accurate entries as the product requires.\n- Keep confirmed evidence separate from analyst inference and uncertainty.\n- Give every environment, geometry module, reference asset, action, and stage a stable unique ID.\n- Keep stages chronological and use product_state_code A (raw), B (partial), or C (finished).\n- Describe only camera-visible geometry, materials, factory actions, continuity, and constraints.\n- Return only valid JSON.\n\n${JSON.stringify(template, null, 2)}`;
}

export function normalizeProductionHandoff(input: any): TopicBrief {
  const p = input.product || {};
  const dims = input.dimensions_and_proportions || {};
  const modules = Array.isArray(input.geometry_modules) ? input.geometry_modules : [];
  const productName = [p.official_name, p.exact_variant].filter(Boolean).join(' ') || 'Untitled product';
  const dimensionText = describe(dims);
  const moduleText = modules.map((m: any) => [m.module_name || m.module_id, ...strings(m.required_visible_features)].filter(Boolean).join(': ')).filter(Boolean);
  const visualLock = [p.overall_visual_description, ...strings(p.immutable_identity_features), dimensionText, ...moduleText].filter(Boolean).join(' | ');
  const exclusions = [...strings(p.visually_similar_products_to_avoid), ...strings(p.global_negative_constraints), ...modules.flatMap((m: any) => strings(m.likely_wrong_substitutions)), ...modules.flatMap((m: any) => strings(m.forbidden_geometry_changes))];
  const environments = (input.environments || []).map((env: any, index: number) => ({
    environment_id: env.environment_id || `E${String(index + 1).padStart(2, '0')}`,
    name: env.environment_name || env.environment_id || `Environment ${index + 1}`,
    environment_type: env.setting_scope || env.facility_type,
    visual_details: describe(env, ['environment_id', 'environment_name', 'forbidden_elements']),
    confirmed_visuals: describe(env, ['environment_id', 'environment_name', 'forbidden_elements']),
    do_not_show: strings(env.forbidden_elements),
    _production_environment: env,
  }));
  const stages = (input.production_stages || []).map((stage: any, index: number) => {
    const actions = (stage.stage_actions || []).flatMap((a: any) => strings(a.action_description || a.primary_action));
    const state = ['A', 'B', 'C'].includes(stage.product_state_code) ? stage.product_state_code : (stage.product_state?.recognizable_as_final_product ? 'C' : 'B');
    return {
      stage_id: stage.stage_id || `S${String(index + 1).padStart(2, '0')}`,
      stage_name: stage.stage_name || `Production stage ${index + 1}`,
      environment_ref: stage.environment_ids?.[0] || stage.environment_id || '',
      stage_function: stage.production_function || stage.stage_visual_summary,
      action: actions.join(' ') || stage.stage_visual_summary || '',
      product_visual_state: describe(stage.product_state),
      state,
      primary_camera_shot: strings(stage.camera_guidance?.preferred_views).join(', '),
      secondary_detail_shots: strings(stage.camera_guidance?.safe_shot_scales),
      motion_direction: strings(stage.camera_guidance?.preferred_camera_movements).join(', '),
      quality_control_focus: strings(stage.geometry_control?.required_visible_anchors).join(', '),
      continuity_from_previous_stage: stage.continuity?.previous_stage_end_state || '',
      transition_to_next_stage: stage.continuity?.next_stage_expected_state || '',
      visual_risk_notes: [...strings(stage.camera_guidance?.high_risk_views), ...strings(stage.geometry_control?.negative_constraints)].join(', '),
      source_claim_refs: strings(stage.visual_evidence?.reference_asset_ids),
      _production_stage: stage,
    };
  });
  return {
    schema_version: `modus_visual_handoff_${input.schema?.version || '1.0.0'}`,
    topic: { title: `The Production of ${productName}`, product: productName, category: p.product_class || 'Industrial production', manufacturer: p.manufacturer || '' },
    global_visual_constants: 'Photorealistic industrial documentary, physically accurate scale and geometry, realistic factory lighting and materials.',
    product_identity_lock: { core_geometry: visualLock, surface_finish: p.overall_visual_description || '', markings: '', scale_reference: dims.human_scale_reference || '', distinctive_features: strings(p.immutable_identity_features), must_remain_consistent_across_all_scenes: true },
    visual_lock: visualLock,
    visual_exclusions: exclusions.join(', '),
    negative_prompt_global: [...new Set([...strings(p.global_negative_constraints), ...exclusions])],
    master_voiceover_script: input.master_voiceover_script || '',
    environments,
    lifecycle_stages: stages,
    lifecycle_stage_count: stages.length,
    scene_continuity_rules: { lifecycle_progression: 'Follow production_stages in order.', state_consistency: 'Honor product_state_code.', environment_logic: 'Use each stage environment_id.', markings_consistency: 'Preserve immutable identity features.', scale_consistency: dims.human_scale_reference || 'Keep scale stable.', no_stage_skipping: true },
    quality_control: { source_schema: input.schema, reference_assets: input.reference_assets, stage_transitions: input.stage_transitions, global_prompt_rules: input.global_prompt_rules },
    _production_handoff: input,
  } as TopicBrief;
}

export function isProductionHandoff(data: any): boolean {
  return !!data?.schema?.name && Array.isArray(data?.production_stages) && !!data?.product;
}
