import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GUI } from 'dat.gui'; // Import dat.GUI

// Firebase SDK & Auth Configuration
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCZl5JdTHrEdJPUKTwnWV2NrO2PWWqYdWg",
  authDomain: "misterios-innova.firebaseapp.com",
  projectId: "misterios-innova",
  storageBucket: "misterios-innova.firebasestorage.app",
  messagingSenderId: "33121826124",
  appId: "1:33121826124:web:c110f50b9bcebceec3cbe9",
  measurementId: "G-MH7V9XP03Z"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

// Global user state variables
let currentUser = null;
let isAdminUser = false;
const ADMIN_EMAIL = "sanjuanazuara@gmail.com";

// Levels and Difficulty State
let currentLevel = 1;
let maxReachedLevel = 1;
let zombieTransformTimeout = null;

// Mobile Device Detection
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

//================================================================
// Levels & Difficulty System Logic
//================================================================
function applyLevelDifficulty(level) {
  currentLevel = level;
  const hudNum = document.getElementById('hud-level-number');
  const vicNum = document.getElementById('victory-level-num');
  if (hudNum) hudNum.textContent = level;
  if (vicNum) vicNum.textContent = level;
  
  const t = (level - 1) / 19; // 0 to 1 scaling
  
  // Water rise speed: 0.03 to 0.22
  waterRiseSpeed = 0.03 + t * 0.19;
  
  // Zombie speed multiplier: 0.7 to 2.2
  zombieMoveSpeedMultiplier = 0.7 + t * 1.5;
  
  // Fog density: 0.015 to 0.075
  fogDensity = 0.015 + t * 0.06;
  if (scene && scene.fog) {
    scene.fog.density = fogDensity;
  }
  
  // Update next level info text
  const nextDificultad = document.getElementById('next-level-dificultad');
  if (nextDificultad) {
    if (level < 20) {
      nextDificultad.textContent = `Nivel ${level + 1}: +Niebla, +Velocidad de Inundación, +Velocidad del Monstruo`;
    } else {
      nextDificultad.textContent = '¡Has completado todos los niveles de Misterios Innova!';
    }
  }
}

function triggerLevelComplete() {
  gameOverState = true; // Pause updates
  if (pointerLockControls && pointerLockControls.unlock) {
    pointerLockControls.unlock();
  }
  
  // Save progress in Firebase Firestore
  if (currentUser) {
    const userDocRef = doc(db, "users", currentUser.uid);
    if (currentLevel === maxReachedLevel && currentLevel < 20) {
      maxReachedLevel = currentLevel + 1;
      setDoc(userDocRef, { highestLevel: maxReachedLevel }, { merge: true })
        .then(() => console.log("Progress saved in Firebase!"))
        .catch((err) => console.error("Error saving progress:", err));
    }
  }
  
  // Show UI
  const victoryScreen = document.getElementById('victory-screen');
  if (victoryScreen) {
    victoryScreen.style.display = 'flex';
    victoryScreen.style.opacity = 1;
  }
  
  const victoryTitle = document.getElementById('victory-title');
  const victoryNextBtn = document.getElementById('victory-next-btn');
  if (victoryTitle && victoryNextBtn) {
    if (currentLevel >= 20) {
      victoryTitle.textContent = '¡CAMPAÑA COMPLETADA!';
      victoryNextBtn.textContent = 'REINICIAR JUEGO';
    } else {
      victoryTitle.textContent = '¡NIVEL COMPLETADO!';
      victoryNextBtn.textContent = 'SIGUIENTE NIVEL';
    }
  }
}

function rebuildCollisionBoxes() {
  if (typeof wallBoundingBoxes !== 'undefined' && typeof walls !== 'undefined') {
    wallBoundingBoxes.length = 0;
    walls.forEach(wall => {
      if (wall) {
        const box = new THREE.Box3().setFromObject(wall);
        wallBoundingBoxes.push(box);
      }
    });
  }
}

function startZombieTimer() {
  if (zombieTransformTimeout) clearTimeout(zombieTransformTimeout);
  zombieTransformTimeout = setTimeout(() => {
    if (zombie && !gameOverState) {
      const savedPosition = zombie.position.clone();
      loadZombieModel(
        '/images/models/Running Crawl.fbx.glb',
        [0.090, 0.090, 0.090],
        savedPosition,
        3.5,
        2.0,
        null,
        true
      );
    }
  }, 20000);
}

function resetSceneForNextLevel() {
  // 1. Reset player position and velocity
  camera.position.set(39, 5, -21);
  if (controls) {
    controls.velocity.set(0, 0, 0);
    controls.isStanding = true;
  }
  
  // 2. Reset water height
  water.position.y = -50;
  if (water1) {
    water1.position.y = 21.7;
  }
  waterRising = true;
  
  // 3. Reset access card (keyObject)
  hasKey = false;
  hasUsedKey = false;
  if (keyObject) {
    if (keyObject.parent === camera) {
      camera.remove(keyObject);
    }
    // Only add if not already in scene
    let inScene = false;
    scene.traverse(child => {
      if (child === keyObject) inScene = true;
    });
    if (!inScene) {
      scene.add(keyObject);
    }
    keyObject.position.set(35, 4, 30);
    keyObject.scale.set(0.4, 0.4, 0.4);
    keyObject.visible = true;
  }
  const keyHUD = document.getElementById('key-image-container');
  if (keyHUD) keyHUD.style.display = 'none';
  
  // 4. Reset doors
  doorOpen = false;
  deviceInteracted = false;
  enteredPassword = "";
  if (door) {
    door.position.set(24, 4, 44);
  }
  if (texturedPasswordDoor) {
    texturedPasswordDoor.position.set(23, 7, -42);
  }
  
  // Re-add closed doors to wallBoundingBoxes
  rebuildCollisionBoxes();
  
  // 5. Reset zombie position and reload first model (female walk)
  if (zombie) {
    // Stop all action on zombie mix if exists
    if (mixer) mixer.stopAllAction();
    // Remove zombie from scene
    scene.remove(zombie);
    zombie = null;
  }
  zombieState = "patrolling";
  zombieStuckTimer = 0;
  
  loadZombieModel(
    '/images/models/exaggerated_female_walk.glb',
    [4, 5, 3],
    new THREE.Vector3(0, 5, 0),
    1.5,
    1.0,
    () => {
      console.log('Level zombie reset!');
      startZombieTimer(); // Reset the 20s transformer timer
    }
  );
  
  // 6. Reset Game Over state
  gameOverState = false;
  
  // 7. Lock controls
  if (pointerLockControls && !isMobile) {
    pointerLockControls.lock();
  }
}



// Global controls and sound variables
let pointerLockControls = null;
const zombieSound1 = new Audio('/sounds/Snake Hiss _ Sound Effect(MP3_160K).mp3');
zombieSound1.loop = true;
const zombieSound2 = new Audio('/sounds/Snake (Hiss) - Sound Effect _ ProSounds(MP3_160K).mp3');
zombieSound2.loop = true;

// Global collision variables (moved to avoid Temporal Dead Zone / hoisting issues)
const wallBoundingBoxes = [];
const zombieWallBoxes = [];
const modelBoundingBoxes = [];

// Firebase Auth state observer and event listeners
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    isAdminUser = (user.email === ADMIN_EMAIL);
    
    // Set Profile HUD UI
    document.getElementById('user-avatar').src = user.photoURL || 'https://www.gravatar.com/avatar/?d=mp';
    document.getElementById('user-display-name').textContent = user.displayName || user.email;
    const roleLabel = document.getElementById('user-role-label');
    
    if (isAdminUser) {
      roleLabel.textContent = 'ADMINISTRADOR';
      roleLabel.className = 'user-role admin';
      // Show admin features if not mobile
      if (!isMobile) {
        document.getElementById('editModeBtn').style.display = 'inline-block';
        const guiContainer = document.querySelector('.dg.ac');
        if (guiContainer) guiContainer.style.display = 'block';
      } else {
        document.getElementById('editModeBtn').style.display = 'none';
      }
    } else {
      roleLabel.textContent = 'Jugador';
      roleLabel.className = 'user-role';
      // Hide admin features
      document.getElementById('editModeBtn').style.display = 'none';
      const guiContainer = document.querySelector('.dg.ac');
      if (guiContainer) guiContainer.style.display = 'none';
    }
    
    // Load level progress from Firebase Firestore
    const userDocRef = doc(db, "users", user.uid);
    getDoc(userDocRef).then((docSnap) => {
      if (docSnap.exists()) {
        maxReachedLevel = docSnap.data().highestLevel || 1;
      } else {
        maxReachedLevel = 1;
        setDoc(userDocRef, { highestLevel: 1 });
      }
      applyLevelDifficulty(maxReachedLevel);
      document.getElementById('level-indicator-hud').style.display = 'block';
    }).catch(err => {
      console.error("Error reading progress:", err);
      applyLevelDifficulty(1);
      document.getElementById('level-indicator-hud').style.display = 'block';
    });
    
    if (isMobile) {
      document.getElementById('controls').style.display = 'none';
      document.getElementById('mobile-controls-layer').style.display = 'block';
    } else {
      document.getElementById('firstPersonBtn').style.display = 'inline-block';
      document.getElementById('controls').style.display = 'flex';
    }
    
    document.getElementById('user-profile-hud').style.display = 'flex';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('webgl-container').style.display = 'block';
  } else {
    currentUser = null;
    isAdminUser = false;
    stopAmbientAudio(); // Custom function to pause all playing loop audios
    
    document.getElementById('user-profile-hud').style.display = 'none';
    document.getElementById('level-indicator-hud').style.display = 'none';
    document.getElementById('mobile-controls-layer').style.display = 'none';
    document.getElementById('controls').style.display = 'none';
    document.getElementById('webgl-container').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    
    // Hide dat.GUI for unauthenticated
    const guiContainer = document.querySelector('.dg.ac');
    if (guiContainer) guiContainer.style.display = 'none';
    
    // Unlock pointer controls if active
    if (pointerLockControls && pointerLockControls.isLocked) {
      pointerLockControls.unlock();
    }
  }
});

// Setup click handlers for login and logout
document.getElementById('google-login-btn').addEventListener('click', () => {
  const errorMsg = document.getElementById('login-error-msg');
  const statusMsg = document.getElementById('login-status-msg');
  errorMsg.style.display = 'none';
  statusMsg.style.display = 'block';
  statusMsg.textContent = 'Conectando con Google...';
  
  signInWithPopup(auth, googleProvider)
    .then((result) => {
      statusMsg.textContent = '¡Sesión iniciada con éxito!';
      setTimeout(() => {
        statusMsg.style.display = 'none';
      }, 1000);
    })
    .catch((error) => {
      console.error("Firebase Login error:", error);
      statusMsg.style.display = 'none';
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Error al iniciar sesión: ' + error.message;
    });
});

document.getElementById('logout-hud-btn').addEventListener('click', () => {
  signOut(auth).catch((error) => {
    console.error("Firebase Signout error:", error);
  });
});



// Import custom object creation functions


  
// Define boundary limits for player movement
const boundaryMinX = -50; // Minimum X boundary
const boundaryMaxX = 50;  // Maximum X boundary
const boundaryMinY = 0;   // Minimum Y boundary (ground level)
const boundaryMaxY = 10;  // Maximum Y boundary (height limit)
const boundaryMinZ = -50; // Minimum Z boundary
const boundaryMaxZ = 50;  // Maximum Z boundary




function checkPlayerBounds(playerPosition) {
  if (playerPosition.x < boundaryMinX || playerPosition.x > boundaryMaxX ||
      playerPosition.y < boundaryMinY || playerPosition.y > boundaryMaxY ||
      playerPosition.z < boundaryMinZ || playerPosition.z > boundaryMaxZ) {
    resetPlayerPosition();
  }
}

function resetPlayerPosition() {
  // Set the player's position to a safe location
  camera.position.set(39, -1,-21); // Example reset position
  console.log("You have been reset to a safe location!"); // Console message
}
//================================================================
// Scene Setup
//================================================================



const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff); // Default background color
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('webgl-container').appendChild(renderer.domElement);


const textureLoader = new THREE.TextureLoader();

//================================================================
// Fog Setup
//================================================================
let fogDensity = 0.08; // Adjusted density for fog
let fogColor = new THREE.Color(0x000000); // Set initial fog color (black)
scene.fog = new THREE.FogExp2(fogColor, fogDensity); // Exponential fog (color, density)



//================================================================
// Lighting Setup
//================================================================
const ambientLight = new THREE.AmbientLight(0xffffff, 0.1); // Ambient light to illuminate all objects
scene.add(ambientLight);

//0x635900
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.010); // White directional light
directionalLight.position.set(-15.36, -50, 50).normalize(); // Light source position
scene.add(directionalLight);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // For softer shadows


/*
//================================================================
// Lighting Setup
//================================================================
const ambientLight = new THREE.AmbientLight(0x635900, 0.1); // Ambient light to illuminate all objects
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0x635900, 0.010); // White directional light
directionalLight.position.set(-15.36, -50, 50).normalize(); // Light source position
scene.add(directionalLight);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // For softer shadows


*/

const localizedDirectionalLight = new THREE.DirectionalLight(0xffffff, 1.0);

// Position it in your specific area
localizedDirectionalLight.position.set(-15.36, -50, 50); // Position it at (-115, -39, -40)

// Set the light's target to the area you want to illuminate
localizedDirectionalLight.target.position.set(29, 7, -28); // Focus it downward toward the ground

// Enable shadows for more localized effects
localizedDirectionalLight.castShadow = true;
localizedDirectionalLight.shadow.mapSize.width = 1024;  // Higher value for better resolution
localizedDirectionalLight.shadow.mapSize.height = 1024;
localizedDirectionalLight.shadow.camera.near = 0.1;  // Set the shadow camera near
localizedDirectionalLight.shadow.camera.far = 500;  // Set the shadow camera far (to control distance)

// Add the light to the scene
scene.add(localizedDirectionalLight);
scene.add(localizedDirectionalLight.target);




//================================================================
// Sound Setup with Auto-Play Attempt
//================================================================
let audioContext;
let isAmbientAudioPlaying = false;
let ambientAudios = [];

document.addEventListener('click', function() {
  if (!currentUser) return; // Only trigger audio if user is logged in
  
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume the AudioContext if it's suspended
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // Now you can safely start playing audio if not already playing
  if (!isAmbientAudioPlaying) {
    playAudio();
    isAmbientAudioPlaying = true;
  }
});

// Function to play three audio files at once, looping indefinitely
function playAudio() {
  // If we already have audio running, stop it first to be safe
  stopAmbientAudio();

  const audio1 = new Audio('/sounds/Sound Effects Heavy Rain and Thunder.mp3');
  const audio2 = new Audio('/sounds/Underwater Pool - Sound Effect (HD).mp3');
  const audio3 = new Audio('/sounds/Free Horror Ambience (Dark Project).mp3');

  audio1.volume = 1;
  audio2.volume = 1;
  audio3.volume = 1; // Adjust this value (0.0 to 1.0) to control the volume of the third sound

  // Enable looping for all three audio files
  audio1.loop = true;
  audio2.loop = true;
  audio3.loop = true;

  // Play all three sounds at once
  audio1.play().catch(error => console.error('Error playing audio1:', error));
  audio2.play().catch(error => console.error('Error playing audio2:', error));
  audio3.play().catch(error => console.error('Error playing audio3:', error));

  ambientAudios = [audio1, audio2, audio3];
}

