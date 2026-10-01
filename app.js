/* Kutchan house — interactive 3D walkthrough.
   Geometry comes from plan.json, parsed out of the Floor Plan Creator share by
   parse_plan.py (walls already resolved into exterior walls + shared partitions,
   openings merged, stairs lifted out). Finishes are indicative, not a spec.
   Textures + HDRI + furniture models: Poly Haven (CC0); worktop marble and the
   bath-tile source marble: ambientCG (CC0). Derived here: the 60x60 bath tile
   (Marble012 + 3 mm joints), charred cedar (from japanese_cedar_planks),
   brushed-steel hairlines and the anti-tiling noise (procedural). */
'use strict';

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;
const FLOOR_NAMES = ['1F', '2F', '3F'];
const EYE = 1.62;
/* Lens. st.fov is the field of view across the WIDER screen axis (horizontal
   on landscape, vertical on portrait); 72deg ~ a 24 mm archviz lens. */
const FOV = { def: 72, min: 40, max: 100, wide: 90, narrow: 50 };
/* Two-point perspective: looking up/down by up to SHIFT is a vertical lens
   shift (camera stays level, verticals stay vertical, like an architectural
   shift lens); only pitch beyond +-SHIFT tilts the camera. */
const SHIFT = 24 * Math.PI / 180;
/* sun direction measured off the HDRI (brightest texel): az 36deg from +x
   towards +z, 28deg up. The directional light has to agree with the sky. */
const SUN_DIR = new V(0.713, 0.473, 0.517).normalize();
/* Which house. The Floor Plan Creator share holds two: house 1 (3 floors,
   flat roof: plan.json, the original walkthrough) and house 2 (2 floors,
   1F 3.5 m, 2F under one mono-pitch roof: plan2.json, re-centred on itself).
   ?house=2 opens house 2; the switcher reloads with it, so each house is
   built from a clean start (house 1 renders exactly as it did before). */
const HOUSE = new URLSearchParams(location.search).get('house') === '2' ? 2 : 1;
/* house 2: the 2F ceiling plane, see roofSetup(); null for house 1 */
let ROOF = null;
const ROOF_HEAD = 0.15;      /* least wall left over a window cut down by the roof */

/* ------------------------------------------------------------ renderer etc */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.08, 1400);   /* fov/aspect: applyLens() */
const root = new THREE.Group(); scene.add(root);
let sun = null, composer = null, gtaoPass = null, smaaPass = null;

const LM = new THREE.LoadingManager();
const TL = new THREE.TextureLoader(LM);
const loadMsg = (t) => { const e = document.getElementById('loadmsg'); if (e) e.textContent = t; };
LM.onProgress = (url, n, total) => loadMsg('loading textures + models… ' + n + ' / ' + total);

/* ---------------------------------------------------------------- materials */
/* Every textured material carries userData.tile = metres covered by one
   repeat of its texture. Geometry UVs are written in metres / tile, so the
   textures themselves stay at repeat 1 and can be shared. */
const TEX = {};
function tload(file, srgb) {
  const k = file + (srgb ? '|s' : '');
  if (TEX[k]) return TEX[k];
  const t = TL.load('assets/tex/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, MAX_ANISO);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[k] = t);
}
/* o: color, rough (x the arm roughness), env, ao, nScale, noDiff, noNor,
   maps {diff, nor, arm} (other texture names), phys {MeshPhysicalMaterial
   params, e.g. clearcoat}, grain (veneer: UVs follow each piece's long axis,
   see grainUV), macro (anti-tiling, see macro()) */
function pbr(name, tile, o) {
  o = o || {};
  const M = o.phys ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new M(Object.assign({
    color: typeof o.color === 'number' ? o.color : 0xffffff,
    roughness: o.rough === undefined ? 1 : o.rough,
    metalness: o.metal || 0,
    envMapIntensity: o.env === undefined ? 1 : o.env,
  }, o.phys || {}));
  if (Array.isArray(o.color)) m.color.setRGB(o.color[0], o.color[1], o.color[2]);   /* linear multiplier on the albedo map */
  const mp = Object.assign({ diff: name, nor: name, arm: name }, o.maps || {});
  if (!o.noDiff) m.map = tload(mp.diff + '_diff.jpg', true);
  if (!o.noNor) m.normalMap = tload(mp.nor + '_nor.jpg', false);
  const arm = tload(mp.arm + '_arm.jpg', false);
  m.roughnessMap = arm;
  m.aoMap = arm; m.aoMapIntensity = o.ao === undefined ? 1 : o.ao;
  const ns = o.nScale === undefined ? 1 : o.nScale;
  /* OpenGL-convention maps (Poly Haven nor_gl, ambientCG NormalGL, ours) with
     three's default flipY: +v is image-up, so +green = +B. (v2 had -ns here,
     which lit every bevel from the wrong side; checked on a lit test plane.) */
  m.normalScale.set(ns, ns);
  m.userData.tile = tile;
  if (o.grain) m.userData.grain = true;
  if (o.macro) macro(m, o.macro);
  return m;
}

/* Anti-tiling. Large surfaces get a world-space, low-frequency variation from
   a small tileable noise (assets/tex/macro_noise.png, triplanar, sampled at
   two incommensurate scales): albedo +-~4-8 %, roughness +-~10 %. Options:
   blend = isotropic textures (snow, plaster, concrete) also mix in a second,
   rotated + rescaled sample of every map in noise-driven patches;
   cells = [n, 0]: plank textures with n boards across u (gaps at k/n): each
   board column samples a random column at a random offset along the board, so
   board ends never line up into a repeat; cells = [n, m]: a tile grid, every
   tile position shows a random one of the n x m tiles. The shuffled samples
   use textureGrad with the true UV derivatives (no mip seams at the joints). */
let MACRO_TEX = null;
const MACRO_HEAD = `
#if __VERSION__ < 300
#define textureGrad( s, p, dx, dy ) texture2D( s, p )
#endif
varying vec3 vMacroP;
varying vec3 vMacroN;
varying vec2 vMacroUv;
uniform sampler2D uMacroTex;
uniform vec4 uMacroA;
uniform vec4 uMacroB;
uniform vec4 uMacroC;
vec2 gUvA, gUvB, gDx, gDy, gDxB, gDyB;
float gBlend, gMacroAlbedo, gMacroRough;
float mHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec4 mNoise( vec3 p, vec3 w ) {
  return texture2D( uMacroTex, p.zy ) * w.x + texture2D( uMacroTex, p.xz ) * w.y + texture2D( uMacroTex, p.xy ) * w.z;
}
vec4 macroTex( sampler2D s ) {
  vec4 a = textureGrad( s, gUvA, gDx, gDy );
#ifdef MACRO_BLEND
  a = mix( a, textureGrad( s, gUvB, gDxB, gDyB ), gBlend );
#endif
  return a;
}
vec3 macroNor( sampler2D s ) {
  vec3 a = textureGrad( s, gUvA, gDx, gDy ).xyz * 2.0 - 1.0;
#ifdef MACRO_BLEND
  vec3 b = textureGrad( s, gUvB, gDxB, gDyB ).xyz * 2.0 - 1.0;
  b.xy = vec2( uMacroB.x * b.x + uMacroB.y * b.y, - uMacroB.y * b.x + uMacroB.x * b.y );
  a = mix( a, b, gBlend );
#endif
  return a;
}
`;
const MACRO_MAIN = `
  gDx = dFdx( vMacroUv ); gDy = dFdy( vMacroUv );
  gUvA = vMacroUv;
  float mCell = 0.0;
#ifdef MACRO_PLANKS
  { float ci = floor( vMacroUv.x * uMacroC.x );
    gUvA += vec2( floor( mHash( vec2( ci, 3.1 ) ) * uMacroC.x ) / uMacroC.x, mHash( vec2( ci, 7.7 ) ) * 17.0 );
    mCell = mHash( vec2( ci, 1.3 ) ) - 0.5; }
#endif
#ifdef MACRO_GRID
  { vec2 ci = floor( vMacroUv * uMacroC.xy );
    gUvA += floor( vec2( mHash( ci + 0.37 ), mHash( ci + 5.51 ) ) * uMacroC.xy ) / uMacroC.xy;
    mCell = mHash( ci + 9.13 ) - 0.5; }
#endif
  vec3 mw = pow( abs( vMacroN ), vec3( 4.0 ) ); mw /= ( mw.x + mw.y + mw.z + 1e-5 );
  vec4 mn = mNoise( vMacroP * uMacroA.x, mw ) * 0.62 + mNoise( vMacroP * uMacroA.x * 0.27 + 0.31, mw ) * 0.38;
  gMacroAlbedo = 1.0 + uMacroA.y * ( mn.r - 0.5 ) * 3.0 + uMacroC.z * mCell * 2.0;
  gMacroRough = 1.0 + uMacroA.z * ( mn.g - 0.5 ) * 3.0;
#ifdef MACRO_BLEND
  gBlend = smoothstep( 0.4, 0.6, mn.b ) * uMacroA.w;
  mat2 mR = mat2( uMacroB.x, uMacroB.y, - uMacroB.y, uMacroB.x );
  gUvB = mR * gUvA * uMacroB.z + vec2( 0.37, 0.61 );
  gDxB = mR * gDx * uMacroB.z; gDyB = mR * gDy * uMacroB.z;
#endif
`;
function macro(m, c) {
  if (!MACRO_TEX) { MACRO_TEX = TL.load('assets/tex/macro_noise.png'); MACRO_TEX.wrapS = MACRO_TEX.wrapT = THREE.RepeatWrapping; }
  c = Object.assign({ scale: 7, albedo: 0, rough: 0, blend: 0, rot: 0.9, s2: 0.73, cells: null, tint: 0 }, c);
  const U = {
    uMacroTex: { value: MACRO_TEX },
    uMacroA: { value: new THREE.Vector4(1 / c.scale, c.albedo, c.rough, c.blend) },
    uMacroB: { value: new THREE.Vector4(Math.cos(c.rot), Math.sin(c.rot), c.s2, 0) },
    uMacroC: { value: new THREE.Vector4(c.cells ? c.cells[0] : 0, c.cells ? c.cells[1] : 0, c.tint, 0) },
  };
  const defs = (c.blend ? '#define MACRO_BLEND\n' : '') + (c.cells ? (c.cells[1] ? '#define MACRO_GRID\n' : '#define MACRO_PLANKS\n') : '');
  const key = 'macro|' + defs.replace(/\s+/g, ' ');
  const sub = (chunk, from, to) => THREE.ShaderChunk[chunk].split(from).join(to);
  m.macroCfg = c;                       /* not userData: Material.copy JSON-clones that */
  m.customProgramCacheKey = () => key;  /* same defines -> same code -> one program */
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vMacroP;\nvarying vec3 vMacroN;\nvarying vec2 vMacroUv;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n  vMacroP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vMacroN = normalize( mat3( modelMatrix ) * objectNormal );\n  vMacroUv = uv;');
    sh.fragmentShader = (defs + MACRO_HEAD + sh.fragmentShader)
      .replace('void main() {', 'void main() {\n' + MACRO_MAIN)
      .replace('#include <map_fragment>', sub('map_fragment', 'texture2D( map, vMapUv )', 'macroTex( map )') + '\n  diffuseColor.rgb *= gMacroAlbedo;')
      .replace('#include <normal_fragment_maps>', sub('normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0', 'macroNor( normalMap )'))
      .replace('#include <roughnessmap_fragment>', sub('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'macroTex( roughnessMap )') + '\n  roughnessFactor = clamp( roughnessFactor * gMacroRough, 0.03, 1.0 );')
      .replace('#include <aomap_fragment>', sub('aomap_fragment', 'texture2D( aoMap, vAoMapUv )', 'macroTex( aoMap )'));
  };
  return m;
}
/* clone() drops onBeforeCompile (and macroCfg): re-apply it */
function cloneMat(src) {
  const m = src.clone();
  if (src.macroCfg) macro(m, src.macroCfg);
  else if (src.onBeforeCompile) m.onBeforeCompile = src.onBeforeCompile;
  return m;
}

const std = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {};
function buildMaterials() {
  const IN = 0.42;                      /* env light indoors: the sky can't see in */
  /* 2F/3F: brushed engineered oak, 9 boards of 18.8 cm per 1.69 m, satin lacquer */
  MAT.oak = pbr('wood_floor', 1.69, { env: IN, rough: 0.72, color: [1.75, 2.05, 2.4],
    phys: { clearcoat: 0.25, clearcoatRoughness: 0.34 },
    macro: { cells: [9, 0], tint: 0.05, albedo: 0.10, rough: 0.12, scale: 6 } });
  /* joinery: continuous oak veneer (no plank seams), grain along each piece's long axis */
  MAT.oakFurn = pbr('silver_oak_veneer_02', 1.0, { env: IN, rough: 0.78, color: [0.77, 0.86, 0.74], grain: true,
    macro: { albedo: 0.06, rough: 0.1, scale: 3 } });
  /* 1F: sealed, lightly polished concrete */
  MAT.concrete = pbr('concrete_floor_worn_001', 3.0, { env: IN, color: [2.7, 2.8, 3.0], rough: 0.62, nScale: 0.6,
    phys: { clearcoat: 0.35, clearcoatRoughness: 0.22 },
    macro: { blend: 1, albedo: 0.14, rough: 0.2, scale: 7 } });
  /* onsen: dark stone tile, wet-look; entrance: the same stone, honed */
  MAT.granite = pbr('granite_tile', 2.29, { env: IN, rough: 0.52, color: [0.55, 0.56, 0.58], macro: { albedo: 0.08, rough: 0.12, scale: 5 } });
  MAT.entranceStone = pbr('granite_tile', 2.29, { env: IN, rough: 0.75, color: [0.6, 0.6, 0.62], macro: { albedo: 0.08, rough: 0.1, scale: 5 } });
  /* bathrooms / powder / wash room: 60 x 60 light porcelain (marble look), 3 mm joints */
  MAT.bathTile = pbr('bath_tile', 2.4, { env: IN, rough: 1.0, ao: 0.8, color: [1.45, 1.43, 1.28],
    macro: { cells: [4, 4], tint: 0.02, albedo: 0.04, rough: 0.1, scale: 5 } });
  /* sauna + soaking tubs: hinoki - pale cream, straight fine grain, knot-free:
     12 cm boards with 1.5 mm joints, derived from the oak veneer (10 per 1.2 m) */
  MAT.hinoki = pbr('hinoki_boards', 1.2, { env: IN, rough: 1.0 });
  MAT.cedar = pbr('japanese_cedar_planks', 1.13, { env: 0.8, color: 0x9c7d66 });
  /* painted plaster / drywall: near-white, stipple normal kept faint */
  MAT.plaster = pbr('white_stucco', 1.99, { env: IN, color: [1.26, 1.27, 1.24], nScale: 0.22, ao: 0.3,
    macro: { blend: 1, albedo: 0.07, rough: 0.14, scale: 5 } });
  MAT.ceiling = pbr('white_stucco', 1.99, { env: IN, color: [1.33, 1.37, 1.36], nScale: 0.18, ao: 0.3,
    macro: { blend: 1, albedo: 0.05, rough: 0.1, scale: 5 } });
  /* charred (yakisugi) cedar boards, 14 cm, brushed so the grain shows */
  MAT.clad = pbr('charred_cedar', 1.13, { env: 0.85, rough: 1.0, color: [0.38, 0.38, 0.38], maps: { nor: 'japanese_cedar_planks' }, nScale: 1.9,
    macro: { albedo: 0.08, rough: 0.08, scale: 6 } });
  /* snow: the scan's normal map carried a 12.8 deg net tilt (removed in the
     file); v2 lit the field as a plane tilted toward the sun, so the albedo is
     raised to keep v2's brightness on level ground. Anti-tiling: a second,
     rotated and slightly finer sample + only +-1-3 % luminance breakup */
  MAT.snow = pbr('snow_02', 3.0, { env: 1.0, color: [1.2, 1.23, 1.29], rough: 0.9, nScale: 0.8,
    macro: { blend: 1, albedo: 0.03, rough: 0.03, scale: 9, s2: 1.31, rot: 1.1 } });
  MAT.roofSnow = pbr('snow_02', 2.2, { env: 1.0, color: [1.245, 1.268, 1.314], rough: 0.9, nScale: 0.6,
    macro: { blend: 1, albedo: 0.03, rough: 0.03, scale: 6, s2: 1.27, rot: 1.1 } });
  /* terrace: weathered, silvering timber */
  MAT.deck = pbr('old_planks_02', 2.0, { env: 0.9, color: [1.0, 1.02, 1.06], macro: { albedo: 0.12, rough: 0.1, scale: 5 } });
  MAT.packed = pbr('snow_02', 1.6, { env: 1.0, color: [0.879, 0.926, 0.986], rough: 0.8, nScale: 0.5,
    macro: { blend: 1, albedo: 0.03, rough: 0.03, scale: 7, s2: 1.29, rot: 1.1 } });
  MAT.pad = pbr('concrete_floor_worn_001', 3.0, { env: 0.8, color: [2.2, 2.2, 2.3], rough: 0.95, nScale: 0.7,
    macro: { blend: 1, albedo: 0.14, rough: 0.1, scale: 6 } });
  /* textiles: wool herringbone upholstery, linen bedding, wool throw */
  /* cloth: sheen (the soft grazing-angle fuzz of fibres) + deeper weave relief */
  const CLOTH = (c) => ({ sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(c) });
  MAT.sofa = pbr('poly_wool_herringbone', 0.3, { env: 0.5, color: [2.2, 2.1, 1.85], nScale: 1.8, rough: 1, phys: CLOTH(0x9c958a) });
  MAT.linen = pbr('rough_linen', 0.36, { env: 0.5, color: 0xe2dacd, nScale: 1.5, rough: 1.3, phys: CLOTH(0xb8b2a8) });
  MAT.linenDark = pbr('poly_wool_herringbone', 0.3, { env: 0.5, color: [0.8, 0.78, 0.74], nScale: 1.8, rough: 1, phys: CLOTH(0x5c5852) });
  MAT.linenWhite = pbr('rough_linen', 0.36, { env: 0.5, color: [1.22, 1.21, 1.19], nScale: 1.2, rough: 1.3, phys: CLOTH(0xc8c6c2) });

  /* glass: reflections are ADDED at full strength (Fresnel does the work),
     what's behind is let through at (1 - opacity). Stock transparency would
     scale the reflection by opacity too, which is why windows read as holes. */
  MAT.glass = new THREE.MeshStandardMaterial({
    color: 0x9fb3ba, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1,
    envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  MAT.glass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'gl_FragColor = vec4( totalSpecular + totalDiffuse * diffuseColor.a, diffuseColor.a );');
  };
  MAT.glassIn = new THREE.MeshStandardMaterial({
    color: 0xdfe9ea, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.1,
    envMapIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false,
  });
  MAT.frame = std({ color: 0x1b1d20, roughness: 0.38, metalness: 0.6, envMapIntensity: 0.9 });
  /* brushed stainless: streaked normal + roughness (procedural, streaks along u) */
  MAT.steel = pbr('brushed_steel', 0.5, { noDiff: true, metal: 1, rough: 1, color: 0xbfc4c9, env: 1.2, nScale: 0.8 });
  MAT.blackSteel = std({ color: 0x1d1f22, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.8 });
  MAT.white = std({ color: 0xf1f1ef, roughness: 0.35, metalness: 0, envMapIntensity: IN });
  MAT.porcelain = std({ color: 0xfbfbfa, roughness: 0.08, metalness: 0, envMapIntensity: 1.0 });
  /* worktops + vanity tops: one dark marble slab (ambientCG Marble016), honed-polished */
  MAT.stoneTop = pbr('marble016', 1.0, { noNor: true, rough: 1.6, env: 0.9, color: 0xd6d6d6 });
  MAT.water = new THREE.MeshPhysicalMaterial({
    color: 0x6fa9b8, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.55,
    envMapIntensity: 1.4, depthWrite: false,
  });
  MAT.black = std({ color: 0x141517, roughness: 0.3, metalness: 0.2, envMapIntensity: 0.8 });
  MAT.screen = std({ color: 0x07090b, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.0 });
  MAT.slabEdge = std({ color: 0xd6d3cd, roughness: 0.9, envMapIntensity: IN });
  MAT.bark = std({ color: 0x4a4038, roughness: 0.95, envMapIntensity: 0.6 });
  MAT.rug = pbr('hessian_380', 0.8, { env: 0.4, color: [0.92, 1.0, 1.1], nScale: 1.6 });      /* entrance: chunky jute weave (hessian at 3x) */
  MAT.rugWool = pbr('curly_teddy_natural', 0.33, { env: 0.4, color: [0.62, 0.66, 0.72], nScale: 1.0, rough: 1.25 });  /* living: wool boucle */
  MAT.lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff1d8 });
  MAT.heater = std({ color: 0x2b2b2b, roughness: 0.7, metalness: 0.3 });
  MAT.stones = std({ color: 0x55524e, roughness: 0.95, envMapIntensity: 0.5 });
}

