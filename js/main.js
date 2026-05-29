import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';


const renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects( [ bloomPass ] );

document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 3 );
dirLight.position.set( 11.4, 15, -5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.radius = 4;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 2 );
hemiLight.position.copy( dirLight.position )
scene.add( hemiLight );


window.addEventListener( 'resize', () => {

	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const loader = new ColorMapGLTFLoader();

const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];

const models = {};

async function loadModels() {

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				const meshes = [];
				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;
						meshes.push( child );

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.5 );

				}

				if ( meshes.length === 1 ) {

					const mesh = meshes[ 0 ];
					mesh.removeFromParent();
					models[ name ] = mesh;

				} else {

					models[ name ] = gltf.scene;

				}

				resolve();

			}, undefined, reject );

		} )
	);

	await Promise.all( promises );

}

async function init() {

	registerAll();
	await loadModels();

	const mapParam = new URLSearchParams( window.location.search ).get( 'map' );
	let customCells = null;
	let spawn = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	// Compute track bounds and size physics/shadows to fit
	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	const shadowExtent = Math.max( hw, hd ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	buildTrack( scene, models, customCells );

	// Probes

	const probeHeight = 6;
	const probes = new LightProbeGrid(
		hw * 2, probeHeight, hd * 2,
		Math.max( 4, Math.round( hw / 4 ) ),
		2,
		Math.max( 4, Math.round( hd / 4 ) ),
	);
	probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
	probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
	scene.add( probes );

	// scene.add( new LightProbeGridHelper( probes, 0.5 ) );

	//

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	const vehicles = {};
	let mainVehicle = null;

	window.addPlayerToGame = (id, color) => {
		const sb = createSphereBody( world, spawn ? spawn.position : null );
		const v = new Vehicle();
		v.rigidBody = sb;
		v.physicsWorld = world;
		if ( spawn ) {
			const [ sx, sy, sz ] = spawn.position;
			const offset = Object.keys(vehicles).length * 2;
			v.spherePos.set( sx + offset, sy, sz );
			v.prevModelPos.set( sx + offset, 0, sz );
			v.container.rotation.y = spawn.angle;
		}

		const colorToModelMap = {
			'#fbbf24': 'vehicle-truck-yellow',
			'#22c55e': 'vehicle-truck-green',
			'#a855f7': 'vehicle-truck-purple',
			'#ef4444': 'vehicle-truck-red'
		};
		const m = colorToModelMap[color] || 'vehicle-truck-yellow';
		const vg = v.init( models[ m ] );
		scene.add( vg );
		
		const vCam = new Camera();
		vehicles[id] = { vehicle: v, group: vg, body: sb, camera: vCam };

		if (!mainVehicle) mainVehicle = v;
	};

	window.removePlayerFromGame = (id) => {
		if (vehicles[id]) {
			scene.remove(vehicles[id].group);
			delete vehicles[id];
			if (mainVehicle === vehicles[id]?.vehicle) {
				const keys = Object.keys(vehicles);
				mainVehicle = keys.length > 0 ? vehicles[keys[0]].vehicle : null;
			}
		}
	};

	const defaultCam = new Camera();

	const controls = new Controls();

	const particles = new SmokeTrails( scene );
	const driftMarks = new DriftMarks( scene, mapParam );

	const audio = new GameAudio();
	audio.init( defaultCam.camera );

	const lapTimer = new LapTimer( customCells, mapParam );

	const _forward = new THREE.Vector3();
	const _camLead = new THREE.Vector3();

	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			let involvedVehicle = null;
			for (const id in vehicles) {
				if (bodyA === vehicles[id].body || bodyB === vehicles[id].body) {
					involvedVehicle = vehicles[id].vehicle;
					break;
				}
			}
			if (!involvedVehicle) return;

			_forward.set( 0, 0, 1 ).applyQuaternion( involvedVehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( involvedVehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

		}
	};

	const timer = new THREE.Timer();

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const input = controls.update();

		updateWorld( world, contactListener, dt );

		for (const id in vehicles) {
			const v = vehicles[id].vehicle;
			const pInput = (window.playerInputs && window.playerInputs[id]) ? window.playerInputs[id] : { x: 0, z: 0 };
			v.update(dt, pInput);
		}

		if (mainVehicle) {
			dirLight.position.set( mainVehicle.spherePos.x + 11.4, 15, mainVehicle.spherePos.z - 5.3 );
			dirLight.target = vehicles[Object.keys(vehicles)[0]].group;

			particles.update( dt, mainVehicle );
			driftMarks.update( dt, mainVehicle );
			
			const firstId = Object.keys(vehicles)[0];
			const pInputZ = firstId && window.playerInputs[firstId] ? window.playerInputs[firstId].z : 0;
			audio.update( dt, mainVehicle.linearSpeed / MAX_SPEED, pInputZ, mainVehicle.driftIntensity );

			lapTimer.update( dt, mainVehicle.spherePos, true );
		}

		const playerIds = Object.keys(vehicles);
		const playerCount = playerIds.length;

		if (playerCount === 0) {
			renderer.setScissorTest(false);
			renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
			renderer.render(scene, defaultCam.camera);
		} else {
			renderer.setScissorTest(true);
			playerIds.forEach((id, index) => {
				const pInfo = vehicles[id];
				const v = pInfo.vehicle;
				const vCam = pInfo.camera;

				const mv = v.modelVelocity;
				_camLead.set( 0, 0, 1 ).applyQuaternion( v.container.quaternion ).multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
				vCam.update( dt, v.spherePos, _camLead );

				if (index === 0) {
					defaultCam.camera.position.copy(vCam.camera.position);
					defaultCam.camera.quaternion.copy(vCam.camera.quaternion);
				}

				const w = window.innerWidth;
				const h = window.innerHeight;
				let vx, vy, vw, vh;

				if (playerCount === 1) {
					vx = 0; vy = 0; vw = w; vh = h;
				} else if (playerCount === 2) {
					vw = Math.floor(w / 2); vh = h;
					vx = index === 0 ? 0 : vw;
					vy = 0;
				} else {
					vw = Math.floor(w / 2); vh = Math.floor(h / 2);
					vx = (index % 2) === 0 ? 0 : vw;
					vy = index < 2 ? vh : 0;
				}

				renderer.setViewport(vx, vy, vw, vh);
				renderer.setScissor(vx, vy, vw, vh);
				vCam.camera.aspect = vw / vh;
				vCam.camera.updateProjectionMatrix();

				renderer.render(scene, vCam.camera);
			});
			renderer.setScissorTest(false);
		}

	}

	animate();

}

init();
