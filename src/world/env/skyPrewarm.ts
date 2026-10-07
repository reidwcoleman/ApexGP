import * as THREE from 'three';
import { cloudNoiseMaterial } from './skyNoise.ts';
import { cloudPanoramaMaterial } from './skyClouds.ts';
import { createSkyDome } from './sky.ts';

/**
 * The sky's programs, queued on the driver's threads (KHR_parallel_shader_compile) the moment the boot
 * starts. createEnvironment draws with each of them as soon as it is made — the cloud noise, the
 * cloud panorama's march, the sky dome into the env cube, PMREM's GGX and blur filters — so each was
 * compiled and linked in turn while the main thread waited on it: ≈1.2–1.5 s in a row on a cold
 * Windows/D3D shader cache (tools/_boottrace.mjs), the longest stall before the garage. Compiled here
 * from the same sources, they build side by side while the circuit is surveyed and the garage made,
 * and the environment finds them ready: three shares a program between materials with the same key.
 *
 * The keys must match what the environment draws. The raw materials (noise, panorama) are keyed by
 * their source alone. The dome and PMREM's filters are drawn into linear half-float targets with no
 * lights and no fog — so they are compiled alone (no scene lights) with a linear target bound — and
 * their keys also carry which vertex attributes the mesh has (position, normals): the dome is
 * compiled on its own sphere, the filters on a stand-in with PMREM's planes' attributes. The
 * throwaway materials hold their programs until `release()` (once createEnvironment has its own).
 */
export function prewarmSkyPrograms(renderer: THREE.WebGLRenderer): { release(): void } {
  const held: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  // (PMREM's planes: position, uv and faceIndex, no normals — see three's _createPlanes)
  const planes = new THREE.BufferGeometry();
  planes.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  planes.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  planes.setAttribute('faceIndex', new THREE.BufferAttribute(new Float32Array(3), 1));
  geos.push(planes);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  let pmrem: THREE.PMREMGenerator | null = null;
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    const compile = (m: THREE.Material, geo: THREE.BufferGeometry) => {
      held.push(m);
      renderer.compile(new THREE.Mesh(geo, m), cam);
    };
    const quad = new THREE.PlaneGeometry(2, 2);
    geos.push(quad);
    compile(cloudNoiseMaterial(), quad);
    compile(cloudPanoramaMaterial(), quad);
    const sky = createSkyDome();
    geos.push(sky.envMesh.geometry);
    compile(sky.envMesh.material as THREE.Material, sky.envMesh.geometry);
    held.push(sky.mesh.material as THREE.Material);
    // PMREM's filters for the 256² env cube (Environment ENV_SIZE): lodMax 8. (three's private
    // interface — skipped if it changes: the environment then builds them itself, as before)
    const g = new THREE.PMREMGenerator(renderer) as unknown as {
      _setSize?: (n: number) => void;
      _allocateTargets?: () => THREE.WebGLRenderTarget;
      _ggxMaterial?: THREE.Material | null;
      _blurMaterial?: THREE.Material | null;
    };
    pmrem = g as unknown as THREE.PMREMGenerator;
    if (typeof g._setSize === 'function' && typeof g._allocateTargets === 'function') {
      g._setSize(256);
      g._allocateTargets().dispose();
      if (g._ggxMaterial) renderer.compile(new THREE.Mesh(planes, g._ggxMaterial), cam);
      if (g._blurMaterial) renderer.compile(new THREE.Mesh(planes, g._blurMaterial), cam);
    }
  } catch (e) {
    console.warn('[shaders] sky prewarm failed', e);
  } finally {
    renderer.setRenderTarget(prev);
  }
  return {
    release() {
      for (const m of held) m.dispose();
      held.length = 0;
      pmrem?.dispose();
      pmrem = null;
      rt.dispose();
      for (const g of geos) g.dispose();
    },
  };
}