function stopAmbientAudio() {
  ambientAudios.forEach(audio => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (e) {
      console.error('Error stopping ambient audio:', e);
    }
  });
  ambientAudios = [];
  isAmbientAudioPlaying = false;
}





// Load the sound effect
const sparkSound = new Audio('/sounds/Electricity spark sound effects HQ.mp3'); // Replace with the correct sound file path
sparkSound.volume = 1.0; // Set the volume to maximum (range: 0.0 to 1.0)


// Wait for the sound to be loaded and ensure the duration is valid before using it
sparkSound.addEventListener('loadedmetadata', () => {
  // The sound is loaded and duration is available, you can start using it
  console.log('Sound loaded, duration:', sparkSound.duration);
});

function flickerLight() {
  const flashCount = Math.floor(Math.random() * 6) + 3; // Random flashes (3 to 8)
  let currentFlash = 0;

  function flash() {
    if (currentFlash < flashCount) {
      // Decide if the light should flicker
      const isFlickering = Math.random() > 0.5; // 50% chance of flickering

      if (isFlickering) {
        // Flickering: Set random light intensity and play the sound
        ambientLight.intensity = Math.random() * 0.7 + 0.1; // Intensity: 0.1 to 0.8
        
        // Start the sound at a random time within its duration, but check if duration is valid
        if (sparkSound.paused && !isNaN(sparkSound.duration)) {
          const randomStartTime = Math.random() * sparkSound.duration; // Random start between 0 and the sound's duration
          sparkSound.currentTime = randomStartTime; // Set the random start time
          sparkSound.play();
        }
      } else {
        // Not flickering: Dim the light and stop the sound
        ambientLight.intensity = 1; // Normal ambient light
        if (!sparkSound.paused) {
          sparkSound.pause(); // Stop the sound if it's playing
        }
      }

      currentFlash++;

      // Random delay between each flash (50ms to 150ms)
      setTimeout(flash, Math.random() * 100 + 50);
    } else {
      // End of flashes: Dim the light, stop the sound, and wait for the next sequence
      ambientLight.intensity = 0.1; // Minimal ambient light during delay
      if (!sparkSound.paused) {
        sparkSound.pause(); // Ensure sound is stopped
      }
      setTimeout(flickerLight, 5000); // 5-second delay before the next sequence
    }
  }

  flash(); // Start the flashing sequence
}

// Start the flickering effect
flickerLight();




//================================================================
// Wall Setup (Front, Back, Left, Right)
//================================================================

// Front Wall
const frontWallTexture = textureLoader.load('/images/texture/tile.jpg'); // Front wall texture
frontWallTexture.wrapS = THREE.RepeatWrapping;
frontWallTexture.wrapT = THREE.RepeatWrapping;
frontWallTexture.repeat.set(30, 10); // Scale texture to fit

const frontWallMaterial = new THREE.MeshStandardMaterial({ 
    map: frontWallTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5 // Optional: for added shininess
});
const frontWall = new THREE.Mesh(new THREE.BoxGeometry(100, 40, 1), frontWallMaterial);
frontWall.position.z = -50;
frontWall.castShadow = false;
frontWall.receiveShadow = true;
scene.add(frontWall);

// Back Wall
const backWallTexture = textureLoader.load('/images/texture/tile.jpg'); // Back wall texture
backWallTexture.wrapS = THREE.RepeatWrapping;
backWallTexture.wrapT = THREE.RepeatWrapping;
backWallTexture.repeat.set(30, 10); // Adjust the repeat scale

