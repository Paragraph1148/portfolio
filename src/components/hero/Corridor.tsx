import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, PerspectiveCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
   The road is the deck and the road users are keycaps sitting on
   it. Scroll runs the planner's own pipeline in order — the seven
   layer names are the toggles in Sarathi's Layers panel, not
   invented for the page.

   Everything mounts once and animates by mutating materials and
   transforms inside useFrame. Re-rendering React sixty times a
   second would rebuild this whole tree every frame.
   ──────────────────────────────────────────────────────────────── */

export const STAGES = [
  ["Ground truth", "Bodies only. No labels, no classes — the world as it is."],
  ["Perceived tracks", "Camera, LiDAR and radar fused into Kalman tracks. Some are wrong."],
  ["Prediction cones", "A manoeuvre distribution per body, clamped to what it can reach."],
  ["Risk field", "Continuous, class-conditioned, harm-weighted. Not an occupancy grid."],
  ["Derived reference", "A dynamic program over free space. This is what replaces the lane."],
  ["Candidate fan", "198 jerk-minimal candidates in the corridor's Frenet frame."],
  ["Chosen trajectory", "One line survives. Telemetry populates. 46 ms."],
] as const;

type Agent = { x: number; z: number; kind: "vehicle" | "vulnerable"; w: number; d: number };

/* A fixed cast, so every scroll down the page shows the same scene. */
const AGENTS: Agent[] = [
  { x: -2.1, z: -4, kind: "vehicle", w: 1.0, d: 2.2 },
  { x: 1.5, z: -8, kind: "vulnerable", w: 0.5, d: 0.6 },
  { x: -0.9, z: -13, kind: "vehicle", w: 1.1, d: 2.6 },
  { x: 2.4, z: -17, kind: "vulnerable", w: 0.46, d: 0.5 },
  { x: -2.6, z: -21, kind: "vehicle", w: 1.0, d: 2.0 },
  { x: 0.8, z: -25, kind: "vulnerable", w: 0.5, d: 0.6 },
  { x: -1.4, z: -30, kind: "vehicle", w: 1.05, d: 2.4 },
  { x: 2.0, z: -35, kind: "vulnerable", w: 0.46, d: 0.5 },
];
const VULNERABLE = AGENTS.filter((a) => a.kind === "vulnerable");

const EGO = { x: 0.2, z: 2.4, w: 1.05, d: 2.3 };
const CAP_H = 0.34;
const FAN_COUNT = 34;
const REACH = 38;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Reveal amount for stage `k` (1-based) given a float stage cursor. */
const at = (cursor: number, k: number) => easeOut(clamp01(cursor - (k - 1)));

type Palette = {
  deck: string;
  fog: string;
  ego: string;
  vehicle: string;
  vulnerable: string;
  accent: string;
  amber: string;
  dim: string;
  faint: string;
  key: number;
  ambient: number;
  dark: boolean;
};

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  const ambient = parseFloat(v("--scene-ambient")) || 1;
  return {
    deck: v("--scene-deck") || "#cbc7bc",
    fog: v("--scene-fog") || "#dedbd3",
    ego: v("--scene-ego") || "#17171a",
    vehicle: v("--scene-vehicle") || "#3987e5",
    vulnerable: v("--scene-vulnerable") || "#199e70",
    accent: v("--accent") || "#c0271f",
    amber: v("--amber") || "#9a5a00",
    dim: v("--legend-dim") || "#6e6a61",
    faint: v("--legend-faint") || "#969186",
    key: parseFloat(v("--scene-key")) || 2,
    ambient,
    dark: ambient < 0.9,
  };
}

/** A soft round falloff, drawn once and shared by every risk blob. */
function useFalloff() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.45, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

/** A flat triangle on the deck — a manoeuvre cone, not a 3D cone. */
function useConeGeometry() {
  return useMemo(() => {
    const g = new THREE.BufferGeometry();
    const spread = 1.5;
    const reach = 5.2;
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, -spread, 0, -reach, spread, 0, -reach], 3)
    );
    g.computeVertexNormals();
    return g;
  }, []);
}

