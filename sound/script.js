// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDdvg3bdmO8-UnWiVPlptrWPr3Af77IerM",
    authDomain: "noiselogger-7a546.firebaseapp.com",
    databaseURL: "https://noiselogger-7a546-default-rtdb.firebaseio.com",
    projectId: "noiselogger-7a546",
    storageBucket: "noiselogger-7a546.appspot.com",
    messagingSenderId: "1088883369572",
    appId: "1:1088883369572:web:4047fde03df55f864b2171",
    measurementId: "G-VPDTDN640G"
};
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Generate a unique ID for this user
const userId = 'user_' + Math.random().toString(36).substr(2, 9);

// Function to calculate weighted average
function calculateWeightedAverage(readings) {
    if (readings.length === 0) return 0;
    let sum = 0;
    let weightSum = 0;
    for (let i = 0; i < readings.length; i++) {
        let weight = (i + 1) / readings.length; // More recent readings have higher weight
        sum += readings[i] * weight;
        weightSum += weight;
    }
    return sum / weightSum;
}

// Create sound meter bars
const soundMeter = document.getElementById('sound-meter');
const numBars = 30;
for (let i = 0; i < numBars; i++) {
    const bar = document.createElement('div');
    bar.className = 'h-full w-full bg-gray-300';
    soundMeter.appendChild(bar);
}

// Function to update the sound meter and noise zone
function updateSoundMeter(db) {
    const bars = document.querySelectorAll('#sound-meter > div');
    const percentage = Math.min(100, Math.max(0, db));
    const activeBars = Math.floor(percentage / 100 * numBars);

    bars.forEach((bar, index) => {
        if (index < activeBars) {
            bar.style.height = '100%';
            if (db <= 50) {
                bar.className = 'h-full w-full bg-green-500';
            } else if (db <= 55) {
                bar.className = 'h-full w-full bg-orange-500';
            } else if (db <= 65) {
                bar.className = 'h-full w-full bg-red-500';
            } else if (db <= 75) {
                bar.className = 'h-full w-full bg-purple-500';
            } else {
                bar.className = 'h-full w-full bg-white';
            }
        } else {
            bar.style.height = '10%';
            bar.className = 'h-full w-full bg-gray-300';
        }
    });

    // Update noise zone based on current sound levels
    const noiseZoneElement = document.getElementById('noise-zone');
    if (db <= 50) {
        noiseZoneElement.textContent = 'Silent Zone';
        noiseZoneElement.className = 'text-green-500';
    } else if (db <= 55) {
        noiseZoneElement.textContent = 'Residential Zone';
        noiseZoneElement.className = 'text-orange-500';
    } else if (db <= 65) {
        noiseZoneElement.textContent = 'Commercial Zone';
        noiseZoneElement.className = 'text-red-500';
    } else if (db <= 75) {
        noiseZoneElement.textContent = 'Industrial Zone';
        noiseZoneElement.className = 'text-purple-500';
    } else {
        noiseZoneElement.textContent = 'Unhealthy Noise Zone';
        noiseZoneElement.className = 'text-white';
    }
}

// Array to store sound level readings
let soundReadings = [];

let userLocation = [73.8, 15.6]; // Default location
let map;
let noiseHistory = []; // Array to store noise history

let startTime = Date.now();
let pausedDuration = 0;
let isPaused = false;

// Add this variable at the top of the file
let locationAccuracy = 0;

document.addEventListener('DOMContentLoaded', () => {
    mapboxgl.accessToken = window.amche.MAPBOXGL_ACCESS_TOKEN;

    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/planemad/cm0c67r0100py01qybp7s2enn',
        center: userLocation,
        zoom: 9,
        hash: true
    });

    // Add geolocate control to the map
    const geolocate = new mapboxgl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: true
    });
    map.addControl(geolocate);

    map.on('load', () => {
        // Trigger the geolocate control to start tracking the user's location
        geolocate.trigger();

        geolocate.on('geolocate', function (e) {
            userLocation = [e.coords.longitude, e.coords.latitude];
            locationAccuracy = e.coords.accuracy;
            document.getElementById('location-accuracy').textContent = locationAccuracy.toFixed(2);
            map.flyTo({ center: userLocation, zoom: 14 });
        });

        map.addSource('noise', {
            'type': 'geojson',
            'data': {
                'type': 'FeatureCollection',
                'features': []
            }
        });

        map.addLayer({
            'id': 'noise-level',
            'type': 'circle',
            'source': 'noise',
            'paint': {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['get', 'db'],
                    0, 5,
                    100, 50
                ],
                'circle-color': [
                    'step',
                    ['get', 'db'],
                    '#4ade80', // Silent Zone (green)
                    50, '#f97316', // Residential Zone (orange)
                    55, '#ef4444', // Commercial Zone (red)
                    65, '#a855f7', // Industrial Zone (purple)
                    75, '#ffffff' // Unhealthy Noise Zone (white)
                ],
                'circle-opacity': 0.8
            }
        });

        // Add click event to the noise-level layer
        map.on('click', 'noise-level', (e) => {
            const coordinates = e.features[0].geometry.coordinates.slice();
            const properties = e.features[0].properties;

            // Create popup content
            let popupContent = '<div>';
            for (const [key, value] of Object.entries(properties)) {
                popupContent += `<strong>${key}:</strong> ${value}<br>`;
            }
            popupContent += '</div>';

            // Ensure that if the map is zoomed out such that multiple
            // copies of the feature are visible, the popup appears
            // over the copy being pointed to.
            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }

            new mapboxgl.Popup()
                .setLngLat(coordinates)
                .setHTML(popupContent)
                .addTo(map);
        });

        // Change the cursor to a pointer when the mouse is over the noise-level layer.
        map.on('mouseenter', 'noise-level', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        // Change it back to a pointer when it leaves.
        map.on('mouseleave', 'noise-level', () => {
            map.getCanvas().style.cursor = '';
        });

        initializeAudio();
    });
});

