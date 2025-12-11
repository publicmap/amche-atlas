// Map Puzzle Game Logic

const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoicGxhbmVtYWQiLCJhIjoiY2l3ZmNjNXVzMDAzZzJ0cDV6b2lkOG9odSJ9.eep6sUoBS0eMN4thZUWpyQ';
const MAP_STYLE = 'mapbox://styles/planemad/cm3gyibd3004x01qz08rohcsg';
// Extract just the user/style-id part for static API if needed, 
// but static API usually takes 'user/styleid' or 'mapbox/streets-v11'.
// The style URL provided is 'mapbox://styles/planemad/cm3gyibd3004x01qz08rohcsg'.
// So user = planemad, styleId = cm3gyibd3004x01qz08rohcsg.
const STATIC_STYLE_ID = 'planemad/cm3gyibd3004x01qz08rohcsg';

const gameState = {
    level: 1,
    zoom: 9.99, // Initial Zoom
    center: [73.9414, 15.4121], // Initial Center [lon, lat] from map-init.js
    bearing: 0, // Initial bearing
    pitch: 0, // Initial pitch
    grid: [2, 2], // [cols, rows] - Initial grid size 1x1
    difficulty: 10, // Initial shuffle moves

    // Runtime state
    tiles: [], // 2D array or 1D array of current state
    emptySlot: { col: 0, row: 0 },
    solvedState: [], // Reference for win checking
    isAnimating: false,
    imageUrl: '',
    bgMap: null,
    isWon: false // Track win state
};

let interactionTimeout;

const dom = {
    container: document.getElementById('fifteen'),
    gameWrapper: document.getElementById('game-container'),
    winMsg: document.getElementById('win-message'),
    nextBtn: document.getElementById('next-level-btn')
};

function initGame() {
    dom.nextBtn.addEventListener('click', nextLevel);
    parseHash(); // Parse URL hash for initial state
    startLevel();
    // Setup map interactions once map is ready - handled in updateBackgroundMap or check every time?
    // We can just call it safely, but bgMap might be null.
    // We will call it inside updateBackgroundMap or when map loads.
}

function parseHash() {
    const hash = window.location.hash;
    if (hash) {
        // Remove # and split by /
        // Expected format: #zoom/lat/lon or #zoom/lat/lon/bearing/pitch
        const parts = hash.substring(1).split('/');
        if (parts.length >= 3) {
            const zoom = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const lon = parseFloat(parts[2]);

            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lon)) {
                gameState.zoom = zoom;
                gameState.center = [lon, lat];

                // Parse bearing and pitch if available
                if (parts.length >= 4) {
                    const bearing = parseFloat(parts[3]);
                    if (!isNaN(bearing)) {
                        // Clamp bearing to 0-360
                        gameState.bearing = ((bearing % 360) + 360) % 360;
                    }
                }
                if (parts.length >= 5) {
                    const pitch = parseFloat(parts[4]);
                    if (!isNaN(pitch)) {
                        // Clamp pitch to 0-60 (Mapbox API limit)
                        gameState.pitch = Math.max(0, Math.min(60, pitch));
                    }
                }

                console.log('Parsed hash:', gameState.zoom, gameState.center, gameState.bearing, gameState.pitch);
            }
        }
    }
}

