import type { TCMode } from '../sim/CarPhysics.ts';
import type { BrakingAssist } from '../sim/PlayerControl.ts';
import type { LineMode } from './RacingLineAssist.ts';

/** Driving assists, named and grouped the way the F1 games present them. */
export interface AssistConfig {
  traction: TCMode;
  abs: boolean;
  stability: boolean;
  steering: boolean;
  braking: BrakingAssist;
  line: LineMode;
  gearbox: 'auto' | 'manual';
  /** keyboard steering: 'rate' (assisted) or 'direct' */
  keyboard: 'rate' | 'direct';
  drs: 'auto' | 'manual';
}

export type AssistPreset = 'casual' | 'standard' | 'expert';

export const ASSIST_PRESETS: Record<AssistPreset, AssistConfig> = {
  casual: { traction: 'full', abs: true, stability: true, steering: true, braking: 'medium', line: 'full', gearbox: 'auto', keyboard: 'rate', drs: 'auto' },
  standard: { traction: 'medium', abs: true, stability: false, steering: false, braking: 'off', line: 'corners', gearbox: 'auto', keyboard: 'rate', drs: 'manual' },
  expert: { traction: 'off', abs: false, stability: false, steering: false, braking: 'off', line: 'off', gearbox: 'manual', keyboard: 'direct', drs: 'manual' },
};

export const PRESET_ORDER: AssistPreset[] = ['casual', 'standard', 'expert'];
export const PRESET_LABEL: Record<AssistPreset, string> = { casual: 'Casual', standard: 'Standard', expert: 'Expert' };

export function presetOf(c: AssistConfig): AssistPreset | 'custom' {
  for (const p of PRESET_ORDER) {
    const q = ASSIST_PRESETS[p];
    if ((Object.keys(q) as (keyof AssistConfig)[]).every((k) => q[k] === c[k])) return p;
  }
  return 'custom';
}
