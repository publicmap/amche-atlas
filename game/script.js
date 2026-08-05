// Map Puzzle Game Logic

const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1Ijoib3NtaW5kaWEiLCJhIjoiY202czRpbWdpMDNyZjJwczJqZXdkMGR1eSJ9.eQQf--msfqtZIamJN-KKVQ';
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
    nextImage: null, // Store preloaded image object
    isWon: false, // Track win state

    // Scoring
    score: 0,
    pendingLevelScore: 0, // Store score for current level until 'next level' clicked
    startTime: 0,
    levelStartTime: 0
};

let interactionTimeout;

const dom = {
    container: document.getElementById('fifteen'),
    gameWrapper: document.getElementById('game-container'),
    nextBtn: document.getElementById('next-level-btn'),
    startScreen: document.getElementById('start-screen'),
    startBtn: document.getElementById('start-btn'),
    scoreDisplay: document.getElementById('score-display'),
    scoreMsg: document.getElementById('score-message'),
    scoreTime: document.getElementById('score-time'),
    scoreBonus: document.getElementById('score-bonus'),
    scoreTotal: document.getElementById('score-total')
};

function initGame() {
    dom.nextBtn.addEventListener('click', nextLevel);
    dom.startBtn.addEventListener('click', startGame);
    parseHash(); // Parse URL hash for initial state

    dom.startScreen.style.display = 'flex';
    dom.scoreMsg.style.display = 'none';
    dom.nextBtn.style.display = 'none';
    updateScoreDisplay();

    // Start preloading immediately
    preloadFirstLevel();
}

function startGame() {
    dom.startScreen.style.display = 'none';
    startLevel();
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
    dom.scoreMsg.style.display = 'none';
    dom.nextBtn.style.display = 'none'; // Ensure button is hidden
    dom.container.style.pointerEvents = 'auto'; // Re-enable game interaction
    gameState.isWon = false;
    clearTimeout(interactionTimeout);

    gameState.levelStartTime = Date.now();

    // Reset Map View
    const bgContainer = document.getElementById('background-map');
    bgContainer.style.opacity = '0.3';
    bgContainer.style.pointerEvents = 'none'; // Disable during gameplay
    console.log('startLevel: Reset map - opacity 0.3, pointer-events none');

    if (gameState.bgMap) {
        // Stop any ongoing animations
        gameState.bgMap.stop();

        // Reset view to match static tiles exactly
        gameState.bgMap.jumpTo({
            pitch: gameState.pitch,
            bearing: gameState.bearing,
            zoom: gameState.zoom,
            center: gameState.center
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
    const { width, height } = getViewportDimensions();

    // Generate Static Map URL
    const url = getMapUrl(gameState.center, gameState.zoom, gameState.bearing, gameState.pitch, width, height);

    console.log('Static image URL:', url);

    gameState.imageUrl = url;

    // Update Background Map
    updateBackgroundMap(width, height);

    // Preload image - optimized to use cached object even if pending
    if (gameState.nextImage && gameState.nextImage.src === url) {
        console.log('Using preloaded image object');
        const img = gameState.nextImage;
        if (img.complete) {
            setupGrid(width, height);
            gameState.nextImage = null;
            preloadNextLevel();
        } else {
            console.log('Image pending, waiting for onload...');
            img.onload = () => {
                setupGrid(width, height);
                gameState.nextImage = null;
                preloadNextLevel();
            };
        }
    } else {
        console.log('No preloaded image, fetching new...');
        const img = new Image();
        img.onload = () => {
            setupGrid(width, height);
            preloadNextLevel(); // Prefetch next level
        };
        img.src = url;
    }
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

        // Map loaded - interactions will be enabled after win
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

    // Calculate Scores
    const now = Date.now();
    const elapsedSec = Math.floor((now - gameState.levelStartTime) / 1000);
    const timeScore = Math.max((gameState.level * 60) - elapsedSec, 1);
    const difficultyBonus = gameState.level * 100;
    const levelTotal = timeScore + difficultyBonus;

    gameState.pendingLevelScore = levelTotal;
    const currentTotalForDisplay = gameState.score + levelTotal; // Predicted total for overlay

    // updateScoreDisplay(); // Don't update header yet

    // Prefetch Next Level immediately
    preloadNextLevel();

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

            // Enable map interactions without animations
            if (gameState.bgMap) {
                // Enable interactions
                gameState.bgMap.interactive = true;
                gameState.bgMap.scrollZoom.enable();
                gameState.bgMap.boxZoom.enable();
                gameState.bgMap.dragRotate.enable();
                gameState.bgMap.dragPan.enable();
                gameState.bgMap.keyboard.enable();
                gameState.bgMap.doubleClickZoom.enable();
                gameState.bgMap.touchZoomRotate.enable();

                // Allow interactions - bring map to front
                const canvas = gameState.bgMap.getCanvas();
                canvas.style.zIndex = '20';
                canvas.style.cursor = 'grab';

                // Add grab/grabbing cursor behavior
                gameState.bgMap.on('mousedown', () => {
                    canvas.style.cursor = 'grabbing';
                });

                gameState.bgMap.on('mouseup', () => {
                    canvas.style.cursor = 'grab';
                });

                gameState.bgMap.on('dragend', () => {
                    canvas.style.cursor = 'grab';
                });

                dom.container.style.zIndex = '0';
                dom.container.style.pointerEvents = 'none';
                console.log('onWin: Map interactions enabled - canvas z-index=20, fifteen z-index=0, fifteen pointer-events=none');
                console.log('onWin: Map interactive state:', gameState.bgMap.interactive);
            }

            // 5. Show Score Popup then Win Popup
            // Pass the PREDICTED total to the overlay animation
            showScore(timeScore, difficultyBonus, gameState.score + gameState.pendingLevelScore);

        }, 750); // Duration match bounceOut roughly
    }, 1000); // Wait for bounce to finish
}