/* ------------------------------------------------------------ environment */
function setupEnv() {
  return new Promise((res) => {
    new RGBELoader(LM).load('assets/sky_2k.hdr', (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = hdr;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(hdr).texture;
      pm.dispose();
      res();
    });
  });
}
function setupLights() {
  scene.add(new THREE.HemisphereLight(0xcfe0f2, 0xf2f2f4, 0.25));
  sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
  if (HOUSE === 2) sun.target.position.set(0, 3, 0); else sun.target.position.set(-4, 3, -5);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 60);
  sun.castShadow = true;
  const big = Math.min(screen.width, screen.height) >= 700 && (navigator.hardwareConcurrency || 4) > 4;
  sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
  const s = 17, cm = sun.shadow.camera;
  cm.left = -s; cm.right = s; cm.top = s; cm.bottom = -s; cm.near = 20; cm.far = 110;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  /* fog = the HDRI's own horizon radiance (linear), so the far snow melts into it */
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.66, 0.73, 0.83, THREE.LinearSRGBColorSpace), 0.0042);
}

/* ------------------------------------------------------------ geometry kit */
const tileOf = (m) => (m && m.userData && m.userData.tile) || 1;
function scaleUV(geo, s) {
  const uv = geo.attributes.uv; if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  uv.needsUpdate = true; return geo;
}
/* BoxGeometry with UVs in metres / tile. axis: grain axis for veneer ('x'|'y'|'z') */
function B(w, h, d, mat, axis) {
  const g = new THREE.BoxGeometry(w, h, d);
  const t = tileOf(mat), uv = g.attributes.uv;
  if (mat && mat.userData.grain) return grainUV(g, t, axis);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let s = 0; s < 6; s++) for (let v = 0; v < 4; v++) {
    const i = s * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[s][0] / t, uv.getY(i) * dims[s][1] / t);
  }
  return g;
}
/* Veneer UVs. The veneer texture's grain runs along u. Every triangle is
   box-projected onto its dominant plane with u along the grain axis (the
   piece's longest dimension unless given) wherever that axis lies in the
   face, so the grain follows each piece: up door leaves and cupboard fronts,
   along tables, treads and rails. A seeded offset per piece keeps identical
   pieces from showing identical figure. */
let _grainSeed = 424242;
function grainUV(geo, tile, axis) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox, size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  const ax = axis ? 'xyz'.indexOf(axis) : size.indexOf(Math.max(...size));
  const rnd = () => ((_grainSeed = (_grainSeed * 16807) % 2147483647) / 2147483647);
  const ou = rnd() * 7, ov = rnd() * 7;
  const P = g.attributes.position.array, n = g.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i + 2 < n; i += 3) {
    const a = i * 3, b = a + 3, c = a + 6;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = Math.abs(e1y * e2z - e1z * e2y), ny = Math.abs(e1z * e2x - e1x * e2z), nz = Math.abs(e1x * e2y - e1y * e2x);
    const dn = nx >= ny && nx >= nz ? 0 : (ny >= nz ? 1 : 2);
    const ip = [0, 1, 2].filter(k => k !== dn);
    const ua = ip.includes(ax) ? ax : (size[ip[0]] >= size[ip[1]] ? ip[0] : ip[1]);
    const va = ip[0] === ua ? ip[1] : ip[0];
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      uv[j * 2] = P[j * 3 + ua] / tile + ou; uv[j * 2 + 1] = P[j * 3 + va] / tile + ov;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData.grained = true;
  return g;
}
function mk(parent, geo, mat, x, y, z, ry) {
  if (mat && mat.userData && mat.userData.grain && !geo.userData.grained) geo = grainUV(geo, tileOf(mat));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  if (ry) m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
/* rounded box (soft furnishings). soft = bevel radius in m for cushions and
   bedding: a deep 6-step rounding with smooth normals and the same outer size
   as the plain version (whose flat-shaded 3-step bevel read as a hard slab) */
function RB(w, h, d, r, mat, soft) {
  r = Math.max(0.004, Math.min(r, w / 2 - .002, h / 2 - .002));
  let bev = Math.min(r * .7, d * .22), segs = 3, cseg = 6;
  if (soft) {
    const X = w + 2 * bev, Y = h + 2 * bev, b = Math.min(soft, d * 0.45, X * 0.45, Y * 0.45);
    w = X - 2 * b; h = Y - 2 * b; r = Math.max(0.004, Math.min(r + bev - b, w / 2 - .002, h / 2 - .002));
    bev = b; segs = 6; cseg = 10;
  }
  const sh = new THREE.Shape(), x = -w / 2, y = -h / 2;
  sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(.002, d - bev * 2), bevelEnabled: true,
    bevelSize: bev, bevelThickness: bev, bevelSegments: segs, curveSegments: cseg
  });
  g.translate(0, 0, -d / 2 + bev);
  if (soft) {                                        /* weld + smooth: no facets on the roll */
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const m = mergeVertices(g, 1e-5); m.computeVertexNormals();
    return grainUV(m, tileOf(mat));
  }
  g.computeVertexNormals();
  /* box-projected UVs (see grainUV): the extrude generator's bevel UVs smear
     a woven texture into stripes round every rounded edge */
  return grainUV(g, tileOf(mat));
}
/* flat rounded slab: w along x, d along z, h tall */
function RS(w, h, d, r, mat, soft) { const g = RB(w, d, h, r, mat, soft); g.rotateX(-Math.PI / 2); return g; }
const CY = (r, h, s) => new THREE.CylinderGeometry(r, r, h, s || 20);

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function rectCorners(s) {
  const ca = Math.cos(s.a || 0), sa = Math.sin(s.a || 0), hw = s.w / 2, hd = s.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
    .map(([px, pz]) => [s.x + px * ca - pz * sa, s.y + px * sa + pz * ca]);
}

const COLL = [];   /* world AABBs for walk collision */
function addCollBox(cx, cz, w, d, ang, y0, y1) {
  const c = rectCorners({ x: cx, y: cz, w, d, a: ang });
  COLL.push({
    x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])),
    z0: Math.min(...c.map(p => p[1])), z1: Math.max(...c.map(p => p[1])), y0, y1
  });
}

/* ------------------------------------------------------------------- walls */
/* charred cladding UVs: the cedar scan's boards are 8.1 cm; the facade lays
   them at 13 cm (14 boards per 1.82 m) with the grain 1.15x longer, and every
   piece continues the boards of its neighbours: u is the world coordinate
   along the facade (base + dir * s), v the height, so boards run unbroken past
   windows and from floor to floor */
const CLAD_U = 1.82, CLAD_V = 1.3;
function cladUV(geo, i0, i1, s0, y0, base, dir) {
  const uv = geo.attributes.uv, t = tileOf(MAT.clad);
  for (let i = i0; i < i1; i++) uv.setXY(i, (base + dir * (uv.getX(i) * t + s0)) / CLAD_U, (uv.getY(i) * t + y0) / CLAD_V);
}
/* A wall run along a->b. The wall occupies [n0, n1] along the unit normal n
   (n0 < n1) and y in [y0, y1]. Openings cut full-height slots; sills / heads
   are added back. Exterior walls get a cladding skin on the +n side. */
function wallRun(G, w, lvl, L) {
  const [ax, az] = w.a, [bx, bz] = w.b;
  const len = Math.hypot(bx - ax, bz - az); if (len < 0.02) return;
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  let nx, nz, n0, n1;
  if (w.kind === 'ext') { nx = w.n[0]; nz = w.n[1]; n0 = 0; n1 = w.t; }
  else { nx = -uz; nz = ux; n0 = -w.t / 2; n1 = w.t / 2; }
  const ext = w.kind === 'ext';
  /* Each corner is filled by exactly ONE wall (the one ending there); if both
     ran on, the end face of one sits in the other's outer face and z-fights. */
  const e0 = ext && w.pre ? w.pre : 0, e1 = ext ? w.ext1 : 0;   /* w.pre: house 2 inside corners (parse_plan.py) */
  const isTop = lvl === LV.length - 1;
  const yB = L.base - (lvl === 0 && ext ? 0.25 : 0);
  const yT = L.base + L.h + (ext ? (isTop ? 0 : L.ct) : 0);
  const hIn = L.h;                                   /* interior clear height */
  const th = Math.atan2(-uz, ux);                    /* local x -> u, local z -> n */
  const SKIN = 0.025;
  /* house 2 2F: every piece that reaches the wall top gets its top face put
     on the sloped ceiling plane (per vertex), see roofTop() */
  const roof = isTop ? ROOF : null;
  /* piece: s in [s0,s1], y in [y0,y1] (absolute), across n in [q0,q1] */
  const piece = (s0, s1, y0, y1, q0, q1, mat, coll) => {
    if (s1 - s0 < 0.004 || y1 - y0 < 0.004 || q1 - q0 < 0.002) return;
    const geo = B(s1 - s0, y1 - y0, q1 - q0, mat);
    const cs = (s0 + s1) / 2, cq = (q0 + q1) / 2;
    const px = ax + ux * cs + nx * cq, py = (y0 + y1) / 2, pz = az + uz * cs + nz * cq;
    if (roof && y1 >= yT - 1e-6) roofTop(geo, px, py, pz, th);
    if (mat === MAT.clad) cladUV(geo, 16, 20, s0, y0, Math.abs(ux) > 0.5 ? ax : az, Math.sign(Math.abs(ux) > 0.5 ? ux : uz));  /* outer (+z) face */
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.y = th;
    m.castShadow = true; m.receiveShadow = true;
    G.walls.add(m);
    if (coll) addCollBox(m.position.x, m.position.z, s1 - s0, q1 - q0, -th, y0, y1);
  };
  const solid = (s0, s1, y0, y1) => {
    if (ext && w.skin) {
      /* house 2: cladding only where the outer face is outside (parse_plan.py
         `skin`); elsewhere it is in another wall and the core runs full depth */
      let c = s0;
      for (const [k0, k1] of w.skin) {
        const a = Math.max(c, k0), b = Math.min(s1, k1);
        if (b <= a) continue;
        if (a > c) piece(c, a, y0, y1, n0, n1, MAT.plaster, true);
        piece(a, b, y0, y1, n0, n1 - SKIN, MAT.plaster, true);
        piece(a, b, y0, y1, n1 - SKIN, n1, MAT.clad, false);
        c = b;
      }
      if (c < s1) piece(c, s1, y0, y1, n0, n1, MAT.plaster, true);
    } else if (ext) {
      piece(s0, s1, y0, y1, n0, n1 - SKIN, MAT.plaster, true);
      piece(s0, s1, y0, y1, n1 - SKIN, n1, MAT.clad, false);
    } else piece(s0, s1, y0, y1, n0, n1, MAT.plaster, true);
  };
  /* skirting on interior faces */
  const skirt = (s0, s1) => {
    if (s1 - s0 < 0.1) return;
    const faces = ext ? [n0 - 0.006] : [n0 - 0.006, n1 + 0.006];
    for (const q of faces) piece(s0, s1, L.base, L.base + 0.07, q - 0.006, q + 0.006, MAT.white, false);
  };
  const ops = (roof ? underRoof(w, L, ax, az, ux, uz, nx, nz, n0, n1) : w.doors.slice()).sort((p, q) => p.off - q.off);
  /* lowest point of the ceiling plane over [s0, s1] of this wall (plane: the minimum is at a corner) */
  const roofMin = (s0, s1) => Math.min(...[s0, s1].flatMap(s => [n0, n1].map(q => ROOF.y(ax + ux * s + nx * q, az + uz * s + nz * q))));
  const own = { c0: COLL.length, c1: COLL.length };  /* this run's COLL boxes */
  let cur = -e0;
  const runEnd = len + e1;
  for (const o of ops) {
    const s = Math.max(o.off, cur), e = Math.min(o.off + o.w, runEnd);
    if (e <= s) continue;
    if (s > cur) { solid(cur, s, yB, yT); skirt(Math.max(cur, 0), Math.min(s, len)); }
    const bot = L.base + Math.min(o.bottom, hIn);
    /* under house 2's roof: an FPC style-2 hole is open to the ceiling; any
       other opening keeps its drawn head unless the roof comes down past it */
    const top = !roof ? L.base + Math.min(o.top, hIn) : (o.full ? Infinity : Math.min(L.base + o.top, roofMin(s, e) - ROOF_HEAD));
    if (bot > L.base + 0.01) { solid(s, e, yB, bot); skirt(s, e); }
    if (top < yT - 0.01) solid(s, e, top, yT);
    opening(G, o, w, lvl, L, { ax, az, ux, uz, nx, nz, n0, n1, th, s, e, bot, top, ext, own });
    if (ext && lvl > 0 && o.kind !== 'WINDOW' && bot <= L.base + 0.01 && FLOOR_RECTS[lvl]) {
      const pts = [[s, n0 - 0.05], [e, n0 - 0.05], [e, n1 + 0.05], [s, n1 + 0.05]].map(([ss, qq]) => [ax + ux * ss + nx * qq, az + uz * ss + nz * qq]);
      FLOOR_RECTS[lvl].push(bbox(pts));
    }
    cur = Math.max(cur, e);
  }
  if (cur < runEnd) { solid(cur, runEnd, yB, yT); skirt(Math.max(cur, 0), len); }
  own.c1 = COLL.length;
  if (ext && e1 > 0 && w.cap !== 0) {                /* clad the exposed corner end (house 2: not where it butts into the next wall) */
    const cg = B(0.01, yT - yB, n1 - n0, MAT.clad);
    const cx = ax + ux * (runEnd + 0.005) + nx * (n0 + n1) / 2, cy = (yB + yT) / 2, cz = az + uz * (runEnd + 0.005) + nz * (n0 + n1) / 2;
    if (roof) roofTop(cg, cx, cy, cz, th);
    cladUV(cg, 0, 8, 0, yB, 0, 1);
    const m = new THREE.Mesh(cg, MAT.clad);
    m.position.set(cx, cy, cz);
    m.rotation.y = th; m.castShadow = true; m.receiveShadow = true; G.walls.add(m);
  }
}

/* house 2: put a wall box's top face on the 2F ceiling plane, vertex by
   vertex (the box is built up to the nominal level height first). The side
   faces' v stays in metres / tile, so plaster and cladding keep their scale. */
function roofTop(geo, px, py, pz, th) {
  const P = geo.attributes.position, uv = geo.attributes.uv;
  const c = Math.cos(th), s = Math.sin(th);
  let hy = -Infinity;
  for (let i = 0; i < P.count; i++) hy = Math.max(hy, P.getY(i));
  for (let i = 0; i < P.count; i++) {
    if (P.getY(i) < hy - 1e-6) continue;
    const lx = P.getX(i), lz = P.getZ(i);
    const ny = ROOF.y(px + lx * c + lz * s, pz - lx * s + lz * c) - py;   /* mesh turned by th about y */
    if (uv && (i < 8 || i >= 16)) uv.setY(i, uv.getY(i) * (ny + hy) / (2 * hy));   /* +-x / +-z faces; v from the bottom */
    P.setY(i, ny);
  }
  P.needsUpdate = true; if (uv) uv.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}
/* house 2 2F openings: a window the roof would cut is split where an
   interior wall meets it (one window per room behind it) so only the part
   under the low side loses height; the rest keeps its drawn head. */
function underRoof(w, L, ax, az, ux, uz, nx, nz, n0, n1) {
  const at = (s, q) => ROOF.y(ax + ux * s + nx * q, az + uz * s + nz * q) - L.base;
  const clear = (s0, s1) => Math.min(at(s0, n0), at(s0, n1), at(s1, n0), at(s1, n1)) - ROOF_HEAD;
  const out = [];
  for (const o of w.doors) {
    if (o.kind !== 'WINDOW' || w.kind !== 'ext' || o.top <= clear(o.off, o.off + o.w)) { out.push(o); continue; }
    const cuts = [];
    for (const v of L.walls) {
      if (v.kind !== 'int' || v === w) continue;
      const vl = Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]) || 1;
      if (Math.abs(((v.b[0] - v.a[0]) * ux + (v.b[1] - v.a[1]) * uz) / vl) > 0.3) continue;   /* must stand across this wall */
      for (const p of [v.a, v.b]) {
        const q = (p[0] - ax) * nx + (p[1] - az) * nz, s = (p[0] - ax) * ux + (p[1] - az) * uz;
        if (Math.abs(q - n0) < 0.15 && s > o.off + 0.3 && s < o.off + o.w - 0.3) cuts.push(s);
      }
    }
    const xs = [o.off, ...[...new Set(cuts.map(v => +v.toFixed(3)))].sort((a, b) => a - b), o.off + o.w];
    for (let i = 0; i + 1 < xs.length; i++) out.push(Object.assign({}, o, { off: xs[i], w: xs[i + 1] - xs[i] }));
  }
  return out;
}