const backWallMaterial = new THREE.MeshStandardMaterial({ 
    map: backWallTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const backWall = new THREE.Mesh(new THREE.BoxGeometry(100, 40, 1), backWallMaterial);
backWall.position.z = 50;
backWall.castShadow = false;
backWall.receiveShadow = true;
scene.add(backWall);

// Left Wall
const leftWallTexture = textureLoader.load('/images/texture/tile.jpg'); // Left wall texture
leftWallTexture.wrapS = THREE.RepeatWrapping;
leftWallTexture.wrapT = THREE.RepeatWrapping;
leftWallTexture.repeat.set(30, 10); // Adjust the repeat scale

const leftWallMaterial = new THREE.MeshStandardMaterial({ 
    map: leftWallTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const leftWall = new THREE.Mesh(new THREE.BoxGeometry(1, 40, 100), leftWallMaterial);
leftWall.position.set(-52, 2, -1);
leftWall.scale.set(1, 2, 0.6);

leftWall.castShadow = false;
leftWall.receiveShadow = true;
scene.add(leftWall);

// Left Wall 1
const left1WallTexture = textureLoader.load('/images/texture/tile.jpg'); // Left wall texture
left1WallTexture.wrapS = THREE.RepeatWrapping;
left1WallTexture.wrapT = THREE.RepeatWrapping;
left1WallTexture.repeat.set(30, 10); // Adjust the repeat scale

const left1WallMaterial = new THREE.MeshStandardMaterial({ 
    map: left1WallTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const left1Wall = new THREE.Mesh(new THREE.BoxGeometry(1, 40, 100), left1WallMaterial);
left1Wall.scale.set(8, 0.3, 0.3);
left1Wall.position.set(-44, 20, 35);

left1Wall.castShadow = false;
left1Wall.receiveShadow = true;
scene.add(left1Wall);

// Right Wall
const rightWallTexture = textureLoader.load('/images/texture/tile.jpg'); // Right wall texture
rightWallTexture.wrapS = THREE.RepeatWrapping;
rightWallTexture.wrapT = THREE.RepeatWrapping;
rightWallTexture.repeat.set(30, 10); // Adjust the repeat scale

const rightWallMaterial = new THREE.MeshStandardMaterial({ 
    map: rightWallTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const rightWall = new THREE.Mesh(new THREE.BoxGeometry(1, 40, 100), rightWallMaterial);
rightWall.position.x = 50;
rightWall.castShadow = false;
rightWall.receiveShadow = true;
scene.add(rightWall);

//================================================================
// Ceiling and Floor Setup
//================================================================

// Ceiling
const ceilingTexture2 = textureLoader.load('/images/texture/tile.jpg'); // Ceiling texture
ceilingTexture2.wrapS = THREE.RepeatWrapping;
ceilingTexture2.wrapT = THREE.RepeatWrapping;
ceilingTexture2.repeat.set(30, 10); // Adjust the repeat scale

const ceilingMaterial = new THREE.MeshStandardMaterial({ 
    map: ceilingTexture2,
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), ceilingMaterial);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 22; // Place it above the floor
ceiling.receiveShadow = true;
scene.add(ceiling);

// Floor
const floorTexture = textureLoader.load('/images/texture/tile.jpg'); // Floor texture (same texture as ceiling)
floorTexture.wrapS = THREE.RepeatWrapping;
floorTexture.wrapT = THREE.RepeatWrapping;
floorTexture.repeat.set(30, 10); // Adjust the repeat scale

const floorMaterial = new THREE.MeshStandardMaterial({ 
    map: floorTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), floorMaterial);
floor.rotation.x = Math.PI / -2; // Rotate to make it horizontal
floor.position.y = 0; // Place it on the ground
floor.receiveShadow = true;
scene.add(floor);




/*

// New Floor (Renamed to alternateFloor to avoid confusion)
const NORMALLTexture = textureLoader.load(''); // Same texture as floor
NORMALLTexture.wrapS = THREE.RepeatWrapping;
NORMALLTexture.wrapT = THREE.RepeatWrapping;
NORMALLTexture.repeat.set(30, 10); // Adjust the repeat scale

const NORMALLTextureFloorMaterial = new THREE.MeshStandardMaterial({ 
    map: NORMALLTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const NORMAL = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), NORMALLTextureFloorMaterial);
NORMAL.receiveShadow = true;
scene.add(NORMAL);

*/





// New Floor (Renamed to alternateFloor to avoid confusion)
const alternateFloorTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
alternateFloorTexture.wrapS = THREE.RepeatWrapping;
alternateFloorTexture.wrapT = THREE.RepeatWrapping;
alternateFloorTexture.repeat.set(30, 10); // Adjust the repeat scale

const alternateFloorMaterial = new THREE.MeshStandardMaterial({ 
    map: alternateFloorTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const alternateFloor = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), alternateFloorMaterial);
alternateFloor.rotation.y = Math.PI / 2; // Rotate to make it horizontal
alternateFloor.position.set(33, 2, 25.3); // Set position
                    //nipis     //width    //heigh
alternateFloor.scale.set(0.040,         1,          22); // Shrink width to create space for the door
alternateFloor.receiveShadow = true;
scene.add(alternateFloor);


//left

const LEFT1Texture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
LEFT1Texture .wrapS = THREE.RepeatWrapping;
LEFT1Texture .wrapT = THREE.RepeatWrapping;
LEFT1Texture .repeat.set(30, 10); // Adjust the repeat scale

const LEFT1TextureMaterial = new THREE.MeshStandardMaterial({ 
    map: LEFT1Texture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const LEFT1Floor = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), LEFT1TextureMaterial);
LEFT1Floor.rotation.y = Math.PI / 2; // Rotate to make it horizontal
LEFT1Floor.position.set(24, 2, 50); // Set position
                    //nipis     //width    //heigh
LEFT1Floor.scale.set(0.1, 0.5, 2); // Shrink width to create space for the door
LEFT1Floor.receiveShadow = true;
scene.add(LEFT1Floor);


//top
const topTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
topTexture .wrapS = THREE.RepeatWrapping;
topTexture .wrapT = THREE.RepeatWrapping;
topTexture .repeat.set(30, 10); // Adjust the repeat scale

const top1TextureMaterial = new THREE.MeshStandardMaterial({ 
    map: topTexture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const topFloor = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), top1TextureMaterial);
topFloor.rotation.y = Math.PI / 2; // Rotate to make it horizontal
topFloor.position.set(24, 16, 45); // Set position
                    //nipis     //width    //heigh
                    topFloor.scale.set(0.3, 0.4, 2); // Shrink width to create space for the door
                    topFloor.receiveShadow = true;
scene.add(topFloor);

//ceiling room
const ceilingTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
ceilingTexture .wrapS = THREE.RepeatWrapping;
ceilingTexture .wrapT = THREE.RepeatWrapping;
ceilingTexture .repeat.set(30, 10); // Adjust the repeat scale

const ceilingTextureMaterial = new THREE.MeshStandardMaterial({ 
    map: ceilingTexture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const ceiling1 = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), ceilingTextureMaterial);
ceiling1.rotation.x = Math.PI / 2; // Rotate to make it horizontal
ceiling1.position.set(42, 13.4, 45); // Set position
                    //nipis     //width    //heigh
                    ceiling1.scale.set(0.8, 1, 0.5); // Shrink width to create space for the door
                    ceiling1.receiveShadow = true;
scene.add(ceiling1);

//carpet

const carpetTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
carpetTexture .wrapS = THREE.RepeatWrapping;
carpetTexture .wrapT = THREE.RepeatWrapping;
carpetTexture .repeat.set(30, 10); // Adjust the repeat scale

const carpetTextureTextureMaterial = new THREE.MeshStandardMaterial({ 
    map: carpetTexture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const carpet = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), carpetTextureTextureMaterial);
carpet.rotation.x = Math.PI / 2; // Rotate to make it horizontal
carpet.position.set(37, -0, 35); // Set position
                    //nipis     //width    //heigh
                    carpet.scale.set(0.4, 0.5, 0.2); // Shrink width to create space for the door
                    carpet.receiveShadow = true;
scene.add(carpet);

//OFFICE AREA-------------------------------------------------------------------

//right wall second path
const RWSPTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
RWSPTexture .wrapS = THREE.RepeatWrapping;
RWSPTexture .wrapT = THREE.RepeatWrapping;
RWSPTexture .repeat.set(30, 10); // Adjust the repeat scale

const RWSPTextureTextureMaterial = new THREE.MeshStandardMaterial({ 
    map: RWSPTexture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const RWSP = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), RWSPTextureTextureMaterial);
RWSP.rotation.y = Math.PI / 2; // Rotate to make it horizontal
RWSP.position.set(24, 2, 17); // Set position
                    //nipis     //width    //heigh
                    RWSP.scale.set(1.2, 1, 2); // Shrink width to create space for the door
                    RWSP.receiveShadow = true;
scene.add(RWSP);

//left wall second path
const LWSPTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
LWSPTexture .wrapS = THREE.RepeatWrapping;
LWSPTexture .wrapT = THREE.RepeatWrapping;
LWSPTexture .repeat.set(30, 10); // Adjust the repeat scale

const LWSPTextureTextureMaterial = new THREE.MeshStandardMaterial({ 
    map: LWSPTexture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const LWSP = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), LWSPTextureTextureMaterial);
LWSP.rotation.y = Math.PI / 2; // Rotate to make it horizontal
LWSP.position.set(24, 2, -24); // Set position
                    //nipis     //width    //heigh
                    LWSP.scale.set(0.5, 1, 2); // Shrink width to create space for the door
                    LWSP.receiveShadow = true;
scene.add(LWSP);


//top second path

const TSPTexture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
TSPTexture.wrapS = THREE.RepeatWrapping;
TSPTexture.wrapT = THREE.RepeatWrapping;
TSPTexture.repeat.set(5, 5); // Adjust the repeat scale

const TSPTextureMaterial = new THREE.MeshStandardMaterial({ 
    map: TSPTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const TSP = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), TSPTextureMaterial);
TSP.rotation.y = Math.PI / 2; // Rotate to make it horizontal
TSP.position.set(24, 18, -11); // Set position
TSP.scale.set(2, 0.4, 2); // Shrink width to create space for the door
TSP.receiveShadow = true;
scene.add(TSP);



//entrance wall

const ENT1Texture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
ENT1Texture .wrapS = THREE.RepeatWrapping;
ENT1Texture .wrapT = THREE.RepeatWrapping;
ENT1Texture .repeat.set(30, 10); // Adjust the repeat scale

const ENT1TextureMaterial = new THREE.MeshStandardMaterial({ 
    map: ENT1Texture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const ENT1 = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), ENT1TextureMaterial);

ENT1.position.set(35, 2, 23.6); // Set position
                    //nipis     //width    //heigh
                    ENT1.scale.set(0.653, 2, 2); // Shrink width to create space for the door
                    TSP.receiveShadow = true;
scene.add(ENT1);


//entrance wall 2

const ENT2Texture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
ENT2Texture .wrapS = THREE.RepeatWrapping;
ENT2Texture .wrapT = THREE.RepeatWrapping;
ENT2Texture .repeat.set(30, 10); // Adjust the repeat scale

const ENT2TextureMaterial = new THREE.MeshStandardMaterial({ 
    map: ENT2Texture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const ENT2 = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), ENT2TextureMaterial);

ENT2.position.set(-36, 2, -30); // Set position
                    //nipis     //width    //heigh
                    ENT2.scale.set(3, 1, 2); // Shrink width to create space for the door
                    ENT2.receiveShadow = true;
scene.add(ENT2);


const ENT22Texture = textureLoader.load('/images/texture/tile.jpg'); // Same texture as floor
ENT22Texture .wrapS = THREE.RepeatWrapping;
ENT22Texture .wrapT = THREE.RepeatWrapping;
ENT22Texture .repeat.set(30, 10); // Adjust the repeat scale

const ENT22TextureMaterial = new THREE.MeshStandardMaterial({ 
    map: ENT22Texture , 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});
const ENT22 = new THREE.Mesh(new THREE.BoxGeometry(40, 35, 1), ENT2TextureMaterial);

ENT22.position.set(-36, 2, -50); // Set position
                    //nipis     //width    //heigh
                    ENT22.scale.set(3, 1, 2); // Shrink width to create space for the door
                    ENT22.receiveShadow = true;
scene.add(ENT22);


//================================================================
// GUI Setup
//================================================================
const gui = new GUI();

// Light Intensity Control
const lightFolder = gui.addFolder('Lighting');
const ambientLightControl = lightFolder.add(ambientLight, 'intensity', 0, 2).name('Ambient Light Intensity');
const directionalLightControl = lightFolder.add(directionalLight, 'intensity', 0, 2).name('Directional Light Intensity');

// Directional Light Direction Controls
const lightDirectionFolder = gui.addFolder('Light Direction');
const initialLightPosition = {
  x: -15.36,
  y: -50,
  z: 50
};

// Set initial position of the directional light
directionalLight.position.set(initialLightPosition.x, initialLightPosition.y, initialLightPosition.z);

// Initialize GUI controls for light position
lightDirectionFolder.add(initialLightPosition, 'x', -50, 50).name('Light X Position').onChange((value) => {
  directionalLight.position.x = value;
});
lightDirectionFolder.add(initialLightPosition, 'y', -50, 50).name('Light Y Position').onChange((value) => {
  directionalLight.position.y = value;
});
lightDirectionFolder.add(initialLightPosition, 'z', -50, 50).name('Light Z Position').onChange((value) => {
  directionalLight.position.z = value;
});

// Fog Controls
const fogFolder = gui.addFolder('Fog');
const fogIntensityControl = fogFolder.add({ fogDensity: fogDensity }, 'fogDensity', 0, 0.1).name('Fog Density').onChange((value) => {
  scene.fog.density = value;
});

const fogColorControl = fogFolder.addColor({ fogColor: fogColor.getHex() }, 'fogColor').name('Fog Color').onChange((value) => {
  scene.fog.color.set(value);
});

//================================================================
// Initialize the GUI
//================================================================
function hideGUI() {
  const guiContainer = document.querySelector('.dg.ac'); // Default class for dat.GUI
  if (guiContainer) {
    guiContainer.style.display = 'none'; // Fixed bug: changed '1' to 'none'
  }
}



hideGUI();
lightFolder.close();
lightDirectionFolder.close(); 
fogFolder.close();


// Set camera position
// Set camera position
camera.position.set(48, -26, 42);
//camera.position.set(-12, 14,41);
// Rotate camera to look downward (45 degrees downward)
camera.rotation.x = -Math.PI / 3; // Convert 45 degrees to radians (downward tilt)

// Rotate camera 30 degrees to the left (yaw rotation)
camera.rotation.y = -Math.PI / 20; // Convert 30 degrees to radians (left rotation)





class FPSControls {
  constructor(camera, scene) {
      this.camera = camera;
      this.scene = scene;
      this.pointerLockControls = new PointerLockControls(camera, document.body);
      pointerLockControls = this.pointerLockControls; // Set global reference

      scene.add(this.pointerLockControls.getObject()); // Use getObject()

      // Fixed: only lock pointer if the user has signed in and not on mobile.
      // If already locked on PC, click toggles the flashlight.
      document.addEventListener('click', () => {
        if (currentUser && !isMobile) {
          if (this.pointerLockControls.isLocked) {
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
          } else {
            this.pointerLockControls.lock();
          }
        }
      });

      this.velocity = new THREE.Vector3(0, 0, 0);
      this.acceleration = new THREE.Vector3(40, 2130, 40);
      this.deceleration = new THREE.Vector3(-10, -55, -10);
      this.move = { forward: false, backward: false, left: false, right: false };
      this.walkSoundStopTimeout = null; // Timeout reference to fix the frame-by-frame setTimeout bug

      this.isStanding = true;
      this.isEditMode = false; // Track whether we are in edit mode


      // Initialize Audio Listener and Sounds
      this.listener = new THREE.AudioListener();
      this.camera.add(this.listener); // Attach the listener to the camera
  
      
    // First walking sound
    this.walkSound = new THREE.Audio(this.listener);
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('/sounds/Sound Effects - Walking on Tile Floor.mp3', (buffer) => {
      this.walkSound.setBuffer(buffer);
      this.walkSound.setLoop(true); // Set to loop if desired
      this.walkSound.setVolume(0.5); // Adjust volume as needed
    });

    // Second walking sound
    this.secondWalkSound = new THREE.Audio(this.listener);
    audioLoader.load('/sounds/Walking Through Water Sound Effect.mp3', (buffer) => {
      this.secondWalkSound.setBuffer(buffer);
      this.secondWalkSound.setLoop(true);
      this.secondWalkSound.setVolume(0.5); // Adjust volume as needed
    });
  

      document.addEventListener('keydown', (e) => this._onKeyDown(e), false);
      document.addEventListener('keyup', (e) => this._onKeyUp(e), false);

       // Add event listener for the "Enter First Person Mode" button
    const firstPersonBtn = document.getElementById('firstPersonBtn');
    firstPersonBtn.addEventListener('click', () => this.enterFirstPersonMode());

    // Add event listener for the "Enter Edit Mode" button
    const editModeBtn = document.getElementById('editModeBtn');
    editModeBtn.addEventListener('click', () => this.enterEditMode());

    // Add a scroll wheel listener to handle zoom only in edit mode
    document.addEventListener('wheel', (event) => this.handleScroll(event), { passive: false });
     // Create the target marker in the game
     this.createTargetMarker();
  }

  createTargetMarker() {
    const targetPosition = new THREE.Vector3(-61, 4, -40); // The target position
  
    // Create a small sphere to act as the marker
    const geometry = new THREE.SphereGeometry(0.2, 32, 32); // Small sphere with radius 0.2
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,      // Red color
      transparent: true,    // Enable transparency
      opacity: 0.0         // Set the opacity to 50% (you can adjust this value)
    });
    const marker = new THREE.Mesh(geometry, material);
  
    // Set the marker's position to the target position
    marker.position.copy(targetPosition);
  
    // Add the marker to the scene
    this.scene.add(marker);
  }


  enterFirstPersonMode() {
    // Activates pointer lock controls when the button is clicked
    this.pointerLockControls.lock(); // This will activate the pointer lock
    this.isEditMode = false; // Disable edit mode when entering first-person view
  }

  enterEditMode() {
    this.isEditMode = true; // Enable edit mode (fly mode)
    this.velocity.set(0, 0, 0); // Reset velocity
  }
  handleScroll(event) {
    // Disable zoom on scroll in both modes
    event.preventDefault(); // Prevent the page from scrolling
  }

  _onKeyDown(event) {
    switch (event.code) {
      case 'KeyW': this.move.forward = true; break;
      case 'KeyS': this.move.backward = true; break;
      case 'KeyA': this.move.left = true; break;
      case 'KeyD': this.move.right = true; break;
      case 'Space': // Jump (move up in Edit Mode)
        if (this.isEditMode) {
          this.move.up = true;
        } else if (this.isStanding) {
          this.velocity.y += 12; // Adjust jump height as needed
          this.isStanding = true;
        }
        break;
      case 'ShiftLeft': // Move down in Edit Mode
        if (this.isEditMode) {
          this.move.down = true;
        }
        break;
    }
  }





  _onKeyUp(event) {
      switch (event.code) {
          case 'KeyW': this.move.forward = false; break;
          case 'KeyS': this.move.backward = false; break;
          case 'KeyA': this.move.left = false; break;
          case 'KeyD': this.move.right = false; break;
          case 'Space': break;
      }
  }

  update(delta) {
    const speedMultiplier = 1; // Adjust speed multiplier here
    const frameDeceleration = new THREE.Vector3(
        this.velocity.x * this.deceleration.x,
        this.deceleration.y,
        this.velocity.z * this.deceleration.z
    );
    frameDeceleration.multiplyScalar(delta);
    this.velocity.add(frameDeceleration);

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    const forward = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    const right = new THREE.Vector3().crossVectors(this.camera.up, forward).normalize();

    if (this.move.forward) this.velocity.addScaledVector(forward, this.acceleration.z * delta);
    if (this.move.backward) this.velocity.addScaledVector(forward, -this.acceleration.z * delta);
    if (this.move.left) this.velocity.addScaledVector(right, this.acceleration.x * delta);
    if (this.move.right) this.velocity.addScaledVector(right, -this.acceleration.x * delta);

    // Create a bounding box for the character
    const characterBox = new THREE.Box3().setFromCenterAndSize(
        this.pointerLockControls.getObject().position,
        new THREE.Vector3(1, 1.8, 1) // Adjust size based on your character's dimensions
    );
    

    // Check for collisions with walls
    for (const wallBox of wallBoundingBoxes) {
        if (characterBox.intersectsBox(wallBox)) {
            // Collision detected, revert position
            this.pointerLockControls.getObject().position.sub(this.velocity.clone().multiplyScalar(delta));
            this.velocity.set(0, 0, 0); // Stop movement
            break; // Exit loop after collision
        }
    }
    

    
    // Update camera position
    const position = this.pointerLockControls.getObject().position;
    position.addScaledVector(this.velocity, delta);

    // Apply gravity
    if (position.y < 5) {
        this.velocity.y = 1;
        position.y = 5;
        this.isStanding = true;
    }

/*
    // Floating effect: Custom down and up positions
    let time = Date.now() * 0.001; // Time for the floating effect (in seconds)

    // Customize the down and up positions
    const downPosition = 4.1;  // Lowest point (down position)
    const upPosition = 5;     // Highest point (up position)

    const floatingAmplitude = upPosition - downPosition;  // The range between up and down positions
    const floatingFrequency = 0.5;  // Controls how fast the floating oscillates

    // Sinusoidal floating effect between the custom down and up positions
    position.y = downPosition + Math.sin(time * floatingFrequency) * floatingAmplitude;

*/

    // Play both walking sounds when moving
    if (this.move.forward || this.move.backward || this.move.left || this.move.right) {
      if (this.walkSoundStopTimeout) {
        clearTimeout(this.walkSoundStopTimeout);
        this.walkSoundStopTimeout = null;
      }
      if (!this.walkSound.isPlaying) {
        this.walkSound.play(); // Play the first sound
      }
      if (!this.secondWalkSound.isPlaying) {
        this.secondWalkSound.play(); // Play the second sound
      }
      position.y += Math.sin(Date.now() / 100) * 0.10; // Bump effect
    } else {
      if (this.walkSound.isPlaying) {
        this.walkSound.stop(); // Stop the first sound
      }
      // Delay stopping the second sound by 1 second (safe from frame-by-frame memory leaks)
      if (this.secondWalkSound.isPlaying && !this.walkSoundStopTimeout) {
        this.walkSoundStopTimeout = setTimeout(() => {
          if (this.secondWalkSound.isPlaying) {
            this.secondWalkSound.stop(); // Stop the second sound after 1 second delay
          }
          this.walkSoundStopTimeout = null;
        }, 1000); // 1000 milliseconds = 1 second
      }
    }
  }
}






// Instantiate FPSControls
const controls = new FPSControls(camera, scene);



const loader = new GLTFLoader();



/*
let walkingModel; 
let walkingMixer;

loader.load('/images/models/nathan_animated_003_-_walking_3d_man.glb', (gltf) => {
    walkingModel = gltf.scene;
    walkingMixer = new THREE.AnimationMixer(walkingModel);
    walkingModel.scale.set(0.0080, 0.0080, 0.0080);

    // Traverse the model to find and "cut" specific parts
    walkingModel.traverse((child) => {
        if (child.isMesh) {
            // Example: Remove or hide specific parts
            if (child.name === 'Head' || child.name === 'Torso') {
                child.visible = false; // Hide the part
                // OR remove it completely:
                // walkingModel.remove(child);
            }
        }
    });

    // Play walking animation
    gltf.animations.forEach((clip) => {
        const action = walkingMixer.clipAction(clip);
        action.play();
    });

    scene.add(walkingModel);
});


*/







// flood

// Load water model
// Load water model
let water1;  // Declare water globally
let waterMixer;  // Declare a global mixer variable

loader.load('/images/models/water_wave_for_ar.glb', (gltf) => {
  water1 = gltf.scene;
  water1.scale.set(0.3, 0.3, 0.31);
  //use 21.7
  water1.position.set(20, 21.7, 20); // Starting position of the water
  water1.castShadow = true;
  water1.receiveShadow = true;
    scene.add(water1);

    // Make the water darker by adjusting its material
    water1.traverse((child) => {
        if (child.isMesh) {
            if (child.material) {
                child.material.color = new THREE.Color(0x001a33); // Dark blue
                child.material.emissive = new THREE.Color(0x000000); // No emissive light
                child.material.needsUpdate = true; // Update the material
            }
        }
    });

    if (gltf.animations && gltf.animations.length) {
      waterMixer = new THREE.AnimationMixer(water1);
      gltf.animations.forEach((clip) => {
          const action = waterMixer.clipAction(clip);
          action.play(); // Play the animation
      });
  }
});

// --------------------------------------------------------------------------------[Water Shader for Raging Sea]
// Vertex Shader for Water
const waterVertexShader = `
  uniform float time;
  varying vec2 vUv;
  varying float vWaveHeight;

  void main() {
    vUv = uv;

    // Increase wave height by changing amplitude
    float waveAmplitude = 12.0;  // Increase the wave height
    float waveFrequency = 0.1;  // Control wave frequency (lower = wider waves)

    // Create waving effect based on sine and cosine functions
    vec3 newPosition = position;
    float waveHeight = sin(position.x * waveFrequency + time * 1.5) * waveAmplitude + 
                       cos(position.z * waveFrequency + time * 1.5) * waveAmplitude;

    // Apply wave height to y position
    newPosition.y += waveHeight;

    vWaveHeight = waveHeight;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

// Fragment Shader for Water
const waterFragmentShader = `
  uniform float time;
  uniform sampler2D normalMap;  // Normal map for water
  uniform vec3 lightPosition;   // Light source position
  uniform vec3 waterColor;      // Single color for the water
  uniform vec3 ambientLightColor; // Ambient light color
  varying vec2 vUv;
  varying float vWaveHeight;

  void main() {
    // Sample normal map to get water surface normals
    vec3 normal = texture2D(normalMap, vUv).rgb;
    normal = normalize(normal * 2.0 - 1.0); // Convert normal to [-1,1] range

    // Light reflection and refraction based on wave surface
    vec3 lightDir = normalize(lightPosition - gl_FragCoord.xyz);
    float diff = max(dot(normal, lightDir), 0.0);
    
    // Combine the water color with light and shadow effects
  vec3 color = waterColor * diff * 0.3 + vec3(48.0/255.0, 48.0/255.0, 0.0) * (1.0 - diff);



    // Add ambient light effect
    color += ambientLightColor * 1;  // Lightens the water

    // Set the alpha value for transparency
    gl_FragColor = vec4(color, 0.1); // Adjust alpha as needed
  }
`;

// --------------------------------------------------------------------------------[Scene Setup]

// Load normal map texture for the water

const normalTexture = textureLoader.load('/images/texture/water.avif'); // Load normal map texture

// --------------------------------------------------------------------------------[Lighting Setup]


// --------------------------------------------------------------------------------[Water Material Setup]

const waterMaterial = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0.0 },
    normalMap: { value: normalTexture },
    lightPosition: { value: new THREE.Vector3(0, 10, 0) }, // Set the light position
    waterColor: { value: new THREE.Color(0x001a33) }, // Dark blue color
    ambientLightColor: { value: new THREE.Color(0x404040) }, // Ambient light color
  },
  vertexShader: waterVertexShader,
  fragmentShader: waterFragmentShader,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// --------------------------------------------------------------------------------[Water Geometry]

const waterGeometry = new THREE.PlaneGeometry(900, 900, 64, 64); // Increase segments for better wave definition

// --------------------------------------------------------------------------------[Water Mesh Setup]

const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI * 0.5; // Rotate water to lie flat
//water.position.set(0, 2.5, 0); 
water.position.set(0, -50, 0);
water.scale.set(0.130, 0.130, 0.130); // Position the water at the bottom
water.receiveShadow = true; // Make sure the water receives shadows
water.castShadow = true;
//scene.add(water); // Add the water to the scene



////////////////////////////////////////////////////////////////////////////////////////
//OBJECTS/TREASURES



// Load the texture
const mapTexture = textureLoader.load('/map.png'); // Left wall texture
mapTexture.wrapS = THREE.RepeatWrapping;
mapTexture.wrapT = THREE.RepeatWrapping;
mapTexture.repeat.set(1, 1); // Adjust the repeat scale

// Create the material
const mapMaterial = new THREE.MeshStandardMaterial({ 
    map: mapTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});

// Create the mesh
const mapWall = new THREE.Mesh(new THREE.BoxGeometry(1, 40, 100), mapMaterial);
mapWall.scale.set(.12,.17,.12);
mapWall.position.set(23, 7,33.5);
// Enable shadows
mapWall.castShadow = true;
mapWall.receiveShadow = true;

// Add the mesh to the scene
scene.add(mapWall);





// Load the texture
const noteTexture = textureLoader.load('/map/fordoorcardpaper.png'); // Paper texture
noteTexture.wrapS = THREE.RepeatWrapping;
noteTexture.wrapT = THREE.RepeatWrapping;
noteTexture.repeat.set(1, 1); // Adjust the repeat scale

// Create the material
const noteMaterial = new THREE.MeshStandardMaterial({ 
    map: noteTexture, 
    side: THREE.DoubleSide, 
    roughness: 0, 
    metalness: 0.5
});

// Create the mesh
const noteWall = new THREE.Mesh(new THREE.BoxGeometry(1, 40, 100), noteMaterial);
noteWall.scale.set(0.050, 0.050, 0.020); // Scale to resemble paper size
noteWall.position.set(-13, 3.6, -27.4); // Slightly above the ground to avoid z-fighting

// Rotate the paper to lie flat, facing up
noteWall.rotation.x = Math.PI / 2; // Rotate 90 degrees on the X-axis to make it lie flat
noteWall.rotation.y = Math.PI / -2;


// Enable shadows
noteWall.castShadow = true;
noteWall.receiveShadow = true;

// Add the mesh to the scene
scene.add(noteWall);








// ── Flashlight toggle state ──
let flashlightOn = false;
let flashlightCooldown = false;
let flashlightOverlay = null;

// ── Create the overlay text element ──
function createFlashlightOverlay() {
  flashlightOverlay = document.createElement('div');
  flashlightOverlay.style.position = 'fixed';
  flashlightOverlay.style.bottom = '30px';
  flashlightOverlay.style.left = '50%';
  flashlightOverlay.style.transform = 'translateX(-50%)';
  flashlightOverlay.style.color = 'white';
  flashlightOverlay.style.fontSize = '18px';
  flashlightOverlay.style.fontFamily = 'Courier New, monospace';
  flashlightOverlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
  flashlightOverlay.style.padding = '8px 18px';
  flashlightOverlay.style.borderRadius = '6px';
  flashlightOverlay.style.pointerEvents = 'none';
  flashlightOverlay.style.display = 'none';
  flashlightOverlay.style.zIndex = '500';
  document.body.appendChild(flashlightOverlay);
}
createFlashlightOverlay();

function showFlashlightMessage(msg, duration = 2000) {
  flashlightOverlay.innerText = msg;
  flashlightOverlay.style.display = 'block';
  clearTimeout(flashlightOverlay._timeout);
  flashlightOverlay._timeout = setTimeout(() => {
    flashlightOverlay.style.display = 'none';
  }, duration);
}



























//================================================================
// Character (Zombie) Setup
//================================================================

let isFirstPerson = false;
let isZombieMoving = true; // Track whether the zombie should move
let zombieState = "patrolling"; // Initial state of the zombie
const clock = new THREE.Clock();

//================================================================
// Screen Effects (Damage Overlay)
//================================================================
const damageOverlay = document.getElementById('damage-overlay');

// Function to make the screen flicker red
function triggerRedFlicker() {
  let flickerCount = 0; // Count flickers
  const maxFlickers = 5; // Total number of flickers

  const interval = setInterval(() => {
    damageOverlay.style.opacity = damageOverlay.style.opacity === '0' ? '1' : '0';
    flickerCount++;
    if (flickerCount >= maxFlickers * 2) {
      clearInterval(interval);
      damageOverlay.style.opacity = '0'; // Ensure it ends in a non-visible state
    }
  }, 100); // Flicker interval (in milliseconds)
}

// Attack sound setup
const attackSound = new Audio('/sounds/Snake (Hiss) - Sound Effect _ ProSounds(MP3_160K).mp3');
attackSound.volume = 1; // Max volume
attackSound.playbackRate = 2; // Slightly increase playback speed for intensity

function onZombieAttack() {
  triggerRedFlicker();
  console.log('Player attacked by zombie!');

  // Play the attack sound
  attackSound.play();

  // Ensure the zombie doesn't tilt during the attack
  zombie.rotation.x = 0;  // Reset X-axis rotation (no tilt)
  zombie.rotation.z = 0;  // Reset Z-axis rotation (no tilt)

  // Make the zombie's face face directly toward the camera when attacking
  const directionToCamera = new THREE.Vector3();
  directionToCamera.subVectors(camera.position, zombie.position).normalize();
  
  // Calculate the angle to rotate towards the camera (Y-axis rotation)
  const angle = Math.atan2(directionToCamera.x, directionToCamera.z);  // Use directionToCamera here
  zombie.rotation.y = angle;

  // Trigger the attack animation here if any
  // For example:
  // zombieAnimation.play("attack_animation");

  // Camera shake logic
  const shakeDuration = 0.2; // Shake duration in seconds
  const shakeMagnitude = 0.1; // Magnitude of shake (how far the camera moves)

  const originalCameraPosition = camera.position.clone(); // Store the original position
  const originalFOV = camera.fov; // Store the original FOV
  
  // Set the zoom effect (zoom in the camera)
  const zoomDuration = 0.2; // Duration of zoom effect in seconds
  const zoomMagnitude = 30; // The field of view to zoom into (smaller means more zoomed in)
  camera.fov = zoomMagnitude; // Set the camera to zoom in

  let shakeTime = 0;
  let zoomTime = 0;

  function shakeCamera() {
    if (shakeTime < shakeDuration) {
      // Apply random movement to the camera position
      camera.position.x = originalCameraPosition.x + (Math.random() - 0.5) * shakeMagnitude;
      camera.position.y = originalCameraPosition.y + (Math.random() - 0.5) * shakeMagnitude;
      camera.position.z = originalCameraPosition.z + (Math.random() - 0.5) * shakeMagnitude;

      shakeTime += 0.016; // Assume 60 FPS, so 1 frame = 0.016s
      requestAnimationFrame(shakeCamera); // Continue shaking
    } else {
      // Restore the camera to its original position after the shake
      camera.position.copy(originalCameraPosition);
    }
  }

  function zoomCamera() {
    if (zoomTime < zoomDuration) {
      // Gradually zoom back to the original FOV
      camera.fov = THREE.MathUtils.lerp(camera.fov, originalFOV, zoomTime / zoomDuration);
      camera.updateProjectionMatrix(); // Update the camera's projection matrix to apply the FOV change

      zoomTime += 0.016; // Assume 60 FPS, so 1 frame = 0.016s
      requestAnimationFrame(zoomCamera); // Continue zooming
    } else {
      // Reset the camera's FOV after zoom effect
      camera.fov = originalFOV;
      camera.updateProjectionMatrix();
    }
  }
  
  // Start the shake and zoom effects
  shakeCamera();
  zoomCamera();

   setTimeout(() => {
    gameOver();
  }, 550); // slightly longer than shakeDuration (0.2s)
}


let lastAttackTime = 0;
const attackCooldown = 1.5; // seconds between attacks
//================================================================
// Zombie Movement (AI Behavior)
//================================================================
// Square boundaries (min and max coordinates ```javascript
const minX = -40, maxX = 40;
const minZ = -40, maxZ = 40;

let currentTarget = new THREE.Vector3();  // Current target position for the zombie
let isMovingToTarget = false;  // Flag to track if the zombie is moving to a new target
const wanderDistance = 50; // Distance at which the zombie starts wandering

// Update zombie state and movement //freeze distance
function isPlayerLookingAtZombie({ fovCos = Math.cos(THREE.MathUtils.degToRad(35)), maxDistance = 50 } = {}) {
  if (!zombie) return false;

  const camPos = camera.position;
  const zomPos = zombie.position;

  const toZombie = new THREE.Vector3().subVectors(zomPos, camPos);
  const dist = toZombie.length();
  if (dist === 0) return true;
  if (dist > maxDistance) return false;

  toZombie.normalize();

  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);

  const dot = camForward.dot(toZombie);
  return dot >= fovCos;
}

function updateZombie(delta) {
  if (zombie) {
    if (isPlayerLookingAtZombie()) {
      if (mixer) mixer.timeScale = 0;
      console.log(`[ZOMBIE] FROZEN — player is looking | dist: ${camera.position.distanceTo(zombie.position).toFixed(2)}`);
      return; // freeze while player is looking at the zombie
    }
// ── STUCK DETECTION ──────────────────────────────
const distanceMoved = zombie.position.distanceTo(zombieLastPosition);
if (distanceMoved < 0.3) {
    zombieStuckTimer += delta; // ← use the delta already gotten at top of animate()
} else {
    zombieStuckTimer = 0;
}
zombieLastPosition.copy(zombie.position);

if (zombieStuckTimer >= STUCK_THRESHOLD) {
    console.log('[ZOMBIE] STUCK 10s — resetting position');
    zombie.position.set(
        Math.random() * 40 - 20,
        5,
        Math.random() * 40 - 20
    );
    zombieStuckTimer = 0;
    zombieState = "patrolling";
    isMovingToTarget = false;
    return;
}
// ─────────────────────────────────────────────────

  if (mixer) mixer.timeScale = 0.7;
    const playerPosition = camera.position;
    const zombiePosition = zombie.position;
    const distanceToPlayer = playerPosition.distanceTo(zombiePosition);
    const direction = new THREE.Vector3();
    direction.subVectors(playerPosition, zombiePosition).normalize();






    switch (zombieState) {
      case "patrolling":
        patrolRandomly();
        console.log(`[ZOMBIE] PATROLLING | dist: ${distanceToPlayer.toFixed(2)} | triggers stalking at < 32`);
        if (distanceToPlayer < 32) {
          zombieState = "stalking";
        }
        break;

      case "stalking":
        stalkPlayer(direction, distanceToPlayer);
        zombie.position.y = -0.6;
        console.log(`[ZOMBIE] STALKING | dist: ${distanceToPlayer.toFixed(2)} | chase at < 10, back to patrol at > 25`);
        if (distanceToPlayer < 10) {
          zombieState = "chasing";
        } else if (distanceToPlayer > 33) {
          zombieState = "patrolling";
          isMovingToTarget = false;
        }
        break;

      case "chasing":
        chasePlayer(direction, distanceToPlayer);
        zombie.position.y = -0.6;
        console.log(`[ZOMBIE] CHASING | dist: ${distanceToPlayer.toFixed(2)} | attack at < 5, back to stalking at > 20`);
        if (distanceToPlayer < 7) {
          zombieState = "attacking";
        } else if (distanceToPlayer > 20) {
          zombieState = "stalking";
        }
        break;

      case "attacking":
        const now = clock.getElapsedTime();
        console.log(`[ZOMBIE] ATTACKING | dist: ${distanceToPlayer.toFixed(2)} | cooldown: ${(attackCooldown - (now - lastAttackTime)).toFixed(1)}s left`);
        if (now - lastAttackTime > attackCooldown) {
          onZombieAttack();
          lastAttackTime = now;
        }
        if (distanceToPlayer > 5) {
          zombieState = "chasing";
          damageOverlay.style.opacity = '0';
        }
        break;

      case "wandering":
        wanderRandomly();
        console.log(`[ZOMBIE] WANDERING | dist: ${distanceToPlayer.toFixed(2)}`);
        if (distanceToPlayer < wanderDistance) {
          zombieState = "chasing";
        }
        break;
    }
  }
}


//================================================================
// Game Over Effect with Delay
//================================================================

let gameOverState = false; // Track the game over state
const gameoverSound = new Audio('/sounds/Snake (Hiss) - Sound Effect _ ProSounds(MP3_160K).mp3');  // Replace with actual path

function gameOver() {
  // Stop all animations
  if (mixer) {
    mixer.stopAllAction();  // Stop all animations
  }

 // Set the gameOverState flag to true
gameOverState = true;

// Add a delay before showing the "Game Over" message
setTimeout(() => {
  // Display "Game Over" message
  const gameOverMessage = document.createElement('div');
  gameoverSound.play();
  gameOverMessage.style.position = 'absolute';
  gameOverMessage.style.top = '50%';
  gameOverMessage.style.left = '50%';
  gameOverMessage.style.transform = 'translate(-50%, -50%)';
  gameOverMessage.style.fontSize = '48px';
  gameOverMessage.style.fontFamily = 'Courier New, Courier, monospace';
  gameOverMessage.style.color = 'red';
  gameOverMessage.style.fontWeight = 'bold';
  gameOverMessage.innerText = 'FIN DEL JUEGO\nPresiona Ctrl + R para reiniciar';
  document.body.appendChild(gameOverMessage);

  // Create the image element
  const gameOverImage = document.createElement('img');
  gameOverImage.src = '/images/pics/bloodscreen.png'; // Correct image path
  gameOverImage.style.position = 'absolute';
  gameOverImage.style.position = 'fixed';
  gameOverImage.style.top = '0';
  gameOverImage.style.left = '0';
  gameOverImage.style.width = '100%';
  gameOverImage.style.height = '100%';
  gameOverImage.style.filter = 'contrast(41)';
  gameOverImage.style.opacity = '0.3';
  gameOverImage.style.zIndex = '-5'; // Set the z-index behind other elements
  document.body.appendChild(gameOverImage); // Append the image to the body

  // Listen for 'Ctrl + R' key press to restart the game
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'r') {
      restartGame();  // Restart the game when Ctrl + R is pressed
      document.body.removeChild(gameOverMessage);  // Remove the game over message
      document.body.removeChild(gameOverImage);  // Remove the image as well
    }
  });
}, 2000); // Delay for 2 seconds before showing the message

// Play the key collection sound
gameoverSound.play();
}
function triggerFloodGameOver() {
    // Blue screen overlay instead of blood
    const floodOverlay = document.createElement('div');
    floodOverlay.style.position = 'fixed';
    floodOverlay.style.top = '0';
    floodOverlay.style.left = '0';
    floodOverlay.style.width = '100%';
    floodOverlay.style.height = '100%';
    floodOverlay.style.backgroundColor = 'rgba(0, 50, 150, 0.7)';
    floodOverlay.style.zIndex = '999';
    document.body.appendChild(floodOverlay);

    // Game over message
    const gameOverMessage = document.createElement('div');
    gameOverMessage.style.position = 'fixed';
    gameOverMessage.style.top = '50%';
    gameOverMessage.style.left = '50%';
    gameOverMessage.style.transform = 'translate(-50%, -50%)';
    gameOverMessage.style.fontSize = '48px';
    gameOverMessage.style.fontFamily = 'Courier New, Courier, monospace';
    gameOverMessage.style.color = 'white';
    gameOverMessage.style.fontWeight = 'bold';
    gameOverMessage.style.textAlign = 'center';
    gameOverMessage.style.zIndex = '1000';
    gameOverMessage.innerHTML = 'TE HAS AHOGADO<br><span style="font-size:24px">Presiona Ctrl + R para reiniciar</span>';
    document.body.appendChild(gameOverMessage);

    // Stop the game loop
    gameOverState = true;
}

//================================================================
// Game Restart Function
//================================================================
function restartGame() {
  // Reset game state
  zombie.position.set(0, 0, 0); // Reset zombie position
  camera.position.set(0, 14, 24); // Reset camera position
  zombieState = "patrolling"; // Reset zombie state
  isZombieMoving = true; // Enable zombie movement

  // Restart the animation
  if (mixer) {
    mixer.stopAllAction();  // Stop any active animation
    gltf.animations.forEach((clip) => {
      mixer.clipAction(clip).play(); // Play animations again
    });
  }

  // Additional reset logic (if needed)
  // Reset the player's position, game variables, etc.

  // You can call any necessary functions to reset the game scene here
  // For example: resetPlayerPosition(), resetGameEnvironment(), etc.
}






function patrolRandomly() {
  if (!isMovingToTarget) {
    currentTarget.set(
      Math.random() * (maxX - minX) + minX,
      0,
      Math.random() * (maxZ - minZ) + minZ
    );
    isMovingToTarget = true;
  }

  const distanceToTarget = zombie.position.distanceTo(currentTarget);

  if (distanceToTarget < 1) {
    isMovingToTarget = false;
    currentTarget.set(
      Math.random() * (maxX - minX) + minX,
      0,
      Math.random() * (maxZ - minZ) + minZ
    );
  } else {
    const direction = new THREE.Vector3();
    direction.subVectors(currentTarget, zombie.position).normalize();

    const angle = Math.atan2(direction.x, direction.z);
    zombie.rotation.y = angle;

    const previousPosition = zombie.position.clone();
    zombie.position.addScaledVector(direction, 0.04);

    const zombieBox = new THREE.Box3().setFromCenterAndSize(
      zombie.position,
      new THREE.Vector3(2, 4, 2)
    );

    let hitWall = false;
    for (const wallBox of zombieWallBoxes) {
      if (zombieBox.intersectsBox(wallBox)) {
        hitWall = true;
        break;
      }
    }

    if (hitWall) {
      zombie.position.copy(previousPosition);
      isMovingToTarget = false;
    }
  }

  if (Math.random() < 0.04) {
    zombie.rotation.y += (Math.random() - 0.5) * Math.PI / 4;
  }
}

function stalkPlayer(direction, distanceToPlayer) {
  if (isPlayerLookingAtZombie()) return;

 const previousPosition = zombie.position.clone();
  zombie.position.addScaledVector(direction, 0.090 * zombieMoveSpeedMultiplier);

  const zombieBox = new THREE.Box3().setFromCenterAndSize( // ← ADD
    zombie.position,
    new THREE.Vector3(2, 4, 2)
  );
 for (const wallBox of zombieWallBoxes) {              // ← ADD
    if (zombieBox.intersectsBox(wallBox)) {
      zombie.position.copy(previousPosition);
      break;
    }
  }

  const angle = Math.atan2(direction.x, direction.z);
  zombie.rotation.y = angle;
  zombie.rotation.x = 0;
  zombie.rotation.z = 0;
  zombie.position.y = 3;

  const volume = THREE.MathUtils.clamp(0.3 - distanceToPlayer / 80, 0, 0.3);
  zombieSound1.volume = volume;
  zombieSound2.volume = volume;
  if (zombieSound1.paused) zombieSound1.play();
  if (zombieSound2.paused) zombieSound2.play();
}



// Chase the player
function chasePlayer(direction, distanceToPlayer) {
  let speed = 0.04;
  if (distanceToPlayer < 15) speed = 0.07;
  if (distanceToPlayer < 8)  speed = 0.11;
   speed *= zombieMoveSpeedMultiplier;

  const previousPosition = zombie.position.clone();       // ← ADD
  zombie.position.addScaledVector(direction, speed);

  const zombieBox = new THREE.Box3().setFromCenterAndSize( // ← ADD
    zombie.position,
    new THREE.Vector3(2, 4, 2)
  );
for (const wallBox of zombieWallBoxes) {              // ← ADD
    if (zombieBox.intersectsBox(wallBox)) {
      zombie.position.copy(previousPosition);
      break;
    }
  }

  zombie.lookAt(camera.position);
  zombie.rotation.x = 0;
  zombie.rotation.z = 0;
  zombie.position.y = 7;

  const volume = THREE.MathUtils.clamp(1 - distanceToPlayer / 26, 0, 1);
  zombieSound1.volume = volume;
  zombieSound2.volume = volume;
  if (distanceToPlayer <= 26) {
    if (zombieSound1.paused) zombieSound1.play();
    if (zombieSound2.paused) zombieSound2.play();
  } else {
    zombieSound1.pause();
    zombieSound2.pause();
  }
}
// Wander randomly within the defined area
function wanderRandomly() {
  if (!isMovingToTarget) {
    // Set a random target within the defined area
    currentTarget.set(
      Math.random() * (maxX - minX) + minX,  // Random x within the range
      0,  // Y remains constant (since this is a flat 2D plane for movement)
      Math.random() * (maxZ - minZ) + minZ   // Random z within the range
    );
    isMovingToTarget = true;  // Start moving to the new target
  }

  // Move zombie towards the target
  const distanceToTarget = zombie.position.distanceTo(currentTarget);
  
  if (distanceToTarget < 1) {
    // If the zombie reaches the target, stop moving and pick a new target
    isMovingToTarget = false;
    currentTarget.set(
      Math.random() * (maxX - minX) + minX,  // Random x within the range
      0,  // Y remains constant (since this is a flat 2D plane for movement)
      Math.random() * (maxZ - minZ) + minZ   // Random z within the range
    );
  } else {
    // Move towards the target
    const direction = new THREE.Vector3();
    direction.subVectors(currentTarget, zombie.position).normalize();

    // Update zombie's rotation to face the target
    const angle = Math.atan2(direction.x, direction.z);  // Calculate the angle
    zombie.rotation.y = angle;  // Make the zombie face the target

    const wanderSpeed = 0.05;  // Wander speed
    zombie.position.addScaledVector(direction, wanderSpeed);  // Move towards the target
  }

  // Optional: Randomly rotate slightly to simulate looking around
  if (Math.random() < 0.04) {
    zombie.rotation.y += (Math.random() - 0.5) * Math.PI / 4; // Randomly adjust rotation
  }
}




//================================================================
// Character (Zombie) Setup
//================================================================
let zombie, zombie2, mixer;
let zombieMoveSpeedMultiplier = 1;
let zombieStuckTimer = 0;
let zombieLastPosition = new THREE.Vector3();
const STUCK_THRESHOLD = 10; // seconds
const STUCK_DISTANCE = 0.5; // how little movement = "stuck"

// ── helper to load a zombie model and swap it in ──────────────────
function loadZombieModel(path, scale, position, animSpeed = 1, moveSpeedMultiplier = 1, onLoaded) {
    loader.load(path, (gltf) => {
        const newZombie = gltf.scene;
        newZombie.scale.set(...scale);
        newZombie.position.copy(position || new THREE.Vector3(0, 5, 0));
        newZombie.castShadow = true;
        newZombie.receiveShadow = true;

        newZombie.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    metalness: 0.2,
                    roughness: 0.6,
                    side: THREE.DoubleSide
                });
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        if (mixer) mixer.stopAllAction();
        if (zombie) scene.remove(zombie);

        zombie = newZombie;
        scene.add(zombie);

        zombieMoveSpeedMultiplier = moveSpeedMultiplier; // ← NEW

        mixer = new THREE.AnimationMixer(zombie);
        gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
            action.timeScale = animSpeed;
        });

        if (onLoaded) onLoaded();
    });
}



