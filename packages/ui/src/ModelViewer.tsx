"use client";

import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { DRACOLoader, type GLTFLoader } from "three-stdlib";

/**
 * The model on a phone.
 *
 * Delivered GLBs are Draco-compressed by the worker, so the decoder is served
 * from /public rather than a CDN — the app has to work behind a job-site
 * firewall and inside a locked-down webview.
 */

const PROCEDURAL = "procedural://framed-room";

function configureDraco(loader: GLTFLoader) {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  loader.setDRACOLoader(draco);
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url, undefined, undefined, configureDraco);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} />;
}

/**
 * Stand-in geometry used when no reconstruction backend is configured. It is a
 * real 16in-on-centre stud wall layout so the viewer, controls, and scale bar
 * can be exercised — it is never presented as a reconstruction of a real house.
 */
function ProceduralRoom() {
  const group = useMemo(() => {
    const g = new THREE.Group();

    const lumber = new THREE.MeshStandardMaterial({ color: "#c8a06a", roughness: 0.85 });
    const plate = new THREE.MeshStandardMaterial({ color: "#b8905c", roughness: 0.9 });

    const roomW = 5.2;
    const roomD = 4.0;
    const wallH = 2.44;
    const spacing = 0.4064; // 16in

    const floor = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.05, roomD), plate);
    floor.position.y = -0.025;
    g.add(floor);

    const studGeo = new THREE.BoxGeometry(0.038, wallH, 0.089);
    const addRun = (length: number, origin: [number, number], axis: "x" | "z") => {
      const count = Math.floor(length / spacing) + 1;
      for (let i = 0; i < count; i++) {
        const stud = new THREE.Mesh(studGeo, lumber);
        const offset = i * spacing - length / 2;
        if (axis === "x") {
          stud.position.set(offset, wallH / 2, origin[1]);
        } else {
          stud.rotation.y = Math.PI / 2;
          stud.position.set(origin[0], wallH / 2, offset);
        }
        g.add(stud);
      }
      // Bottom plate and doubled top plate.
      for (const y of [0.02, wallH - 0.06, wallH - 0.02]) {
        const geo =
          axis === "x"
            ? new THREE.BoxGeometry(length, 0.038, 0.089)
            : new THREE.BoxGeometry(0.089, 0.038, length);
        const p = new THREE.Mesh(geo, plate);
        p.position.set(axis === "x" ? 0 : origin[0], y, axis === "x" ? origin[1] : 0);
        g.add(p);
      }
    };

    addRun(roomW, [0, -roomD / 2], "x");
    addRun(roomW, [0, roomD / 2], "x");
    addRun(roomD, [-roomW / 2, 0], "z");
    addRun(roomD, [roomW / 2, 0], "z");

    // Ceiling joists across the short span.
    const joistGeo = new THREE.BoxGeometry(roomW, 0.184, 0.038);
    for (let i = 0; i * spacing <= roomD; i++) {
      const j = new THREE.Mesh(joistGeo, lumber);
      j.position.set(0, wallH + 0.09, i * spacing - roomD / 2);
      g.add(j);
    }

    return g;
  }, []);

  return <primitive object={group} />;
}

export default function ModelViewer({ url, className }: { url: string; className?: string }) {
  const isProcedural = url === PROCEDURAL;

  return (
    <div
      className={className}
      role="img"
      aria-label={
        isProcedural
          ? "Stand-in 3D model of a framed room"
          : "Interactive 3D model of this stage. Drag to orbit, pinch to zoom."
      }
    >
      <Canvas
        camera={{ position: [4.5, 3.2, 5.5], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ touchAction: "none" }}
      >
        {/* Onyx exactly — the canvas has to disappear into the plate around it. */}
        <color attach="background" args={["#16130f"]} />
        <hemisphereLight args={["#fff4e2", "#2b241d", 1.15]} />
        <directionalLight position={[6, 9, 4]} intensity={1.5} castShadow={false} />
        <directionalLight position={[-5, 3, -4]} intensity={0.45} />

        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.15}>
            {isProcedural ? <ProceduralRoom /> : <Model url={url} />}
          </Bounds>
        </Suspense>

        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellThickness={0.6}
          cellColor="#3a322a"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#5c4d3c"
          fadeDistance={26}
          fadeStrength={1.4}
          followCamera={false}
          infiniteGrid
          position={[0, -0.02, 0]}
        />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={0.8}
          maxDistance={40}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  );
}