/* glazing, door leaves, frames */
const MAIN_ENTRANCE = new Set(['487', '408']);
function opening(G, o, w, lvl, L, c) {
  const { ax, az, ux, uz, nx, nz, n0, n1, th, s, e, bot, top, ext } = c;
  const W = e - s, H = top - bot;
  if (H < 0.05 || W < 0.05 || o.kind === 'HOLE') return;
  const at = (ss, qq, yy) => new V(ax + ux * ss + nx * qq, yy, az + uz * ss + nz * qq);
  const put = (geo, mat, ss, qq, yy, shadow) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at(ss, qq, yy)); m.rotation.y = th;
    m.castShadow = !!shadow; m.receiveShadow = true;
    G.walls.add(m); return m;
  };
  const glazed = o.kind === 'WINDOW' || (ext && !MAIN_ENTRANCE.has(o.id) && (o.kind === 'DOUBLE_DOOR' || o.kind === 'DOOR'));
  if (glazed) {
    /* aluminium frame near the outside face, glass in the middle of it */
    const q = ext ? n1 - 0.11 : 0, fd = 0.07, fw = 0.05;
    const bar = (s0, s1, y0, y1) => put(B(s1 - s0, y1 - y0, fd), MAT.frame, (s0 + s1) / 2, q, (y0 + y1) / 2, true);
    bar(s, e, bot, bot + fw); bar(s, e, top - fw, top);
    bar(s, s + fw, bot, top); bar(e - fw, e, bot, top);
    if (ext) {                                          /* black metal reveal lining outside the frame */
      const qa = q + fd / 2, qb = n1 + 0.002, dq = qb - qa, cq = (qa + qb) / 2;
      put(B(0.006, H, dq), MAT.blackSteel, s + 0.004, cq, (bot + top) / 2, false);
      put(B(0.006, H, dq), MAT.blackSteel, e - 0.004, cq, (bot + top) / 2, false);
      put(B(W, 0.006, dq), MAT.blackSteel, (s + e) / 2, cq, top - 0.004, false);
      if (bot > L.base + 0.05) put(B(W, 0.006, dq), MAT.blackSteel, (s + e) / 2, cq, bot + 0.004, false);
    }
    const nMull = Math.max(0, Math.ceil(W / 1.9) - 1);
    for (let i = 1; i <= nMull; i++) { const mx = s + W * i / (nMull + 1); bar(mx - 0.025, mx + 0.025, bot, top); }
    if (o.kind !== 'WINDOW') bar(s, e, bot + 1.02, bot + 1.06);          /* door rail */
    const gl = put(new THREE.PlaneGeometry(W - 0.04, H - 0.04), MAT.glass, (s + e) / 2, q, (bot + top) / 2, false);
    gl.renderOrder = 2;
    if (o.kind === 'WINDOW' && bot > L.base + 0.05) {
      /* oak sill board inside, metal flashing outside */
      const qa = (ext ? n0 : n0) - 0.03, qb = q - fd / 2;
      put(B(W + 0.06, 0.03, qb - qa, MAT.oakFurn), MAT.oakFurn, (s + e) / 2, (qa + qb) / 2, bot - 0.015, true);
      if (ext) put(B(W + 0.04, 0.02, 0.1), MAT.blackSteel, (s + e) / 2, n1 - 0.03, bot - 0.01, true);
    }
    return;
  }
  /* solid doors: leaves + casings */
  const leafMat = MAT.oakFurn;
  const q = ext ? n1 - 0.12 : 0;
  const casing = (s0, s1, y0, y1) => put(B(s1 - s0, y1 - y0, (n1 - n0) + 0.02, MAT.white), MAT.white, (s0 + s1) / 2, (n0 + n1) / 2, (y0 + y1) / 2, true);
  if (!ext) { casing(s - 0.04, s, bot, top + 0.04); casing(e, e + 0.04, bot, top + 0.04); casing(s - 0.04, e + 0.04, top, top + 0.04); }
  const nLeaf = o.kind === 'DOUBLE_DOOR' ? 2 : 1, lw = W / nLeaf;
  if (o.kind === 'SLIDING_HUNG_DOOR') {
    /* slid open against a wall face beside the opening, on a track. Which
       face and which way needs every wall in place: see parkSliders() */
    SLIDERS.push({ id: o.id, lvl, put, at, lw, H, s, e, bot, top, n0, n1, own: c.own });
    return;
  }
  for (let i = 0; i < nLeaf; i++) {
    const g = new THREE.Group();
    const leaf = new THREE.Mesh(B(lw - 0.01, H - 0.01, 0.04, ext ? MAT.cedar : leafMat), ext ? MAT.cedar : leafMat);
    leaf.castShadow = true; leaf.receiveShadow = true;
    const handle = new THREE.Mesh(B(0.02, 0.26, 0.05), MAT.blackSteel);
    const hinge = i === 0 ? 0 : 1;                       /* 0 = hinge at s side */
    if (!ext) {
      /* interior swing door, left open 90deg */
      const hs = hinge === 0 ? s : e, dir = hinge === 0 ? 1 : -1;
      g.position.copy(at(hs, 0, bot + H / 2)); g.rotation.y = th;
      const pivot = new THREE.Group(); g.add(pivot);
      pivot.rotation.y = dir * (Math.PI / 2) * (o.id && (+o.id % 2) ? 1 : -1);
      leaf.position.set(dir * lw / 2, 0, 0);
      handle.position.set(dir * (lw - 0.08), 0, 0.04);
      pivot.add(leaf, handle);
      G.walls.add(g); continue;
    } else {
      /* exterior solid door: closed */
      g.position.copy(at(s + lw * (i + 0.5), q, bot + H / 2)); g.rotation.y = th;
      handle.position.set((i === 0 ? 1 : -1) * (lw / 2 - 0.1), 0, -0.05);
      const h2 = handle.clone(); h2.position.z = 0.05; g.add(h2);
    }
    g.add(leaf, handle);
    G.walls.add(g);
  }
}

/* Every sliding leaf parks flat against a wall face beside its opening, in
   the first of: n1 face toward the wall start, n1 toward its end, n0 toward
   the start, n0 toward the end, where the leaf box (lw x H x 5 cm, 3.5 cm off
   the face) hits no wall but its own and no furniture, fixture or door leaf,
   stays on this floor of the house and has solid wall behind it (not open
   space or another opening). If none is free, the first. Runs once all walls
   of all levels exist, before mergeStatic. */
const SLIDERS = [];
function parkSliders(list) {
  scene.updateMatrixWorld(true);
  const obst = [];
  for (const g of G.furn) for (const o of g.children) obst.push(new THREE.Box3().setFromObject(o));
  for (const g of G.walls) for (const o of g.children) if (o.isGroup) obst.push(new THREE.Box3().setFromObject(o));
  const inWall = (v) => COLL.some(b => v.x > b.x0 && v.x < b.x1 && v.z > b.z0 && v.z < b.z1 && v.y > b.y0 && v.y < b.y1);
  for (const d of (list || SLIDERS)) {
    const { put, at, lw, H, s, e, bot, top, n0, n1, own } = d;
    const spots = [[1, -1], [1, 1], [-1, -1], [-1, 1]].map(([side, dir]) => ({
      side, dir,
      q: side > 0 ? n1 + 0.035 : n0 - 0.035,               /* leaf centre plane */
      sc: dir < 0 ? s - lw / 2 + 0.08 : e + lw / 2 - 0.08, /* leaf centre along the wall */
    }));
    const blocker = (p) => {
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => at(p.sc + i * lw / 2, p.q + j * 0.025, 0));
      const box = new THREE.Box3(new V(Math.min(...c.map(v => v.x)), bot + 0.02, Math.min(...c.map(v => v.z))),
        new V(Math.max(...c.map(v => v.x)), bot + H - 0.02, Math.max(...c.map(v => v.z))));
      for (let k = 0; k < COLL.length; k++) {
        if (k >= own.c0 && k < own.c1) continue;
        const b = COLL[k];
        if (box.min.x < b.x1 && box.max.x > b.x0 && box.min.z < b.z1 && box.max.z > b.z0 && box.min.y < b.y1 && box.max.y > b.y0) return 'wall';
      }
      if (obst.some(b => b.intersectsBox(box))) return 'furniture';
      for (let i = 0; i <= 10; i++) for (const j of [-1, 1]) {
        const v = at(p.sc - lw / 2 + lw * i / 10, p.q + j * 0.025, 0);
        if (!onRects(FLOOR_RECTS[d.lvl], v.x, v.z, 0.005)) return 'off floor';
      }
      const a0 = p.dir < 0 ? s - lw + 0.1 : e + 0.02, a1 = p.dir < 0 ? s - 0.02 : e + lw - 0.1;
      for (let i = 0; i <= 8; i++) for (const y of [0.3, 1.1, H - 0.15])
        if (!inWall(at(a0 + (a1 - a0) * i / 8, p.side > 0 ? n1 - 0.02 : n0 + 0.02, bot + y))) return 'no wall behind';
      return '';
    };
    for (const p of spots) p.why = blocker(p);
    const p = d.park = spots.find(q => !q.why) || spots[0];
    const leafMat = MAT.oakFurn;
    put(B(lw, H - 0.02, 0.035, leafMat), leafMat, p.sc, p.q, bot + (H - 0.02) / 2, true);
    put(B(0.02, 0.3, 0.03), MAT.blackSteel, p.sc - p.dir * (lw / 2 - 0.07), p.q + p.side * 0.03, bot + 1.0, true);   /* pull, opening end */
    put(B(2 * lw, 0.05, 0.05), MAT.blackSteel, p.dir < 0 ? s + 0.08 : e - 0.08, p.q, top + 0.03, true);       /* track over leaf + opening */
  }
}

/* -------------------------------------------------------------- slabs */
function shapeFrom(poly, holes) {
  const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], -p[1])));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], -p[1])).reverse()));
  return sh;
}
/* slab whose TOP is at yTop, `thick` deep; top material + edge material */
function slab(poly, holes, yTop, thick, topMat, edgeMat) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(poly, holes), { depth: thick, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);                      /* shape z (extrude) -> +y */
  geo.translate(0, yTop - thick, 0);
  scaleUV(geo, 1 / tileOf(topMat));
  const m = new THREE.Mesh(geo, [topMat, edgeMat || MAT.slabEdge]);
  m.receiveShadow = true; m.castShadow = true;
  return m;
}
/* flat plane facing up (dir=1) or down (dir=-1) */
function flat(poly, holes, y, mat, dir) {
  const geo = new THREE.ShapeGeometry(shapeFrom(poly, holes));
  geo.rotateX(-Math.PI / 2);                      /* (x, 0, plan y), facing up */
  if (dir < 0) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const nr = geo.attributes.normal;
    for (let i = 0; i < nr.count; i++) nr.setY(i, -nr.getY(i));
  }
  geo.translate(0, y, 0);
  scaleUV(geo, 1 / tileOf(mat));
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}
const rectPoly = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const bbox = (pts) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
  return [x0, z0, x1, z1];
};

/* Axis-aligned region -> non-overlapping rects. Everything in this plan is
   orthogonal, so floors are built from rects rather than triangulated shapes
   with holes (earcut mangles holes that touch the outline). */
function gridRects(xsIn, zsIn, pred) {
  const xs = [...new Set(xsIn.map(v => +v.toFixed(4)))].sort((a, b) => a - b);
  const zs = [...new Set(zsIn.map(v => +v.toFixed(4)))].sort((a, b) => a - b);
  const out = [];
  let open = new Map();
  for (let j = 0; j < zs.length - 1; j++) {
    const cz = (zs[j] + zs[j + 1]) / 2, runs = [];
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (pred(cx, cz)) { if (run) run[1] = xs[i + 1]; else { run = [xs[i], xs[i + 1]]; runs.push(run); } }
      else run = null;
    }
    const next = new Map();
    for (const [x0, x1] of runs) {
      const k = x0 + '|' + x1, r = open.get(k);
      if (r) { r[3] = zs[j + 1]; next.set(k, r); }
      else { const nr = [x0, zs[j], x1, zs[j + 1]]; out.push(nr); next.set(k, nr); }
    }
    open = next;
  }
  return out;
}
function rectsOf(poly, holes) {
  const P = bbox(poly), hb = holes.map(bbox);
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  for (const h of hb) {
    for (const x of [h[0], h[2]]) if (x > P[0] && x < P[2]) xs.push(x);
    for (const z of [h[1], h[3]]) if (z > P[1] && z < P[3]) zs.push(z);
  }
  return gridRects(xs, zs, (x, z) => inside(poly, x, z) && !hb.some(h => x > h[0] && x < h[2] && z > h[1] && z < h[3]));
}
function unionRects(polys, classify) {
  const xs = [], zs = [];
  for (const p of polys) for (const q of p) { xs.push(q[0]); zs.push(q[1]); }
  return gridRects(xs, zs, (x, z) => polys.some(p => inside(p, x, z)) && (!classify || classify(x, z)));
}
/* quad soup with world-space UVs (metres / tile), one mesh per material */
function Quads(mat) { return { mat, p: [], n: [], uv: [], i: [] }; }
function quad(Q, a, b, c, d, nrm, uvOf) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] < 0) { const t = b; b = d; d = t; }
  const base = Q.p.length / 3, t = tileOf(Q.mat);
  for (const v of [a, b, c, d]) { Q.p.push(...v); Q.n.push(...nrm); const uv = uvOf(v); Q.uv.push(uv[0] / t, uv[1] / t); }
  Q.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function qMesh(Q) {
  if (!Q.p.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Q.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Q.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(Q.uv, 2));
  g.setIndex(Q.i);
  const m = new THREE.Mesh(g, Q.mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}
/* slab from rects: top face at yTop, bottom face (optional) at yTop-th, edges */
function slabRects(parent, rects, yTop, th, topMat, botMat, edgeMat, botPick) {
  const T = Quads(topMat), E = Quads(edgeMat), Bm = new Map();
  const yb = yTop - th, up = [0, 1, 0], dn = [0, -1, 0];
  const plan = (v) => [v[0], -v[2]];
  for (const r of rects) {
    const [x0, z0, x1, z1] = r;
    quad(T, [x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], up, plan);
    const bm = botPick ? botPick(r) : botMat;
    if (bm) {
      if (!Bm.has(bm)) Bm.set(bm, Quads(bm));
      quad(Bm.get(bm), [x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1], dn, plan);
    }
    const side = (ax, az, bx, bz, n) => quad(E, [ax, yb, az], [bx, yb, bz], [bx, yTop, bz], [ax, yTop, az], n,
      (v) => [Math.abs(n[0]) > 0 ? v[2] : v[0], v[1]]);
    side(x0, z0, x1, z0, [0, 0, -1]); side(x1, z1, x0, z1, [0, 0, 1]);
    side(x0, z1, x0, z0, [-1, 0, 0]); side(x1, z0, x1, z1, [1, 0, 0]);
  }
  for (const Q of [T, E, ...Bm.values()]) { const m = qMesh(Q); if (m) parent.add(m); }
}

/* ------------------------------------------------------------------ stairs */
function stairRise(s) {
  const L = LV[s.level], N = LV[s.level + 1];
  return N ? N.base - L.base : L.h + L.ct;
}
function buildStraightStair(G, s) {
  const g = new THREE.Group();
  const H = stairRise(s), run = s.d, wid = s.w;
  const n = Math.round(H / 0.18), rise = H / n, go = run / n;
  const outside = s.level === 0 && !LV[0].rooms.some(r => inside(r.poly, s.x, s.y));
  const treadMat = outside ? MAT.deck : MAT.oakFurn;
  /* climbs towards local -z (FPC: up the drawing) */
  for (let i = 1; i <= n; i++) {
    const zc = run / 2 - go * (i - 0.5);
    mk(g, B(wid - 0.02, 0.045, go + 0.03, treadMat), treadMat, 0, rise * i - 0.0225, zc);
    if (outside) mk(g, RS(wid - 0.06, 0.05, go * 0.8, 0.02, MAT.snow), MAT.snow, 0, rise * i + 0.012, zc + 0.01).castShadow = false;
  }
  /* steel stringers */
  const slope = Math.atan2(H, run), sl = Math.hypot(H, run);
  for (const sx of [-1, 1]) {
    const st = mk(g, B(0.012, 0.26, sl + 0.25), MAT.blackSteel, sx * (wid / 2 - 0.006), H / 2 - 0.12, 0);
    st.rotation.x = slope;
    /* handrail + posts */
    const hr = mk(g, CY(0.022, sl + 0.2, 12), outside ? MAT.blackSteel : MAT.oakFurn, sx * (wid / 2 - 0.03), H / 2 + 0.92, 0);
    hr.rotation.x = Math.PI / 2 + slope;
    for (let i = 1; i <= n; i += 3) {
      const zc = run / 2 - go * (i - 0.5), y = rise * i;
      mk(g, CY(0.011, 0.92, 8), MAT.blackSteel, sx * (wid / 2 - 0.03), y + 0.46, zc);
    }
  }
  g.position.set(s.x, LV[s.level].base, s.y);
  g.rotation.y = -s.a;
  G.furn.add(g);
}
function buildSpiralStair(G, s) {
  const g = new THREE.Group();
  const H = stairRise(s), n = s.treads || 16, sweep = s.rot || Math.PI * 2;
  const d = sweep / n, rise = H / n, r = s.w / 2 - 0.02;
  /* top tread faces the landing (north, three theta = PI); climbs clockwise
     seen from above, which puts the first step on the open WNW side */
  const thTop = Math.PI;
  mk(g, CY(0.075, H + 1.0, 20), MAT.blackSteel, 0, (H + 1.0) / 2, 0);
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const thc = thTop + (n - i) * d;
    /* built centred on +z so the grain can run out along the radius, then turned into place */
    const geo = grainUV(new THREE.CylinderGeometry(r, r, 0.045, 10, 1, false, -d / 2, d * 1.04), tileOf(MAT.oakFurn), 'z');
    geo.rotateY(thc);
    mk(g, geo, MAT.oakFurn, 0, rise * i - 0.0225, 0);
    /* baluster at the outer end */
    const bx = Math.sin(thc) * (r - 0.04), bz = Math.cos(thc) * (r - 0.04);
    mk(g, CY(0.009, 0.95, 8), MAT.blackSteel, bx, rise * i + 0.475, bz);
    pts.push(new V(bx, rise * i + 0.95, bz));
  }
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 6, 0.022, 8, false), MAT.blackSteel);
  rail.castShadow = true; g.add(rail);
  g.position.set(s.x, LV[s.level].base, s.y);
  G.furn.add(g);
}

