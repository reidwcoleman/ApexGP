import * as THREE from 'three';

/**
 * Physically based single-scattering atmosphere (Rayleigh + Mie + ozone), with a
 * crude multiple-scattering term, evaluated on the CPU into a small sky-view LUT.
 *
 * The LUT is parameterised by the azimuth between view and sun (u = Δφ / π) and
 * elevation (v = 0.5 ± 0.5·sqrt(|el| / (π/2)), Hillaire's non-linear mapping so the
 * horizon gets most of the texels). Values are radiance for a solar irradiance of 1.
 *
 * Because the sun only moves when the time-of-day preset changes, a full per-pixel
 * atmosphere is unnecessary — this costs ~15 ms per preset and gives us matched
 * colours for the sun light, the fog/haze and the hemisphere fill for free.
 */

const R_G = 6360e3;
const R_T = 6460e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const HR = 8000;
const HM = 1200;

export interface AtmosphereParams {
  /** sun elevation, radians */
  sunElevation: number;
  /** Mie density multiplier (1 = clear, 3 = hazy summer) */
  mie: number;
  /** Mie phase asymmetry */
  g: number;
  /** crude multiple-scattering boost (0.2–0.6) */
  ms: number;
  /** camera altitude (m) */
  altitude?: number;
}

export interface SkyLUT {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  data: Float32Array;
  /** sun transmittance at the camera (RGB, 0..1) */
  sunT: THREE.Color;
  /** CPU lookup of the LUT for a direction given in sun-relative terms */
  sample(elevation: number, dPhi: number, out?: THREE.Color): THREE.Color;
}

// ---------------------------------------------------------------- transmittance

const TH = 24;
const TM = 160;
const MU_MIN = -0.6;

function buildTransmittance(mie: number): Float32Array {
  const mieExt = 4.4e-6 * mie;
  const out = new Float32Array(TH * TM * 3);
  const STEPS = 30;
  for (let hi = 0; hi < TH; hi++) {
    const hn = hi / (TH - 1);
    const h = hn * hn * (R_T - R_G);
    const r = R_G + h;
    for (let mi = 0; mi < TM; mi++) {
      const mu = MU_MIN + ((1 - MU_MIN) * mi) / (TM - 1);
      const k = (hi * TM + mi) * 3;
      // ground hit?
      const dg = r * r * (mu * mu - 1) + R_G * R_G;
      if (mu < 0 && dg >= 0) {
        out[k] = out[k + 1] = out[k + 2] = 1e4;
        continue;
      }
      const d = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + R_T * R_T));
      const dt = d / STEPS;
      let tr = 0, tm = 0, to = 0;
      for (let s = 0; s < STEPS; s++) {
        const t = (s + 0.5) * dt;
        const hh = Math.sqrt(r * r + t * t + 2 * r * mu * t) - R_G;
        tr += Math.exp(-hh / HR);
        tm += Math.exp(-hh / HM);
        to += Math.max(0, 1 - Math.abs(hh - 25000) / 15000);
      }
      tr *= dt; tm *= dt; to *= dt;
      out[k] = BETA_R[0] * tr + mieExt * tm + OZONE[0] * to;
      out[k + 1] = BETA_R[1] * tr + mieExt * tm + OZONE[1] * to;
      out[k + 2] = BETA_R[2] * tr + mieExt * tm + OZONE[2] * to;
    }
  }
  return out;
}

function lookupTau(tab: Float32Array, h: number, mu: number, out: number[]) {
  const hn = Math.sqrt(Math.max(0, Math.min(1, h / (R_T - R_G))));
  const fh = hn * (TH - 1);
  const fm = ((Math.max(MU_MIN, Math.min(1, mu)) - MU_MIN) / (1 - MU_MIN)) * (TM - 1);
  const h0 = Math.min(TH - 2, Math.floor(fh));
  const m0 = Math.min(TM - 2, Math.floor(fm));
  const ah = fh - h0;
  const am = fm - m0;
  for (let c = 0; c < 3; c++) {
    const a = tab[(h0 * TM + m0) * 3 + c];
    const b = tab[(h0 * TM + m0 + 1) * 3 + c];
    const cc = tab[((h0 + 1) * TM + m0) * 3 + c];
    const d = tab[((h0 + 1) * TM + m0 + 1) * 3 + c];
    out[c] = (a * (1 - am) + b * am) * (1 - ah) + (cc * (1 - am) + d * am) * ah;
  }
}

// ---------------------------------------------------------------- sky-view LUT