// ── Load first model immediately ──────────────────────────────────

// ── Load first model immediately ──────────────────────────────────
loadZombieModel(
    '/images/models/exaggerated_female_walk.glb',
    [4, 5, 3],
    new THREE.Vector3(0, 5, 0),
    1.5,
    1.0,
    () => {
        console.log('Female zombie loaded! Starting 20s timer...');

        setTimeout(() => {
            const savedPosition = zombie.position.clone();

            loadZombieModel(
                '/images/models/Running Crawl.fbx.glb',
                [0.090, 0.090, 0.090],
                savedPosition,
                3.5,
                2.0,
                null,
                true // make shiny black
            );
        }, 20000);
    }
);
//================================================================
// Input and Controls
//================================================================
document.addEventListener('click', () => {
  if (!currentUser) return; // Fixed: only allow pointer lock if logged in
  if (!isFirstPerson) {
    pointerLockControls.lock(); // Enable first-person mode
    isFirstPerson = true;
  }
});

document.addEventListener('keydown', (event) => {
  if (!currentUser) return;
  if (event.key === 'Escape' && isFirstPerson) {
    pointerLockControls.unlock(); // Exit first-person mode
    isFirstPerson = false;
  }
});






//================================================================
// Candle Setup and Interactions
//================================================================

let lightObject;