/* --------------------------------------------------------- glTF furniture */
const GLTF = {};
const gltfLoader = new GLTFLoader(LM);
const MODELS = {
  armchair: 'modern_arm_chair_01/modern_arm_chair_01_1k.gltf',
  dining: 'dining_chair_02/dining_chair_02_1k.gltf',
  pendant: 'modern_ceiling_lamp_01/modern_ceiling_lamp_01_1k.gltf',
  plant: 'potted_plant_02/potted_plant_02_1k.gltf',
  side: 'side_table_01/side_table_01_1k.gltf',
  coffee: 'modern_coffee_table_01/modern_coffee_table_01_1k.gltf',
};
function loadModels() {
  return Promise.all(Object.entries(MODELS).map(([k, f]) => new Promise((res) => {
    gltfLoader.load('assets/models/' + f, (gl) => {
      const o = gl.scene;
      o.traverse(m => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mm = m.material; if (mm) { mm.envMapIntensity = 0.6; if (mm.map) mm.map.anisotropy = 4; }
      });
      const bb = new THREE.Box3().setFromObject(o);
      GLTF[k] = { obj: o, size: bb.getSize(new V()), min: bb.min.clone(), center: bb.getCenter(new V()) };
      res();
    }, undefined, () => res());
  })));
}
/* place a model: footprint centred on (x,z), front facing local +z rotated by ry */
function placeModel(parent, key, x, y, z, ry, scale, faceFix) {
  const M = GLTF[key]; if (!M) return null;
  const o = M.obj.clone(true);
  const wrap = new THREE.Group();
  o.position.set(-M.center.x, -M.min.y, -M.center.z);
  const inner = new THREE.Group(); inner.add(o);
  inner.rotation.y = faceFix || 0;
  inner.scale.setScalar(scale || 1);
  wrap.add(inner);
  wrap.position.set(x, y, z); wrap.rotation.y = ry || 0;
  parent.add(wrap);
  return wrap;
}

/* --------------------------------------------------------- procedural props */
/* FPC furniture: x/y centre, w along local x, d along local y, angle a. In
   three: group at (x, base, y), rotation.y = -a; local +z = FPC local +y. */
function makeProp(s, lvl) {
  const g = new THREE.Group();
  const n = s.name, w = s.w, d = s.d, top = s.top, bot = s.bottom;
  const h = Math.max(0.02, top - bot);
  const has = (k) => n.indexOf(k) >= 0;
  let placed = true;

  if (has('bed')) {
    /* FPC bed: headboard at local -y (top of the symbol). On 3F the symbol's
       head edge IS the wall face, so everything stays inside the footprint:
       headboard 1.6 cm off the wall (clear of the 1.2 cm skirting), 1 cm clear
       of the bedside tables, top at 0.92 m (bed 3's window sill board starts at
       0.97); the frame's head end tucks inside the headboard. (v2's headboard
       sat in the wall, its face coplanar with the plaster: vertical stripes.) */
    mk(g, B(w - 0.12, 0.14, d - 0.12), MAT.black, 0, 0.07, 0);
    mk(g, RS(w, 0.16, d - 0.04, 0.02, MAT.oakFurn), MAT.oakFurn, 0, 0.22, 0.02);
    mk(g, RS(w - 0.06, 0.22, d - 0.08, 0.05, MAT.linenWhite, 0.06), MAT.linenWhite, 0, 0.41, 0.01);
    mk(g, RS(w + 0.02, 0.09, d * 0.66, 0.06, MAT.linen, 0.04), MAT.linen, 0, 0.555, d * 0.16);
    mk(g, RS(w + 0.03, 0.05, 0.36, 0.04, MAT.linenDark, 0.022), MAT.linenDark, 0, 0.61, d * 0.34);
    for (const sx of [-1, 1]) mk(g, RS(w * 0.42, 0.13, 0.36, 0.07, MAT.linenWhite, 0.055), MAT.linenWhite, sx * w * 0.24, 0.58, -d / 2 + 0.3);
    mk(g, B(w + 0.28, 0.92, 0.06, MAT.oakFurn), MAT.oakFurn, 0, 0.46, -d / 2 + 0.046);
    for (const sx of [-1, 1]) {                                     /* bedside tables + lamps */
      mk(g, B(0.42, 0.45, 0.38, MAT.oakFurn), MAT.oakFurn, sx * (w / 2 + 0.36), 0.225, -d / 2 + 0.22);
      mk(g, CY(0.06, 0.03, 16), MAT.blackSteel, sx * (w / 2 + 0.36), 0.465, -d / 2 + 0.2);
      mk(g, CY(0.012, 0.3, 8), MAT.blackSteel, sx * (w / 2 + 0.36), 0.61, -d / 2 + 0.2);
      mk(g, new THREE.CylinderGeometry(0.08, 0.12, 0.16, 20, 1, true), MAT.linenWhite, sx * (w / 2 + 0.36), 0.8, -d / 2 + 0.2);
    }
  } else if (has('toilet')) {
    /* FPC toilet: cistern at local +y (checked against all four in the plan) */
    mk(g, RB(w * 0.62, 0.38, d * 0.6, 0.06, MAT.porcelain), MAT.porcelain, 0, 0.19, -d * 0.08);
    mk(g, new THREE.CylinderGeometry(w * 0.36, w * 0.3, 0.06, 24), MAT.porcelain, 0, 0.41, -d * 0.1);
    mk(g, RB(w * 0.9, 0.42, d * 0.24, 0.03, MAT.porcelain), MAT.porcelain, 0, 0.3, d * 0.36);
  } else if (has('showerRect')) {
    mk(g, B(w, 0.03, d, MAT.bathTile), MAT.bathTile, 0, 0.015, 0);
    /* clear screen in a thin black frame on the tray's +z edge, 2 m tall */
    const gl = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 1.98, 0.008), MAT.glassIn); gl.position.set(0, 1.03, d / 2); gl.renderOrder = 2; g.add(gl);
    for (const y of [0.04, 2.02]) mk(g, B(w, 0.02, 0.022), MAT.blackSteel, 0, y, d / 2);
    for (const sx of [-1, 1]) mk(g, B(0.02, 1.96, 0.022), MAT.blackSteel, sx * (w / 2 - 0.01), 1.03, d / 2);
    mk(g, CY(0.012, 0.9, 10), MAT.steel, -w * 0.3, 1.6, -d * 0.44);
    mk(g, CY(0.1, 0.012, 24), MAT.steel, -w * 0.3, 2.06, -d * 0.3);
  } else if (has('showerSystem')) {
    mk(g, B(0.05, h, 0.04), MAT.steel, 0, bot + h / 2, 0);
    mk(g, CY(0.11, 0.012, 24), MAT.steel, 0, bot + h - 0.02, 0.14);
  } else if (has('tube')) {
    /* built-in hinoki soaking tub (hot bath + cold plunge) */
    const Ht = 0.6, t = 0.06;
    mk(g, B(w, Ht, t, MAT.hinoki), MAT.hinoki, 0, Ht / 2, -d / 2 + t / 2);
    mk(g, B(w, Ht, t, MAT.hinoki), MAT.hinoki, 0, Ht / 2, d / 2 - t / 2);
    mk(g, B(t, Ht, d - 2 * t, MAT.hinoki), MAT.hinoki, -w / 2 + t / 2, Ht / 2, 0);
    mk(g, B(t, Ht, d - 2 * t, MAT.hinoki), MAT.hinoki, w / 2 - t / 2, Ht / 2, 0);
    mk(g, B(w - 2 * t, 0.04, d - 2 * t, MAT.hinoki), MAT.hinoki, 0, 0.02, 0);
    const wt = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * t, d - 2 * t), MAT.water);
    wt.rotation.x = -Math.PI / 2; wt.position.y = Ht - 0.09; g.add(wt);
  } else if (has('jacuzzi')) {
    mk(g, new THREE.CylinderGeometry(w / 2, w / 2 * 0.96, 0.9, 40), MAT.cedar, 0, 0.45, 0);
    const wt = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - 0.06, 40), MAT.water); wt.rotation.x = -Math.PI / 2; wt.position.y = 0.8; g.add(wt);
    const ring = mk(g, new THREE.TorusGeometry(w / 2 - 0.02, 0.03, 8, 40), MAT.cedar, 0, 0.9, 0); ring.rotation.x = Math.PI / 2;
  } else if (has('sinkDouble') || has('handBasin') || has('Basin') || has('basin')) {
    const vt = Math.max(top, 0.8);
    mk(g, B(w, 0.04, d, MAT.stoneTop), MAT.stoneTop, 0, vt - 0.02, 0);
    mk(g, B(w - 0.02, 0.36, d - 0.03, MAT.oakFurn), MAT.oakFurn, 0, vt - 0.22, 0);
    const nb = has('Double') ? 2 : 1;
    for (let i = 0; i < nb; i++) {
      const bx = nb === 1 ? 0 : (i - 0.5) * w * 0.48;
      mk(g, RB(Math.min(0.46, w * 0.8 / nb), 0.12, d * 0.62, 0.05, MAT.porcelain), MAT.porcelain, bx, vt + 0.06, 0.02);
      mk(g, CY(0.012, 0.22, 10), MAT.steel, bx, vt + 0.11, -d * 0.36);
    }
  } else if (has('cornerCabinet') || has('kitchen.cabinet')) {
    mk(g, B(w, 0.1, d - 0.06), MAT.black, 0, 0.05, -0.03);
    mk(g, B(w, top - 0.14, d, MAT.oakFurn, 'y'), MAT.oakFurn, 0, 0.1 + (top - 0.14) / 2, 0);   /* cupboard fronts: vertical grain */
    mk(g, B(w + 0.01, 0.04, d + 0.03, MAT.stoneTop), MAT.stoneTop, 0, top - 0.02, 0.015);
    mk(g, B(w - 0.004, 0.004, 0.004), MAT.black, 0, top * 0.62, d / 2 + 0.002);
  } else if (has('hood')) {
    mk(g, B(w, 0.06, d, MAT.steel), MAT.steel, 0, bot + 0.03, 0);
    mk(g, B(w * 0.4, h - 0.06, d * 0.5), MAT.steel, 0, bot + 0.06 + (h - 0.06) / 2, 0);
  } else if (has('racks') || has('bookcase')) {
    mk(g, B(w, top, d, MAT.oakFurn, 'y'), MAT.oakFurn, 0, top / 2, 0);
    if (has('racks')) {                                 /* built-in cupboard fronts */
      const nd = Math.max(1, Math.round(w / 0.6));
      for (let i = 1; i < nd; i++) mk(g, B(0.004, top - 0.04, 0.004), MAT.black, -w / 2 + w * i / nd, top / 2, d / 2 + 0.002);
    } else {
      const ns = Math.max(2, Math.round(top / 0.38));
      for (let i = 1; i < ns; i++) mk(g, B(w - 0.04, 0.02, 0.01), MAT.black, 0, top * i / ns, d / 2 + 0.004);
    }
  } else if (has('fridge')) {
    mk(g, RB(w, top, d, 0.015, MAT.steel), MAT.steel, 0, top / 2, 0);
    mk(g, B(w * 0.98, 0.006, 0.006), MAT.black, 0, top * 0.62, d / 2 + 0.002);
    mk(g, B(0.02, 0.5, 0.03), MAT.black, w * 0.4, top * 0.8, d / 2 + 0.02);
  } else if (has('owen') || has('oven')) {
    /* sauna heater with stones */
    mk(g, B(w * 0.85, 0.65, d * 0.85), MAT.heater, 0, 0.325, 0);
    for (let i = 0; i < 26; i++) {
      const st = mk(g, new THREE.IcosahedronGeometry(0.045 + Math.random() * 0.03, 1), MAT.stones,
        (Math.random() - 0.5) * w * 0.7, 0.69 + Math.random() * 0.1, (Math.random() - 0.5) * d * 0.7);
      st.scale.y = 0.7;
    }
  } else if (has('stowe') || has('stove') || has('hob')) {
    if (lvl === 0) { placed = false; }                 /* 1F one = the sauna heater's twin symbol */
    else {
      mk(g, B(w, 0.012, d), MAT.black, 0, 0.905, 0);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        mk(g, CY(w * 0.15, 0.004, 24), MAT.screen, sx * w * 0.22, 0.913, sz * d * 0.22);
    }
  } else if (has('laundry') || has('dryer')) {
    mk(g, RB(w - 0.02, top, d - 0.02, 0.02, MAT.white), MAT.white, 0, top / 2, 0);
    const port = mk(g, CY(w * 0.28, 0.02, 32), MAT.glass, 0, top * 0.46, d / 2 - 0.005); port.rotation.x = Math.PI / 2;
    const rim = mk(g, new THREE.TorusGeometry(w * 0.29, 0.015, 8, 32), MAT.steel, 0, top * 0.46, d / 2); rim.castShadow = false;
  } else if (has('water_heater')) {
    mk(g, CY(w * 0.36, 1.7, 28), MAT.white, 0, 0.85, 0);
    mk(g, CY(0.02, 0.4, 10), MAT.steel, w * 0.15, 1.9, 0);
  } else if (has('desk')) {
    mk(g, B(w, 0.035, d, MAT.oakFurn), MAT.oakFurn, 0, top - 0.018, 0);
    for (const sx of [-1, 1]) mk(g, B(0.03, top - 0.035, d - 0.06), MAT.blackSteel, sx * (w / 2 - 0.05), (top - 0.035) / 2, 0);
  } else if (has('table')) {
    mk(g, RS(w, 0.04, d + 0.3, 0.02, MAT.oakFurn), MAT.oakFurn, 0, top - 0.02, 0);
    for (const sx of [-1, 1]) {
      mk(g, B(0.05, top - 0.04, 0.05), MAT.blackSteel, sx * (w / 2 - 0.2), (top - 0.04) / 2, -(d + 0.3) / 2 + 0.12);
      mk(g, B(0.05, top - 0.04, 0.05), MAT.blackSteel, sx * (w / 2 - 0.2), (top - 0.04) / 2, (d + 0.3) / 2 - 0.12);
    }
  } else if (has('armchair')) {
    /* must be tested before 'chair' ('living.armchair' contains it). Both
       Poly Haven chairs face their own +z (rendered alone: seat to +z, back
       at -z). FPC armchair front = local +y = three +z (the living one faces
       the TV, the terrace pair the jacuzzi, the 1F one faces west): no flip */
    placeModel(g, 'armchair', 0, 0, 0, 0, 1, 0);
  } else if (has('chair')) {
    /* FPC dining chair front = local -y (the row at y+55 faces up the drawing
       into the table) = three -z: turn the +z-facing model round */
    if (!placeModel(g, 'dining', 0, 0, 0, 0, 1, Math.PI)) {
      mk(g, RS(w, 0.04, d, 0.02, MAT.oakFurn), MAT.oakFurn, 0, 0.45, 0);
    }
  } else if (has('sofa')) {
    /* 250 x 250 "sofa" symbol = corner (L) sofa. The plan parks an armchair in
       the -x/+y corner, so the L runs along -y and +x (backs on those sides). */
    const SD = 0.95, SH = 0.42, BH = 0.8;
    const seat = (x0, z0, x1, z1) => mk(g, RS(x1 - x0, SH - 0.1, z1 - z0, 0.05, MAT.sofa, 0.07), MAT.sofa, (x0 + x1) / 2, 0.1 + (SH - 0.1) / 2, (z0 + z1) / 2);
    const base = (x0, z0, x1, z1) => mk(g, B(x1 - x0, 0.1, z1 - z0), MAT.black, (x0 + x1) / 2, 0.05, (z0 + z1) / 2);
    const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
    base(X0 + 0.05, Z0 + 0.05, X1 - 0.05, Z0 + SD); base(X1 - SD, Z0 + SD, X1 - 0.05, Z1 - 0.05);
    seat(X0, Z0, X1, Z0 + SD); seat(X1 - SD, Z0 + SD, X1, Z1);
    mk(g, RS(w, BH - SH, 0.22, 0.07, MAT.sofa, 0.07), MAT.sofa, 0, SH + (BH - SH) / 2, Z0 + 0.11);
    mk(g, RS(0.22, BH - SH, d - 0.22, 0.07, MAT.sofa, 0.07), MAT.sofa, X1 - 0.11, SH + (BH - SH) / 2, 0.11);
    mk(g, RS(0.22, 0.2, SD - 0.22, 0.07, MAT.sofa, 0.07), MAT.sofa, X0 + 0.11, SH + 0.1, Z0 + 0.22 + (SD - 0.22) / 2);
    for (let i = 0; i < 3; i++) mk(g, RB(0.5, 0.44, 0.15, 0.07, i === 1 ? MAT.linenDark : MAT.linenWhite, 0.06), i === 1 ? MAT.linenDark : MAT.linenWhite, X0 + 0.65 + i * 0.6, SH + 0.2, Z0 + 0.32);
    for (let i = 0; i < 2; i++) mk(g, RB(0.15, 0.44, 0.5, 0.07, MAT.linenWhite, 0.06), MAT.linenWhite, X1 - 0.32, SH + 0.2, Z0 + 1.4 + i * 0.6);
    if (s.mx) for (const c of g.children) c.position.x = -c.position.x;   /* mirrored symbol (house 2): the L runs along -x */
  } else if (has('rug')) {
    mk(g, B(w, 0.012, d, MAT.rug), MAT.rug, 0, 0.006, 0).castShadow = false;
  } else if (has('tv')) {
    mk(g, B(w * 1.3, 0.42, 0.42, MAT.oakFurn), MAT.oakFurn, 0, 0.21, 0);        /* low media unit */
    mk(g, B(w * 1.1, 0.64, 0.03), MAT.screen, 0, 0.42 + 0.06 + 0.32, 0);
  } else if (has('mirror')) {
    mk(g, B(w, h, 0.012), std({ color: 0xe8eef2, roughness: 0.02, metalness: 1, envMapIntensity: 1.2 }), 0, bot + h / 2, 0);
  } else if (has('railing')) {
    const Lr = Math.max(w, d), along = w >= d, top2 = Math.max(top, 1.05);
    const gl = new THREE.Mesh(along ? new THREE.BoxGeometry(Lr, top2 - 0.06, 0.012) : new THREE.BoxGeometry(0.012, top2 - 0.06, Lr), MAT.glassIn);
    gl.position.y = (top2 - 0.06) / 2 + 0.03; gl.renderOrder = 2; g.add(gl);
    mk(g, along ? B(Lr, 0.04, 0.06, MAT.oakFurn) : B(0.06, 0.04, Lr, MAT.oakFurn), MAT.oakFurn, 0, top2, 0);
    mk(g, along ? B(Lr, 0.03, 0.04) : B(0.04, 0.03, Lr), MAT.blackSteel, 0, 0.015, 0);
  } else if (has('shade') && lvl === 0 && HOUSE === 1 && touchesHouse(s)) {
    buildCarport(s); placed = false;                   /* house 1's carport (see buildCarport) */
  } else if (has('shade') && HOUSE === 2 && lvl === 0) {
    /* house 2: the same pergola, trimmed so it stands clear of the walls */
    const c = clearOfHouse(s);
    if (c) { pergola(g, c.w, c.d, top); s = Object.assign({}, s, { x: c.x, y: c.y }); } else placed = false;
  } else if (has('shade')) {
    pergola(g, w, d, top);
  } else if (has('treeBig')) {
    buildBareTree(g, top, w);
  } else if (has('box')) {
    /* 1F boxes are the sauna benches */
    mk(g, B(w, top, d, MAT.hinoki), MAT.hinoki, 0, top / 2, 0);
  } else if (has('suv') || has('motorbike') || has('tricycle') || has('grass')) {
    placed = false;                                    /* toys read as Minecraft; leave them out */
  } else {
    mk(g, B(w, h, d), std({ color: 0xd8d4cc, roughness: 0.8 }), 0, bot + h / 2, 0);
  }
  if (!placed) return null;
  g.position.set(s.x, 0, s.y);
  g.rotation.y = -s.a;
  return g;
}

