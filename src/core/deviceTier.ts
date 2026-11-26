import type { QualityLevel } from './Renderer.ts';

/**
 * Which graphics level a first visit starts on, from what the browser says about the machine.
 * An Apple-silicon Mac or a discrete card starts on Ultra, held there (Reid's rule for his M1: the
 * best picture, whatever it costs). Everything weaker starts lower with "auto" on, so the governor
 * can keep stepping down (Ultra → High → lean → Medium → Low) until the frame rate holds.
 */
export interface DeviceTier {
  quality: QualityLevel;
  auto: boolean;
  /** strong: Ultra is the right default and the save is left alone */
  strong: boolean;
  gpu: string;
}

let gpuName = '';
/** the Renderer reports the GPU it got (it owns the only WebGL context) */
export function setGpuName(name: string) {
  gpuName = name;
}

let cached: DeviceTier | null = null;
export function deviceTier(): DeviceTier {
  if (cached) return cached;
  const forced = new URLSearchParams(location.search).get('device');
  const gpu = gpuName.toLowerCase();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8;
  const ua = navigator.userAgent;
  // (an iPad reports itself as a Mac; it has a touch screen)
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const software = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i.test(gpu);
  const appleSilicon = !mobile && /apple m\d|apple gpu/i.test(gpu) && /Macintosh/.test(ua);
  const discrete = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|radeon \(tm\) rx|arc\(tm\) a|arc a\d/i.test(gpu);
  const intel = /intel|uhd|iris|hd graphics/i.test(gpu);
  const igpuAmd = /radeon(\(tm\))? graphics|vega \d|radeon vega/i.test(gpu) && !discrete;
  // (Safari says "Apple GPU" on a Mac too: that one is the Mac's)
  const phoneGpu = /mali|adreno|powervr|immortalis|xclipse/i.test(gpu) || (/apple gpu/i.test(gpu) && mobile);
  let t: DeviceTier;
  if (forced === 'low' || forced === 'medium' || forced === 'high') t = { quality: forced, auto: true, strong: false, gpu };
  else if (forced === 'strong') t = { quality: 'ultra', auto: false, strong: true, gpu };
  else if (software || mobile || phoneGpu || cores <= 2 || mem <= 2) t = { quality: 'low', auto: true, strong: false, gpu };
  else if (appleSilicon || (discrete && cores >= 6)) t = { quality: 'ultra', auto: false, strong: true, gpu };
  else if (discrete) t = { quality: 'high', auto: true, strong: false, gpu };
  // (Intel Iris Xe / Arc-class integrated or a recent Radeon iGPU on an 8-thread laptop manages Medium)
  else if ((intel && /iris|xe|arc/i.test(gpu) && cores >= 8 && mem >= 8) || (igpuAmd && cores >= 8)) t = { quality: 'medium', auto: true, strong: false, gpu };
  else if (intel || igpuAmd || cores <= 4 || mem <= 4) t = { quality: 'low', auto: true, strong: false, gpu };
  else t = { quality: 'high', auto: true, strong: false, gpu };
  cached = t;
  return t;
}
