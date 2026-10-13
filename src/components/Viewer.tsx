import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBoardModel } from '../lib/boardModel';
import type { CaseParts } from '../lib/caseGeometry';
import type { Device } from '../types';

export interface ViewOptions {
  board: boolean;
  base: boolean;
  lid: boolean;
  exploded: boolean;
  dimensions: boolean;
  xray: boolean;
}

interface Props {
  device: Device;
  parts: CaseParts | null;
  view: ViewOptions;
  highlight: string | null;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  lastFitKey: string;
}

export function Viewer({ device, parts, view, highlight }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);

  // One-time scene setup
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.className = 'label-layer';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -140, 110);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(80, -60, 160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#cfe3ff', 0.5);
    fill.position.set(-100, 120, 60);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, '#5b6675', '#39414c');
    grid.rotateX(Math.PI / 2);
    grid.position.z = -0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.position.z = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    const content = new THREE.Group();
    scene.add(content);

    refs.current = { renderer, labels, scene, camera, controls, content, lastFitKey: '' };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.innerHTML = '';
      refs.current = null;
    };
  }, []);

  // Rebuild content whenever inputs change
  useEffect(() => {
    const r = refs.current;
    if (!r || !parts) return;
    const { content } = r;
    disposeChildren(content);

    const L = parts.layout;
    const lift = view.exploded ? Math.max(20, L.totalHeight * 0.9) : 0;

    const caseMat = new THREE.MeshStandardMaterial({
      color: '#e8edf2',
      roughness: 0.55,
      metalness: 0.05,
      transparent: view.xray,
      opacity: view.xray ? 0.35 : 1,
      depthWrite: !view.xray,
      side: THREE.DoubleSide,
    });
    const lidMat = caseMat.clone();
    lidMat.color.set('#f5a524');

    if (view.base) {
      const m = new THREE.Mesh(parts.base, caseMat);
      m.castShadow = m.receiveShadow = !view.xray;
      content.add(m);
      content.add(edges(parts.base));
    }
    if (view.lid) {
      const m = new THREE.Mesh(parts.lid, lidMat);
      m.position.z = lift;
      m.castShadow = m.receiveShadow = !view.xray;
      content.add(m);
      const e = edges(parts.lid);
      e.position.z = lift;
      content.add(e);
    }
    if (view.board && parts.deviceId === device.id) {
      const board = buildBoardModel(device, L.boardOrigin);
      if (view.exploded) board.position.z += lift * 0.45;
      board.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && highlight && mesh.userData.featureId === highlight) {
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          mat.emissive.set('#3b82f6');
          mat.emissiveIntensity = 0.9;
          mesh.material = mat;
        }
      });
      content.add(board);
    }

    if (view.dimensions) {
      addDimension(content, new THREE.Vector3(0, -6, 0), new THREE.Vector3(L.outerLength, -6, 0), `${fmt(L.outerLength)} mm`);
      addDimension(
        content,
        new THREE.Vector3(L.outerLength + 6, 0, 0),
        new THREE.Vector3(L.outerLength + 6, L.outerWidth, 0),
        `${fmt(L.outerWidth)} mm`,
      );
      addDimension(
        content,
        new THREE.Vector3(L.outerLength + 6, -6, 0),
        new THREE.Vector3(L.outerLength + 6, -6, L.totalHeight),
        `${fmt(L.totalHeight)} mm`,
      );
    }

    // Centre the model on the grid
    content.position.set(-L.outerLength / 2, -L.outerWidth / 2, 0);

    // Re-frame the camera only when switching boards, not on every tweak, and
    // only once the geometry for the new board has been built.
    const fitKey = parts.deviceId;
    if (fitKey !== r.lastFitKey) {
      r.lastFitKey = fitKey;
      const radius = Math.hypot(L.outerLength, L.outerWidth, L.totalHeight) / 2;
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(r.camera.fov / 2)) * 1.15;
      const dir = new THREE.Vector3(0.55, -0.75, 0.6).normalize();
      r.controls.target.set(0, 0, L.totalHeight / 2);
      r.camera.position.copy(dir.multiplyScalar(dist)).add(r.controls.target);
      r.controls.update();
    }
  }, [device, parts, view, highlight]);

  return <div className="viewer" ref={host} />;
}

const fmt = (n: number) => n.toFixed(1);

function edges(g: THREE.BufferGeometry) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(g, 25),
    new THREE.LineBasicMaterial({ color: '#334155', transparent: true, opacity: 0.55 }),
  );
}

function addDimension(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, text: string) {
  const mat = new THREE.LineBasicMaterial({ color: '#38bdf8' });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat);
  parent.add(line);
  const dir = b.clone().sub(a).normalize();
  // perpendicular tick marks
  const perp = Math.abs(dir.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  for (const p of [a, b]) {
    const t = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(perp, -2), p.clone().addScaledVector(perp, 2)]),
      mat,
    );
    parent.add(t);
  }
  const div = document.createElement('div');
  div.className = 'dim-label';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.copy(a.clone().add(b).multiplyScalar(0.5));
  parent.add(label);
}

function disposeChildren(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
      const m = o as THREE.Mesh;
      // Case geometries are owned by the parent component; only free what we made here.
      if (m.isMesh && m.parent?.type === 'Group' && m.parent !== group) m.geometry.dispose();
      if ((o as THREE.LineSegments).isLineSegments || (o as THREE.Line).isLine) (o as THREE.Line).geometry.dispose();
    });
  }
}