/* free-standing garden pergola: black steel posts, cedar roof, snow load */
function pergola(g, w, d, top) {
  const t = Math.min(Math.max(top, 2.2), 2.6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    mk(g, B(0.12, t, 0.12), MAT.blackSteel, sx * (w / 2 - 0.15), t / 2, sz * (d / 2 - 0.15));
  mk(g, B(w, 0.18, d, MAT.cedar), MAT.cedar, 0, t + 0.09, 0);
  mk(g, B(w + 0.02, 0.05, d + 0.02), MAT.blackSteel, 0, t + 0.2, 0);
  mk(g, RS(w - 0.05, 0.18, d - 0.05, 0.08, MAT.roofSnow), MAT.roofSnow, 0, t + 0.31, 0);
}
/* house 2: an axis-aligned site symbol drawn into the house corner is
   trimmed from ONE side until it is clear of the walls (the side that keeps
   the most of it); null if that leaves less than half */
function clearOfHouse(s) {
  const [X0, Z0, X1, Z1] = bbox(rectCorners(s));
  const clear = (r) => { for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) if (houseAt(r[0] + (r[2] - r[0]) * i / 12, r[1] + (r[3] - r[1]) * j / 12)) return false; return true; };
  if (clear([X0, Z0, X1, Z1])) return { x: s.x, y: s.y, w: s.w, d: s.d };
  let best = null;
  for (let k = 0; k < 4; k++) {
    const r = [X0, Z0, X1, Z1];
    for (let it = 0; it < 400 && !clear(r); it++) r[k] += (k < 2 ? 1 : -1) * 0.02;
    const area = (r[2] - r[0]) * (r[3] - r[1]);
    if (clear(r) && r[2] > r[0] && r[3] > r[1] && (!best || area > best.area)) best = { r, area };
  }
  if (!best || best.area < 0.5 * (X1 - X0) * (Z1 - Z0)) return null;
  const r = best.r, gap = 0.1;                               /* and 10 cm off the cladding */
  for (let k = 0; k < 4; k++) if (r[k] !== [X0, Z0, X1, Z1][k]) r[k] += (k < 2 ? 1 : -1) * gap;
  return { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1] };
}

/* Carport. The plan's "shade" over the two cars is drawn hard against the
   south facade with a 3 m top, i.e. its roof would cut through the 2F living
   room glass at knee height (and its snow read as ground right outside the
   window). Built as a real carport instead: it stops at the facade, 2.35 m
   clear, glass roof on a black steel frame so the living room sees down. */
function touchesHouse(s) {
  const c = rectCorners(s), [x0, z0, x1, z1] = bbox(c);
  const pts = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push([x0 + (x1 - x0) * i / 10, z0 + (z1 - z0) * j / 10]);
  return pts.some(([x, z]) => houseAt(x, z));
}
let _house = null;
function houseAt(x, z) { _house = _house || LV[0].rooms.map(r => offsetPoly(r.poly, 0.38)); return _house.some(p => inside(p, x, z)); }
function buildCarport(s) {
  let [x0, z0, x1, z1] = bbox(rectCorners(s));
  const on = { z0: false, z1: false, x0: false, x1: false };
  const edgeHits = (a, b, fixed, alongX) => {
    for (let k = 0; k <= 12; k++) { const t = a + (b - a) * k / 12; if (alongX ? houseAt(t, fixed) : houseAt(fixed, t)) return true; }
    return false;
  };
  for (let it = 0; it < 150 && edgeHits(x0 + 0.1, x1 - 0.1, z0, true); it++) { z0 += 0.01; on.z0 = true; }
  for (let it = 0; it < 150 && edgeHits(x0 + 0.1, x1 - 0.1, z1, true); it++) { z1 -= 0.01; on.z1 = true; }
  for (let it = 0; it < 150 && edgeHits(z0 + 0.1, z1 - 0.1, x0, false); it++) { x0 += 0.01; on.x0 = true; }
  for (let it = 0; it < 150 && edgeHits(z0 + 0.1, z1 - 0.1, x1, false); it++) { x1 -= 0.01; on.x1 = true; }
  const g = G.ext, H = 2.35, bd = 0.18, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const top = H + bd;
  /* posts only along free edges; the house side hangs off a ledger on the wall */
  const posts = [];
  if (!on.z1) posts.push([x0 + 0.12, z1 - 0.12], [cx, z1 - 0.12], [x1 - 0.12, z1 - 0.12]);
  if (!on.z0) posts.push([x0 + 0.12, z0 + 0.12], [cx, z0 + 0.12], [x1 - 0.12, z0 + 0.12]);
  if (on.z0 && on.z1) posts.push([x0 + 0.12, cz], [x1 - 0.12, cz]);
  const seen = new Set();
  for (const [px, pz] of posts) {
    const k = px.toFixed(2) + ',' + pz.toFixed(2); if (seen.has(k)) continue; seen.add(k);
    mk(g, B(0.12, H, 0.12), MAT.blackSteel, px, H / 2, pz);
  }
  /* perimeter beams + rafters */
  mk(g, B(W, bd, 0.1), MAT.blackSteel, cx, H + bd / 2, z0 + 0.05);
  mk(g, B(W, bd, 0.1), MAT.blackSteel, cx, H + bd / 2, z1 - 0.05);
  mk(g, B(0.1, bd, D), MAT.blackSteel, x0 + 0.05, H + bd / 2, cz);
  mk(g, B(0.1, bd, D), MAT.blackSteel, x1 - 0.05, H + bd / 2, cz);
  const nR = Math.max(1, Math.round(W / 1.2));
  for (let i = 1; i < nR; i++) mk(g, B(0.06, bd * 0.7, D - 0.2), MAT.blackSteel, x0 + W * i / nR, H + bd * 0.65, cz);
  if (on.z0) mk(g, B(W, 0.22, 0.06), MAT.blackSteel, cx, H + bd - 0.11, z0 - 0.02);   /* wall ledger */
  if (!MAT.canopy) { MAT.canopy = MAT.glass.clone(); MAT.canopy.envMapIntensity = 0.45; MAT.canopy.opacity = 0.05; MAT.canopy.onBeforeCompile = MAT.glass.onBeforeCompile; }
  const gl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.012, D - 0.02), MAT.canopy);
  gl.position.set(cx, top + 0.006, cz); gl.renderOrder = 2; g.add(gl);
  /* downlight under the canopy by the door */
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), MAT.lampGlow);
  lens.rotation.x = Math.PI / 2; lens.position.set(-9.4, H + 0.001, z0 + 0.8); g.add(lens);
}

/* winter tree: bare branching trunk, a little snow on the big limbs */
function buildBareTree(g, H, spread) {
  const geos = [], snow = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const branch = (p, dir, len, r, depth) => {
    const end = p.clone().addScaledVector(dir, len);
    const geo = new THREE.CylinderGeometry(r * 0.7, r, len, 7, 1);
    geo.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), dir);
    geo.applyQuaternion(q); geo.translate(p.x, p.y, p.z);
    geos.push(geo);
    if (depth < 3 && r > 0.04) {
      const s = new THREE.CylinderGeometry(r * 0.72, r * 0.9, len * 0.8, 7, 1, false, -Math.PI / 2, Math.PI);
      s.translate(0, len / 2, 0); s.applyQuaternion(q); s.translate(p.x, p.y + r * 0.35, p.z);
      if (dir.y < 0.85) snow.push(s);
    }
    if (depth >= 5 || r < 0.012) return;
    const k = depth === 0 ? 4 : 3;
    for (let i = 0; i < k; i++) {
      const a = rnd() * Math.PI * 2, tilt = 0.35 + rnd() * 0.55;
      const nd = new V(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).lerp(dir, 0.35).normalize();
      branch(end, nd, len * (0.62 + rnd() * 0.18), r * 0.62, depth + 1);
    }
  };
  branch(new V(0, 0, 0), new V(0, 1, 0), H * 0.38, Math.max(0.16, spread * 0.05), 0);
  const tm = new THREE.Mesh(mergeGeometries(geos, false), MAT.bark); tm.castShadow = true; tm.receiveShadow = true; g.add(tm);
  if (snow.length) { const sm = new THREE.Mesh(mergeGeometries(snow, false), MAT.roofSnow); sm.castShadow = false; g.add(sm); }
}

/* ------------------------------------------------------- finishes & labels */
/* floor finish overlays [level, x0, z0, x1, z1, material] */
const ZONES1 = [
  [0, -10.486, -11.083, -6.73, -7.97, 'granite'],     /* bath: soaking tubs + showers (dark stone, wet) */
  [0, -10.486, -7.85, -9.20, -4.99, 'hinoki'],         /* sauna */
  [0, -9.08, -7.85, -6.73, -4.99, 'oak'],              /* rest / changing */
  [0, -4.08, -6.53, -1.12, -2.95, 'bathTile'],         /* wash room */
  [0, -3.225, -2.83, 2.685, 1.06, 'entranceStone'],    /* entrance */
  [1, -1.39, -9.22, -0.53, -7.44, 'bathTile'],         /* powder room */
  [2, -3.24, -11.05, -1.46, -8.35, 'bathTile'],        /* bathroom 1 */
  [2, 0.38, -8.23, 2.685, -6.41, 'bathTile'],          /* bathroom 2 */
];
const LABELS1 = [
  [0, -0.27, -0.91, 'Entrance'],
  [0, -8.60, -9.30, 'Bath · soaking tubs'],
  [0, -9.85, -6.40, 'Sauna'],
  [0, -3.80, -9.00, 'Gym (double height)'],
  [0, -7.90, -6.30, 'Rest / changing'],
  [0, -7.30, -3.90, 'Plant room · laundry'],
  [0, -2.60, -4.70, 'Wash room'],
  [0, 0.80, -4.70, 'Garage / ski room'],
  [1, -8.00, -5.30, 'Living'],
  [1, -2.60, -4.20, 'Dining'],
  [1, 1.10, -8.30, 'Kitchen'],
  [1, -0.95, -8.40, 'Powder'],
  [1, -1.00, -1.40, 'Void over entrance'],
  [2, -8.67, -9.70, 'Bedroom 1'],
  [2, -5.10, -9.70, 'Bedroom 2'],
  [2, 1.00, -9.70, 'Bedroom 3'],
  [2, 0.60, -0.60, 'Bedroom 4'],
  [2, -2.36, -9.90, 'Bathroom'],
  [2, 1.50, -7.30, 'Bathroom 2'],
  [2, -5.65, -5.00, 'Void over living'],
];
function labelSprite(text) {
  const pad = 16, f = 30;
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `600 ${f}px -apple-system,Segoe UI,Roboto,sans-serif`;
  const w = Math.ceil(x.measureText(text).width) + pad * 2;
  c.width = w; c.height = f + pad * 2;
  const g = c.getContext('2d');
  g.font = `600 ${f}px -apple-system,Segoe UI,Roboto,sans-serif`;
  g.fillStyle = 'rgba(12,17,22,.72)';
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, 14); g.fill();
  g.fillStyle = '#eaf2f8'; g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: true, depthWrite: false, opacity: .95, fog: false }));
  sp.scale.set(c.width / c.height * 0.26, 0.26, 1);
  sp.renderOrder = 999;
  return sp;
}

/* ceiling lights [level, x, z] */
/* [x, z, lit] — every one gets a fitting; only `lit` ones get a real light
   (each extra light costs every pixel, so they're rationed) */
const DOWN1 = {
  0: [[-8.6, -9.6, 1], [-3.6, -9.2, 0], [0.9, -8.8, 0], [-7.3, -3.9, 1], [-2.6, -4.7, 0], [1.0, -4.4, 0], [-0.3, -0.9, 1], [-7.9, -6.4, 0]],
  1: [[-8.2, -4.6, 0], [-5.4, -4.2, 0], [0.9, -8.0, 1], [1.0, -4.4, 0], [-0.9, -8.3, 1]],
  2: [[-8.7, -9.7, 1], [-5.1, -9.7, 1], [1.0, -9.7, 1], [-2.4, -9.9, 0], [1.5, -7.3, 0], [0.6, -0.6, 0], [-4.6, -7.8, 1]],
};

/* house 2 (plan2.json: re-centred on the house, x east, z south). FPC has
   no room names: they are read off the fixtures (1F reuses house 1's set:
   tubs, sauna benches + heater, plant room, wash room) and Toby's note (1F =
   gym + bath). */
const ZONES2 = [
  [0, -7.76, -5.52, -1.25, -3.16, 'granite'],          /* bath: soaking tubs + showers */
  [0, -7.76, -6.92, -4.23, -5.52, 'granite'],
  [0, -4.11, -6.92, -1.25, -5.64, 'hinoki'],           /* sauna */
  [0, -3.82, -3.04, -2.91, -1.98, 'bathTile'],         /* WC */
  [0, -2.79, -0.51, 0.84, 3.69, 'bathTile'],           /* wash room */
  [0, -2.79, 3.81, 0.84, 6.92, 'entranceStone'],       /* entrance (south door) */
  [1, -7.74, 0.33, -4.26, 1.88, 'bathTile'],           /* bathrooms */
  [1, -7.74, -1.31, -4.26, 0.21, 'bathTile'],
  [1, -2.80, -3.09, 0.91, -1.78, 'bathTile'],
  [1, -1.82, 0.87, 0.91, 2.11, 'bathTile'],
];
const LABELS2 = [
  [0, -5.30, 1.30, 'Gym'],
  [0, -1.00, 5.40, 'Entrance'],
  [0, 4.40, 3.70, 'Stair hall · north door'],
  [0, -5.00, -4.60, 'Bath · soaking tubs'],
  [0, -2.70, -6.25, 'Sauna'],
  [0, -3.36, -2.50, 'WC'],
  [0, -1.00, 1.50, 'Wash room'],
  [0, -0.15, -2.30, 'Laundry'],
  [0, -0.15, -5.50, 'Plant room'],
  [1, 4.60, 3.60, 'Living'],
  [1, 0.30, 3.10, 'Dining'],
  [1, -2.60, 4.60, 'Kitchen'],
  [1, -6.00, -5.60, 'Bedroom 1'],
  [1, -0.65, -5.00, 'Bedroom 2'],
  [1, -0.95, -0.40, 'Bedroom 3'],
  [1, -6.20, 5.30, 'Bedroom 4'],
  [1, -6.00, 1.10, 'Bathroom'],
  [1, -6.00, -0.55, 'Bathroom'],
  [1, -0.95, -2.42, 'Bathroom'],
  [1, -0.45, 1.48, 'Bathroom'],
  [1, -3.53, -0.80, 'Hall'],
];
/* 1F lights; the 2F ones hang off the sloped ceiling: ROOF_LIGHTS2 */
const DOWN2 = {
  0: [[-5.3, 0.8, 1], [-5.3, 4.6, 0], [-1.0, 5.4, 0], [4.4, 3.4, 1], [-5.0, -4.4, 1], [-1.0, 1.6, 0], [-0.15, -2.3, 0], [-0.15, -5.5, 0], [-2.7, -6.25, 0]],
};
const ROOF_LIGHTS2 = [[-2.6, 4.6, 1], [-6.0, -5.6, 1], [-0.65, -5.0, 1], [-0.95, -0.4, 0], [-6.2, 5.3, 1], [-3.53, -0.8, 0],
  [-6.0, 1.1, 0], [-6.0, -0.55, 0], [-0.95, -2.42, 0], [-0.45, 1.48, 0], [5.6, 4.6, 0], [3.3, 4.6, 0]];
const ZONES = HOUSE === 2 ? ZONES2 : ZONES1, LABELS = HOUSE === 2 ? LABELS2 : LABELS1, DOWN = HOUSE === 2 ? DOWN2 : DOWN1;

/* ------------------------------------------------------------ build it all */
const G = { floor: [], walls: [], furn: [], ceil: [], labels: [], ext: new THREE.Group(), roof: new THREE.Group() };
let PLAN = null, LV = [], STAIRS = [], FLOOR_RECTS = [];