let pointLight; // For candle-like light

let candleMixer;
// Load the .glb model for the candle
loader.load(
  './images/models/flashlight_electricity_lamp_the_light.glb',
  function (gltf) {
    lightObject = gltf.scene;

    // ── Wrap in a group so camera's bounding box stays clean ──
    const flashlightHolder = new THREE.Group();
    camera.add(flashlightHolder);

    lightObject.position.set(0, 0, 9.5);
    lightObject.scale.set(0.01, 0.01, 0.01);
    lightObject.rotation.x = Math.PI / -2;

    // ── Put every mesh on layer 1 so it renders on top ──
    lightObject.traverse((child) => {
      if (child.isMesh) {
  child.material = child.material.clone();

    child.material.map = null;
    child.material.emissiveMap = null;

    
    child.material.emissive.set(0x32CD32);
    child.material.emissiveIntensity = 0.3;

    child.material.needsUpdate = true;
        child.layers.set(1);           // separate layer
        child.renderOrder = 999;       // always draw last (on top)
        child.material = child.material.clone();
        child.material.depthTest = false;   // never hidden behind walls
        child.material.depthWrite = false;
        child.raycast = () => {};      // disable collision raycasting
      }
    });

    flashlightHolder.add(lightObject);

    // ── Point light stays on default layer ──
    pointLight = new THREE.PointLight(0xff0000, 1, 10);
    pointLight.position.set(0, 0, -1);
    // NO scale.set() on lights — it does nothing and inflates bounding box
    flashlightHolder.add(pointLight);

    // ── Tell camera to also render layer 1 ──
    camera.layers.enable(1);

    // ── Start hidden ──
    lightObject.visible = false;
    pointLight.visible = false;

    // ── F key toggle ──
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF') return;
      if (flashlightCooldown) return; // still cooling down, do nothing

      if (!flashlightOn) {
        // Turn ON
        flashlightOn = true;
        lightObject.visible = true;
        pointLight.visible = true;
        showFlashlightMessage('🔦 Flashlight ON', 1500);

        // Auto turn off after 5s and start cooldown
        setTimeout(() => {
          flashlightOn = false;
          lightObject.visible = false;
          pointLight.visible = false;
          flashlightCooldown = true;
          showFlashlightMessage('🔥 Overheat — please wait 5 seconds...', 5000);

          // Cooldown ends after 5s
          setTimeout(() => {
            flashlightCooldown = false;
            showFlashlightMessage('✅ Flashlight ready', 2000);
          }, 5000);
        }, 5000); // flashlight stays on for 5 seconds

      } else {
        // Manual early turn off
        flashlightOn = false;
        lightObject.visible = false;
        pointLight.visible = false;
        flashlightCooldown = true;
        showFlashlightMessage('🔥 Overheat — please wait 5 seconds...', 5000);

        setTimeout(() => {
          flashlightCooldown = false;
          showFlashlightMessage('✅ Flashlight ready', 2000);
        }, 5000);
      }
    });

    if (gltf.animations && gltf.animations.length) {
      candleMixer = new THREE.AnimationMixer(lightObject);
      gltf.animations.forEach((clip) => {
        candleMixer.clipAction(clip).play();
      });
    }
  },
  undefined,
  function (error) {
    console.error('An error occurred while loading the model:', error);
  }
);



















//================================================================
// Key Setup and Interactions
//================================================================
let hasKey = false;  
let hasUsedKey = false; 
let boundDoor = null;  