export function computeSky(p: AtmosphereParams, W = 48, H = 72): SkyLUT {
  const tab = buildTransmittance(p.mie);
  const mieSca = 3.996e-6 * p.mie;
  const mieExt = 4.4e-6 * p.mie;
  const g = p.g;
  const alt = p.altitude ?? 60;
  const r0 = R_G + alt;
  const se = p.sunElevation;
  const sx = Math.cos(se), sy = Math.sin(se);
  const data = new Float32Array(W * H * 4);
  const tau = [0, 0, 0];
  const STEPS = 26;
  const inv4pi = 1 / (4 * Math.PI);

  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const e = v >= 0.5 ? (v - 0.5) * 2 : (0.5 - v) * 2;
    const el = (v >= 0.5 ? 1 : -1) * e * e * (Math.PI / 2);
    const ce = Math.cos(el), sel = Math.sin(el);
    // ray/sphere
    const b = r0 * sel;
    const tTop = -b + Math.sqrt(Math.max(0, b * b - (r0 * r0 - R_T * R_T)));
    const dg = b * b - (r0 * r0 - R_G * R_G);
    let tMax = tTop;
    if (dg > 0) {
      const tg = -b - Math.sqrt(dg);
      if (tg > 0) tMax = Math.min(tMax, tg);
    }
    for (let i = 0; i < W; i++) {
      const phi = (Math.PI * (i + 0.5)) / W;
      const dx = ce * Math.cos(phi);
      const dy = sel;
      const dz = ce * Math.sin(phi);
      const cosT = dx * sx + dy * sy;
      const pr = (3 / (16 * Math.PI)) * (1 + cosT * cosT);
      // Cornette-Shanks
      const pm = ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + cosT * cosT))) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * cosT, 1.5));
      let Lr = 0, Lg = 0, Lb = 0;
      let ar = 0, ag = 0, ab = 0; // accumulated optical depth
      let tPrev = 0;
      for (let s = 0; s < STEPS; s++) {
        const u1 = (s + 1) / STEPS;
        const t1 = tMax * u1 * u1;
        const dt = t1 - tPrev;
        const t = tPrev + dt * 0.5;
        tPrev = t1;
        const px = dx * t, py = r0 + dy * t, pz = dz * t;
        const r = Math.sqrt(px * px + py * py + pz * pz);
        const h = r - R_G;
        const dR = Math.exp(-h / HR);
        const dM = Math.exp(-h / HM);
        const dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
        const er = (BETA_R[0] * dR + mieExt * dM + OZONE[0] * dO) * dt;
        const eg = (BETA_R[1] * dR + mieExt * dM + OZONE[1] * dO) * dt;
        const eb = (BETA_R[2] * dR + mieExt * dM + OZONE[2] * dO) * dt;
        const vr = Math.exp(-(ar + er * 0.5));
        const vg = Math.exp(-(ag + eg * 0.5));
        const vb = Math.exp(-(ab + eb * 0.5));
        ar += er; ag += eg; ab += eb;
        const muS = (px * sx + py * sy) / r;
        lookupTau(tab, h, muS, tau);
        const sr = Math.exp(-tau[0]);
        const sg = Math.exp(-tau[1]);
        const sb = Math.exp(-tau[2]);
        const msR = p.ms * inv4pi;
        const scR = BETA_R[0] * dR * (pr + msR) + mieSca * dM * (pm + msR);
        const scG = BETA_R[1] * dR * (pr + msR) + mieSca * dM * (pm + msR);
        const scB = BETA_R[2] * dR * (pr + msR) + mieSca * dM * (pm + msR);
        Lr += vr * sr * scR * dt;
        Lg += vg * sg * scG * dt;
        Lb += vb * sb * scB * dt;
      }
      const k = (j * W + i) * 4;
      data[k] = Lr;
      data[k + 1] = Lg;
      data[k + 2] = Lb;
      data[k + 3] = 1;
    }
  }

  const half = new Uint16Array(W * H * 4);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i] * 10);
  const texture = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  lookupTau(tab, alt, sy, tau);
  const sunT = new THREE.Color(Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2]));

  const sample = (elevation: number, dPhi: number, out = new THREE.Color()) => {
    const a = Math.abs(dPhi) % (Math.PI * 2);
    const phi = a > Math.PI ? Math.PI * 2 - a : a;
    const u = (phi / Math.PI) * W - 0.5;
    const e = Math.sqrt(Math.min(1, Math.abs(elevation) / (Math.PI / 2)));
    const v = (elevation >= 0 ? 0.5 + 0.5 * e : 0.5 - 0.5 * e) * H - 0.5;
    const i0 = Math.max(0, Math.min(W - 2, Math.floor(u)));
    const j0 = Math.max(0, Math.min(H - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i0));
    const fv = Math.max(0, Math.min(1, v - j0));
    const c = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      const q = (jj: number, ii: number) => data[(jj * W + ii) * 4 + ch];
      c[ch] = (q(j0, i0) * (1 - fu) + q(j0, i0 + 1) * fu) * (1 - fv) + (q(j0 + 1, i0) * (1 - fu) + q(j0 + 1, i0 + 1) * fu) * fv;
    }
    return out.setRGB(c[0], c[1], c[2]);
  };

  return { texture, width: W, height: H, data, sunT, sample };
}

/** the LUT texture stores radiance × 10 (keeps half floats out of the subnormal range) */
export const LUT_SCALE = 0.1;