function buildHouse(plan) {
  PLAN = plan; LV = plan.levels; STAIRS = plan.stairs || [];
  root.add(G.ext); root.add(G.roof);

  /* stair openings through the floor above + landing nosings */
  const extraHoles = LV.map(() => []), patches = LV.map(() => []);
  for (const s of STAIRS) {
    const up = s.level + 1; if (!LV[up]) continue;
    const c = s.name === 'stairsCircle'
      ? rectPoly(s.x - s.w / 2 - 0.02, s.y - s.d / 2 - 0.02, s.x + s.w / 2 + 0.02, s.y + s.d / 2 + 0.02)
      : s.hole ? holeOver(s) : rectCorners({ x: s.x, y: s.y, w: s.w + 0.04, d: s.d + 0.04, a: s.a });
    extraHoles[up].push(c);
    if (s.name === 'stairs') {
      /* the top edge of the flight must meet floor: bridge any gap to the slab */
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const dir = [sa, -ca];                         /* local -y in world */
      const tx = s.x + dir[0] * s.d / 2, tz = s.y + dir[1] * s.d / 2;
      const onFloor = (x, z) => LV[up].rooms.some(r => inside(r.poly, x, z) && !r.voids.some(v => inside(rectCorners(v), x, z)));
      for (let k = 1; k <= 12; k++) {
        const px = tx + dir[0] * k * 0.05, pz = tz + dir[1] * k * 0.05;
        if (onFloor(px, pz)) {
          if (k > 1) patches[up].push(rectCorners({ x: tx + dir[0] * k * 0.025, y: tz + dir[1] * k * 0.025, w: s.w, d: k * 0.05 + 0.02, a: s.a }));
          break;
        }
      }
    }
  }

  LV.forEach((L, i) => {
    const gf = new THREE.Group(), gw = new THREE.Group(), gu = new THREE.Group(), gc = new THREE.Group(), gl = new THREE.Group();
    G.floor[i] = gf; G.walls[i] = gw; G.furn[i] = gu; G.ceil[i] = gc; G.labels[i] = gl;
    root.add(gf, gw, gu, gc, gl);
    const GL = { walls: gw, furn: gu };
    const floorMat = i === 0 ? MAT.concrete : MAT.oak;

    const th = i === 0 ? 0.3 : LV[i - 1].ct;
    const rects = [];
    for (const rm of L.rooms) {
      const holes = rm.voids.map(v => rectCorners(v)).concat(extraHoles[i]);
      rects.push(...rectsOf(rm.poly, holes));
      for (const z of ZONES) if (z[0] === i) {
        const cx = (z[1] + z[3]) / 2, cz = (z[2] + z[4]) / 2;
        if (inside(rm.poly, cx, cz)) {
          const zm = cloneMat(MAT[z[5]]); zm.polygonOffset = true; zm.polygonOffsetFactor = -2; zm.polygonOffsetUnits = -2;
          gf.add(flat(rectPoly(z[1], z[2], z[3], z[4]), [], L.base + 0.002, zm, 1));
        }
      }
      for (const f of rm.furniture) { const p = makeProp(f, i); if (p) { p.position.y += L.base; gu.add(p); } }
    }
    for (const p of patches[i]) rects.push(bbox(p));
    /* house 2: floor across the gap between two rooms' facing walls (parse_plan.py) */
    for (const p of L.patches || []) rects.push(...rectsOf(rectPoly(p[0], p[1], p[2], p[3]), extraHoles[i]));
    FLOOR_RECTS[i] = rects;
    /* this level's floor; its underside is the ceiling of the level below */
    slabRects(gf, rects, L.base, th, floorMat, i > 0 ? MAT.ceiling : null, MAT.slabEdge);
    if (HOUSE === 2 && i === LV.length - 1) { /* house 2 2F walls follow the roof: buildUnderRoof() */ }
    else for (const w of L.walls) {
      if (w.kind === 'int' && i === 0) {
        /* free walls that run out past the house become a garden screen */
        for (const part of clipToHouse(w, L)) wallRun(GL, part, i, L);
      } else if (w.kind === 'int') {
        for (const part of clipToHouse(w, L)) if (part.inHouse) wallRun(GL, part, i, L);
      } else wallRun(GL, w, i, L);
    }
    for (const f of L.furniture) {
      const p = makeProp(f, i); if (!p) continue;
      p.position.y += L.base;
      (i === 0 ? G.ext : gu).add(p);
    }
    for (const l of LABELS) if (l[0] === i) {
      const sp = labelSprite(l[3]); sp.position.set(l[1], L.base + 2.1, l[2]); gl.add(sp);
    }
    for (const p of DOWN[i] || []) {
      if (p[2]) { const pl = new THREE.PointLight(0xffdcb0, 6, 9, 1.5); pl.position.set(p[0], L.base + L.h - 0.25, p[1]); gu.add(pl); }
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), MAT.lampGlow);
      lens.rotation.x = Math.PI / 2; lens.position.set(p[0], L.base + L.h - 0.004, p[1]); gu.add(lens);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 24), MAT.white);
      ring.rotation.x = Math.PI / 2; ring.position.set(p[0], L.base + L.h - 0.003, p[1]); gu.add(ring);
    }
  });

  for (const s of STAIRS) (s.name === 'stairsCircle' ? buildSpiralStair : buildStraightStair)({ furn: s.level === 0 && !LV[0].rooms.some(r => inside(r.poly, s.x, s.y)) ? G.ext : G.furn[s.level] }, s);

  if (HOUSE === 2) { roofSetup(); decorate2(); buildUnderRoof(); buildSite2(); }
  else { decorate(); buildSauna(); buildRoof(); buildSite(); }
  parkSliders();

  for (let i = 0; i < LV.length; i++) { mergeStatic(G.walls[i]); mergeStatic(G.furn[i]); mergeStatic(G.floor[i]); mergeStatic(G.ceil[i]); }
  mergeStatic(G.ext); mergeStatic(G.roof);
}
/* the part of a flight the floor above is open over: s.hole = [from, to] as
   fractions of the flight from its foot (parse_plan.py: from the balustrade
   drawn across it upstairs to the top) */
function holeOver(s) {
  const [f0, f1] = s.hole, ly = s.d / 2 - (f0 + f1) / 2 * s.d;   /* local y of the hole's middle (the flight climbs to -y) */
  return rectCorners({ x: s.x - ly * Math.sin(s.a), y: s.y + ly * Math.cos(s.a), w: s.w + 0.04, d: (f1 - f0) * s.d + 0.04, a: s.a });
}
/* split a free wall into the part inside the house footprint and the part
   outside it (level 0 only keeps the outside part, as a lower garden screen) */
function clipToHouse(w, L) {
  const [ax, az] = w.a, [bx, bz] = w.b, len = Math.hypot(bx - ax, bz - az);
  /* a wall drawn in the sliver between two room outlines (1F: the entrance's
     north wall, sliding door 168) has rooms on both sides: inside, not a screen */
  const nx = -(bz - az) / len, nz = (bx - ax) / len, D = (w.t || 0.12) / 2 + 0.04;
  const inR = (x, z) => L.rooms.some(r => inside(r.poly, x, z));
  const inH = (x, z) => inR(x, z) || (inR(x + nx * D, z + nz * D) && inR(x - nx * D, z - nz * D));
  const N = Math.max(2, Math.ceil(len / 0.05)), runs = [];
  let cur = null;
  for (let k = 0; k <= N; k++) {
    const t = k / N, x = ax + (bx - ax) * t, z = az + (bz - az) * t, v = inH(x, z);
    if (!cur || cur.v !== v) { cur = { v, t0: t, t1: t }; runs.push(cur); } else cur.t1 = t;
  }
  const out = [];
  for (const r of runs) {
    let t0 = r.t0, t1 = r.t1;
    if (r.v) { t0 = Math.max(0, t0 - 0.3 / len); t1 = Math.min(1, t1 + 0.3 / len); }   /* run into the outer wall */
    else {
      if (L !== LV[0] || (t1 - t0) * len < 1.0) continue;
      t0 = Math.min(1, t0 + 0.37 / len);
    }
    const a = [ax + (bx - ax) * t0, az + (bz - az) * t0], b = [ax + (bx - ax) * t1, az + (bz - az) * t1];
    const doors = w.doors.map(d => Object.assign({}, d, { off: d.off - t0 * len })).filter(d => d.off > -d.w && d.off < (t1 - t0) * len);
    const part = Object.assign({}, w, { a, b, doors, inHouse: r.v });
    if (!r.v) { part.kind = 'screen'; }
    out.push(part);
  }
  return out.map(p => p.kind === 'screen' ? screenWall(p) : p).filter(Boolean);
}
function screenWall(p) {
  /* 1.9 m slatted cedar privacy screen */
  const [ax, az] = p.a, [bx, bz] = p.b, len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len, th = Math.atan2(-uz, ux);
  const g = new THREE.Group();
  const n = Math.floor(len / 0.11);
  for (let i = 0; i < n; i++) mk(g, B(0.07, 1.9, 0.045, MAT.cedar), MAT.cedar, -len / 2 + 0.055 + i * 0.11, 0.95, 0);
  for (const y of [0.25, 1.65]) mk(g, B(len, 0.06, 0.04), MAT.blackSteel, 0, y, -0.045);
  g.position.set((ax + bx) / 2, 0, (az + bz) / 2); g.rotation.y = th;
  G.ext.add(g);
  return null;
}

/* a few things the plan implies but doesn't draw */
function decorate() {
  const L1 = LV[1], L2 = LV[2], L0 = LV[0];
  /* pendants over the dining table */
  const tbl = findProp(1, 'table');
  if (tbl) for (const dx of [-0.5, 0.5]) {
    const ca = Math.cos(tbl.a), sa = Math.sin(tbl.a);
    const px = tbl.x + dx * ca, pz = tbl.y + dx * sa;
    const lamp = placeModel(G.furn[1], 'pendant', px, L1.base + L1.h - 0.55, pz, 0, 1);
    if (lamp) {
      const M = GLTF.pendant; lamp.position.y = L1.base + L1.h - M.size.y - 0.35;
      mk(G.furn[1], CY(0.004, 0.35, 6), MAT.black, px, L1.base + L1.h - 0.175, pz);
      const pl = new THREE.PointLight(0xffd6a0, 3.2, 5, 1.8); pl.position.set(px, lamp.position.y + 0.05, pz); G.furn[1].add(pl);
    }
  }
  /* plants */
  placeModel(G.furn[1], 'plant', -10.05, L1.base, -7.0, 0.3, 1.25);
  placeModel(G.furn[1], 'plant', -3.7, L1.base, -3.35, 1.2, 1.1);
  placeModel(G.furn[0], 'plant', -2.9, L0.base, 0.65, 0.6, 1.2);
  placeModel(G.furn[2], 'plant', 0.1, L2.base, -8.0, 2.0, 1.0);
  /* living: coffee table + rug in front of the corner sofa */
  const sofa = findProp(1, 'sofa');
  if (sofa) {
    mk(G.furn[1], B(2.3, 0.012, 2.1, MAT.rugWool), MAT.rugWool, sofa.x - 0.55, L1.base + 0.006, sofa.y + 0.3).castShadow = false;
    placeModel(G.furn[1], 'coffee', sofa.x - 0.85, L1.base, sofa.y + 0.35, Math.PI / 2, 1);
  }
  /* glass balustrade where the 3F landing meets the void beside the stair */
  const s2 = STAIRS.find(s => s.level === 1 && s.name === 'stairs');
  if (s2) {
    const zTop = Math.max(...rectCorners(s2).map(p => p[1]));
    const railLen = -5.486 - zTop;
    if (railLen > 0.1) {
      const r = makeProp({ name: 'railing', x: -0.80, y: zTop + railLen / 2, w: 0.05, d: railLen, a: 0, top: 1.1, bottom: 0 }, 2);
      r.position.y += L2.base; G.furn[2].add(r);
    }
  }
}
function findProp(lvl, key) {
  for (const r of LV[lvl].rooms) for (const f of r.furniture) if (f.name === key || f.name.indexOf(key) === 0) return f;
  return null;
}

/* sauna: hinoki lining + lowered hinoki ceiling (the plan's void clips it) */
function buildSauna() {
  const x0 = -10.486, x1 = -9.20, z0 = -7.85, z1 = -4.99, y0 = LV[0].base, H = 2.35, g = G.furn[0];
  const t = 0.02;
  const panel = (cx, cz, w, d) => mk(g, B(w, H, d, MAT.hinoki), MAT.hinoki, cx, y0 + H / 2, cz);
  panel((x0 + x1) / 2, z0 + t / 2, x1 - x0, t);                      /* north */
  panel((x0 + x1) / 2, z1 - t / 2, x1 - x0, t);                      /* south */
  panel(x0 + t / 2, (z0 + z1) / 2, t, z1 - z0);                      /* west  */
  const doorZ0 = -4.99 - 0.0, doorZ1 = -5.90;                        /* door 444 in wall 440 */
  panel(x1 - t / 2, (z0 + doorZ1) / 2, t, doorZ1 - z0);
  const c = mk(g, B(x1 - x0, 0.03, z1 - z0, MAT.hinoki), MAT.hinoki, (x0 + x1) / 2, y0 + H + 0.015, (z0 + z1) / 2);
  c.castShadow = true;
  const pl = new THREE.PointLight(0xffb070, 2.2, 3.5, 1.8); pl.position.set(-9.85, y0 + 2.1, -6.4); g.add(pl);
}

/* flat roof: structure, black fascia, cedar soffit on the overhang, snow load */
function buildRoof() {
  const top = LV[LV.length - 1], rTop = top.base + top.h;
  const walls = top.rooms.map(r => offsetPoly(r.poly, 0.37));
  const eaves = top.rooms.map(r => offsetPoly(r.poly, 0.37 + 0.45));
  const snowP = top.rooms.map(r => offsetPoly(r.poly, 0.37 + 0.38));
  /* one roof over the union of the top rooms: plaster ceiling inside, cedar
     soffit under the 45cm overhang, black fascia, then the snow load */
  const inHouse = (r) => walls.some(p => inside(p, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2));
  const roofRects = unionRects(eaves.concat(walls));
  slabRects(G.roof, roofRects, rTop + 0.32, 0.32, MAT.blackSteel, null, MAT.blackSteel, (r) => inHouse(r) ? MAT.ceiling : MAT.cedar);
  slabRects(G.roof, unionRects(snowP), rTop + 0.62, 0.30, MAT.roofSnow, null, MAT.roofSnow);
}
/* grow a closed axis-aligned polygon outwards by d */
function offsetPoly(poly, d) {
  const n = poly.length, out = [];
  const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sgn = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
    const nx = dz / l * sgn, nz = -dx / l * sgn;              /* outward for CCW-in-y-down */
    lines.push([p[0] + nx * d, p[1] + nz * d, dx, dz]);
  }
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], Bl = lines[i];
    const den = A[2] * Bl[3] - A[3] * Bl[2];
    if (Math.abs(den) < 1e-9) { out.push([Bl[0], Bl[1]]); continue; }
    const t = ((Bl[0] - A[0]) * Bl[3] - (Bl[1] - A[1]) * Bl[2]) / den;
    out.push([A[0] + A[2] * t, A[1] + A[3] * t]);
  }
  /* sanity: if we grew the wrong way, flip */
  const test = inside(out, poly[0][0], poly[0][1]);
  return test ? out : offsetPolyFlip(poly, d);
}
function offsetPolyFlip(poly, d) { return offsetPoly(poly.slice().reverse(), d); }

/* ------------------------------------------------------------------- site */
function buildSite() {
  const E = G.ext;
  /* snow field */
  const R = 480;
  const geo = new THREE.CircleGeometry(R, 96, 0, Math.PI * 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y);
    const k = Math.min(1, Math.max(0, (d - 30) / 120));
    p.setZ(i, (Math.sin(x * 0.05) * Math.cos(y * 0.043) * 0.6 + Math.sin(x * 0.013 + 1) * Math.cos(y * 0.011) * 2.2) * k);
  }
  geo.computeVertexNormals();
  scaleUV(geo, R * 2 / tileOf(MAT.snow));
  const gnd = new THREE.Mesh(geo, MAT.snow);
  gnd.rotation.x = -Math.PI / 2; gnd.position.set(-4, -0.02, -6); gnd.receiveShadow = true;
  E.add(gnd);
  /* ploughed drive (packed snow), concrete pad under the carport, path to the door */
  const drive = mk(E, B(8.0, 0.04, 9.0, MAT.packed), MAT.packed, -7.0, 0.0, 3.6); drive.castShadow = false;
  const pad = mk(E, B(7.1, 0.05, 5.3, MAT.pad), MAT.pad, -7.25, 0.005, -0.2); pad.castShadow = false;
  const path = mk(E, B(1.4, 0.05, 2.6, MAT.pad), MAT.pad, -3.9, 0.005, 0.1); path.castShadow = false;
  /* north terrace (jacuzzi side) */
  const deck = mk(E, B(7.5, 0.14, 4.3, MAT.deck), MAT.deck, -7.05, 0.07, -13.65); deck.castShadow = false;
  /* snow banks where the plough piles it */
  const bank = (x, z, w, d, h) => {
    const g2 = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const pp = g2.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const vx = pp.getX(i), vy = pp.getY(i), vz = pp.getZ(i), k = 1 + Math.sin(vx * 7.3 + vz * 2) * .06;
      pp.setXYZ(i, vx * k, vy * (1 + Math.sin(vx * 4 + vz * 3) * .15), vz * k);
    }
    g2.computeVertexNormals(); scaleUV(g2, 3);
    const b = new THREE.Mesh(g2, MAT.snow); b.scale.set(w, h, d); b.position.set(x, -0.05, z);
    b.castShadow = true; b.receiveShadow = true; E.add(b);
  };

}

/* ================================================================ house 2 */
/* The 2F ceiling is ONE plane (a mono-pitch / shed roof). It falls from the
   living room towards the bedrooms, along the plan's own axis: the vector
   from the living room's centroid (the 2F room with the sofa) to the mean
   of the bed centres, snapped to x or z. The heights are the plane's height
   above the 2F floor at the OUTER faces of the two end walls; the "Living
   side" / "Bedroom side" sliders change them and everything under the roof
   is rebuilt (buildUnderRoof). */
function roofSetup() {
  const top = LV[LV.length - 1];
  const cen = (P) => {
    let a = 0, cx = 0, cz = 0;
    for (let i = 0; i < P.length; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], k = x0 * z1 - x1 * z0;
      a += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k;
    }
    return [cx / (3 * a), cz / (3 * a)];
  };
  const liv = top.rooms.find(r => r.furniture.some(f => f.name === 'sofa')) || top.rooms[0];
  const lc = cen(liv.poly);
  const beds = LV.flatMap(L => L.rooms.flatMap(r => r.furniture.filter(f => f.name === 'bed')));
  const bc = beds.length ? [beds.reduce((a, f) => a + f.x, 0) / beds.length, beds.reduce((a, f) => a + f.y, 0) / beds.length] : [0, 0];
  const d = [bc[0] - lc[0], bc[1] - lc[1]];
  const axis = Math.abs(d[0]) >= Math.abs(d[1]) ? 0 : 1;              /* 0: x (east-west), 1: z (north-south) */
  const t = Math.max(...top.walls.filter(w => w.kind === 'ext').map(w => w.t));
  const lo = Math.min(...top.rooms.flatMap(r => r.poly.map(q => q[axis]))) - t;
  const hi = Math.max(...top.rooms.flatMap(r => r.poly.map(q => q[axis]))) + t;
  const bedLow = d[axis] < 0;
  ROOF = {
    axis, living: lc, bedrooms: bc, delta: d, sBed: bedLow ? lo : hi, sLiv: bedLow ? hi : lo,
    hBed: 3.0, hLiv: 6.0, base: top.base,
    y(x, z) { return this.base + this.hBed + this.k * ((this.axis ? z : x) - this.sBed); },
    get k() { return (this.hLiv - this.hBed) / (this.sLiv - this.sBed); },
    get n() { return new V(this.axis ? 0 : -this.k, 1, this.axis ? -this.k : 0).normalize(); },
    get pitch() { return Math.atan(Math.abs(this.hLiv - this.hBed) / Math.abs(this.sLiv - this.sBed)) * 180 / Math.PI; },
  };
  console.log('[h3d] roof axis', axis ? 'z' : 'x', 'living', lc.map(v => +v.toFixed(2)), 'bedrooms', bc.map(v => +v.toFixed(2)),
    'delta', d.map(v => +v.toFixed(2)), 'bedroom side at', ROOF.sBed.toFixed(2), 'living side at', ROOF.sLiv.toFixed(2));
}
function clearGroup(g) {
  g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  g.clear();
}
/* Everything that depends on the roof heights: the 2F walls (tops on the
   plane, windows cut down where it comes too low), the roof and what hangs
   off the ceiling. Run once by buildHouse, then again on every slider move. */