type LineLike = THREE.Object3D & { material: THREE.Material & { opacity: number } };

/* drei's <Line> spreads its extra props onto BOTH the Line2 and its
   LineMaterial, and THREE.Material has its own `visible`. Passing
   visible={false} therefore pins the material hidden for good, and
   un-hiding the Line2 from a ref does nothing. Drive Line visibility
   from useFrame only — never as a prop. */

function Scene({
  progress,
  palette,
  onStage,
}: {
  progress: React.RefObject<number>;
  palette: Palette;
  onStage: (n: number) => void;
}) {
  const smoothed = useRef(0);
  const lastStage = useRef(0);
  const falloff = useFalloff();
  const coneGeo = useConeGeometry();
  const cam = useRef<THREE.PerspectiveCamera>(null);

  const bodies = useRef<(THREE.Group | null)[]>([]);
  const bodyMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const trackMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const cones = useRef<(THREE.Mesh | null)[]>([]);
  const riskMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const edges = useRef<(LineLike | null)[]>([]);
  const fanGroup = useRef<THREE.Group>(null);
  const fanLines = useRef<(LineLike | null)[]>([]);
  const chosen = useRef<LineLike | null>(null);

  /* Candidate trajectories: lateral offsets sampled inside the reachable
     set, each smoothstepped out from the ego to the horizon. */
  const fan = useMemo(() => {
    const paths: THREE.Vector3[][] = [];
    for (let i = 0; i < FAN_COUNT; i++) {
      const lat = (i / (FAN_COUNT - 1) - 0.5) * 5.6;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const ease = s * s * (3 - 2 * s);
        pts.push(new THREE.Vector3(EGO.x + lat * ease, 0.06, EGO.z - s * REACH));
      }
      paths.push(pts);
    }
    return paths;
  }, []);

  /* The one that survives: pulls out around the stopped bus, comes back. */
  const chosenPath = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 1.0001; s += 0.025) {
      const lat = -1.85 * Math.sin(Math.PI * Math.min(1, s * 1.25));
      pts.push(new THREE.Vector3(EGO.x + lat, 0.15, EGO.z - s * REACH));
    }
    return pts;
  }, []);

  const [edgeL, edgeR] = useMemo(() => {
    const build = (side: number) => {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 1.0001; s += 0.04) {
        const drift = Math.sin(s * 2.6) * 0.7;
        pts.push(new THREE.Vector3(EGO.x + drift + side * 1.85, 0.04, EGO.z - s * 40));
      }
      return pts;
    };
    return [build(-1), build(1)];
  }, []);

  useFrame((_, delta) => {
    const target = progress.current ?? 0;
    // Framerate-independent follow, so the flow feels the same at 60 and 144.
    smoothed.current += (target - smoothed.current) * (1 - Math.pow(0.0016, delta));
    const cursor = smoothed.current * 7;

    const stage = Math.min(7, Math.max(1, Math.ceil(cursor - 0.001) || 1));
    if (stage !== lastStage.current) {
      lastStage.current = stage;
      onStage(stage);
    }

    const rArrive = at(cursor, 1);
    const rTrack = at(cursor, 2);
    const rCone = at(cursor, 3);
    const rRisk = at(cursor, 4);
    const rCorr = at(cursor, 5);
    const rFan = at(cursor, 6);
    const rChosen = at(cursor, 7);

    if (cam.current) {
      // High and back: the road reads as a deck seen at a rake, and the
      // ego stays a keycap on it rather than filling the frame.
      cam.current.position.set(
        3.2 - smoothed.current * 1.1,
        7.4 - smoothed.current * 1.7,
        19.5 - smoothed.current * 4.2
      );
      cam.current.lookAt(-0.6, 0.1, -12 - smoothed.current * 2);
    }

    // 1 — bodies converge from off the sides, the way cardboard's
    // thumbnails start outside the viewport before they land.
    AGENTS.forEach((a, i) => {
      const g = bodies.current[i];
      if (g) {
        g.position.x = a.x + (1 - rArrive) * (a.x < 0 ? -15 : 15);
        g.position.y = (1 - rArrive) * 2.4;
      }
      const m = bodyMats.current[i];
      if (m) m.opacity = rArrive;

      // 2 — the box the tracker draws round each body
      const t = trackMeshes.current[i];
      if (t) {
        t.visible = rTrack > 0.002;
        (t.material as THREE.MeshBasicMaterial).opacity = 0.42 * rTrack;
      }

      // 4 — risk, as light under the deck
      const r = riskMeshes.current[i];
      if (r) {
        r.visible = rRisk > 0.002;
        (r.material as THREE.MeshBasicMaterial).opacity =
          (a.kind === "vulnerable" ? 0.5 : 0.36) * rRisk;
      }
    });

    // 3 — prediction cones grow out of the vulnerable bodies
    VULNERABLE.forEach((_a, i) => {
      const c = cones.current[i];
      if (!c) return;
      c.visible = rCone > 0.002;
      c.scale.set(rCone, 1, rCone);
      (c.material as THREE.MeshBasicMaterial).opacity = 0.34 * rCone;
    });

    // 5 — the corridor
    edges.current.forEach((e) => {
      if (!e) return;
      e.visible = rCorr > 0.002;
      e.material.opacity = 0.55 * rCorr;
    });

    // 6 — the fan sprays forward, then dims when one is chosen
    if (fanGroup.current) {
      const grow = 0.25 + 0.75 * rFan;
      fanGroup.current.visible = rFan > 0.002;
      fanGroup.current.scale.z = grow;
      fanGroup.current.position.z = EGO.z * (1 - grow);
    }
    fanLines.current.forEach((l, i) => {
      if (!l) return;
      const rejected = i % 7 === 0;
      l.material.opacity = (rejected ? 0.1 : 0.3) * rFan * (1 - 0.62 * rChosen);
    });

    // 7 — the one that survives
    if (chosen.current) {
      chosen.current.visible = rChosen > 0.002;
      chosen.current.material.opacity = rChosen;
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cam} makeDefault fov={30} near={0.1} far={110} position={[3.2, 7.4, 19.5]} />
      <fog attach="fog" args={[palette.fog, 26, 72]} />

      <ambientLight intensity={palette.ambient} />
      <directionalLight position={[-6, 9, 6]} intensity={palette.key} />
      <directionalLight position={[7, 4, -6]} intensity={palette.key * 0.28} />

      {/* the deck */}
      <mesh position={[0, -0.2, -22]}>
        <boxGeometry args={[11, 0.4, 78]} />
        <meshStandardMaterial color={palette.deck} roughness={0.94} metalness={0.02} />
      </mesh>

      {/* 4 — risk field */}
      {AGENTS.map((a, i) => {
        const r = a.kind === "vulnerable" ? 7.4 : 5.6;
        return (
          <mesh
            key={`risk-${i}`}
            ref={(el) => void (riskMeshes.current[i] = el)}
            position={[a.x, 0.015, a.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
            renderOrder={0}
          >
            <planeGeometry args={[r, r]} />
            <meshBasicMaterial
              map={falloff}
              color={palette.accent}
              transparent
              opacity={0}
              depthWrite={false}
              blending={palette.dark ? THREE.AdditiveBlending : THREE.NormalBlending}
            />
          </mesh>
        );
      })}

      {/* 5 — the corridor, what replaces the lane centreline */}
      {[edgeL, edgeR].map((pts, i) => (
        <Line
          key={`edge-${i}`}
          ref={(el: LineLike | null) => void (edges.current[i] = el)}
          points={pts}
          color={palette.dim}
          lineWidth={1.4}
          transparent
          opacity={0}
          dashed
          dashSize={0.5}
          gapSize={0.4}
        />
      ))}

      {/* 3 — prediction cones */}
      {VULNERABLE.map((a, i) => (
        <mesh
          key={`cone-${i}`}
          ref={(el) => void (cones.current[i] = el)}
          geometry={coneGeo}
          position={[a.x, 0.03, a.z]}
          visible={false}
          renderOrder={1}
        >
          <meshBasicMaterial
            color={palette.vulnerable}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* 6 — the candidate fan */}
      <group ref={fanGroup} visible={false}>
        {fan.map((pts, i) => (
          <Line
            key={`fan-${i}`}
            ref={(el: LineLike | null) => void (fanLines.current[i] = el)}
            points={pts}
            color={i % 7 === 0 ? palette.faint : palette.dim}
            lineWidth={1.1}
            transparent
            opacity={0}
          />
        ))}
      </group>

      {/* 7 — the one that survives */}
      <Line
        ref={(el: LineLike | null) => void (chosen.current = el)}
        points={chosenPath}
        color={palette.amber}
        lineWidth={4.2}
        transparent
        opacity={0}
      />

      {/* 1 & 2 — the road users, and the boxes the tracker draws */}
      {AGENTS.map((a, i) => (
        <group key={`a-${i}`} ref={(el) => void (bodies.current[i] = el)} position={[a.x, 0, a.z]}>
          <RoundedBox args={[a.w, CAP_H, a.d]} radius={0.07} smoothness={3} position={[0, CAP_H / 2, 0]}>
            <meshStandardMaterial
              ref={(el: THREE.MeshStandardMaterial | null) => void (bodyMats.current[i] = el)}
              color={a.kind === "vehicle" ? palette.vehicle : palette.vulnerable}
              roughness={0.72}
              metalness={0.03}
              transparent
              opacity={0}
            />
          </RoundedBox>

          <mesh ref={(el) => void (trackMeshes.current[i] = el)} position={[0, CAP_H / 2 + 0.02, 0]} visible={false}>
            <boxGeometry args={[a.w + 0.46, CAP_H + 0.34, a.d + 0.46]} />
            <meshBasicMaterial color={palette.dim} wireframe transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/* the ego — an ink keycap. Red belongs to the risk field, not to us. */}
      <RoundedBox
        args={[EGO.w, CAP_H, EGO.d]}
        radius={0.07}
        smoothness={3}
        position={[EGO.x, CAP_H / 2, EGO.z]}
      >
        <meshStandardMaterial color={palette.ego} roughness={0.6} metalness={0.05} />
      </RoundedBox>
    </>
  );
}

export default function Corridor() {
  const progress = useRef(0);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [stage, setStage] = useState(1);

  useEffect(() => {
    setPalette(readPalette());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => setPalette(readPalette());
    mq.addEventListener("change", onTheme);
    return () => mq.removeEventListener("change", onTheme);
  }, []);

  useEffect(() => {
    const track = document.getElementById("hero-track");
    if (!track) return;
    const read = () => {
      const r = track.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      progress.current = span > 0 ? clamp01(-r.top / span) : 0;
      // Published so CSS can react without React re-rendering — the hero
      // copy clears out of the frame as the pipeline assembles.
      track.style.setProperty("--p", progress.current.toFixed(4));
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  if (!palette) return null;

  return (
    <>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Scene progress={progress} palette={palette} onStage={setStage} />
      </Canvas>

      <div className="hero__hud">
        <span className="hero__idx">{stage}/7</span>
        <span className="hero__stage">{STAGES[stage - 1][0]}</span>
        <span className="hero__ticks" aria-hidden="true">
          {STAGES.map((_, i) => (
            <i key={i} className={i < stage ? "on" : ""} />
          ))}
        </span>
        <p className="hero__what">{STAGES[stage - 1][1]}</p>
      </div>
    </>
  );
}