function startLevel() {
    updateProcessionUI();
    dom.winMsg.style.display = 'none';
    dom.container.style.pointerEvents = 'auto'; // Re-enable game interaction
    gameState.isWon = false;
    clearTimeout(interactionTimeout);

    // Reset Map View
    const bgContainer = document.getElementById('background-map');
    bgContainer.style.opacity = '0.3';
    bgContainer.style.pointerEvents = 'none'; // Disable during gameplay
    console.log('startLevel: Reset map - opacity 0.3, pointer-events none');

    if (gameState.bgMap) {
        // Reset view to top-down
        gameState.bgMap.easeTo({
            pitch: gameState.pitch,
            bearing: gameState.bearing,
            zoom: gameState.zoom,
            center: gameState.center,
            duration: 1000
        });
        // Disable interactions
        gameState.bgMap.scrollZoom.disable();
        gameState.bgMap.boxZoom.disable();
        gameState.bgMap.dragRotate.disable();
        gameState.bgMap.dragPan.disable();
        gameState.bgMap.keyboard.disable();
        gameState.bgMap.doubleClickZoom.disable();
        gameState.bgMap.touchZoomRotate.disable();

        // Reset Z-Index
        gameState.bgMap.getCanvas().style.zIndex = '0';
        dom.container.style.zIndex = '10';
        console.log('startLevel: Reset z-indices - canvas=0, fifteen=10');
    }

    // Calculate dimensions based on viewport
    // use full available height/width minus some padding
    const padding = 40;
    const maxWidth = window.innerWidth - padding;
    const maxHeight = window.innerHeight - padding;

    // Determine image dimensions
    // The static API has limits (usually 1280x1280 for free tier standard, can go higher).
    // Let's stick to viewport size or max 1024 to be safe and sharp.
    let width = Math.min(maxWidth, 1024);
    let height = Math.min(maxHeight, 1024);

    // Maintain aspect ratio if we want, or just fill screen?
    // User asked "make the initial dimension to have full height".
    // So height is priority.
    height = Math.min(maxHeight, 1280); // API max height
    // Width can be proportional or defined. Let's make it fit ratio.
    // Standard phone/desktop ratio.
    // Let's just use the computed available space.
    width = Math.min(window.innerWidth - padding, 1280);
    height = Math.min(window.innerHeight - padding, 1280);

    // Generate Static Map URL
    // https://api.mapbox.com/styles/v1/{username}/{style_id}/static/{lon},{lat},{zoom},{bearing},{pitch}/{width}x{height}{@2x}
    // Note: Mapbox Static API limits pitch to 0-60 degrees
    const retina = window.devicePixelRatio > 1 ? '@2x' : '';
    const clampedPitch = Math.max(0, Math.min(60, gameState.pitch)); // Clamp to 0-60
    const url = `https://api.mapbox.com/styles/v1/${STATIC_STYLE_ID}/static/${gameState.center[0]},${gameState.center[1]},${gameState.zoom},${gameState.bearing},${clampedPitch}/${Math.floor(width)}x${Math.floor(height)}${retina}?access_token=${MAPBOX_ACCESS_TOKEN}&logo=false&attribution=false`;

    console.log('Static image URL:', url);

    gameState.imageUrl = url;

    // Update Background Map
    updateBackgroundMap(width, height);

    // Preload image
    const img = new Image();
    img.onload = () => {
        setupGrid(width, height);
        preloadNextLevel(); // Prefetch next level
    };
    img.src = url;
}

function updateBackgroundMap(width, height) {
    const bgContainer = document.getElementById('background-map');
    bgContainer.style.width = width + 'px';
    bgContainer.style.height = height + 'px';

    if (!gameState.bgMap) {
        // Initialize Map
        mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
        gameState.bgMap = new mapboxgl.Map({
            container: 'background-map',
            style: MAP_STYLE,
            center: gameState.center,
            zoom: gameState.zoom,
            bearing: gameState.bearing,
            pitch: gameState.pitch,
            interactive: false, // Start non-interactive
            attributionControl: false
        });

        gameState.bgMap.on('load', () => {
            setupMapInteractions();
        });
    } else {
        // Update View
        gameState.bgMap.resize();
        gameState.bgMap.jumpTo({
            center: gameState.center,
            zoom: gameState.zoom
        });
    }
}