let _rdFloor = null, _built = false;
function buildUnderRoof() {
  const li = LV.length - 1, L = LV[li];
  if (!G.rdep) { G.rdep = new THREE.Group(); G.rdep.userData.keep = true; root.add(G.rdep); }
  for (const g of [G.walls[li], G.roof, G.rdep]) clearGroup(g);
  for (let k = COLL.length - 1; k >= 0; k--) if (COLL[k].rd) COLL.splice(k, 1);
  for (let k = SLIDERS.length - 1; k >= 0; k--) if (SLIDERS[k].lvl === li) SLIDERS.splice(k, 1);
  if (_rdFloor) FLOOR_RECTS[li] = _rdFloor.slice(); else _rdFloor = FLOOR_RECTS[li].slice();
  const c0 = COLL.length, s0 = SLIDERS.length, GL = { walls: G.walls[li], furn: G.furn[li] };
  for (const w of L.walls) {
    if (w.kind === 'int') { for (const part of clipToHouse(w, L)) if (part.inHouse) wallRun(GL, part, li, L); }
    else wallRun(GL, w, li, L);
  }
  for (let k = c0; k < COLL.length; k++) COLL[k].rd = true;
  buildShedRoof();
  roofFixtures();
  if (_built) {                       /* a rebuild: park the new sliding doors and merge, as buildHouse does */
    parkSliders(SLIDERS.slice(s0));
    mergeStatic(G.walls[li]); mergeStatic(G.roof);
  }
}
let _rdPending = false;
function rebuildRoof() {
  const t0 = performance.now();
  buildUnderRoof();
  ROOF.ms = Math.round(performance.now() - t0);
}
/* shed roof: plaster ceiling inside, cedar soffit under the 45 cm overhang,
   black fascia, snow load on top -- all parallel to the ceiling plane */
function buildShedRoof() {
  const top = LV[LV.length - 1];
  const walls = top.rooms.map(r => offsetPoly(r.poly, 0.37));
  const eaves = top.rooms.map(r => offsetPoly(r.poly, 0.37 + 0.45));
  const snowP = top.rooms.map(r => offsetPoly(r.poly, 0.37 + 0.38));
  /* inside the walls and the overhang as separate rect sets: a merged row
     would span both and take one material (the soffit has to be cedar all round) */
  const all = eaves.concat(walls), inner = (x, z) => walls.some(p => inside(p, x, z));
  slopedSlab(G.roof, unionRects(all, inner), 0, 0.32, MAT.blackSteel, MAT.blackSteel, () => MAT.ceiling);
  slopedSlab(G.roof, unionRects(all, (x, z) => !inner(x, z)), 0, 0.32, MAT.blackSteel, MAT.blackSteel, () => MAT.cedar);
  slopedSlab(G.roof, unionRects(snowP), 0.32, 0.30, MAT.roofSnow, MAT.roofSnow, null);
}
/* slabRects on the roof plane: bottom face = plane + off, top = bottom + th */
function slopedSlab(parent, rects, off, th, topMat, edgeMat, botPick) {
  const T = Quads(topMat), E = Quads(edgeMat), Bm = new Map();
  const n = ROOF.n, up = [n.x, n.y, n.z], dn = [-n.x, -n.y, -n.z];
  const yb = (x, z) => ROOF.y(x, z) + off, yt = (x, z) => ROOF.y(x, z) + off + th;
  const plan = (v) => [v[0], -v[2]];
  for (const r of rects) {
    const [x0, z0, x1, z1] = r;
    quad(T, [x0, yt(x0, z0), z0], [x0, yt(x0, z1), z1], [x1, yt(x1, z1), z1], [x1, yt(x1, z0), z0], up, plan);
    const bm = botPick && botPick(r);
    if (bm) {
      if (!Bm.has(bm)) Bm.set(bm, Quads(bm));
      quad(Bm.get(bm), [x0, yb(x0, z0), z0], [x1, yb(x1, z0), z0], [x1, yb(x1, z1), z1], [x0, yb(x0, z1), z1], dn, plan);
    }
    const side = (ax, az, bx, bz, nn) => quad(E, [ax, yb(ax, az), az], [bx, yb(bx, bz), bz], [bx, yt(bx, bz), bz], [ax, yt(ax, az), az], nn,
      (v) => [Math.abs(nn[0]) > 0 ? v[2] : v[0], v[1]]);
    side(x0, z0, x1, z0, [0, 0, -1]); side(x1, z1, x0, z1, [0, 0, 1]);
    side(x0, z1, x0, z0, [-1, 0, 0]); side(x1, z0, x1, z1, [1, 0, 0]);
  }
  for (const Q of [T, E, ...Bm.values()]) { const m = qMesh(Q); if (m) parent.add(m); }
}
/* 2F downlights flush with the sloped ceiling + pendants over the dining table */
function roofFixtures() {
  const li = LV.length - 1, L = LV[li], g = G.rdep;
  const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), ROOF.n.clone().negate());
  for (const [x, z, lit] of ROOF_LIGHTS2) {
    const y = ROOF.y(x, z);
    if (lit) { const pl = new THREE.PointLight(0xffdcb0, 6, 9, 1.5); pl.position.set(x, y - 0.25, z); g.add(pl); }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), MAT.lampGlow);
    lens.quaternion.copy(q); lens.position.set(x, y - 0.004, z); g.add(lens);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 24), MAT.white);
    ring.quaternion.copy(q); ring.position.set(x, y - 0.003, z); g.add(ring);
  }
  const tbl = findProp(li, 'table');
  if (tbl) for (const dx of [-0.5, 0.5]) {
    const px = tbl.x + dx * Math.cos(tbl.a), pz = tbl.y + dx * Math.sin(tbl.a);
    const lamp = placeModel(g, 'pendant', px, L.base + 1.62, pz, 0, 1);       /* shade ~0.77 m over the table */
    if (!lamp) continue;
    const yc = ROOF.y(px, pz), y1 = lamp.position.y + GLTF.pendant.size.y;
    mk(g, CY(0.004, yc - y1, 6), MAT.black, px, (yc + y1) / 2, pz);
    const pl = new THREE.PointLight(0xffd6a0, 3.2, 5, 1.8); pl.position.set(px, lamp.position.y + 0.05, pz); g.add(pl);
  }
}
/* a few things the plan implies but doesn't draw */
function decorate2() {
  const li = LV.length - 1, L = LV[li];
  const sofa = findProp(li, 'sofa');
  if (sofa) {                                        /* rug + coffee table on the sofa's open side */
    const sx = sofa.mx ? 1 : -1;
    mk(G.furn[li], B(2.3, 0.012, 2.1, MAT.rugWool), MAT.rugWool, sofa.x + sx * 0.55, L.base + 0.006, sofa.y + 0.3).castShadow = false;
    placeModel(G.furn[li], 'coffee', sofa.x + sx * 0.85, L.base, sofa.y + 0.35, Math.PI / 2, 1);
  }
  placeModel(G.furn[li], 'plant', 7.2, L.base, 2.7, 0.4, 1.25);
  placeModel(G.furn[0], 'plant', 0.45, LV[0].base, 4.2, 1.1, 1.15);
  placeModel(G.furn[0], 'plant', 7.3, LV[0].base, 6.45, 2.2, 1.2);
}
/* snow field, the ploughed north-east yard (parking: the L's open corner),
   paths to the doors */
function buildSite2() {
  const E = G.ext, R = 480;
  const geo = new THREE.CircleGeometry(R, 96, 0, Math.PI * 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y);
    const k = Math.min(1, Math.max(0, (d - 30) / 120));
    p.setZ(i, (Math.sin(x * 0.05) * Math.cos(y * 0.043) * 0.6 + Math.sin(x * 0.013 + 1) * Math.cos(y * 0.011) * 2.2) * k);
  }
  geo.computeVertexNormals();
  scaleUV(geo, R * 2 / tileOf(MAT.snow));
  const gnd = new THREE.Mesh(geo, MAT.snow);
  gnd.rotation.x = -Math.PI / 2; gnd.position.set(0, -0.02, 0); gnd.receiveShadow = true;
  E.add(gnd);
  const flatOn = (m) => { m.castShadow = false; return m; };
  flatOn(mk(E, B(7.4, 0.04, 9.0, MAT.packed), MAT.packed, 4.95, 0.0, -2.75));      /* parking, north-east yard */
  flatOn(mk(E, B(13.4, 0.04, 6.0, MAT.packed), MAT.packed, 15.3, 0.0, -2.0));      /* drive out east */
  flatOn(mk(E, B(2.0, 0.05, 2.8, MAT.pad), MAT.pad, -0.6, 0.005, 8.7));            /* path, south door */
  flatOn(mk(E, B(2.4, 0.14, 2.4, MAT.deck), MAT.deck, -9.35, 0.07, -5.1));         /* deck, bath's west door */
}

/* Collapse single-material static meshes into one mesh per material. */
function mergeStatic(group) {
  const buckets = new Map(), victims = [];
  group.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  group.traverse(o => {
    if (!o.isMesh || o === group || Array.isArray(o.material) || o.renderOrder !== 0 || o.material.transparent) return;
    if (o.userData.keep || !o.geometry.attributes.uv || !o.geometry.attributes.normal) return;
    let pp = o.parent, skip = false;
    while (pp && pp !== group) { if (pp.userData.keep) skip = true; pp = pp.parent; }
    if (skip) return;
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cs: o.castShadow, rs: o.receiveShadow, g: [] });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (g.groups.length) g.clearGroups();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    buckets.get(key).g.push(g);
    victims.push(o);
  });
  for (const o of victims) if (o.parent) o.parent.remove(o);
  for (const b of buckets.values()) {
    const merged = b.g.length === 1 ? b.g[0] : mergeGeometries(b.g, false);
    if (!merged) { for (const g of b.g) group.add(new THREE.Mesh(g, b.mat)); continue; }
    const m = new THREE.Mesh(merged, b.mat);
    m.castShadow = b.cs; m.receiveShadow = b.rs;
    group.add(m);
  }
}

/* ------------------------------------------------------------------ presets */
/* [name, x, z, yaw, pitch, level|null(fly), y(optional)] — yaw 0 looks north (-z).
   pitch = where the centre of the view points; up to +-SHIFT it is lens shift.
   Framed for the default 72deg (wide-axis) lens. */
const VIEWS1 = [
  ['Outside — south-east', 9.5, 10.5, 0.72, -0.10, null, 3.2],
  ['Outside — south (living glass)', -5.0, 14.0, 0.05, -0.02, null, 2.6],
  ['Outside — north terrace', -12.5, -21.0, -2.59, -0.06, null, 2.4],
  ['Doll-house from above', -4.0, 13.0, 0.0, -0.92, null, 23.0],
  ['1F — Entrance', -2.2, 0.4, -1.05, -0.05, 0],
  ['1F — Gym (double height)', 1.6, -8.4, 1.40, 0.18, 0],
  ['1F — Bath + tubs', -7.4, -8.4, 1.05, -0.12, 0],
  ['1F — Sauna', -9.55, -5.35, 0.25, -0.10, 0],
  ['1F — Wash room', -1.7, -3.4, 1.9, -0.06, 0],
  ['2F — Living (double height)', -3.3, -5.5, 1.85, 0.12, 1],
  ['2F — Dining + kitchen', -3.8, -4.4, -1.35, -0.05, 1],
  ['2F — Kitchen', 0.2, -6.4, 2.6, -0.08, 1],
  ['2F — Stairs up to 3F', -5.4, -5.7, -1.55, 0.18, 1],
  ['2F — Over the entrance void', -1.8, -3.9, 3.14, -0.52, 1],
  ['3F — Landing over the living', -0.3, -7.6, 1.95, -0.30, 2],
  ['3F — Bedroom 1', -9.9, -8.7, -0.6, -0.08, 2],
  ['3F — Bedroom 2', -6.3, -8.7, -0.6, -0.08, 2],
  ['3F — Bedroom 3', 0.1, -8.75, -0.75, -0.08, 2],
  ['3F — Bedroom 4', 2.2, -2.2, 2.29, -0.10, 2],
  ['3F — Bathroom', -3.1, -7.7, -0.50, -0.15, 2],
];

/* house 2 presets (plan2.json coordinates) */
const VIEWS2 = [
  ['Outside — south-east (living end: roof high)', 13.0, 22.0, 0.57, 0.02, null, 2.8],
  ['Outside — north-west (bedroom end: roof low)', -15.5, -17.0, -2.40, -0.16, null, 6.0],
  ['Outside — south elevation', 0.0, 24.0, 0.0, 0.04, null, 3.2],
  ['Outside — north-east yard', 17.0, -14.0, 2.30, -0.06, null, 4.5],
  ['Doll-house from above', 0.0, 17.0, 0.0, -0.92, null, 23.0],
  ['1F — Gym', -3.3, -0.5, 2.30, 0.08, 0],
  ['1F — Entrance', 0.4, 6.4, 0.95, -0.02, 0],
  ['1F — Stair hall', 7.1, 2.8, 1.85, 0.12, 0],
  ['1F — Bath + tubs', -1.7, -3.6, 1.35, -0.10, 0],
  ['1F — Wash room', -2.4, 3.2, -0.6, -0.05, 0],
  ['2F — Living, looking west to the bedrooms', 7.3, 2.65, 1.80, 0.24, 1],
  ['2F — Dining, looking east (roof rises)', -1.6, 3.4, -1.45, 0.18, 1],
  ['2F — Kitchen + dining', 1.2, 2.7, 2.35, 0.02, 1],
  ['2F — Top of the stairs', 4.2, 6.2, 1.57, -0.30, 1],
  ['2F — Bedroom 1 (lowest ceiling)', -7.35, -4.55, -0.75, 0.16, 1],
  ['2F — Bedroom 2', 0.65, -3.45, 0.75, 0.18, 1],
  ['2F — Bedroom 3', -2.5, -1.4, -2.30, 0.06, 1],
  ['2F — Bedroom 4', -4.45, 4.15, 2.45, 0.14, 1],
];
const VIEWS = HOUSE === 2 ? VIEWS2 : VIEWS1;

