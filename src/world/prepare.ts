import * as THREE from 'three';

/**
 * Getting a piece of the world ready to draw without the frame that first draws it stalling: its
 * shader programs (the lit ones and the shadow pass's depth ones) queued with the driver a slice of
 * objects per frame, its textures uploaded a few per frame, then a wait — on the main thread's idle
 * time, never blocking it — until the driver has linked them all (KHR_parallel_shader_compile).
 *
 * Why not three's `compileAsync`: it queues a whole subtree in one call (the landscape's ~100
 * programs held one frame for 1.6–2.5 s just making them), it polls every material of the set every
 * 10 ms, and each poll of a program not linked yet is a round trip to the GPU process (a 2.5 s frame
 * of the boot trace was ~120 such polls, ~1 s, while the driver was busy linking); and it never
 * queues the depth programs the shadow pass needs, which the first shadow refresh then linked one by
 * one, synchronously (people at the marshal posts and in the paddock: a 2.4–4 s frame on Windows/D3D).
 */

/** a lighting set-up to compile for: switch the scene's lights to it, return the undo */
export type LightMode = () => () => void;

export interface PrepareOpts {
  /** the lighting set-ups to compile for, each slice in turn (default: the scene's lights as they are) */
  modes?: LightMode[];
  /** the last of `modes` is the lighting the frames draw with now (no extra pass under the lights as they are) */
  lastIsCurrent?: boolean;
  /** also the depth programs the shadow pass will use for every caster (as WebGLShadowMap picks them) */
  shadows?: boolean;
  /** upload the textures too (a few per frame) */
  textures?: boolean;
  /** main-thread milliseconds per frame (default 6) */
  budget?: number;
  /** a circuit switch: stop where we are */
  cancelled?: () => boolean;
  /** stop waiting for the driver after this long (a driver that never says leaves the rest to the first frame) */
  cap?: number;
}

