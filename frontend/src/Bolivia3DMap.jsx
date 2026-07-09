// 3D Bolivia: each department extruded in proportion to its sales — height
// AND color encode Bs. Built from the same SVG geometry as the 2D map, so no
// tile servers, API keys or internet needed. Lazy-loaded (three.js is heavy).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import boliviaAdminMapSvg from './assets/bolivia-admin1.svg?raw';

const BASE_DEPTH = 3;
const MAX_EXTRA_DEPTH = 34;

const fillColorFor = (ratio, hasSales) => {
  if (!hasSales) return new THREE.Color(0xdcd6cd);
  const t = Math.max(0, Math.min(1, ratio));
  const start = new THREE.Color(0x1e40af);
  const end = new THREE.Color(0xf97316);
  return start.clone().lerp(end, t);
};

export default function Bolivia3DMap({ featureRows, formatValue }) {
  const mountRef = useRef(null);
  const tooltipRef = useRef(null);
  const featureRowsRef = useRef(featureRows);
  featureRowsRef.current = featureRows;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const width = mount.clientWidth || 640;
    const height = 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 1, 4000);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-220, 320, 260);
    scene.add(sun);

    // Parse the SVG once and extrude each department.
    const group = new THREE.Group();
    const salesById = new Map(
      (featureRowsRef.current || []).map((row) => [row.id, row])
    );
    const loader = new SVGLoader();
    const parsed = loader.parse(boliviaAdminMapSvg);
    const pickables = [];
    for (const path of parsed.paths) {
      const nodeId = path?.userData?.node?.getAttribute?.('id') || '';
      const row = salesById.get(nodeId);
      if (!row) continue;
      const depth = BASE_DEPTH + (row.ratio || 0) * MAX_EXTRA_DEPTH;
      // DoubleSide: the group is Y-flipped below (SVG's Y axis points down,
      // three.js's points up), which inverts face winding.
      const material = new THREE.MeshLambertMaterial({
        color: fillColorFor(row.ratio, row.totalSales > 0),
        side: THREE.DoubleSide
      });
      const sideMaterial = new THREE.MeshLambertMaterial({
        color: fillColorFor(row.ratio, row.totalSales > 0).multiplyScalar(0.72),
        side: THREE.DoubleSide
      });
      for (const shape of SVGLoader.createShapes(path)) {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        const mesh = new THREE.Mesh(geometry, [material, sideMaterial]);
        mesh.userData = { id: row.id, department: row.department, totalSales: row.totalSales };
        group.add(mesh);
        pickables.push(mesh);
      }
    }

    // Center the country, flip Y (SVG grows downward — without this Bolivia
    // renders mirrored/upside-down) and tilt it toward the camera.
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -center.y, 0);
    const pivot = new THREE.Group();
    pivot.add(group);
    pivot.scale.y = -1;
    pivot.rotation.x = -Math.PI / 4.2; // tilt toward the viewer
    scene.add(pivot);

    const size = bounds.getSize(new THREE.Vector3());
    const fitDistance = Math.max(size.x, size.y) * 1.15;
    camera.position.set(0, -fitDistance * 0.28, fitDistance);
    camera.lookAt(0, 0, 0);

    // Hover: raycast → tooltip with department + Bs.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = null;
    const onPointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0] || null;
      const tooltip = tooltipRef.current;
      if (hit) {
        if (hovered && hovered !== hit.object) hovered.material[0].emissive?.setHex(0x000000);
        hovered = hit.object;
        hovered.material[0].emissive?.setHex(0x333333);
        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top - 8}px`;
          tooltip.textContent = `${hit.object.userData.department}: ${formatValue(hit.object.userData.totalSales)}`;
        }
      } else {
        if (hovered) hovered.material[0].emissive?.setHex(0x000000);
        hovered = null;
        if (tooltip) tooltip.style.display = 'none';
      }
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // Gentle oscillation instead of a full spin: the map stays recognizable
    // (north up) at all times.
    let rafId = 0;
    let swaying = true;
    const onPointerDown = () => { swaying = !swaying; };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    const animate = (time) => {
      if (swaying) pivot.rotation.z = Math.sin((time || 0) * 0.0005) * 0.22;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate(0);

    const onResize = () => {
      const w = mount.clientWidth || width;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.dispose();
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else if (obj.material) obj.material.dispose();
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Rebuild when the sales data changes (month switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureRows]);

  return (
    <div className="bolivia3d-wrap" ref={mountRef}>
      <div className="bolivia3d-tooltip" ref={tooltipRef} />
      <div className="bolivia3d-hint">La altura y el color = ventas · toca para pausar el movimiento</div>
    </div>
  );
}