function showScore(timeVal, bonusVal, totalVal) {
    dom.scoreMsg.style.display = 'block';

    // Animate numbers
    animateValue(dom.scoreTime, 0, timeVal, 2000);
    animateValue(dom.scoreBonus, 0, bonusVal, 2000);
    animateValue(dom.scoreTotal, totalVal - (timeVal + bonusVal), totalVal, 2000);

    setTimeout(() => {
        // Show proceed button
        dom.nextBtn.style.display = 'block';
    }, 2500); // 2s animation + 0.5s pause
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function updateScoreDisplay() {
    if (dom.scoreDisplay) {
        dom.scoreDisplay.textContent = `Score: ${gameState.score}`;
    }
}

function nextLevel() {
    // Apply Pending Score with Animation
    const oldScore = gameState.score;
    gameState.score += gameState.pendingLevelScore;
    gameState.pendingLevelScore = 0;

    // Animate Header Score
    animateScoreDisplay(oldScore, gameState.score, 2000);

    // Apply progression rules
    gameState.level++;
    gameState.zoom += 1;
    gameState.difficulty += 10;

    // Increase grid size alternatively expanding grid height and width by 1 count
    // Responsive logic based on screen orientation:
    // - Small/Portrait screens (mobile): prioritize height expansion (1x1 -> 1x2 -> 2x2 -> 2x3 -> 3x3)
    // - Wide/Landscape screens (desktop): prioritize width expansion (1x1 -> 2x1 -> 2x2 -> 3x2 -> 3x3)

    const isSmallScreen = window.innerWidth < window.innerHeight || window.innerWidth < 768;

    if (gameState.grid[0] === gameState.grid[1]) {
        // Square grid: expand based on screen orientation
        if (isSmallScreen) {
            // Small screen: Increase Height first
            gameState.grid[1]++;
        } else {
            // Wide screen: Increase Width first
            gameState.grid[0]++;
        }
    } else {
        // Rectangle: Make it square by increasing the smaller dimension
        if (gameState.grid[0] < gameState.grid[1]) {
            gameState.grid[0]++;
        } else {
            gameState.grid[1]++;
        }
    }

    startLevel();
}

function preloadNextLevel() {
    // Calculate parameters for the NEXT level
    // Current state is already the active level.
    // We need to simulate nextLevel() logic without changing state.

    const nextZoom = gameState.zoom + 1;
    let nextGrid = [...gameState.grid];

    const isSmallScreen = window.innerWidth < window.innerHeight || window.innerWidth < 768;

    if (nextGrid[0] === nextGrid[1]) {
        if (isSmallScreen) {
            nextGrid[1]++;
        } else {
            nextGrid[0]++;
        }
    } else {
        if (nextGrid[0] < nextGrid[1]) {
            nextGrid[0]++;
        } else {
            nextGrid[1]++;
        }
    }

    // Calculate dimensions same as startLevel()
    const { width, height } = getViewportDimensions();

    // Construct URL
    // Use NEXT zoom, but CURRENT bearing and pitch because nextLevel() does not change them
    const url = getMapUrl(gameState.center, nextZoom, gameState.bearing, gameState.pitch, width, height);

    // Prefetch
    const img = new Image();
    img.src = url;
    gameState.nextImage = img; // Store for next level immediate use

    console.log('Prefetching next level:', url);
}

// Start
initGame();

// Interaction Logic for Win State - removed to keep win message always visible

// ... existing code ...

function preloadFirstLevel() {
    const { width, height } = getViewportDimensions();
    const url = getMapUrl(gameState.center, gameState.zoom, gameState.bearing, gameState.pitch, width, height);

    // We can prefetch it as a nextImage, OR just let the browser cache handle it.
    // If we set it as nextImage, initGame might need to handle it.
    // Actually, startLevel calls updateBackgroundMap -> getMapUrl
    // It also tries to use nextImage.

    const img = new Image();
    img.src = url;
    gameState.nextImage = img;
    console.log('Preloading first level:', url);
}

function getViewportDimensions() {
    const padding = 40;

    // Priority: maximize height, then width, limit to 1280
    const w = Math.min(window.innerWidth - padding, 1280);
    const h = Math.min(window.innerHeight - padding, 1280);

    return { width: Math.floor(w), height: Math.floor(h) };
}

function getMapUrl(center, zoom, bearing, pitch, width, height) {
    const retina = window.devicePixelRatio > 1 ? '@2x' : '';
    const clampedPitch = Math.max(0, Math.min(60, pitch));
    return `https://api.mapbox.com/styles/v1/${STATIC_STYLE_ID}/static/${center[0]},${center[1]},${zoom},${bearing},${clampedPitch}/${width}x${height}${retina}?access_token=${MAPBOX_ACCESS_TOKEN}&logo=false&attribution=false`;
}

function animateScoreDisplay(start, end, duration) {
    if (!dom.scoreDisplay) return;

    // Mechanical counter sound effect
    const tickSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
    tickSound.volume = 0.3;
    tickSound.loop = true;
    tickSound.play().catch(e => console.log('Tick sound failed', e));

    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        dom.scoreDisplay.textContent = `Score: ${current}`;

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            // Stop sound when animation finishes
            tickSound.pause();
            tickSound.currentTime = 0;
        }
    };
    window.requestAnimationFrame(step);
}