// Sound effect for collecting the key
const keyCollectSound = new Audio('/sounds/key.mp3');  // Replace with actual path

// Sound effect for opening the door
const doorOpenSound = new Audio('/sounds/Door.mp3');  // Replace with actual path
doorOpenSound.volume = 1.0;  // Set volume to maximum

// Load the .glb model for the key
let keyObject;
loader.load('/images/models/metal_credit_card.glb', function (gltf) {
  keyObject = gltf.scene; 
  keyObject.position.set(35, 4,30);
  keyObject.scale.set(0.4, 0.4, 0.4); 
  scene.add(keyObject);
  keyObject.rotation.x = Math.PI / 2;
}, undefined, function (error) {
  console.error(error);
});

// Bind the key to a specific door
function bindKeyToDoor(door) {
  boundDoor = door;  // Assign the key to open this door
}

// Export functions for key-related interactions
export function showKeyCollectNote() {
  const keyCollectNote = document.getElementById('key-collect-note');
  if (keyCollectNote) {
    keyCollectNote.style.display = 'block';  // Show the key collect note
  }
}

export function hideKeyCollectNote() {
  const keyCollectNote = document.getElementById('key-collect-note');
  if (keyCollectNote) {
    keyCollectNote.style.display = 'none';  // Hide the key collect note
  }
}

function checkProximityToKey(playerPosition) {
  if (keyObject && !hasKey) {
    const keyPosition = keyObject.position.clone();
    const distance = playerPosition.distanceTo(keyPosition);

    if (distance < 4) {
      onKeyCollected();
      hideKeyCollectNote();
    } else if (distance < 7) {
      showKeyCollectNote();
      const note = document.getElementById('key-collect-note');
      if (note) note.textContent = "Acércate para recoger la tarjeta";
    } else {
      hideKeyCollectNote();
    }
  }
}

// Handle key press to collect the key
function onKeyPress(event) {
  if (event.key === 'c' && !hasUsedKey) {  // Only collect key if it hasn't been used yet
    const distanceToKey = camera.position.distanceTo(keyObject.position);
    if (distanceToKey < 15) {
      onKeyCollected();
      hideKeyCollectNote();
      keyCollectSound.play();  // Play the sound when the key is collected
    }
  }
}

// Function to collect the key
function onKeyCollected() {
  if (keyObject) {
    // Remove the key from its current position in the scene
    scene.remove(keyObject);

    // Attach the key to the camera
    camera.add(keyObject);

    // Position the key in front of the camera (e.g., 2 units forward, 0.5 units up)
    keyObject.position.set(0.2, -0.5, -1); // Adjust as needed
    
    // Adjust the scale to make the key visible but not too large
    keyObject.scale.set(0.3, 0.4, 0.3); // Fine-tune scale if needed
  }


  hasKey = true; // Update the flag

  // Hide the key collect note
  hideKeyCollectNote();

  // Play the key collection sound
  keyCollectSound.play();

  // Show the key in the inventory UI (optional)
  const keyImageContainer = document.getElementById('key-image-container');
  if (keyImageContainer) {
    keyImageContainer.style.display = 'block';
  }
}



//================================================================
// Door Setup and Interactions
//================================================================

// Load the texture for the door
const doorTexture = textureLoader.load('images/texture/moderndoor.jpg'); // Set your image path

// Set the texture to repeat
doorTexture.wrapS = THREE.RepeatWrapping;  // Repeat the texture on the X-axis
doorTexture.wrapT = THREE.RepeatWrapping;  // Repeat the texture on the Y-axis

// Adjust the number of times the texture repeats (adjust these values as needed)
doorTexture.repeat.set(1, 1);  // Repeat the texture 2 times along X, 3 times along Y

// Create a material with the loaded texture
const doorMaterial = new THREE.MeshStandardMaterial({
  map: doorTexture,  // Apply the texture to the material

  side: THREE.DoubleSide  // Optionally, apply texture to both sides of the door
});

// Define the door geometry (size of the door)
const doorGeometry = new THREE.BoxGeometry(3, 6, 0.2); // Width, height, depth of the door

// Create the door mesh with the geometry and material
const door = new THREE.Mesh(doorGeometry, doorMaterial);

// Position the door in your scene (adjust position as needed)
door.position.set(24, 4,44); // Example position (x, y, z)
door.rotation.y = Math.PI / -2;
door.scale.set(3,2, 7); // Example position (x, y, z)

// Add the door to the scene
scene.add(door);

// Bind the key to this door
bindKeyToDoor(door);

let doorOpen = false; // Flag to track if the door is open

function checkProximityToDoor(playerPosition) {
  const doorPosition = door.position.clone();
  const distanceToDoor = playerPosition.distanceTo(doorPosition);

  if (distanceToDoor < 10) { 
    if (hasKey && !doorOpen && !hasUsedKey && boundDoor === door) {  // Ensure the key is bound to this door
      if (distanceToDoor < 4) {
        openDoor();
        hideDoorNote();
      } else {
        showDoorOpenNote();
        const note = document.getElementById('door-open-note');
        if (note) note.textContent = "Acércate para abrir la puerta";
      }
    } else if (!doorOpen) {
      showNoKeyNote();
    }
  } else {
    hideDoorNote();  // Hide the door prompt when not close
  }
}

function openDoor() {
  if (doorOpen) return; // Prevent reopening if already open
  doorOpen = true;

  // Animate the door's position to simulate it opening
  const doorTargetPosition = door.position.clone();
  doorTargetPosition.z -= 5.4; // Move the door 5 units to the left (adjust as needed)
  
  const animationDuration = 1; // 1-second animation
  let startTime = performance.now();

  // Remove the door's collision from the wallBoundingBoxes before starting the animation
  const doorBox = new THREE.Box3().setFromObject(door);
  const doorIndex = wallBoundingBoxes.findIndex(box => box.equals(doorBox));
  if (doorIndex !== -1) {
    wallBoundingBoxes.splice(doorIndex, 1); // Remove the bounding box for the door
  }

  function animateDoor() {
    const elapsedTime = (performance.now() - startTime) / 50000; // Time elapsed in seconds
    if (elapsedTime < animationDuration) {
      // Lerp (smooth transition) between current position and target position
      door.position.lerp(doorTargetPosition, elapsedTime / animationDuration);
      requestAnimationFrame(animateDoor);
    } else {
      // Ensure the door ends up at the final position
      door.position.copy(doorTargetPosition);
    }
  }

  animateDoor();



  // Play door open sound
  doorOpenSound.play();

  // Mark the key as used
  hasUsedKey = true;

  // Remove the key from the camera and scene
  if (keyObject) {
    camera.remove(keyObject); // Detach from the camera
    keyObject = null; // Fully remove the key reference
    const keyImageContainer = document.getElementById('key-image-container');
  if (keyImageContainer) {
    keyImageContainer.style.display = 'none';  // Hide the key image
  }
  }

  // Hide the inventory image
  hideKeyImage();
}


// Show the door prompt
function showDoorOpenNote() {
  const doorNote = document.getElementById('door-open-note');
  if (doorNote) {
    doorNote.style.display = 'block';  // Show the "Press E to open the door" note
  }
}

// Hide the door prompt
function hideDoorNote() {
  const doorNote = document.getElementById('door-open-note');
  if (doorNote) {
    doorNote.style.display = 'none';  // Hide the door prompt
  }
}

// Show the "no key" message
function showNoKeyNote() {
  const noKeyNote = document.getElementById('no-key-note');
  if (noKeyNote) {
    noKeyNote.style.display = 'block';  // Show "You need the key" note
  }
}




import TWEEN from '@tweenjs/tween.js';

// Initialize audio elements for each action with max volume
const wrongPasswordSound = new Audio('/sounds/Sound effect WRONG ANSWER.mp3');
const correctPasswordSound = new Audio('/sounds/Correct answer Sound effect.mp3');
const typingSound = new Audio('/sounds/enter button on a keyboard sound effect (royalty free).mp3');
const deviceInteractionSound = new Audio('/sounds/90s PC boot sequence with sound HD.mp3');
const doorOpenSound1 = new Audio('/sounds/Faction Vault Door Open (Fortnite Sound) - Sound Effect for editing.mp3');  // Path to the door open sound effect




wrongPasswordSound.volume = 1.0;
correctPasswordSound.volume = 1.0;
typingSound.volume = 1.0;
deviceInteractionSound.volume = 1.0;
doorOpenSound1.volume = 1.0;  // Set volume to maximum


// Create the password door and device
let passwordDoor, passwordDevice;
let correctPassword = "1532";  // Correct password
let enteredPassword = "";  // Holds the player's input
let isInteracting = false;  // To check if the player is interacting
let interactionUI;  // UI elements for instructions
let inputDiv;  // Password input div
let playerPosition;  // Store player's position for distance check
let deviceInteracted = false;  // To track if the device has been interacted with already

const customDoorTexture = textureLoader.load('/images/texture/glass.jpg');  // Set your image path

// Set texture wrapping
customDoorTexture.wrapS = THREE.RepeatWrapping;  // Repeat the texture on the X-axis
customDoorTexture.wrapT = THREE.RepeatWrapping;  // Repeat the texture on the Y-axis

// Adjust the number of times the texture repeats
customDoorTexture.repeat.set(1, 1);  // Repeat the texture 1 time along X, 1 time along Y

// Create material with transparency and smoothness
const customDoorMaterial = new THREE.MeshStandardMaterial({
  map: customDoorTexture,        // Apply the texture
  transparent: true,             // Enable transparency
  opacity: 0.7,                  // Set semi-transparency (adjust 0 to 1 for desired effect)
  roughness: 0,                  // Make the material completely smooth
  side: THREE.DoubleSide         // Apply the texture to both sides
});

// Define geometry for the door
const customDoorGeometry = new THREE.BoxGeometry(1, 3, 0.2); // Width, height, depth of the door

// Create the door mesh
const texturedPasswordDoor = new THREE.Mesh(customDoorGeometry, customDoorMaterial);

// Position and scale the door
texturedPasswordDoor.position.set(23, 7, -42); // Same position as the original door
texturedPasswordDoor.rotation.y = Math.PI / 2;
texturedPasswordDoor.scale.set(16, 6, 4);  // Example scale (width, height, depth)

// Add the door to the scene
scene.add(texturedPasswordDoor);


























// Declare model variables in one line
let chair
, desk, aircon, flower, frame, dispenser,
 design1, design2, design3, hallchairs, cheaproom,
  fence, statue, nearstatue, dead, fallingdebris;

// Array to hold model bounding boxes
// modelBoundingBoxes is already declared globally at the top
const models = [];  // List to hold models once they are loaded

// Define the shrink factor for reducing collision bounding box size
const shrinkFactor = -3; // Adjust this value to reduce collision strength
//-1/4

// Load and add chair model to the scene
loader.load('/images/models/day_20__old_office_chair.glb', (gltf) => {
    chair = gltf.scene;
    chair.position.set(40, 2, -42);
    chair.scale.set(7, 5, 5);
    chair.rotation.x = Math.PI / 4;
    chair.rotation.z = -Math.PI / 1.9;
    chair.castShadow = true;
    chair.receiveShadow = true;
    scene.add(chair);
    
    // Add the chair to models and modelBoundingBoxes
    models.push(chair);
    const chairBox = new THREE.Box3().setFromObject(chair);
    chairBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(chairBox);
});

// Load and add desk model to the scene
loader.load('/images/models/office_desk.glb', (gltf) => {
    desk = gltf.scene;
    desk.position.set(40, 0.050, 33);
    desk.scale.set(0.130, 0.130, 0.130);
    desk.rotation.y = Math.PI / -1;
    desk.castShadow = true;
    desk.receiveShadow = true;
    scene.add(desk);
    
    // Add the desk to models and modelBoundingBoxes
    models.push(desk);
    const deskBox = new THREE.Box3().setFromObject(desk);
    deskBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(deskBox);
});

// Load and add air conditioner model to the scene
loader.load('/images/models/old_aircon.glb', (gltf) => {
    aircon = gltf.scene;
    aircon.position.set(34, 9, 28);
    aircon.scale.set(0.8, 0.8, 0.8);
    aircon.rotation.y = Math.PI / -2;
    aircon.castShadow = true;
    aircon.receiveShadow = true;
    scene.add(aircon);
    
    // Add the aircon to models and modelBoundingBoxes
    models.push(aircon);
    const airconBox = new THREE.Box3().setFromObject(aircon);
    airconBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(airconBox);
});
/*
// Load and add flower model to the scene
loader.load('/images/models/flowering_cannabis_plant_in_a_pot.glb', (gltf) => {
    flower = gltf.scene;
    flower.position.set(30.4, 0, 31);
    flower.scale.set(0.030, 0.030, 0.030);
    flower.rotation.y = Math.PI / -2;
    flower.castShadow = false;
    flower.receiveShadow = true;
    scene.add(flower);
    
    // Add the flower to models and modelBoundingBoxes
    models.push(flower);
    const flowerBox = new THREE.Box3().setFromObject(flower);
    flowerBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(flowerBox);
});*/

// Load and add frame model to the scene
loader.load('/images/models/picture_frame.glb', (gltf) => {
    frame = gltf.scene;
    frame.position.set(46, 0, 43);
    frame.scale.set(1.3, 1.3, 1.3);
    frame.rotation.y = Math.PI / -2;
    frame.castShadow = true;
    frame.receiveShadow = true;
    scene.add(frame);
    
    // Add the frame to models and modelBoundingBoxes
    models.push(frame);
    const frameBox = new THREE.Box3().setFromObject(frame);
    frameBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(frameBox);
});





loader.load('/images/models/isometric_office.glb', (gltf) => {
  design1 = gltf.scene;
  design1.position.set(10, 0, -30);
  design1.scale.set(6, 5, 6);
  design1.rotation.y = Math.PI / 100;
  design1.castShadow = true;
  design1.receiveShadow = true;
  //scene.add(design1);

  const design1ShrinkFactor = -7.2;

  //models.push(design1);
  const design1Box = new THREE.Box3().setFromObject(design1);
  design1Box.expandByVector(new THREE.Vector3(design1ShrinkFactor, design1ShrinkFactor, design1ShrinkFactor));
  //modelBoundingBoxes.push(design1Box);

  const pushBackAmount = 0.00010;
  const bounceDamping = 0.00010;

  function handleCameraBounce(camera, modelBox) {
    const cameraBox = new THREE.Box3().setFromObject(camera);

    if (cameraBox.intersectsBox(modelBox)) {
      const collisionNormal = new THREE.Vector3().subVectors(camera.position, modelBox.getCenter(new THREE.Vector3())).normalize();
      camera.position.add(collisionNormal.multiplyScalar(pushBackAmount));
      const velocity = new THREE.Vector3();
      velocity.add(collisionNormal.multiplyScalar(pushBackAmount));
      velocity.multiplyScalar(bounceDamping);
      camera.position.add(velocity);
    }
  }

  handleCameraBounce(camera, design1Box);
});