function setupGrid(width, height) {
    const cols = gameState.grid[0];
    const rows = gameState.grid[1];

    dom.container.style.width = width + 'px';
    dom.container.style.height = height + 'px';
    dom.container.innerHTML = '';

    const tileWidth = width / cols;
    const tileHeight = height / rows;

    gameState.tiles = [];

    // For 1x1, there is no empty slot effectively, or the game is instantly won.
    // If it's a sliding puzzle, we need one empty slot to move.
    // 1x1: 1 slot. Is it empty? If it's empty, we see nothing. If it's full, we can't move.
    // User requested "initial grid size should be 1x1 with difficulty 10".
    // A 1x1 puzzle is technically solved immediately.
    // We will treat 1x1 as a special case where we just show the full image and trigger "Win" immediately or after a click?
    // "with each win do the following"

    if (cols === 1 && rows === 1) {
        // Special case: Just show the image full size
        const tile = document.createElement('div');
        tile.className = 'slot';
        tile.style.width = width + 'px';
        tile.style.height = height + 'px';
        tile.style.left = '0px';
        tile.style.top = '0px';
        tile.style.backgroundImage = `url('${gameState.imageUrl}')`;
        tile.style.backgroundSize = `${width}px ${height}px`;
        tile.style.backgroundPosition = '0 0';
        dom.container.appendChild(tile);

        // Auto-win immediately for 1x1 to start the loop?
        // Or wait for user to admire it?
        // Let's show win message immediately.
        setTimeout(() => {
            onWin();
        }, 1000);
        return;
    }

    // Generate tiles
    let count = 1;
    const totalSlots = cols * rows;

    // We need an empty slot. Usually the last one.
    gameState.emptySlot = { col: cols - 1, row: rows - 1 };

    for (let r = 0; r < rows; r++) {
        gameState.tiles[r] = [];
        for (let c = 0; c < cols; c++) {
            if (r === rows - 1 && c === cols - 1) {
                gameState.tiles[r][c] = null; // Empty slot
                continue;
            }

            const tile = document.createElement('div');
            tile.className = 'slot';
            tile.id = `slot-${r}-${c}`;
            tile.style.width = tileWidth + 'px';
            tile.style.height = tileHeight + 'px';
            tile.style.left = (c * tileWidth) + 'px';
            tile.style.top = (r * tileHeight) + 'px';
            tile.style.backgroundImage = `url('${gameState.imageUrl}')`;
            tile.style.backgroundSize = `${width}px ${height}px`;
            tile.style.backgroundPosition = `-${c * tileWidth}px -${r * tileHeight}px`;

            // Store logical position
            tile.dataset.r = r;
            tile.dataset.c = c;

            tile.onclick = () => moveTile(r, c);

            dom.container.appendChild(tile);
            gameState.tiles[r][c] = tile;
        }
    }

    // Shuffle
    shuffle();
}

function updateProcessionUI() {
    // UI removed
}

function shuffle() {
    // Perform random valid moves
    const diff = gameState.difficulty;
    let moves = 0;

    // Simple shuffle by simulating random moves
    const interval = setInterval(() => {
        if (moves >= diff) {
            clearInterval(interval);
            return;
        }

        // Find neighbors of empty slot
        const neighbors = getNeighbors(gameState.emptySlot.row, gameState.emptySlot.col);
        if (neighbors.length > 0) {
            const rand = neighbors[Math.floor(Math.random() * neighbors.length)];
            performMove(rand.r, rand.c, false); // false = no animation check/win check
            moves++;
        }
    }, 10); // fast shuffle
}

function getNeighbors(r, c) {
    const neighbors = [];
    if (r > 0) neighbors.push({ r: r - 1, c: c });
    if (r < gameState.grid[1] - 1) neighbors.push({ r: r + 1, c: c });
    if (c > 0) neighbors.push({ r: r, c: c - 1 });
    if (c < gameState.grid[0] - 1) neighbors.push({ r: r, c: c + 1 });
    return neighbors;
}

function moveTile(r, c) {
    // Find current position of this tile in the grid
    // The (r, c) passed are the ORIGINAL coordinates (ID), but we need to find where it is NOW.
    // Wait, my grid `gameState.tiles[r][c]` stores the DOM element at position (r,c).
    // So if I click a visual slot at (r,c), I want to see if it's next to empty.

    // Find coordinates of clicked tile in current state
    let curR = -1, curC = -1;
    // Actually, I should probably attach the handler to the slot at a specific visual position?
    // No, tiles move. The DOM element moves.
    // Let's scan the grid to find which logical slot holds the clicked element.
    // BETTER: The click event is on the DOM element. We need to find its current indices in gameState.tiles

    // UNLESS `gameState.tiles` represents the current visual grid.
    // Yes, let's make `gameState.tiles[r][c]` be the Tile Object (or null) at visual row r, col c.

    // On click, we need to know which (r,c) was clicked.
    // We can rely on looking up the element in the array.

    // Optimization: Just scan.
    for (let y = 0; y < gameState.grid[1]; y++) {
        for (let x = 0; x < gameState.grid[0]; x++) {
            // Check if this grid cell contains a tile and if it's the one clicked?
            // Actually, `moveTile` is called by `tile.onclick`.
            // But `tile.onclick` captures closure variables `r, c` from initialization!
            // THOSE ARE THE ORIGINAL coords.
            // So we are identifying the tile by its original position.
            // We need to find where that tile is NOW.

            const tile = gameState.tiles[y][x];
            if (tile && tile.dataset.r == r && tile.dataset.c == c) {
                curR = y;
                curC = x;
                break;
            }
        }
        if (curR !== -1) break;
    }

    if (curR === -1) return; // Should not happen

    // Check adjacency to empty slot
    if (isAdjacent(curR, curC, gameState.emptySlot.row, gameState.emptySlot.col)) {
        performMove(curR, curC, true);
    }
}