function initializeAudio() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                const audioContext = new AudioContext();
                const analyser = audioContext.createAnalyser();
                const microphone = audioContext.createMediaStreamSource(stream);
                microphone.connect(analyser);
                analyser.fftSize = 2048;
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Float32Array(bufferLength);

                let isRecording = true;
                let lastUpdateTime = 0;
                let lastSnapshotTime = 0;
                let allReadings = [];

                function updateNoiseLevel(timestamp) {
                    if (!isRecording) return;

                    if (timestamp - lastUpdateTime >= 100) { // Update every 100ms for smoother meter
                        analyser.getFloatTimeDomainData(dataArray);
                        let rms = 0;
                        for (let i = 0; i < bufferLength; i++) {
                            rms += dataArray[i] * dataArray[i];
                        }
                        rms = Math.sqrt(rms / bufferLength);

                        let db = 20 * Math.log10(rms);
                        db = Math.max(30, Math.min(90, db + 90));
                        db = Math.round(db);

                        updateSoundMeter(db);

                        if (timestamp - lastUpdateTime >= 1000) { // Update stats every 1 second
                            document.getElementById('current-level').textContent = db;

                            soundReadings.push(db);
                            allReadings.push(db);
                            if (soundReadings.length > 10) {
                                soundReadings.shift();
                            }
                            let weightedAvg = Math.round(calculateWeightedAverage(soundReadings));
                            document.getElementById('avg-level').textContent = weightedAvg;

                            let min = Math.min(...allReadings);
                            let max = Math.max(...allReadings);
                            document.getElementById('min-level').textContent = min;
                            document.getElementById('max-level').textContent = max;

                            // Update duration
                            let currentTime = Date.now();
                            let duration = Math.floor((currentTime - startTime - pausedDuration) / 1000);
                            document.getElementById('duration').textContent = duration;

                            // Update Firebase with the user's current noise level, location, and accuracy
                            database.ref('users/' + userId).set({
                                location: [
                                    Number(userLocation[0].toFixed(4)), // longitude rounded to 4 decimals
                                    Number(userLocation[1].toFixed(4))  // latitude rounded to 4 decimals
                                ],
                                db: db,
                                accuracy: Math.round(locationAccuracy), // accuracy rounded to integer
                                timestamp: firebase.database.ServerValue.TIMESTAMP,
                                userAgent: navigator.userAgent // Add user agent information
                            });

                            lastUpdateTime = timestamp;
                        }

                        // Save snapshot every 10 seconds
                        if (timestamp - lastSnapshotTime >= 10000) {
                            noiseHistory.push({
                                coordinates: [...userLocation],
                                db: db,
                                timestamp: Date.now()
                            });

                            lastSnapshotTime = timestamp;
                        }
                    }

                    requestAnimationFrame(updateNoiseLevel);
                }

                updateNoiseLevel(0);

                // Listen for changes in the Firebase database
                database.ref('users').on('value', (snapshot) => {
                    const users = snapshot.val();
                    const features = [];
                    for (let userId in users) {
                        const user = users[userId];
                        features.push({
                            'type': 'Feature',
                            'geometry': {
                                'type': 'Point',
                                'coordinates': user.location
                            },
                            'properties': user // Include all properties from Firebase
                        });
                    }
                    if (map.loaded()) {
                        map.getSource('noise').setData({
                            'type': 'FeatureCollection',
                            'features': features
                        });
                    }
                });

                // Control buttons functionality
                document.getElementById('pauseBtn').addEventListener('click', () => {
                    isRecording = false;
                    isPaused = true;
                    pausedDuration -= Date.now();
                    document.getElementById('pauseBtn').disabled = true;
                    document.getElementById('resumeBtn').disabled = false;
                });

                document.getElementById('resumeBtn').addEventListener('click', () => {
                    isRecording = true;
                    isPaused = false;
                    pausedDuration += Date.now();
                    document.getElementById('pauseBtn').disabled = false;
                    document.getElementById('resumeBtn').disabled = true;
                    requestAnimationFrame(updateNoiseLevel);
                });

                document.getElementById('resetBtn').addEventListener('click', () => {
                    soundReadings = [];
                    allReadings = [];
                    noiseHistory = [];
                    document.getElementById('current-level').textContent = '0';
                    document.getElementById('avg-level').textContent = '0';
                    document.getElementById('min-level').textContent = '0';
                    document.getElementById('max-level').textContent = '0';
                    updateSoundMeter(0);
                    // Remove user data from Firebase
                    database.ref('users/' + userId).remove();
                });
            })
            .catch(error => console.error('Error accessing microphone:', error));
    } else {
        console.error('getUserMedia is not supported in this browser');
    }
}