/* ---------------------------------------------------------------- controls */
const st = {
  yaw: 0, pitch: -0.05, fly: false, floor: 0, speed: 3, fov: FOV.def,
  fmode: 'all', roof: true, labels: false, orbit: false, quality: 1,
  az: 0.84, el: 0.5, rad: 24, locked: false
};
const ORBIT_T = HOUSE === 2 ? new V(0, 3, 0) : new V(-4, 3, -5);
const act = new Set();
const KEYMAP = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  KeyE: 'up', KeyQ: 'dn', PageUp: 'up', PageDown: 'dn', Space: 'up',
  ArrowLeft: 'lookl', ArrowRight: 'lookr', ArrowUp: 'lookup', ArrowDown: 'lookdn',
  KeyJ: 'lookl', KeyL: 'lookr', KeyI: 'lookup', KeyK: 'lookdn',
  KeyZ: 'wide', KeyX: 'narrow'
};
function goView(v) {
  const fl = v[5];
  st.floor = fl === null ? 0 : fl;
  st.fly = fl === null;
  const y = v[6] !== undefined ? v[6] : (fl === null ? 2.2 : LV[fl].base + EYE);
  camera.position.set(v[1], y, v[2]);
  st.h = fl === null ? null : LV[fl].base;
  st.yaw = v[3]; st.pitch = v[4];
  st.roof = v[0].indexOf('Doll') !== 0;
  st.orbit = false; syncUI();
  expo = indoors() ? 1.3 : 0.9;
}
function curLevel() {
  let b = 0;
  LV.forEach((L, i) => { if (camera.position.y >= L.base - 0.9) b = i; });
  return b;
}
function applyVis() {
  const cl = curLevel();
  LV.forEach((L, i) => {
    const on = (st.fmode === 'all') || (st.fmode === i) || (typeof st.fmode === 'number' && i < st.fmode);
    G.floor[i].visible = on; G.walls[i].visible = on; G.furn[i].visible = on;
    G.labels[i].visible = on && st.labels && (st.fmode !== 'all' ? i === st.fmode : (i === cl || camera.position.y > LV[LV.length - 1].base + 4));
    G.ceil[i].visible = on && st.roof && (st.fmode === 'all' || i < st.fmode);
  });
  G.roof.visible = st.roof && st.fmode === 'all';
  if (G.rdep) G.rdep.visible = G.furn[LV.length - 1].visible;
}
function fadeLabels() {
  const p = camera.position;
  for (const g of G.labels) if (g.visible) for (const s of g.children) {
    const d = p.distanceTo(s.position);
    s.material.opacity = d < 2.2 ? 0 : Math.min(.92, (d - 2.2) * 0.8);
  }
}
const onRects = (rs, x, z, m) => (rs || []).some(r => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m);
function stairHeights(x, z) {
  const out = [];
  for (const s of STAIRS) {
    const base = LV[s.level].base, H = stairRise(s);
    if (s.name === 'stairsCircle') {
      const dx = x - s.x, dz = z - s.y, r = Math.hypot(dx, dz);
      if (r > s.w / 2 + 0.05 || r < 0.1) continue;
      const n = s.treads || 16, d = (s.rot || Math.PI * 2) / n, th = Math.atan2(dx, dz), TAU = Math.PI * 2;
      for (let i = 1; i <= n; i++) {
        const thc = Math.PI + (n - i) * d;
        const diff = ((th - thc) % TAU + TAU * 1.5) % TAU - Math.PI;
        if (Math.abs(diff) <= d / 2 + 1e-6) out.push(base + i * H / n);
      }
    } else {
      const ca = Math.cos(s.a), sa = Math.sin(s.a), dx = x - s.x, dz = z - s.y;
      const lx = dx * ca + dz * sa, ly = -dx * sa + dz * ca;
      if (Math.abs(lx) > s.w / 2 || Math.abs(ly) > s.d / 2 + 0.05) continue;
      out.push(base + H * Math.max(0, Math.min(1, (s.d / 2 - ly) / s.d)));
    }
  }
  return out;
}
/* what would you be standing on at (x,z), given you're at height cur now */
function supportAt(x, z, cur) {
  const c = [0];                                     /* the ground / 1F is everywhere */
  for (let i = 1; i < LV.length; i++) if (onRects(FLOOR_RECTS[i], x, z, 0.06)) c.push(LV[i].base);
  c.push(...stairHeights(x, z));
  /* highest thing within a step of where you are: walking into a flight from
     its foot climbs it; walking off the top of one lands on the floor */
  let best = null;
  for (const h of c) if (Math.abs(h - cur) <= 0.42 && (best === null || h > best)) best = h;
  return best;
}
function blocked(x, y, z) {
  const r = 0.28, lo = y - EYE + 0.35, hi = y - EYE + 1.72;
  for (const c of COLL) {
    if (hi < c.y0 || lo > c.y1) continue;
    if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  }
  return false;
}
function move(dt) {
  const sp = st.speed * (act.has('run') ? 2.5 : 1) * dt;
  let fx = 0, fz = 0, uy = 0;
  if (act.has('fwd')) fz -= 1;
  if (act.has('back')) fz += 1;
  if (act.has('left')) fx -= 1;
  if (act.has('right')) fx += 1;
  if (act.has('up')) uy += 1;
  if (act.has('dn')) uy -= 1;
  const look = 1.35 * dt * (camera.fov / 60);          /* camera.fov = actual vertical fov */
  if (act.has('lookl')) st.yaw += look;
  if (act.has('lookr')) st.yaw -= look;
  if (act.has('lookup')) st.pitch = Math.min(1.5, st.pitch + look);
  if (act.has('lookdn')) st.pitch = Math.max(-1.5, st.pitch - look);
  if (act.has('wide')) setFov(st.fov + 40 * dt);
  if (act.has('narrow')) setFov(st.fov - 40 * dt);

  if (st.orbit) {
    st.rad = Math.max(6, Math.min(70, st.rad + fz * sp * 2.2));
    st.az += fx * sp * 0.12;
    st.el = Math.max(0.05, Math.min(1.45, st.el + uy * sp * 0.06));
    return;
  }
  if (!fx && !fz && !uy) return;
  const len = Math.hypot(fx, fz) || 1;
  const s = Math.sin(st.yaw), c = Math.cos(st.yaw);
  let dx = (-s * (-fz) + c * fx) / len * sp;
  let dz = (-c * (-fz) - s * fx) / len * sp;
  if (st.fly) {
    const p = camera.position;
    p.x += dx; p.z += dz; p.y += uy * sp;
    p.y = Math.max(0.3, Math.min(60, p.y));
  } else {
    const p = camera.position;
    if (st.h === undefined || st.h === null) st.h = LV[st.floor].base;
    const tryGo = (nx, nz) => {
      const h = supportAt(nx, nz, st.h);
      if (h === null || blocked(nx, h + EYE, nz)) return false;
      p.x = nx; p.z = nz; st.h = h; return true;
    };
    if (dx || dz) tryGo(p.x + dx, p.z + dz) || tryGo(p.x + dx, p.z) || tryGo(p.x, p.z + dz);
    if (uy) {
      const n = Math.max(0, Math.min(LV.length - 1, st.floor + (uy > 0 ? 1 : -1)));
      if (n !== st.floor) { st.floor = n; st.h = LV[n].base; act.delete('up'); act.delete('dn'); }
    }
    let fl = 0; LV.forEach((L, i) => { if (st.h >= L.base - 0.3) fl = i; });
    if (fl !== st.floor && !uy) st.floor = fl;
    p.y = st.h + EYE;
    syncFloorLabel();
  }
}
let _lastFl = -1;
function syncFloorLabel() { if (_lastFl !== st.floor) { _lastFl = st.floor; syncUI(); } }
function setFov(v) {
  st.fov = Math.max(FOV.min, Math.min(FOV.max, v));
  applyLens();
  fovEl.value = Math.round(st.fov); fovv.textContent = Math.round(st.fov) + '°';
}
/* three's camera.fov is VERTICAL: derive it from st.fov (wide axis) and the
   aspect, then turn the pitch within +-SHIFT into a vertical lens shift (an
   off-axis frustum: row y / column z of the projection). updateProjectionMatrix
   rebuilds a centred frustum, so this runs every frame (frame()) as well as
   on fov / resize changes. Returns the part of st.pitch the shift took up. */
function applyLens() {
  const half = st.fov * Math.PI / 360;
  camera.fov = camera.aspect >= 1 ? 2 * Math.atan(Math.tan(half) / camera.aspect) * 180 / Math.PI : st.fov;
  camera.updateProjectionMatrix();
  const shift = st.orbit ? 0 : Math.max(-SHIFT, Math.min(SHIFT, st.pitch));
  if (shift) {
    camera.projectionMatrix.elements[9] += Math.tan(shift) / Math.tan(camera.fov * Math.PI / 360);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();   /* GTAO reads it */
  }
  return shift;
}

/* --------------------------------------------------------------- UI wiring */
const $ = (id) => document.getElementById(id);
const fovEl = $('fov'), fovv = $('fovv'), hud = $('hud');
function syncUI() {
  $('bWalk').textContent = st.fly ? 'Fly' : 'Walk';
  $('bWalk').classList.toggle('on', st.fly);
  $('bFloors').textContent = st.fmode === 'all' ? 'All floors' : 'Up to ' + FLOOR_NAMES[st.fmode];
  $('bFloors').classList.toggle('on', st.fmode !== 'all');
  $('bCeil').classList.toggle('on', !st.roof);
  $('bLbl').classList.toggle('on', st.labels);
  $('bMouse').classList.toggle('on', st.locked);
  $('bQual').textContent = st.quality ? 'Quality: high' : 'Quality: fast';
  $('bQual').classList.toggle('on', !!st.quality);
  $('look').querySelector('[data-h=orbit]').classList.toggle('on', st.orbit);
  applyVis();
}
function bindPad() {
  document.querySelectorAll('[data-h]').forEach(b => {
    const h = b.dataset.h;
    const on = (e) => {
      e.preventDefault();
      if (h === 'lvl') { st.pitch = 0; return; }
      if (h === 'orbit') { st.orbit = !st.orbit; if (st.orbit) { st.rad = 24; st.az = 0.84; st.el = 0.45; } syncUI(); return; }
      act.add(h); b.classList.add('on');
    };
    const off = () => { act.delete(h); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  });
}
function bindUI() {
  const jump = $('jump');
  VIEWS.forEach((v, i) => { const o = document.createElement('option'); o.value = i; o.textContent = v[0]; jump.appendChild(o); });
  jump.value = 0;
  jump.addEventListener('change', () => { goView(VIEWS[+jump.value]); jump.blur(); });

  $('bWalk').onclick = () => {
    st.fly = !st.fly;
    if (!st.fly) {
      let best = 0;
      LV.forEach((L, i) => { if (camera.position.y >= L.base - 0.8) best = i; });
      st.floor = best; st.h = LV[best].base; camera.position.y = LV[best].base + EYE;
    }
    syncUI();
  };
  $('bFloors').onclick = () => {
    st.fmode = st.fmode === 'all' ? 0 : (st.fmode === LV.length - 1 ? 'all' : st.fmode + 1);
    syncUI();
  };
  $('bCeil').onclick = () => { st.roof = !st.roof; syncUI(); };
  $('bLbl').onclick = () => { st.labels = !st.labels; syncUI(); };
  $('bQual').onclick = () => { st.quality = st.quality ? 0 : 1; syncUI(); };
  $('bHelp').onclick = () => $('help').classList.add('show');
  $('bMouse').onclick = () => { canvas.requestPointerLock(); };
  $('bWide').onclick = () => setFov(FOV.wide);
  $('bNarrow').onclick = () => setFov(FOV.narrow);
  fovEl.oninput = () => setFov(+fovEl.value);
  $('spd').oninput = (e) => { st.speed = +e.target.value * 0.75; };
  $('help').onclick = (e) => { if (e.target.id === 'help') $('help').classList.remove('show'); };
  /* house switcher: each house is its own page load (?house=2) */
  for (const h of [1, 2]) {
    const b = $('bH' + h); if (!b) continue;
    b.classList.toggle('on', h === HOUSE);
    b.onclick = () => { if (h !== HOUSE) location.href = location.pathname + (h === 2 ? '?house=2' : ''); };
  }
  if (HOUSE === 2) bindRoof();

  /* drag = grab the view and pull it (drag right -> the scene follows right) */
  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; px = e.clientX; py = e.clientY; canvas.classList.add('look');
    canvas.setPointerCapture(e.pointerId);
  });
  const end = () => { dragging = false; canvas.classList.remove('look'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointermove', (e) => {
    if (st.locked || !dragging) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    const k = (camera.fov / 60) * 0.0042;           /* by the actual vertical fov */
    if (st.orbit) { st.az -= dx * 0.005; st.el = Math.max(0.05, Math.min(1.45, st.el + dy * 0.004)); return; }
    st.yaw += dx * k; st.pitch = Math.max(-1.5, Math.min(1.5, st.pitch + dy * k));
  });
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === canvas; syncUI(); });
  document.addEventListener('mousemove', (e) => {
    if (!st.locked) return;
    st.yaw -= e.movementX * 0.0022;
    st.pitch = Math.max(-1.5, Math.min(1.5, st.pitch - e.movementY * 0.0022));
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setFov(st.fov + e.deltaY * 0.05); }, { passive: false });
  let pinch = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    setFov(st.fov * (pinch / d)); pinch = d; e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = 0; });

  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'SELECT') return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') act.add('run');
    const a = KEYMAP[e.code];
    if (a) { act.add(a); e.preventDefault(); return; }
    if (e.code === 'KeyF') $('bWalk').onclick();
    if (e.code === 'KeyG') $('bQual').onclick();
    if (e.code === 'KeyC') $('bCeil').onclick();
    if (e.code === 'KeyT') $('bLbl').onclick();
    if (e.code === 'KeyO') { st.orbit = !st.orbit; syncUI(); }
    const first = (lv) => VIEWS.find(v => v[5] === lv);   /* first preset on that floor */
    if (e.code === 'Digit1' && first(0)) goView(first(0));
    if (e.code === 'Digit2' && first(1)) goView(first(1));
    if (e.code === 'Digit3' && first(2)) goView(first(2));
    if (e.code === 'Digit0') goView(VIEWS[0]);
    if (e.code === 'Slash') $('help').classList.add('show');
    if (e.code === 'Escape') $('help').classList.remove('show');
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') act.delete('run');
    const a = KEYMAP[e.code]; if (a) act.delete(a);
  });
  addEventListener('blur', () => act.clear());
}

/* house 2: roof sliders + readout */
function roofReadout() {
  const f = (v) => v.toFixed(1);
  $('roofRead').textContent = '1F ' + f(LV[0].h) + ' m · 2F ' + f(ROOF.hBed) + ' → ' + f(ROOF.hLiv) + ' m · pitch ' + Math.round(ROOF.pitch) + '°';
  $('hLivV').textContent = f(ROOF.hLiv) + ' m'; $('hBedV').textContent = f(ROOF.hBed) + ' m';
}
function placeRoofPanel() {
  const rp = $('roofp'); if (rp) rp.style.top = Math.round($('top').getBoundingClientRect().bottom + 6) + 'px';
}
/* the top bar wraps on narrow screens (more so with the house switcher): keep the HUD line under it */
function placeHud() { hud.style.top = Math.round($('top').getBoundingClientRect().bottom + 4) + 'px'; }
function bindRoof() {
  const rp = $('roofp'), liv = $('hLiv'), bed = $('hBed');
  rp.hidden = false;
  rp.title = 'One sloped (mono-pitch) roof, falling ' + (ROOF.axis ? (ROOF.sLiv < ROOF.sBed ? 'north to south' : 'south to north') : (ROOF.sLiv > ROOF.sBed ? 'east to west' : 'west to east')) +
    ' from the living room to the bedrooms. Heights: ceiling above the 2F floor at the outside face of each end wall.';
  liv.value = ROOF.hLiv; bed.value = ROOF.hBed;
  const upd = () => {
    ROOF.hLiv = +liv.value; ROOF.hBed = +bed.value; roofReadout();
    if (_rdPending) return;
    _rdPending = true;
    requestAnimationFrame(() => { _rdPending = false; rebuildRoof(); });
  };
  liv.oninput = upd; bed.oninput = upd;
  for (const el of [liv, bed]) el.addEventListener('keydown', (e) => e.stopPropagation());
  roofReadout(); placeRoofPanel();
  const geo = $('helpGeo');
  if (geo) geo.textContent = 'House 2 is the real plan too (the left-hand house of the same Floor Plan Creator share): 2 floors, 1F ceilings 3.5 m, 37 cm exterior walls, every window, door and the stair as drawn. The 2F sits under one sloped (mono-pitch) roof, high over the living room and falling towards the bedrooms; set the two heights with the Roof sliders. Room names are inferred from the fixtures (the plan has none). Finishes are indicative. Textures, sky and furniture models: Poly Haven (CC0).';
}

/* ------------------------------------------------------------ post + loop */
function setupComposer() {
  const w = innerWidth, h = innerHeight;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtaoPass = new GTAOPass(scene, camera, w, h, undefined, { radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1.0 });
  gtaoPass.blendIntensity = 0.9;
  /* GTAO draws its depth/normal g-buffer with an opaque override material, so
     clear interior glass (shower screens, balustrades) became a solid surface
     there: the AO of the room behind it vanished and a noisy dark halo ran
     round its edges -- a shower screen read as a white slab. Glass doesn't
     occlude: hide it for that pass (restoreVisibility puts it back). */
  const noAO = [];
  scene.traverse(o => { if (o.isMesh && o.material === MAT.glassIn) noAO.push(o); });
  const hideForGBuffer = gtaoPass.overrideVisibility;
  gtaoPass.overrideVisibility = function () { hideForGBuffer.call(this); for (const m of noAO) m.visible = false; };
  composer.addPass(gtaoPass);
  composer.addPass(new OutputPass());
  smaaPass = new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  composer.addPass(smaaPass);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; applyLens();              /* vertical fov follows the aspect */
  placeHud();
  if (HOUSE === 2) placeRoofPanel();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
let last = performance.now();
const EUL = new THREE.Euler(0, 0, 0, 'YXZ');
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!window.__pause) frame(dt);
  requestAnimationFrame(loop);
}
let expo = 0.9;
function indoors() {
  const p = camera.position;
  return LV.some(L => p.y > L.base - 0.3 && p.y < L.base + L.h + 0.2 && L.rooms.some(r => inside(r.poly, p.x, p.z)));
}
function frame(dt) {
  move(dt);
  const target = indoors() ? 1.3 : 0.9;
  expo += (target - expo) * Math.min(1, dt * 2.5);
  renderer.toneMappingExposure = expo;
  const shift = applyLens();                         /* 0 in orbit */
  if (st.orbit) {
    st.az += dt * 0.08;
    camera.position.set(
      ORBIT_T.x + st.rad * Math.cos(st.el) * Math.sin(st.az),
      ORBIT_T.y + st.rad * Math.sin(st.el),
      ORBIT_T.z + st.rad * Math.cos(st.el) * Math.cos(st.az));
    camera.lookAt(ORBIT_T);
  } else {
    EUL.set(st.pitch - shift, st.yaw, 0); camera.quaternion.setFromEuler(EUL);   /* only pitch beyond the shift tilts */
  }
  applyVis(); fadeLabels();
  const p = camera.position;
  hud.textContent = (st.orbit ? 'orbit' : (st.fly ? 'fly' : 'walk · ' + FLOOR_NAMES[st.floor]))
    + '  ·  ' + Math.round(st.fov) + '°';
  if (st.quality && composer) composer.render(dt); else renderer.render(scene, camera);
}

/* -------------------------------------------------------------------- init */
const MARKS = window.__marks = {};
const mark = (k, t0) => { MARKS[k] = Math.round(performance.now() - t0); return performance.now(); };
const texturesReady = new Promise((res) => { LM.onLoad = res; });
if (HOUSE === 2) document.title = 'Kutchan house 2 — 3D walkthrough';
fetch(HOUSE === 2 ? 'plan2.json' : 'plan.json').then(r => r.json()).then(async (plan) => {
  let t = performance.now();
  buildMaterials(); t = mark('materials', t);
  setupLights();
  await Promise.all([setupEnv(), loadModels()]); t = mark('env+models', t);
  buildHouse(plan); t = mark('house', t); _built = true;
  setupComposer(); t = mark('composer', t);
  await Promise.race([texturesReady, new Promise(r => setTimeout(r, 20000))]); t = mark('textures', t);
  console.log('build ms', JSON.stringify(MARKS));
  const a = plan.levels.map(L => L.rooms.reduce((s, r) => s + r.area, 0));
  $('areaInfo').textContent = a.map((v, i) => FLOOR_NAMES[i] + ' ' + v.toFixed(0) + 'm²').join(' · ');
  if ((navigator.hardwareConcurrency || 8) <= 4 || Math.min(screen.width, screen.height) < 500) st.quality = 0;
  bindPad(); bindUI(); resize();
  addEventListener('resize', resize);
  goView(VIEWS[0]);
  setFov(FOV.def);
  Object.assign(window, { FOV, SHIFT, applyLens, frame, move, supportAt, FLOOR_RECTS, THREE, scene, camera, renderer, composer, root, G, LV, STAIRS, COLL, SLIDERS, MAT, GLTF, VIEWS, st, act, goView, applyVis, setFov, blocked, curLevel });
  Object.assign(window, { __house: HOUSE, ROOF, rebuildRoof, roofReadout });
  window.__roofInfo = () => ROOF && { axis: ROOF.axis ? 'z' : 'x', living: ROOF.living, bedrooms: ROOF.bedrooms, delta: ROOF.delta, sBed: ROOF.sBed, sLiv: ROOF.sLiv, hBed: ROOF.hBed, hLiv: ROOF.hLiv, pitch: +ROOF.pitch.toFixed(2), ms: ROOF.ms };
  $('load').style.display = 'none';
  window.__ready = true;
  requestAnimationFrame(loop);
}).catch(e => {
  document.getElementById('load').innerHTML = '<div style="color:#f88">failed to load: ' + e + '</div>';
  console.error(e);
});