function isAdjacent(r1, c1, r2, c2) {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

function performMove(r, c, checkWinCondition) {
    // Swap with empty slot
    const emptyR = gameState.emptySlot.row;
    const emptyC = gameState.emptySlot.col;

    const tile = gameState.tiles[r][c];

    // Update DOM
    const width = parseInt(dom.container.style.width);
    const height = parseInt(dom.container.style.height);
    const tileWidth = width / gameState.grid[0];
    const tileHeight = height / gameState.grid[1];

    tile.style.left = (emptyC * tileWidth) + 'px';
    tile.style.top = (emptyR * tileHeight) + 'px';

    // Update State
    gameState.tiles[emptyR][emptyC] = tile;
    gameState.tiles[r][c] = null;
    gameState.emptySlot = { row: r, col: c };

    if (checkWinCondition) {
        checkWin();
    }
}

function checkWin() {
    // Verify order
    let correct = 0;
    const total = gameState.grid[0] * gameState.grid[1] - 1; // Exclude empty

    for (let r = 0; r < gameState.grid[1]; r++) {
        for (let c = 0; c < gameState.grid[0]; c++) {
            const tile = gameState.tiles[r][c];
            if (tile) {
                // Check if tile's original pos matches current pos
                if (parseInt(tile.dataset.r) === r && parseInt(tile.dataset.c) === c) {
                    correct++;
                } else {
                    return; // Not solved
                }
            } else {
                // If it's the empty slot, it should be at the end for "perfect" solution?
                // Usually yes, (last row, last col).
                if (r !== gameState.grid[1] - 1 || c !== gameState.grid[0] - 1) {
                    return; // Empty slot not in correct place
                }
            }
        }
    }

    // If we get here, it's solved
    onWin();
}

function onWin() {
    if (gameState.isWon) return; // Prevent double trigger
    gameState.isWon = true;

    // 1. Add missing tile with bounce animation
    const width = parseInt(dom.container.style.width);
    const height = parseInt(dom.container.style.height);
    const tileWidth = width / gameState.grid[0];
    const tileHeight = height / gameState.grid[1];

    const tile = document.createElement('div');
    tile.className = 'slot bounce animated'; // Add animated class
    tile.style.width = tileWidth + 'px';
    tile.style.height = tileHeight + 'px';
    tile.style.left = (gameState.emptySlot.col * tileWidth) + 'px';
    tile.style.top = (gameState.emptySlot.row * tileHeight) + 'px';
    tile.style.backgroundImage = `url('${gameState.imageUrl}')`;
    tile.style.backgroundSize = `${width}px ${height}px`;
    // Calculate background position for the empty slot (which is usually the last one)
    // Actually, we should calculate for the specific row/col of the empty slot
    tile.style.backgroundPosition = `-${gameState.emptySlot.col * tileWidth}px -${gameState.emptySlot.row * tileHeight}px`;

    dom.container.appendChild(tile);

    // 2. Play victory sound
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3'); // Quick placeholder
        audio.play().catch(e => console.log('Audio play failed', e));
    } catch (e) {
        console.log('Audio error', e);
    }

    // 3. Bounce Out all tiles after delay
    setTimeout(() => {
        const slots = document.querySelectorAll('.slot');
        slots.forEach(s => {
            s.classList.remove('bounce');
            s.classList.add('bounceOut');
            s.classList.add('animated');
        });

        // 4. Reveal map after bounce out
        setTimeout(() => {
            console.log('onWin: Starting map reveal sequence');
            const bgContainer = document.getElementById('background-map');
            bgContainer.style.opacity = '1';
            bgContainer.style.pointerEvents = 'auto'; // ENABLE interactions on container
            console.log('onWin: Set bgContainer opacity=1, pointer-events=auto');

            // Animate Map
            if (gameState.bgMap) {
                gameState.bgMap.flyTo({
                    bearing: 45,
                    pitch: 60,
                    duration: 2000,
                    essential: true
                });

                // Enable interactions
                gameState.bgMap.interactive = true; // Use this or specific handlers
                gameState.bgMap.scrollZoom.enable();
                gameState.bgMap.boxZoom.enable();
                gameState.bgMap.dragRotate.enable();
                gameState.bgMap.dragPan.enable();
                gameState.bgMap.keyboard.enable();
                gameState.bgMap.doubleClickZoom.enable();
                gameState.bgMap.touchZoomRotate.enable();

                // Allow interactions - bring map to front
                gameState.bgMap.getCanvas().style.zIndex = '20';
                dom.container.style.zIndex = '0';
                dom.container.style.pointerEvents = 'none';
                console.log('onWin: Map interactions enabled - canvas z-index=20, fifteen z-index=0, fifteen pointer-events=none');
                console.log('onWin: Map interactive state:', gameState.bgMap.interactive);

                // After the initial flyTo animation completes, start the long Goa flyover
                // Goa bbox approximately: SW [73.67, 14.89], NE [74.34, 15.80]
                setTimeout(() => {
                    console.log('onWin: Starting Goa flyover animation (60s)');
                    gameState.bgMap.fitBounds(
                        [[73.67, 14.89], [74.34, 15.80]], // Goa bounding box
                        {
                            bearing: 0,
                            pitch: 0,
                            duration: 60000, // 60 seconds
                            essential: true,
                            padding: 50
                        }
                    );
                }, 2500); // Start after initial flyTo + small buffer
            }

            // 5. Show Win Popup
            dom.winMsg.style.display = 'block';

        }, 750); // Duration match bounceOut roughly
    }, 1000); // Wait for bounce to finish
}