const SHADOW_SIDE: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const asIs: LightMode = () => () => {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The frame clock of the work behind the garage. `next()` resolves once the next frame has been
 * drawn (the game loop's rAF runs first); `budget(base)` is how much main-thread work to do before
 * the next one: `base` ms at 60 fps, more when the frames come slower without us (a GPU-bound
 * garage at 10–20 fps leaves the main thread idle most of each frame: a quarter of it costs no
 * frames, and the build needs far fewer of them), never over 40 ms.
 */
export const frameClock = {
  /** the last frame intervals (ms): their minimum is the frame time with (almost) none of our work in it */
  gaps: [] as number[],
  lastRaf: 0,
  lastUse: 0,
  ticking: false,
  /** a light rAF loop while the clock is in use (stops 5 s after the last next()) */
  tick(t: number) {
    if (this.lastRaf && t - this.lastRaf < 1000) {
      this.gaps.push(t - this.lastRaf);
      if (this.gaps.length > 12) this.gaps.shift();
    }
    this.lastRaf = t;
    if (performance.now() - this.lastUse < 5000) requestAnimationFrame((u) => this.tick(u));
    else {
      this.ticking = false;
      this.lastRaf = 0;
    }
  },
  next(): Promise<void> {
    this.lastUse = performance.now();
    if (!this.ticking) {
      this.ticking = true;
      this.gaps.length = 0;
      requestAnimationFrame((u) => this.tick(u));
    }
    return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  },
  budget(base: number): number {
    const dt = this.gaps.length >= 4 ? Math.min(...this.gaps) : 1000 / 60;
    return Math.min(40, Math.max(base, dt * 0.25));
  },
};
const nextFrame = () => frameClock.next();

type Mat = THREE.Material & Record<string, unknown>;
/** what of three's WebGLProgram this uses (isReady, and the two calls that run its first-use queries) */
type ProgramLike = { isReady(): boolean; getUniforms(): unknown; getAttributes(): unknown; __apexUsed?: boolean };

/**
 * What of an object goes into its programs' keys besides the lights and the target (WebGLPrograms
 * getParameters: the material, the kind of object, its instance colour / morph / batch textures, its
 * geometry's attributes and morph targets) and into its shadow pass's: two objects alike here compile alike.
 */
function signature(o: THREE.Object3D): string {
  const m = o as THREE.Mesh & { instanceColor?: unknown; morphTexture?: unknown; _colorsTexture?: unknown };
  const mat = m.material as THREE.Material | THREE.Material[] | undefined;
  const mats = Array.isArray(mat) ? mat.map((x) => x?.uuid).join(',') : mat?.uuid;
  const g = m.geometry as THREE.BufferGeometry | undefined;
  const a = g?.attributes ?? {};
  const ma = g?.morphAttributes ?? {};
  const f = (v: unknown) => (v ? 1 : 0);
  // (an InstancedMesh's type is 'Mesh' all the same: the kind of object from its flags)
  const x = o as THREE.Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; isSkinnedMesh?: boolean };
  return `${o.type}${f(x.isInstancedMesh)}${f(x.isBatchedMesh)}${f(x.isSkinnedMesh)}|${mats}|${f(m.instanceColor)}${f(m.morphTexture)}${f(m._colorsTexture)}|${f(a.tangent)}${f(a.normal)}${a.color?.itemSize ?? 0}${f(a.uv)}${f(a.position)}|${ma.position?.length ?? 0},${ma.normal?.length ?? 0},${ma.color?.length ?? 0}|${f(m.castShadow)}${(m.customDepthMaterial as THREE.Material | undefined)?.uuid ?? ''}`;
}

export class ScenePrep {
  /** stands in for three's own shadow depth material (programs are shared by key, so its programs are the ones the shadow pass finds) */
  private readonly depth = new THREE.MeshDepthMaterial();
  /** the object handed to renderer.compile: its traverse walks a slice of the prepared list */
  private readonly batch = new THREE.Object3D();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    /** a linear render target: what the camera draws into (the post chain's), so the program keys match */
    private readonly target: () => THREE.WebGLRenderTarget,
  ) {
    this.depth.name = 'prep-depth';
  }

  /** main-thread ms spent preparing so far (dev readout: Game.worldTimes.background) */
  spent = 0;

  /** prepare `roots` (in the scene or about to be added to it), spread over frames; resolves once the driver has linked everything */
  async prepare(roots: THREE.Object3D[], o: PrepareOpts = {}): Promise<void> {
    await this.queue(roots, o);
    if (o.cancelled?.()) return;
    await this.programsReady(o.cap ?? 20000, o.cancelled);
  }

  /** prepare's first half: the programs queued and the textures uploaded, spread over frames; the driver may still be linking */
  async queue(roots: THREE.Object3D[], o: PrepareOpts = {}): Promise<void> {
    const t0 = performance.now();
    const budget = o.budget ?? 6;
    const modes = o.modes?.length ? o.modes : [asIs];
    // (one object per program key: the trackside's hundreds of chunks share a few materials)
    const list: THREE.Object3D[] = [];
    const seen = new Set<string>();
    for (const root of roots)
      root.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!(m.isMesh || (x as THREE.Points).isPoints || (x as THREE.Line).isLine || (x as THREE.Sprite).isSprite)) return;
        const k = signature(x);
        if (seen.has(k)) return;
        seen.add(k);
        list.push(x);
      });
    // the lights inside roots not yet in the scene (compile counts the target scene's own once)
    const extraLights: THREE.Object3D[] = [];
    for (const root of roots) if (!this.inScene(root)) root.traverseVisible((x) => (x as THREE.Light).isLight && extraLights.push(x));
    let i = 0;
    let ts = t0;
    while (i < list.length) {
      if (o.cancelled?.()) return;
      const start = i;
      const deadline = ts + frameClock.budget(budget);
      // the first lighting set-up decides how far this slice gets; the others compile the same objects
      i = this.compileRange(list, start, list.length, modes[0], !!o.shadows, extraLights, deadline);
      for (let k = 1; k < modes.length; k++) this.compileRange(list, start, i, modes[k], !!o.shadows, extraLights, Infinity);
      // ...and last under the lights as they are. compile() leaves each material's current program
      // the one it compiled last, and a material with no lights (unlit, the shadow pass's depth) never
      // asks again (its key has the light counts all the same): the next frame drew it with the
      // other set-up's program, not linked yet — stalling right there (~1.3 s). It also leaves the
      // scene's light state set up for the lights it compiled with, which the next frame's shadow pass
      // reads before that frame sets up its own (WebGLRenderer.render).
      if (o.modes?.length && !o.lastIsCurrent) this.compileRange(list, start, i, asIs, !!o.shadows, extraLights, Infinity);
      this.spent += performance.now() - ts;
      if (i < list.length) {
        await nextFrame();
        ts = performance.now();
      }
    }
    if (o.textures) await this.uploadTextures(list, budget, o.cancelled);
  }

  /**
   * Resolve once every program three has made is linked (or `cap` ms). Programs are checked in the
   * order they were made and the check stops at the first one still linking: one driver query per
   * check (a linked program caches its answer), in idle time.
   *
   * A query is a round trip that the GPU process answers only once it has worked through every
   * command before it — the queued compiles included: one poll right after a big queue held the
   * main thread 1.2 s (Windows/D3D). So each check waits behind a fence first: a fence's status is
   * read without a round trip (WebGL caches it between tasks), and once it is signalled the GPU
   * process has caught up and the query comes straight back.
   */
  async programsReady(cap = 20000, cancelled?: () => boolean): Promise<void> {
    const t0 = performance.now();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const over = () => performance.now() - t0 > cap || !!cancelled?.();
    for (;;) {
      if (typeof gl.fenceSync === 'function') {
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        while (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED && !over()) await sleep(16);
        if (fence) gl.deleteSync(fence);
      }
      if (over()) return;
      const progs = (this.renderer.info.programs ?? []) as unknown as ProgramLike[];
      let pending = false;
      for (const p of progs)
        if (!p.isReady()) {
          pending = true;
          break;
        }
      if (!pending) break;
      await sleep(16);
    }
    // A program's first draw asks the driver for its uniforms and attributes (three's onFirstUse):
    // another round trip, which in the middle of a big draw (the first reflection face: ~25 ms a
    // program) waits behind everything queued before it. Asked here instead, in idle time behind a fence.
    let tWork = performance.now();
    for (const p of (this.renderer.info.programs ?? []) as unknown as ProgramLike[]) {
      if (p.__apexUsed) continue;
      p.getUniforms();
      p.getAttributes();
      p.__apexUsed = true;
      if (performance.now() - tWork > 4) {
        this.spent += performance.now() - tWork;
        if (typeof gl.fenceSync === 'function') {
          const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          while (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED && !over()) await sleep(16);
          if (fence) gl.deleteSync(fence);
        } else await sleep(16);
        tWork = performance.now();
      }
    }
    this.spent += performance.now() - tWork;
  }

  private inScene(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === this.scene) return true;
    return false;
  }

  /** compile list[a, b) under one lighting set-up, stopping at `deadline`; returns where it stopped */
  private compileRange(list: THREE.Object3D[], a: number, b: number, mode: LightMode, shadows: boolean, lights: THREE.Object3D[], deadline: number): number {
    const r = this.renderer;
    let k = a;
    const undo = mode();
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(this.target());
    const batch = this.batch;
    const casters: THREE.Mesh[] = [];
    batch.traverse = (cb: (o: THREE.Object3D) => void) => {
      for (; k < b; k++) {
        if (k > a && performance.now() > deadline) break;
        const o = list[k];
        cb(o);
        const m = o as THREE.Mesh;
        if (shadows && m.isMesh && m.castShadow && m.material) casters.push(m);
      }
    };
    batch.traverseVisible = (cb: (o: THREE.Object3D) => void) => {
      for (const l of lights) cb(l);
    };
    try {
      r.compile(batch, this.camera, this.scene);
      if (casters.length) {
        // the shadow pass draws with no scene (three's empty one: no fog, which is in the key), under
        // the same lights
        const fog = this.scene.fog;
        this.scene.fog = null;
        batch.traverse = (cb: (o: THREE.Object3D) => void) => {
          for (const m of casters) this.depthPass(m, cb);
        };
        try {
          r.compile(batch, this.camera, this.scene);
        } finally {
          this.scene.fog = fog;
        }
      }
    } catch (e) {
      console.warn('[prep] compile failed', e);
      k = Math.max(k, Math.min(b, k + 1));
    } finally {
      r.setRenderTarget(prevRT);
      undo();
    }
    return k;
  }

  /** the caster once more, wearing the depth material WebGLShadowMap.getDepthMaterial would give it */
  private depthPass(o: THREE.Object3D, cb: (o: THREE.Object3D) => void) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || !m.material) return;
    const mat = m.material;
    const custom = m.customDepthMaterial as Mat | undefined;
    const one = (src: THREE.Material): THREE.Material => {
      const d = (custom ?? this.depth) as Mat;
      const s = src as Mat;
      d.visible = s.visible;
      d.wireframe = s.wireframe;
      d.side = (s.shadowSide as THREE.Side | null) ?? SHADOW_SIDE[s.side];
      d.alphaMap = s.alphaMap ?? null;
      d.alphaTest = s.alphaToCoverage ? 0.5 : s.alphaTest;
      d.map = s.map ?? null;
      d.clipShadows = s.clipShadows;
      d.clippingPlanes = s.clippingPlanes;
      d.clipIntersection = s.clipIntersection;
      d.displacementMap = s.displacementMap ?? null;
      d.displacementScale = s.displacementScale ?? 1;
      d.displacementBias = s.displacementBias ?? 0;
      return d;
    };
    m.material = Array.isArray(mat) ? mat.map(one) : one(mat);
    try {
      cb(m);
    } finally {
      m.material = mat;
      // (the stand-in keeps no textures alive)
      const d = this.depth as unknown as Mat;
      d.map = d.alphaMap = d.displacementMap = null;
    }
  }

  /** every texture of the list's materials onto the GPU, a few per frame (a big canvas's upload can take ~100 ms on its own) */
  private async uploadTextures(list: THREE.Object3D[], budget: number, cancelled?: () => boolean) {
    const seen = new Set<THREE.Texture>();
    const add = (v: unknown) => {
      const t = v as THREE.Texture;
      if (t?.isTexture && !(t as THREE.VideoTexture).isVideoTexture && !(t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) seen.add(t);
    };
    for (const o of list) {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        for (const v of Object.values(m)) add(v);
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) add(u[k]?.value);
      }
    }
    const r = this.renderer;
    let t0 = performance.now();
    for (const t of seen) {
      if (cancelled?.()) return;
      try {
        r.initTexture(t);
      } catch {
        /* an image not ready yet uploads when it is */
      }
      if (performance.now() - t0 > frameClock.budget(budget)) {
        this.spent += performance.now() - t0;
        await nextFrame();
        t0 = performance.now();
      }
    }
    this.spent += performance.now() - t0;
  }
}