// Load and add office of a crane operator model to the scene
loader.load('/images/models/office_of_a_crane_operator.glb', (gltf) => {
    design2 = gltf.scene;
    design2.position.set(-75, -1, 40);
    design2.scale.set(7, 5, 4);
    design2.rotation.y = Math.PI / -2;
    design2.castShadow = true;
    design2.receiveShadow = true;
    scene.add(design2);
    
    // Add the design2 to models and modelBoundingBoxes
    models.push(design2);
    const design2Box = new THREE.Box3().setFromObject(design2);
    design2Box.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(design2Box);
});



loader.load('/images/models/building_hallway.glb', (gltf) => {
  design3 = gltf.scene;
  design3.position.set(-115, -39, -40);
  design3.scale.set(0.120, 0.110, 0.120);
  design3.rotation.y = Math.PI;
  design3.castShadow = true;
  design3.receiveShadow = true;
  //scene.add(design3);

  const design3ShrinkFactor = -116.8;

  models.push(design3);
  const design3Box = new THREE.Box3().setFromObject(design3);
  design3Box.expandByVector(new THREE.Vector3(design3ShrinkFactor, design3ShrinkFactor, design3ShrinkFactor));
  modelBoundingBoxes.push(design3Box);

  const pushBackAmount = 0.010;
  const bounceDamping = 0.010;

  function handleCameraBounce(camera, modelBox) {
      const cameraBox = new THREE.Box3().setFromObject(camera);

      if (cameraBox.intersectsBox(modelBox)) {
          const collisionNormal = new THREE.Vector3().subVectors(camera.position, modelBox.getCenter(new THREE.Vector3())).normalize();
          camera.position.add(collisionNormal.multiplyScalar(pushBackAmount));
          const velocity = new THREE.Vector3();
          velocity.add(collisionNormal.multiplyScalar(pushBackAmount));
          velocity.multiplyScalar(bounceDamping);
          camera.position.add(velocity);
      }
  }

  handleCameraBounce(camera, design3Box);
});




// Load and add checkered tile floor model to the scene, but not include it for collision detection
loader.load('/images/models/checkered_tile_floor.glb', (gltf) => {
    floor = gltf.scene;
    floor.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.roughness = 0;
            child.material.needsUpdate = true;
        }
    });
    floor.position.set(0, 1, 0);
    floor.scale.set(0.410, 0.5, 0.450);
    floor.rotation.y = Math.PI / -2;
    floor.castShadow = true;
    floor.receiveShadow = true;
    scene.add(floor);
});

// Load and add waiting chair model to the scene
loader.load('/images/models/waiting_chair.glb', (gltf) => {
    hallchairs = gltf.scene;
    hallchairs.position.set(-15, -1, 47);
    hallchairs.scale.set(6, 6, 6);
    hallchairs.rotation.y = Math.PI;
    hallchairs.castShadow = true;
    hallchairs.receiveShadow = true;
    scene.add(hallchairs);
    
    // Add the hallchairs to models and modelBoundingBoxes
    models.push(hallchairs);
    const hallchairsBox = new THREE.Box3().setFromObject(hallchairs);
    hallchairsBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(hallchairsBox);
});

// Load and add low poly office cubicle model to the scene
loader.load('/images/models/low_poly_90s_office_cubicle.glb', (gltf) => {
  cheaproom = gltf.scene;
  cheaproom.position.set(39, -1, 6.2);
  cheaproom.scale.set(9, 6, 9);
  cheaproom.rotation.y = Math.PI / 2;
  cheaproom.castShadow = true;
  cheaproom.receiveShadow = true;
  scene.add(cheaproom);
  
  // Set the specific shrink factor for this model
  const cheaproomShrinkFactor = -7.7; // Customize the shrink factor here

  // Add the cheaproom to models and modelBoundingBoxes
  models.push(cheaproom);
  const cheaproomBox = new THREE.Box3().setFromObject(cheaproom);
  cheaproomBox.expandByVector(new THREE.Vector3(cheaproomShrinkFactor, cheaproomShrinkFactor, cheaproomShrinkFactor));  // Shrink collision volume
  modelBoundingBoxes.push(cheaproomBox);

  // Customizable push-back and bounce damping for this model
  const pushBackAmount = 0.0010;  // Amount to push back the camera
  const bounceDamping = 0.0010;  // Factor to reduce the bounce

  // Update the camera position based on collision with this model
  function handleCameraBounce(camera, modelBox) {
      const cameraBox = new THREE.Box3().setFromObject(camera);

      if (cameraBox.intersectsBox(modelBox)) {
          // Collision detected, calculate collision normal
          const collisionNormal = new THREE.Vector3().subVectors(camera.position, modelBox.getCenter(new THREE.Vector3())).normalize();
          
          // Push the camera back slightly
          camera.position.add(collisionNormal.multiplyScalar(pushBackAmount));
          
          // Apply a damping effect to the bounce (if desired)
          const velocity = new THREE.Vector3();  // You can adjust how the camera "bounces" using this vector
          velocity.add(collisionNormal.multiplyScalar(pushBackAmount));
          velocity.multiplyScalar(bounceDamping);  // Apply the bounce damping to reduce bounce over time
          camera.position.add(velocity);  // Apply the velocity (adjusted by damping)
      }
  }

  // Call this function within your game loop to check and handle the collision for this specific model
  // Assuming you have a game loop where the camera is being updated regularly
  handleCameraBounce(camera, cheaproomBox);
});


// Load and add simple metal fence model to the scene
loader.load('/images/models/simple_metal_fence.glb', (gltf) => {
    const fence = gltf.scene;
    fence.position.set(-45, 7, -40);
    fence.scale.set(1.2, 2, 1.2);
    fence.rotation.y = Math.PI / -6;
    fence.castShadow = true;
    fence.receiveShadow = true;
    scene.add(fence);
    
    // Add the fence to models and modelBoundingBoxes
    models.push(fence);
    const fenceBox = new THREE.Box3().setFromObject(fence);
    fenceBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(fenceBox);
});

// Load and add statue of Edward Snowden model to the scene
// Load and add statue of Edward Snowden model to the scene
loader.load('/images/models/statue_of_edward_snowden.glb', (gltf) => {
  const statue = gltf.scene;
  statue.position.set(29, 7, -28);
  statue.scale.set(2, 2, 2);
  statue.rotation.y = Math.PI / 2;
  statue.castShadow = true;
  statue.receiveShadow = true;
  scene.add(statue);
  
  // Set the specific shrink factor for this model
  const statueShrinkFactor = -3; // Customize the shrink factor here

  // Add the statue to models and modelBoundingBoxes
  models.push(statue);
  const statueBox = new THREE.Box3().setFromObject(statue);
  statueBox.expandByVector(new THREE.Vector3(statueShrinkFactor, statueShrinkFactor, statueShrinkFactor));  // Shrink collision volume
  modelBoundingBoxes.push(statueBox);
});

// Load and add water dispenser near statue model to the scene
loader.load('/images/models/water_dispenser.glb', (gltf) => {
    const nearstatue = gltf.scene;
    nearstatue.position.set(28, 6, -18);
    nearstatue.scale.set(3, 3, 3);
    nearstatue.rotation.y = Math.PI / 2;
    nearstatue.castShadow = true;
    nearstatue.receiveShadow = true;
    scene.add(nearstatue);
    
    // Add the nearstatue dispenser to models and modelBoundingBoxes
    models.push(nearstatue);
    const nearstatueBox = new THREE.Box3().setFromObject(nearstatue);
    nearstatueBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
    modelBoundingBoxes.push(nearstatueBox);
});

// Load and add abandoned office ceiling model to the scene
loader.load('/images/models/abandoned_office_ceiling.glb', (gltf) => {
    const ceiling = gltf.scene;
    ceiling.position.set(-149, 40, 100);
    ceiling.scale.set(2, 2, 2);
    ceiling.rotation.y = Math.PI / 2;
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;
    ceiling.traverse((child) => {
        if (child.isMesh) {
            child.material = child.material.clone();
            child.material.roughness = 0;
        }
    });
    scene.add(ceiling);
    
   
});


// Load and add low poly dead body model to the scene
loader.load('/images/models/low_poly_dead_body_covered_game_ready.glb', (gltf) => {
  const dead = gltf.scene;
  dead.position.set(10, 1, 40.2);
  dead.scale.set(5, 5, 5);
  dead.rotation.y = Math.PI / 2;
  dead.traverse((child) => {
      if (child.isMesh) {
          child.material = child.material.clone();
          child.material.roughness = 1;
      }
  });
  scene.add(dead);
  
  // Add the dead body to models and modelBoundingBoxes
  models.push(dead);
  const deadBox = new THREE.Box3().setFromObject(dead);
  deadBox.expandByVector(new THREE.Vector3(shrinkFactor, shrinkFactor, shrinkFactor));  // Shrink collision volume
  modelBoundingBoxes.push(deadBox);
});

// Load and add debris falling from ceiling model to the scene
loader.load('/images/models/falling_debris_ceiling.glb', (gltf) => {
  const fallingdebris = gltf.scene;
  fallingdebris.position.set(1, 3, -40);
  fallingdebris.scale.set(4, 6, 5);
  fallingdebris.rotation.y = Math.PI / 2;
  fallingdebris.castShadow = true;
  fallingdebris.receiveShadow = true;
  scene.add(fallingdebris);
  
  // Add the falling debris to models and modelBoundingBoxes
  models.push(fallingdebris);
  
});

// Load and add falling ceiling model to the scene
loader.load('images/models/abandoned_office_ceiling.glb', (gltf) => {
  const fallceiling = gltf.scene;
  fallceiling.position.set(-27, -16.3, 54);
  fallceiling.scale.set(1, 12, 1);
  fallceiling.rotation.y = Math.PI / 2; // 90-degree rotation
  fallceiling.rotation.z = Math.PI / 8; // Slight tilt by 22.5 degrees
  fallceiling.castShadow = true;
  fallceiling.receiveShadow = true;
  scene.add(fallceiling);

  // Add the falling ceiling to models and modelBoundingBoxes
  models.push(fallceiling);
});

// Camera collision detection
function checkCameraCollision() {
    // Use a small manual box around just the camera position, NOT setFromObject(camera)
    const cameraBox = new THREE.Box3().setFromCenterAndSize(
        camera.position,
        new THREE.Vector3(1, 1.8, 1) // player body size only
    );

    for (let i = 0; i < modelBoundingBoxes.length; i++) {
        const modelBox = modelBoundingBoxes[i];
        if (cameraBox.intersectsBox(modelBox)) {
            const collisionNormal = new THREE.Vector3()
                .subVectors(camera.position, modelBox.getCenter(new THREE.Vector3()))
                .normalize();
            camera.position.add(collisionNormal.multiplyScalar(0.2));
            camera.position.add(collisionNormal.multiplyScalar(0.1));
        }
    }
}

// Adding models to the bounding box array after loading
models.forEach(model => {
  const box = new THREE.Box3().setFromObject(model);
  modelBoundingBoxes.push(box);
});




// wallBoundingBoxes is already declared globally
const walls = [frontWall, backWall, leftWall, rightWall, 
    floor , alternateFloor, LEFT1Floor , topFloor , ceiling1
    , carpet , RWSP , LWSP , TSP , ENT1 , ENT2 , texturedPasswordDoor
    , door , ENT22
];

walls.forEach(wall => {
    const box = new THREE.Box3().setFromObject(wall);
    wallBoundingBoxes.push(box);
});

// ✅ Zombie only collides with actual vertical walls, NOT floor/ceiling
// zombieWallBoxes is already declared globally
const zombieWalls = [frontWall, backWall, leftWall, rightWall,
    alternateFloor, LEFT1Floor, RWSP, LWSP, ENT1, ENT2, ENT22,
    texturedPasswordDoor, door
];
zombieWalls.forEach(wall => {
    const box = new THREE.Box3().setFromObject(wall);
    zombieWallBoxes.push(box);
});

const modelPath = '/images/models/simple_mini-atm.glb';  // Path to your .glb file

// Initialize passwordDevice as null initially
passwordDevice = null;

// Load the .glb model and add it to the scene
loader.load(modelPath, function (gltf) {
  passwordDevice = gltf.scene;
  passwordDevice.scale.set(0.0030, 0.0030, 0.0030); 
  passwordDevice.position.set(27, 6, -49.2); 
  passwordDevice.rotation.y = Math.PI / -2;
  scene.add(passwordDevice);
  console.log("Green device manager loaded");
}, undefined, function (error) {
  console.error("Error loading the GLTF model:", error);
});

// Create the UI instructions (hidden initially)
function createInteractionUI() {
  interactionUI = document.createElement('div');
  interactionUI.style.position = 'absolute';
  interactionUI.style.top = '10px';
  interactionUI.style.left = '50%';
  interactionUI.style.transform = 'translateX(-50%)';
  interactionUI.style.color = 'white';
  interactionUI.style.fontSize = '20px';
  interactionUI.style.fontFamily = 'Arial, sans-serif';
  interactionUI.innerHTML = ""; // Initially empty
  document.body.appendChild(interactionUI);
}
createInteractionUI();

// Handle key events for interaction
let typingTimeout;  // Timer for typing sound
function handleKeyPress(event) {
  if (event.key === 'e' && !isInteracting && !deviceInteracted) {
    if (isNearDevice()) {
      startPasswordInput();
      playDeviceInteractionSound();  // Play device interaction sound
    }
  } else if (event.key === 'q' && isInteracting) {
    quitInteraction();
    playDeviceInteractionSound();  // Play device interaction sound when closing
  } else if (isInteracting && event.key >= '0' && event.key <= '9') {
    enteredPassword += event.key;
    updatePasswordDisplay();
    playTypingSound();  // Play typing sound for entering password
    resetTypingSoundTimeout();  // Reset typing sound timeout to continue playing
  } else if (isInteracting && event.key === 'Enter') {
    validatePassword(enteredPassword);
  } else if (isInteracting && event.key === 'Backspace') {
    enteredPassword = enteredPassword.slice(0, -1);
    updatePasswordDisplay();
    playTypingSound();  // Play typing sound for backspace
    resetTypingSoundTimeout();  // Reset typing sound timeout to continue playing
  }
}
window.addEventListener('keydown', handleKeyPress);

// Handle mouse interaction (detect if player is looking at the device)
function onMouseMove(event) {
  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects([passwordDevice]);

  if (intersects.length > 0 && !isInteracting && isNearDevice() && !deviceInteracted) {
    interactionUI.innerHTML = "Presiona E para usar la terminal de acceso";  // Show instructions if near device
  } else if (intersects.length === 0 && !isInteracting) {
    interactionUI.innerHTML = "";  // Clear instructions when not near the device
  }
}
window.addEventListener('mousemove', onMouseMove);