function nextLevel() {
    // Apply progression rules
    gameState.level++;
    gameState.zoom += 1;
    gameState.difficulty += 10;

    // Increase grid size alternatively expanding grid height and width by 1 count
    // 1x1 -> 2x1 -> 2x2 -> 3x2 -> 3x3
    // Start: [1,1]
    // Lvl 1 (Start) -> Win -> Lvl 2
    // Rules:
    // If width == height, increase width? Or height?
    // "alternatively expanding grid height and width"
    // 1x1 -> 2x1 (Width++?) -> 2x2 (Height++) -> 3x2 (Width++) -> 3x3 (Height++)

    // Let's implement this logic:
    if (gameState.grid[0] === gameState.grid[1]) {
        // Square: Increase Width
        gameState.grid[0]++;
    } else {
        // Rectangle: Increase Height (to make square)
        gameState.grid[1]++;
    }

    startLevel();
}

function preloadNextLevel() {
    // Calculate parameters for the NEXT level
    // Current state is already the active level.
    // We need to simulate nextLevel() logic without changing state.

    const nextZoom = gameState.zoom + 1;
    let nextGrid = [...gameState.grid];

    if (nextGrid[0] === nextGrid[1]) {
        nextGrid[0]++;
    } else {
        nextGrid[1]++;
    }

    // Calculate dimensions same as startLevel()
    const padding = 40;
    const maxWidth = window.innerWidth - padding;
    const maxHeight = window.innerHeight - padding;
    let width = Math.min(maxWidth, 1280);
    let height = Math.min(maxHeight, 1280);

    // Construct URL
    const retina = window.devicePixelRatio > 1 ? '@2x' : '';
    const url = `https://api.mapbox.com/styles/v1/${STATIC_STYLE_ID}/static/${gameState.center[0]},${gameState.center[1]},${nextZoom},0,0/${Math.floor(width)}x${Math.floor(height)}${retina}?access_token=${MAPBOX_ACCESS_TOKEN}&logo=false&attribution=false`;

    // Prefetch
    const img = new Image();
    img.src = url;
    // No need to do anything on load, browser cache handles it.
    console.log('Prefetching next level:', url);
}

// Start
initGame();

// Interaction Logic for Win State
function setupMapInteractions() {
    if (!gameState.bgMap) return;

    const events = ['mousedown', 'touchstart', 'wheel', 'dragstart', 'moveend'];
    events.forEach(event => {
        gameState.bgMap.on(event, () => {
            if (dom.winMsg.style.display === 'block') {
                dom.winMsg.style.display = 'none';
            }
            resetInteractionTimer();
        });
    });
}

function resetInteractionTimer() {
    clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
        // Only show if we are still in win state (check if tiles are gone/hidden?)
        // We can check if the next button is visible or if we haven't started a new level yet.
        // Or check a state flag.
        if (gameState.isWon) {
            dom.winMsg.style.display = 'block';
        }
    }, 5000);
}

// ... existing code ...

