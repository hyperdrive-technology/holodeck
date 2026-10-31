/**
 * TankTuner state for the tank params: the full params the sliders show plus
 * the keys the user EDITED. Parts get exactly the edited keys, whatever their
 * value (`tankTuningOverrides`). Fourth review of #228: handing parts the keys
 * that differ from the generic defaults (`changedTankParams`) dropped an edit
 * back to a default value -- the mash tun's window slider at 91 resolved to
 * the preset's 100 while it showed 91. Before that (holodeck#235) the full
 * state was handed over, overriding every preset with the defaults.
 */
import {
  DEFAULT_TANK_PARAMS,
  changedTankParams,
  mergeTankParams,
  type ResolvedTankParams,
  type TankParams,
} from '../../assets/process/tank-params';

export type TankTuning = {
  params: ResolvedTankParams;
  /** Keys the user edited since the last reset (sorted, unique). */
  touched: ReadonlyArray<keyof TankParams>;
};

const isKey = (k: string): k is keyof TankParams => Object.prototype.hasOwnProperty.call(DEFAULT_TANK_PARAMS, k);

/**
 * From a stored state (localStorage). A state saved before the edit list
 * existed treats the values that differ from the defaults as edited.
 */
export function initialTankTuning(stored?: { params?: Partial<TankParams>; touched?: readonly string[] }): TankTuning {
  const params = mergeTankParams(stored?.params);
  const touched = stored?.touched
    ? stored.touched.filter(isKey)
    : (Object.keys(changedTankParams(params)).filter(isKey) as Array<keyof TankParams>);
  return { params, touched: [...new Set(touched)].sort() };
}

export function editTankParam<K extends keyof TankParams>(state: TankTuning, key: K, value: TankParams[K]): TankTuning {
  return {
    params: { ...state.params, [key]: value },
    touched: state.touched.includes(key) ? state.touched : [...state.touched, key].sort(),
  };
}

export function resetTankTuning(): TankTuning {
  return { params: DEFAULT_TANK_PARAMS, touched: [] };
}

/** Exactly the edited keys with their current values: what parts receive as `tankParams`. */
export function tankTuningOverrides(state: TankTuning): Partial<TankParams> {
  const out: Record<string, unknown> = {};
  for (const k of state.touched) out[k] = state.params[k];
  return out as Partial<TankParams>;
}