// Check if player is near the device (within 15 tiles, assuming each tile is 1 unit in 3D space)
function isNearDevice() {
  if (!passwordDevice) return false;  // Make sure the device is loaded

  playerPosition = camera.position;
  const devicePosition = passwordDevice.position;
  const distance = playerPosition.distanceTo(devicePosition);
  //console.log("Distance to device:", distance);  // Log the distance to the device
  return distance <= 8;  // 8 units distance check (adjust as needed)
}

// Start the password input process
function startPasswordInput() {
  isInteracting = true;
  playDeviceInteractionSound();  // Play sound for interaction
  interactionUI.innerHTML = "Introduce la contraseña:";

  inputDiv = document.createElement('div');
  inputDiv.style.position = 'fixed';
  inputDiv.style.top = '50%';
  inputDiv.style.left = '50%';
  inputDiv.style.transform = 'translate(-50%, -50%)';
  inputDiv.style.backgroundColor = 'rgba(15, 22, 36, 0.95)';
  inputDiv.style.border = '2px solid rgba(145, 172, 173, 0.6)';
  inputDiv.style.padding = '25px';
  inputDiv.style.borderRadius = '12px';
  inputDiv.style.color = '#e0e6ed';
  inputDiv.style.fontFamily = 'Courier New, Courier, monospace';
  inputDiv.style.textAlign = 'center';
  inputDiv.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
  inputDiv.style.zIndex = '1500';
  inputDiv.style.backdropFilter = 'blur(10px)';

  // Build Virtual Keypad HTML
  inputDiv.innerHTML = `
    <div style="font-size: 20px; font-weight: bold; margin-bottom: 15px; border-bottom: 1.5px dashed rgba(145,172,173,0.3); padding-bottom: 10px; letter-spacing: 2px;">
      TERMINAL DE ACCESO
    </div>
    <div id="pwd-display" style="font-size: 28px; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 6px; letter-spacing: 5px; margin-bottom: 15px; border: 1px solid rgba(145,172,173,0.2); min-height: 34px; color: #4aff4a; font-weight: bold; display: flex; justify-content: center; align-items: center;">
      ${enteredPassword || '&nbsp;'}
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 240px; margin: 0 auto 15px;">
      <button class="keypad-btn" data-val="1">1</button>
      <button class="keypad-btn" data-val="2">2</button>
      <button class="keypad-btn" data-val="3">3</button>
      <button class="keypad-btn" data-val="4">4</button>
      <button class="keypad-btn" data-val="5">5</button>
      <button class="keypad-btn" data-val="6">6</button>
      <button class="keypad-btn" data-val="7">7</button>
      <button class="keypad-btn" data-val="8">8</button>
      <button class="keypad-btn" data-val="9">9</button>
      <button class="keypad-btn" data-val="clear" style="color: #ff4d4d;">C</button>
      <button class="keypad-btn" data-val="0">0</button>
      <button class="keypad-btn" data-val="back">⌫</button>
    </div>
    <button id="keypad-enter" style="width: 100%; max-width: 240px; background-color: #4aff4a; color: #030508; border: none; padding: 12px; font-size: 14px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-bottom: 10px; font-family: inherit; letter-spacing: 1px;">ENVIAR</button>
    <button id="keypad-close" style="width: 100%; max-width: 240px; background-color: transparent; color: #ff4d4d; border: 1.5px solid rgba(255, 77, 77, 0.4); padding: 10px; font-size: 13px; font-weight: bold; border-radius: 6px; cursor: pointer; font-family: inherit; letter-spacing: 1px;">SALIR</button>
    
    <style>
      .keypad-btn {
        background: rgba(255,255,255,0.05);
        border: 1.5px solid rgba(145, 172, 173, 0.4);
        color: #e0e6ed;
        font-size: 18px;
        font-weight: bold;
        padding: 12px 0;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        transition: all 0.15s ease;
        user-select: none;
        -webkit-user-select: none;
      }
      .keypad-btn:active {
        background: rgba(145, 172, 173, 0.3);
        transform: scale(0.95);
        border-color: #ffffff;
      }
    </style>
  `;

  document.body.appendChild(inputDiv);

  // Add click listeners to virtual buttons
  inputDiv.querySelectorAll('.keypad-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = btn.getAttribute('data-val');
      if (val === 'clear') {
        enteredPassword = "";
        playTypingSound();
      } else if (val === 'back') {
        enteredPassword = enteredPassword.slice(0, -1);
        playTypingSound();
      } else {
        if (enteredPassword.length < 8) {
          enteredPassword += val;
          playTypingSound();
        }
      }
      updatePasswordDisplay();
      resetTypingSoundTimeout();
    });
  });

  const enterBtn = document.getElementById('keypad-enter');
  if (enterBtn) {
    enterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      validatePassword(enteredPassword);
    });
  }

  const closeBtn = document.getElementById('keypad-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      quitInteraction();
      playDeviceInteractionSound();
    });
  }
}

// Update the password display (show the entered password)
function updatePasswordDisplay() {
  const display = document.getElementById('pwd-display');
  if (display) {
    display.innerHTML = enteredPassword || '&nbsp;';
    display.style.color = isCorrectPassword() ? '#4aff4a' : '#ff4d4d';
  }
}

// Validate the entered password
function validatePassword(password) {
  console.log("Entered Password:", password);  // Debugging the entered password
  if (password === correctPassword) {
    openPasswordDoor();
    showPasswordMessage(true);
    playCorrectPasswordSound();  // Play correct password sound
    setTimeout(() => quitInteraction(), 2000); // Delay before quitting interaction
    deviceInteracted = true;
  } else {
    showPasswordMessage(false);
    playWrongPasswordSound();  // Play wrong password sound
    enteredPassword = ""; // Reset password input to try again
  }
}

// Check if the entered password is correct
function isCorrectPassword() {
  return enteredPassword === correctPassword;
}

// Show password validation message with styling
function showPasswordMessage(isCorrect) {
  const messageDiv = document.createElement('div');
  messageDiv.style.position = 'absolute';
  messageDiv.style.top = '60%';
  messageDiv.style.left = '50%';
  messageDiv.style.transform = 'translateX(-50%)';
  messageDiv.style.color = isCorrect ? 'green' : 'red';
  messageDiv.style.fontFamily = 'fantasy';
  messageDiv.style.fontSize = '30px';
  messageDiv.style.textAlign = 'center';
  
  if (isCorrect) {
    messageDiv.innerHTML = "¡Correcto! Contraseña aceptada. La puerta está abierta.";
  } else {
    messageDiv.innerHTML = "¡Contraseña incorrecta! Inténtalo de nuevo.";
  }

  document.body.appendChild(messageDiv);

  // Remove the message after 3 seconds
  setTimeout(() => {
    document.body.removeChild(messageDiv);
  }, 3000);
}
function openPasswordDoor() {
  // Play the door sound only if it's not already playing
  if (doorOpenSound1.paused || doorOpenSound1.ended) {
    doorOpenSound1.play();
  }

  // Remove the bounding box for the door before the animation starts
  const doorBox = new THREE.Box3().setFromObject(texturedPasswordDoor);
  const doorIndex = wallBoundingBoxes.findIndex(box => box.equals(doorBox));
  if (doorIndex !== -1) {
    wallBoundingBoxes.splice(doorIndex, 1); // Remove the bounding box for the door
  }

  // Animate the door opening (slide the door very slightly upward on the y-axis)
  const openDoorAnimation = new TWEEN.Tween(texturedPasswordDoor.position)
    .to({ y: texturedPasswordDoor.position.y + 11 }, 6000)  // Slide the door by a very small amount on the y-axis
    .easing(TWEEN.Easing.Quadratic.Out)
    .onComplete(() => {
      // Any additional actions after the door finishes opening
    })
    .start();

  // Ensure the sound plays for the duration of the door opening animation
  setTimeout(() => {
    // Stop the sound after the animation is complete
    doorOpenSound1.pause();
    doorOpenSound1.currentTime = 0;  // Reset sound to the beginning
  }, 6000); // Match this duration with the animation time (6000ms)
}


// Quit the interaction (if the player presses Q)
function quitInteraction() {
  isInteracting = false;
  enteredPassword = ""; // Reset password input
  interactionUI.innerHTML = "";  // Hide the interaction prompt
  
  // Stop the device interaction sound if it's playing
  if (!deviceInteractionSound.paused) {
    deviceInteractionSound.pause();
    deviceInteractionSound.currentTime = 0;  // Reset sound to the beginning
  }
  
  if (inputDiv) {
    document.body.removeChild(inputDiv);
  }
}

// Update the interaction UI based on proximity to the device
function updateInteractionUI() {
  if (passwordDevice && !deviceInteracted && !isInteracting) {
    const playerPos = camera.position;
    const distanceToDev = playerPos.distanceTo(passwordDevice.position);
    if (distanceToDev < 8) {
      if (distanceToDev < 4.0) {
        startPasswordInput();
        interactionUI.innerHTML = "";
      } else {
        interactionUI.innerHTML = "Acércate a la terminal para usarla";
      }
    } else {
      interactionUI.innerHTML = "";
    }
  } else if (deviceInteracted || isInteracting) {
    interactionUI.innerHTML = "";
  }
}

// Define sound functions outside the animate loop
function playWrongPasswordSound() {
  wrongPasswordSound.play();
}

function playCorrectPasswordSound() {
  correctPasswordSound.play();
}

function playTypingSound() {
  if (typingTimeout) clearTimeout(typingTimeout);  // Stop any previous typing sound
  typingSound.play();
}

function stopTypingSound() {
  typingSound.pause();
  typingSound.currentTime = 0;  // Reset sound to start
}

function resetTypingSoundTimeout() {
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTypingSound, 1000);  // Stop sound if no typing happens in 1 second
}

function playDeviceInteractionSound() {
  deviceInteractionSound.play();
}




// Add this OUTSIDE animate(), at the top level
let waterRising = true;
let waterRiseSpeed = 0.05; // adjust this to make it rise faster or slower


walls.forEach((wall, i) => {
  const box = new THREE.Box3().setFromObject(wall);
  const helper = new THREE.Box3Helper(box, 0xff0000);
  scene.add(helper);
});
function animate() {
  if (gameOverState) return; // Stop everything if the game is over
  requestAnimationFrame(animate);

  checkCameraCollision();
  TWEEN.update();  // Ensure TWEEN animations are updated in the loop
  updateInteractionUI(); // Check proximity to device and update UI

  const delta = clock.getDelta(); // Get time delta for smooth movement
  // Update the time uniform for the water material
  waterMaterial.uniforms.time.value += delta; // Increment time based on the delta time

  // Update the water animation if it exists
  if (waterMixer) {
      waterMixer.update(delta); // Update the water animation
  }

  if (candleMixer) {
    candleMixer.update(delta); // Update the candle animation
  }
  
  if (mixer) {
    mixer.update(delta); // Update the candle animation
  }
  
  // Update FPS controls
  if (controls && (controls.pointerLockControls.isLocked || isMobile)) {
      controls.update(delta);
  }

  // Check player bounds
  checkPlayerBounds(camera.position); // Check the camera's position (player's position)

  updateZombie(delta); // Update zombie movement

  // Check destination for level finish
  const escapePos = new THREE.Vector3(-61, 4, -40);
  if (camera.position.distanceTo(escapePos) < 4 && !gameOverState) {
      triggerLevelComplete();
  }

  // Rising water logic
  if (waterRising) {
      water.position.y += waterRiseSpeed * delta;

      // also rise the water1 GLB model to match
      if (water1) {
          water1.position.y += waterRiseSpeed * delta;
      }

      // Game over when water reaches y = 10
      if (water.position.y >= -40.2) {
          waterRising = false;
          triggerFloodGameOver();
      }
  }

  const playerPosition = camera.position;

  checkProximityToKey(playerPosition);
  checkProximityToDoor(playerPosition);

  // Proximity checks are handled automatically above

  renderer.render(scene, camera);
}

//================================================================
// Mobile Controls & Event Handling Setup
//================================================================
if (isMobile) {
  const joystickContainer = document.getElementById('joystick-container');
  const joystickKnob = document.getElementById('joystick-knob');
  let joystickActive = false;
  let startX = 0, startY = 0;
  
  joystickContainer.addEventListener('touchstart', (e) => {
    joystickActive = true;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  });
  
  joystickContainer.addEventListener('touchmove', (e) => {
    if (!joystickActive) return;
    const touch = e.touches[0];
    let dx = touch.clientX - startX;
    let dy = touch.clientY - startY;
    
    const maxRadius = 40; // max radius for joystick movement
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    
    if (controls) {
      const threshold = 12;
      controls.move.forward = (dy < -threshold);
      controls.move.backward = (dy > threshold);
      controls.move.left = (dx < -threshold);
      controls.move.right = (dx > threshold);
    }
  });
  
  joystickContainer.addEventListener('touchend', () => {
    joystickActive = false;
    joystickKnob.style.transform = 'translate(0px, 0px)';
    if (controls) {
      controls.move.forward = false;
      controls.move.backward = false;
      controls.move.left = false;
      controls.move.right = false;
    }
  });
  
  // Mobile Action Buttons
  document.getElementById('mobile-jump-btn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (controls && controls.isStanding) {
      controls.velocity.y += 12;
      controls.isStanding = false;
    }
  });
  
  document.getElementById('mobile-interact-btn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    // Dispatch keyboard events C and E
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    setTimeout(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'c' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'e' }));
    }, 100);
  });
  
  document.getElementById('mobile-flashlight-btn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    // Dispatch keyboard event KeyF
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  });
  
  // Mobile Look Around
  let touchStartX = 0;
  let touchStartY = 0;
  
  document.addEventListener('touchstart', (e) => {
    if (e.target.closest('#mobile-controls-layer') || e.target.closest('#user-profile-hud') || e.target.closest('#controls') || e.target.closest('#victory-screen')) {
      return;
    }
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });
  
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest('#mobile-controls-layer') || e.target.closest('#user-profile-hud') || e.target.closest('#controls') || e.target.closest('#victory-screen')) {
      return;
    }
    if (e.touches.length === 1 && currentUser && !gameOverState && !isInteracting) {
      const clientX = e.touches[0].clientX;
      const clientY = e.touches[0].clientY;
      
      const deltaX = clientX - touchStartX;
      const deltaY = clientY - touchStartY;
      
      touchStartX = clientX;
      touchStartY = clientY;
      
      // Look around (rotate camera)
      const sensitivity = 0.003;
      camera.rotation.y -= deltaX * sensitivity;
      camera.rotation.x -= deltaY * sensitivity;
      
      // Clamp pitch to prevent flipping upside down
      camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
    }
  }, { passive: true });
}

// Victory Screen "SIGUIENTE NIVEL" button click listener
const victoryNextBtn = document.getElementById('victory-next-btn');
if (victoryNextBtn) {
  victoryNextBtn.addEventListener('click', () => {
    const victoryScreen = document.getElementById('victory-screen');
    if (victoryScreen) victoryScreen.style.display = 'none';
    
    if (currentLevel >= 20) {
      applyLevelDifficulty(1);
    } else {
      applyLevelDifficulty(currentLevel + 1);
    }
    
    resetSceneForNextLevel();
  });
}

animate();