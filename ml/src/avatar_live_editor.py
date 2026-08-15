"""Local WebGL avatar viewport for VOZUAL desktop authoring."""

from __future__ import annotations

from pathlib import Path
import tempfile
import sys
import json

import webview


REPO_ROOT = Path(__file__).resolve().parents[2]
THREE_ROOT = REPO_ROOT / "mobile/node_modules/three"


class LiveStateApi:
    def __init__(self, state_path: Path) -> None:
        self.state_path = state_path

    def get_state(self) -> dict[str, object]:
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}


def open_live_avatar(source_avatar: Path, state_path: Path) -> None:
    """Open the authored GLB in a local native WebKit window.

    This is deliberately separate from Blender: Blender exports the final MP4,
    while this viewport is the immediate visual reference for authoring.
    """
    if not source_avatar.is_file():
        raise FileNotFoundError(source_avatar)
    html = f"""<!doctype html><html><body style='margin:0;background:#0d1928'>
<div id='status' style='position:fixed;color:#20d6ce;padding:16px;font:14px Arial'>Cargando avatar 3D…</div>
<script type='module'>
import * as THREE from 'file://{THREE_ROOT}/build/three.module.js';
import {{GLTFLoader}} from 'file://{THREE_ROOT}/examples/jsm/loaders/GLTFLoader.js';
const scene=new THREE.Scene(); scene.background=new THREE.Color('#343936');
const camera=new THREE.PerspectiveCamera(32,innerWidth/innerHeight,.01,100); camera.position.set(0,.1,4);
const renderer=new THREE.WebGLRenderer({{antialias:true}}); renderer.setSize(innerWidth,innerHeight); document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x314053,2.4)); const key=new THREE.DirectionalLight(0xffffff,3); key.position.set(2,4,4); scene.add(key);
let avatar, faceMeshes=[]; function bone(name){{let found; avatar?.traverse(o=>{{if(o.isBone && o.name.toLowerCase().includes(name)) found=o;}});return found;}}
function morph(names,value){{for(const mesh of faceMeshes)for(const name of names){{const index=mesh.morphTargetDictionary[name];if(index!==undefined)mesh.morphTargetInfluences[index]=value;}}}}
function apply(state){{if(!avatar)return; const side=(state.active_hand||'right')==='left'?'l':'r'; const hand=bone('hand.'+side); const forearm=bone('forearm.'+side); const x=Number(state.lateral_cm||0),y=Number(state.height_cm||0),z=Number(state.depth_cm||0); if(hand) hand.rotation.set(y*.045,z*.045,-x*.045); if(forearm) forearm.rotation.set(y*.018,z*.018,-x*.018); morph(['Jaw_Open','jawOpen','Mouth_Drop_Lower','mouthLowerDownLeft','mouthLowerDownRight'],Number(state.jaw_open||0)); morph(['Eye_Wide_L','Eye_Wide_R','eyeWideLeft','eyeWideRight'],Number(state.eye_wide||0)); morph(['Brow_Raise_Inner_L','Brow_Raise_Inner_R','browInnerUp','browOuterUpLeft','browOuterUpRight'],Number(state.brow_raise||0)); document.getElementById('status').textContent=`Avatar 3D · boca:${{Number(state.jaw_open||0).toFixed(2)}} ojos:${{Number(state.eye_wide||0).toFixed(2)}}`;}}
setInterval(()=>window.pywebview?.api?.get_state().then(apply),80);
new GLTFLoader().load('file://{source_avatar.resolve()}', gltf=>{{avatar=gltf.scene;avatar.traverse(o=>{{if(o.isMesh&&o.morphTargetDictionary)faceMeshes.push(o);}});const box=new THREE.Box3().setFromObject(avatar); const size=box.getSize(new THREE.Vector3()); const center=box.getCenter(new THREE.Vector3()); const s=2.1/size.y; avatar.scale.setScalar(s); avatar.position.set(-center.x*s,-center.y*s,-center.z*s); scene.add(avatar); document.getElementById('status').textContent='Avatar 3D · conectado al editor';}}, undefined, error=>document.getElementById('status').textContent='No se pudo cargar el avatar: '+error);
addEventListener('resize',()=>{{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}}); function loop(){{requestAnimationFrame(loop);renderer.render(scene,camera);}}loop();
</script></body></html>"""
    path = Path(tempfile.gettempdir()) / "vozual_live_avatar.html"
    path.write_text(html, encoding="utf-8")
    webview.create_window("VOZUAL — Editor 3D", path.as_uri(), width=1100, height=760, js_api=LiveStateApi(state_path))
    webview.start(gui="cocoa")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: avatar_live_editor.py /path/to/avatar.glb /path/to/state.json")
    open_live_avatar(Path(sys.argv[1]), Path(sys.argv[2]))
