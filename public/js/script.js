/**
 * Real-time location-sharing and mapping application using Leaflet.js and Socket.IO.
 * Features include user tracking, place search, autocomplete, routing with popup info, and nearby POI search.
 */

// Initialize Socket.IO connection
const socket = io();
let mySocketId = null;
let myMarker = null;
let activeUsers = {};
let currentMapLayer = 'streets';
let routeLayer = null;
let destinationMarker = null;
let poiMarkers = [];
let distanceMeasurementActive = false;
let measurePoints = [];
let measureMarkers = [];
let measureLines = [];
let autocompleteCache = new Map(); // Cache for autocomplete suggestions
const MIN_CHARS_FOR_AUTOCOMPLETE = 2;
const DEFAULT_LOCATION = [37.7749, -122.4194]; // San Francisco
const DEFAULT_ZOOM = 16;

// Map layers
const mapLayers = {
    streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    })
};

// Initialize map
const mapElement = document.getElementById("map");
let map;
if (mapElement) {
    map = L.map("map", {
        layers: [mapLayers.streets]
    }).setView(DEFAULT_LOCATION, DEFAULT_ZOOM);
} else {
    document.body.innerHTML = '<div class="error">Map container not found. Please check your HTML.</div>';
    throw new Error("Map container not found");
}

// Custom marker icon
function createCustomIcon(isCurrentUser = false) {
    return L.divIcon({
        className: `custom-marker ${isCurrentUser ? 'self' : ''}`,
        html: `<i class="fas fa-male"></i>`,
        iconSize: [50, 50],
        iconAnchor: [25, 50]
    });
}

// UI Elements
const sidebar = document.querySelector('.sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const centerMapBtn = document.getElementById('center-map');
const toggleSatelliteBtn = document.getElementById('toggle-satellite');
const connectionText = document.getElementById('connection-text');
const connectionIcon = document.getElementById('connection-icon');
const trackingText = document.getElementById('tracking-text');
const trackingIcon = document.getElementById('tracking-icon');
const userIdElement = document.getElementById('user-id');
const currentLatElement = document.getElementById('current-lat');
const currentLngElement = document.getElementById('current-lng');
const currentAddressElement = document.getElementById('current-address');
const activeUsersList = document.getElementById('active-users-list');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const searchResultsPanel = document.querySelector('.search-results-panel');
const resultsContainer = document.querySelector('.results-container');
const closeResultsBtn = document.getElementById('close-results');
const quickSearchButtons = document.querySelectorAll('.quick-search-btn');
const shareLocationBtn = document.getElementById('share-location');
const shareModal = document.getElementById('share-modal');
const closeModalBtn = document.getElementById('close-modal');
const copyLinkBtn = document.getElementById('copy-link');
const shareLink = document.getElementById('share-link');
const measureDistanceBtn = document.getElementById('measure-distance');
const travelTimesBtn = document.getElementById('travel-times');
let autocompleteResults = document.getElementById('autocomplete-results');

// Add autocomplete dropdown if missing
if (!autocompleteResults && searchInput) {
    autocompleteResults = document.createElement('div');
    autocompleteResults.id = 'autocomplete-results';
    autocompleteResults.className = 'autocomplete-dropdown';
    searchInput.parentNode.appendChild(autocompleteResults);
}

// Event Listeners
if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
        if (sidebar && !sidebar.classList.contains('active')) {
            sidebar.classList.add('active');
        }
    });
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
        if (sidebar && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
        }
    });
}

if (closeResultsBtn) {
    closeResultsBtn.addEventListener('click', () => {
        if (searchResultsPanel) {
            searchResultsPanel.classList.remove('active');
            clearSearchResults();
        }
    });
}

if (searchButton) {
    searchButton.addEventListener('click', () => {
        const query = searchInput?.value.trim();
        if (!query) return;
        const { lat, lng } = getCurrentLocation();
        searchPlaces(query, lat, lng);
    });
}

if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (!query) return;
            const { lat, lng } = getCurrentLocation();
            searchPlaces(query, lat, lng);
        }
    });

    searchInput.addEventListener('input', debounce((e) => {
        const query = e.target.value.trim();
        if (query.length < MIN_CHARS_FOR_AUTOCOMPLETE) {
            autocompleteResults.innerHTML = '';
            autocompleteResults.classList.remove('active');
            return;
        }
        const { lat, lng } = getCurrentLocation();
        fetchAutocompleteSuggestions(query, lat, lng);
    }, 300));

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !autocompleteResults.contains(e.target)) {
            autocompleteResults.classList.remove('active');
        }
    });
}

if (quickSearchButtons) {
    quickSearchButtons.forEach(button => {
        button.addEventListener('click', () => {
            const category = button.dataset.category;
            const query = button.dataset.query;
            const { lat, lng } = getCurrentLocation();
            if (category) {
                searchNearby(category, lat, lng);
            } else if (query) {
                searchPlaces(query, lat, lng);
            }
        });
    });
}

if (centerMapBtn) {
    centerMapBtn.addEventListener('click', () => {
        if (myMarker) {
            map.setView(myMarker.getLatLng(), DEFAULT_ZOOM);
        }
    });
}

if (toggleSatelliteBtn) {
    toggleSatelliteBtn.addEventListener('click', () => {
        if (currentMapLayer === 'streets') {
            map.removeLayer(mapLayers.streets);
            map.addLayer(mapLayers.satellite);
            currentMapLayer = 'satellite';
            toggleSatelliteBtn.innerHTML = '<i class="fas fa-map"></i>';
        } else {
            map.removeLayer(mapLayers.satellite);
            map.addLayer(mapLayers.streets);
            currentMapLayer = 'streets';
            toggleSatelliteBtn.innerHTML = '<i class="fas fa-globe"></i>';
        }
    });
}

if (shareLocationBtn) {
    shareLocationBtn.addEventListener('click', () => {
        if (!myMarker) {
            showToast('Location not available. Please enable tracking.');
            return;
        }
        if (shareModal) {
            shareModal.classList.add('active');
            const shareUrl = `${window.location.origin}?user=${mySocketId}&lat=${myMarker.getLatLng().lat}&lng=${myMarker.getLatLng().lng}`;
            if (shareLink) shareLink.value = shareUrl;
        }
    });
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        if (shareModal) {
            shareModal.classList.remove('active');
        }
    });
}

if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
        if (shareLink) {
            navigator.clipboard.writeText(shareLink.value)
                .then(() => showToast('Link copied to clipboard!'))
                .catch(() => showToast('Failed to copy link.'));
        }
    });
}

if (measureDistanceBtn) {
    measureDistanceBtn.addEventListener('click', () => {
        distanceMeasurementActive = !distanceMeasurementActive;
        measureDistanceBtn.classList.toggle('active', distanceMeasurementActive);
        if (distanceMeasurementActive) {
            map.on('click', handleMeasureClick);
            showToast('Click on the map to start measuring distance.');
        } else {
            map.off('click', handleMeasureClick);
            clearMeasurement();
            showToast('Distance measurement stopped.');
        }
    });
}

if (travelTimesBtn) {
    travelTimesBtn.style.display = 'none'; // Hidden by default
    travelTimesBtn.addEventListener('click', () => {
        if (destinationMarker) {
            const { lat, lng } = destinationMarker.getLatLng();
            showTravelTimes(lat, lng);
        }
    });
}

// Socket Events
socket.on('connect', () => {
    mySocketId = socket.id;
    userIdElement.textContent = `ID: ${hashId(mySocketId)}`;
    connectionText.textContent = 'Connected';
    connectionIcon.innerHTML = '<i class="fas fa-wifi"></i>';
    connectionIcon.classList.add('connected');
    connectionIcon.classList.remove('disconnected');
});

socket.on('disconnect', () => {
    connectionText.textContent = 'Disconnected';
    connectionIcon.innerHTML = '<i class="fas fa-wifi-slash"></i>';
    connectionIcon.classList.add('disconnected');
    connectionIcon.classList.remove('connected');
    trackingText.textContent = 'Tracking Inactive';
    trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
});

socket.on('receive-location', (data) => {
    const { id, latitude, longitude } = data;
    if (id === mySocketId) return;

    if (!activeUsers[id]) {
        activeUsers[id] = {
            id,
            marker: L.marker([latitude, longitude], {
                icon: createCustomIcon(false)
            }).addTo(map),
            lastUpdate: new Date()
        };
        activeUsers[id].marker.bindPopup(`
            <div class="user-popup">
                <h3>User ${hashId(id).substring(0, 6)}</h3>
                <p>Lat: ${latitude.toFixed(6)}</p>
                <p>Lng: ${longitude.toFixed(6)}</p>
            </div>
        `);
        updateActiveUsersList();
    } else {
        activeUsers[id].marker.setLatLng([latitude, longitude]);
        activeUsers[id].lastUpdate = new Date();
    }
});

// Geolocation Tracking
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            socket.emit('send-location', { latitude, longitude });
            currentLatElement.textContent = `Latitude: ${latitude.toFixed(6)}`;
            currentLngElement.textContent = `Longitude: ${longitude.toFixed(6)}`;
            fetchAddress(latitude, longitude);

            if (myMarker) {
                myMarker.setLatLng([latitude, longitude]);
            } else {
                myMarker = L.marker([latitude, longitude], {
                    icon: createCustomIcon(true)
                }).addTo(map);
                myMarker.bindPopup(`
                    <div class="user-popup">
                        <h3>Your Location</h3>
                        <p>Lat: ${latitude.toFixed(6)}</p>
                        <p>Lng: ${longitude.toFixed(6)}</p>
                    </div>
                `);
                activeUsers[mySocketId] = {
                    id: mySocketId,
                    marker: myMarker,
                    lastUpdate: new Date()
                };
                map.setView([latitude, longitude], DEFAULT_ZOOM);
            }

            trackingText.textContent = 'Tracking Active';
            trackingIcon.innerHTML = '<i class="fas fa-location-arrow"></i>';
            trackingIcon.classList.add('pulse');
        },
        (error) => {
            console.error('Error getting location:', error);
            trackingText.textContent = 'Tracking Error';
            trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
            trackingIcon.classList.remove('pulse');
            showToast('Could not get your location. Please check GPS settings.');
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
} else {
    trackingText.textContent = 'Geolocation Not Supported';
    trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
    showToast('Geolocation is not supported by your browser.');
}

// Helper Functions

/**
 * Updates the active users list in the sidebar.
 */
function updateActiveUsersList() {
    if (!activeUsersList) return;
    activeUsersList.innerHTML = '';
    Object.values(activeUsers).forEach(user => {
        const isCurrentUser = user.id === mySocketId;
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="user-item">
                <i class="fas fa-car"></i>
                <span>${isCurrentUser ? 'You' : 'User ' + hashId(user.id).substring(0, 6)}</span>
            </div>
        `;
        activeUsersList.appendChild(li);
    });

    if (Object.keys(activeUsers).length === 0) {
        activeUsersList.innerHTML = '<li>No active users</li>';
    }
}

/**
 * Fetches address from coordinates using Nominatim API.
 * @param {number} lat - Latitude coordinate.
 * @param {number} lng - Longitude coordinate.
 * @returns {Promise<void>}
 */
async function fetchAddress(lat, lng) {
    if (!currentAddressElement) return;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        currentAddressElement.textContent = data.display_name
            ? `Address: ${data.display_name}`
            : 'Address: Not available';
    } catch (error) {
        console.error('Error fetching address:', error);
        currentAddressElement.textContent = 'Address: Error fetching';
    }
}

/**
 * Cleans up inactive users every 30 seconds.
 */
setInterval(() => {
    const now = new Date();
    Object.keys(activeUsers).forEach(id => {
        if (now - activeUsers[id].lastUpdate > 30000 && id !== mySocketId) {
            if (activeUsers[id].marker) map.removeLayer(activeUsers[id].marker);
            delete activeUsers[id];
            updateActiveUsersList();
        }
    });
}, 30000);

/**
 * Fetches autocomplete suggestions from Nominatim API.
 * @param {string} query - Search query.
 * @param {number} lat - User's latitude.
 * @param {number} lng - User's longitude.
 * @returns {Promise<void>}
 */
async function fetchAutocompleteSuggestions(query, lat, lng) {
    if (!autocompleteResults) return;
    const cacheKey = `${query}:${lat}:${lng}`;
    if (autocompleteCache.has(cacheKey)) {
        displayAutocompleteSuggestions(autocompleteCache.get(cacheKey), query);
        return;
    }
    try {
        const viewboxSize = 0.1;
        const viewbox = `${lng - viewboxSize},${lat - viewboxSize},${lng + viewboxSize},${lat + viewboxSize}`;
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&viewbox=${viewbox}&bounded=1&addressdetails=1`);
        const data = await response.json();
        autocompleteCache.set(cacheKey, data);
        displayAutocompleteSuggestions(data, query);
    } catch (error) {
        console.error('Error fetching autocomplete suggestions:', error);
        showToast('Error loading suggestions.');
    }
}

/**
 * Displays autocomplete suggestions in dropdown.
 * @param {Array} results - API response data.
 * @param {string} query - Search query.
 */
function displayAutocompleteSuggestions(results, query) {
    autocompleteResults.innerHTML = '';
    if (results.length === 0) {
        autocompleteResults.classList.remove('active');
        return;
    }

    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'autocomplete-item';
        const displayName = highlightMatch(result.display_name, query);
        resultItem.innerHTML = `
            <div class="item-name">${displayName}</div>
            <div class="item-address">${result.type || 'Place'}</div>
        `;
        resultItem.addEventListener('click', () => {
            searchInput.value = result.display_name;
            autocompleteResults.classList.remove('active');
            const { lat, lng } = getCurrentLocation();
            searchPlaces(result.display_name, lat, lng);
        });
        autocompleteResults.appendChild(resultItem);
    });

    autocompleteResults.classList.add('active');
}

/**
 * Highlights matching text in autocomplete results.
 * @param {string} text - Text to highlight.
 * @param {string} query - Search query.
 * @returns {string} Highlighted text.
 */
function highlightMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

/**
 * Extracts keywords from search query for refined search.
 * @param {string} query - Search query.
 * @returns {string} Formatted search query.
 */
function extractKeywords(query) {
    const lowerQuery = query.toLowerCase();
    const amenityKeywords = [
        { term: 'restaurant', osmTag: 'amenity=restaurant' },
        { term: 'cafe', osmTag: 'amenity=cafe' },
        { term: 'coffee', osmTag: 'amenity=cafe' },
        { term: 'bar', osmTag: 'amenity=bar' },
        { term: 'pub', osmTag: 'amenity=pub' },
        { term: 'hotel', osmTag: 'tourism=hotel' },
        { term: 'supermarket', osmTag: 'shop=supermarket' },
        { term: 'market', osmTag: 'amenity=market' },
        { term: 'hospital', osmTag: 'amenity=hospital' },
        { term: 'park', osmTag: 'leisure=park' },
        { term: 'fuel', osmTag: 'amenity=fuel' } // Added for gas stations
    ];

    const amenities = amenityKeywords
        .filter(({ term }) => lowerQuery.includes(term))
        .map(({ osmTag }) => osmTag);
    return amenities.length ? amenities.join(' ') + ' ' + lowerQuery : query;
}

/**
 * Searches for places using Nominatim API.
 * @param {string} query - Search query.
 * @param {number} lat - User's latitude.
 * @param {number} lng - User's longitude.
 * @returns {Promise<void>}
 */
async function searchPlaces(query, lat, lng) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
    searchResultsPanel.classList.add('active');

    try {
        const searchQuery = extractKeywords(query);
        const viewboxSize = 0.5;
        const viewbox = `${lng - viewboxSize},${lat - viewboxSize},${lng + viewboxSize},${lat + viewboxSize}`;
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=10&viewbox=${viewbox}&bounded=1&addressdetails=1`);
        const data = await response.json();
        displaySearchResults(data, query);
    } catch (error) {
        console.error('Error searching places:', error);
        resultsContainer.innerHTML = '<div class="no-results">Error searching. Please try again.</div>';
        showToast('Error searching places.');
    }
}

/**
 * Searches for nearby places by category using Overpass API.
 * @param {string} category - Category to search (e.g., restaurant).
 * @param {number} lat - User's latitude.
 * @param {number} lng - User's longitude.
 * @returns {Promise<void>}
 */
async function searchNearby(category, lat, lng) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    resultsContainer.innerHTML = `<div class="loading">Searching nearby ${category}...</div>`;
    searchResultsPanel.classList.add('active');

    try {
        const radius = 2000;
        const categoryTags = {
            restaurant: 'amenity=restaurant',
            cafe: 'amenity=cafe',
            bar: 'amenity=bar',
            pub: 'amenity=pub',
            hotel: 'tourism=hotel',
            supermarket: 'shop=supermarket',
            market: 'amenity=market',
            hospital: 'amenity=hospital',
            park: 'leisure=park',
            fuel: 'amenity=fuel'
        };

        const tag = categoryTags[category] || `amenity=${category}`;
        const [key, value] = tag.split('=');
        const overpassQuery = `
            [out:json];
            (
                node["${key}"="${value}"](around:${radius},${lat},${lng});
                way["${key}"="${value}"](around:${radius},${lat},${lng});
                relation["${key}"="${value}"](around:${radius},${lat},${lng});
            );
            out body;
            >;
            out skel qt;
        `;

        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: overpassQuery
        });
        const data = await response.json();
        displayNearbyResults(data.elements, category);
    } catch (error) {
        console.error('Error searching nearby:', error);
        resultsContainer.innerHTML = '<div class="no-results">Error searching nearby. Please try again.</div>';
        showToast('Error searching nearby.');
    }
}

/**
 * Displays search results in the results panel.
 * @param {Array} results - API response data.
 * @param {string} query - Search query.
 */
function displaySearchResults(results, query) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    resultsContainer.innerHTML = '';

    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
        return;
    }

    clearPoiMarkers();
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        const name = result.display_name || 'Unknown';
        const distance = myMarker ? calculateDistance(
            myMarker.getLatLng().lat,
            myMarker.getLatLng().lng,
            parseFloat(result.lat),
            parseFloat(result.lon)
        ) : 0;
        const distanceText = distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;

        resultItem.innerHTML = `
            <h4>${highlightMatch(name, query)}</h4>
            <p>Distance: ${distanceText}</p>
            <div class="result-actions">
                <button class="btn-view" onclick="viewOnMap(${result.lat}, ${result.lon}, '${name.replace(/'/g, "\\'")}')">View</button>
                <button class="btn-route" onclick="getRoute(${result.lat}, ${result.lon}, '${name.replace(/'/g, "\\'")}')">Show Route</button>
            </div>
        `;
        resultItem.addEventListener('click', () => viewOnMap(result.lat, result.lon, name));
        resultsContainer.appendChild(resultItem);
        addPoiMarker(result.lat, result.lon, name);
    });
}

/**
 * Displays nearby search results in the results panel.
 * @param {Array} results - Overpass API response data.
 * @param {string} category - Category searched.
 */
function displayNearbyResults(results, category) {
    if (!resultsContainer || !searchResultsPanel || !map || !myMarker) return;
    const validResults = results.filter(item => item.lat && item.lon);
    resultsContainer.innerHTML = '';

    if (validResults.length === 0) {
        resultsContainer.innerHTML = `<div class="no-results">No ${category} found nearby</div>`;
        return;
    }

    validResults.sort((a, b) => {
        const distA = calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, a.lat, a.lon);
        const distB = calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, b.lat, b.lon);
        return distA - distB;
    });

    clearPoiMarkers();
    validResults.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        const name = result.tags?.name || category.charAt(0).toUpperCase() + category.slice(1);
        const distance = calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, result.lat, result.lon);
        const distanceText = distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;

        resultItem.innerHTML = `
            <h4>${name}</h4>
            <p>Distance: ${distanceText}</p>
            <div class="result-actions">
                <button class="btn-view" onclick="viewOnMap(${result.lat}, ${result.lon}, '${name.replace(/'/g, "\\'")}')">View</button>
                <button class="btn-route" onclick="getRoute(${result.lat}, ${result.lon}, '${name.replace(/'/g, "\\'")}')">Show Route</button>
            </div>
        `;
        resultItem.addEventListener('click', () => viewOnMap(result.lat, result.lon, name));
        resultsContainer.appendChild(resultItem);
        addPoiMarker(result.lat, result.lon, name);
    });
}

/**
 * Calculates distance between two points using Haversine formula.
 * @param {number} lat1 - First latitude.
 * @param {number} lon1 - First longitude.
 * @param {number} lat2 - Second latitude.
 * @param {number} lon2 - Second longitude.
 * @returns {number} Distance in kilometers.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Converts degrees to radians.
 * @param {number} deg - Degrees.
 * @returns {number} Radians.
 */
function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Gets route between current location and destination using OSRM, displaying info in a popup.
 * @param {number} destLat - Destination latitude.
 * @param {number} destLng - Destination longitude.
 * @param {string} name - Name of the destination.
 * @returns {Promise<void>}
 */
async function getRoute(destLat, destLng, name) {
    if (!map || !myMarker) return;
    showToast('Calculating route...');

    try {
        const startLat = myMarker.getLatLng().lat;
        const startLng = myMarker.getLatLng().lng;
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            clearRoute();

            routeLayer = L.geoJSON(data.routes[0].geometry, {
                style: { color: '#276EF1', weight: 6, opacity: 0.7 }
            }).addTo(map);
            map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

            destinationMarker = L.marker([destLat, destLng], {
                icon: createCustomIcon(false)
            }).addTo(map);

            const distance = (data.routes[0].distance / 1000).toFixed(1);
            const duration = Math.round(data.routes[0].duration / 60);

            destinationMarker.bindPopup(`
                <div class="route-info-popup">
                    <h4>${name}</h4>
                    <p><i class="fas fa-road"></i> Distance: ${distance} km</p>
                    <p><i class="fas fa-clock"></i> Duration: ${duration} min</p>
                    <button class="close-route-btn" onclick="clearRoute()">Clear Route</button>
                </div>
            `, {
                offset: L.point(0, -30)
            }).openPopup();

            if (travelTimesBtn) travelTimesBtn.style.display = 'block';
        } else {
            showToast('No route found. Please try a different destination.');
        }
    } catch (error) {
        console.error('Error calculating route:', error);
        showToast('Error calculating route. Please try again.');
    } finally {
        hideToast();
    }
}

/**
 * Shows travel times by car, bike, and walking to the destination.
 * @param {number} destLat - Destination latitude.
 * @param {number} destLng - Destination longitude.
 * @returns {Promise<void>}
 */
async function showTravelTimes(destLat, destLng) {
    if (!myMarker || !destinationMarker) return;
    showToast('Calculating travel times...');

    try {
        const startLat = myMarker.getLatLng().lat;
        const startLng = myMarker.getLatLng().lng;
        const modes = [
            { mode: 'driving', icon: 'car', label: 'Car' },
            { mode: 'cycling', icon: 'bicycle', label: 'Bike' },
            { mode: 'walking', icon: 'walking', label: 'Walk' }
        ];

        const times = await Promise.all(modes.map(async ({ mode, icon, label }) => {
            const response = await fetch(`https://router.project-osrm.org/route/v1/${mode}/${startLng},${startLat};${destLng},${destLat}?overview=false`);
            const data = await response.json();
            if (data.routes && data.routes.length > 0) {
                const duration = Math.round(data.routes[0].duration / 60);
                return `<p><i class="fas fa-${icon}"></i> ${label}: ${duration} min</p>`;
            }
            return `<p><i class="fas fa-${icon}"></i> ${label}: Unavailable</p>`;
        }));

        destinationMarker.bindPopup(`
            <div class="route-info-popup">
                <h4>Travel Times</h4>
                <div class="travel-times">${times.join('')}</div>
                <button class="close-route-btn" onclick="clearRoute()">Clear Route</button>
            </div>
        `, {
            offset: L.point(0, -30)
        }).openPopup();
    } catch (error) {
        console.error('Error calculating travel times:', error);
        showToast('Error calculating travel times.');
    } finally {
        hideToast();
    }
}

/**
 * Clears the current route, destination marker, and popup.
 */
function clearRoute() {
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
    if (travelTimesBtn) travelTimesBtn.style.display = 'none';
}

/**
 * Shows a toast message.
 * @param {string} message - Message to display.
 */
function showToast(message) {
    hideToast();
    const toast = document.createElement('div');
    toast.className = 'loading-toast';
    toast.id = 'loading-toast';
    toast.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(hideToast, 3000);
}

/**
 * Hides the toast message.
 */
function hideToast() {
    const existingToast = document.getElementById('loading-toast');
    if (existingToast) existingToast.remove();
}

/**
 * Clears search results and POI markers.
 */
function clearSearchResults() {
    if (resultsContainer) {
        resultsContainer.innerHTML = '<p class="no-results">Search for places to see results</p>';
    }
    clearPoiMarkers();
}

/**
 * Clears all POI markers from the map.
 */
function clearPoiMarkers() {
    poiMarkers.forEach(marker => map.removeLayer(marker));
    poiMarkers = [];
}

/**
 * Adds a POI marker to the map.
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @param {string} name - Name of the place.
 */
function addPoiMarker(lat, lng, name) {
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`<div class="poi-popup"><h3>${name}</h3></div>`);
    poiMarkers.push(marker);
}

/**
 * Views a location on the map.
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @param {string} name - Name of the place.
 */
function viewOnMap(lat, lng, name) {
    map.setView([lat, lng], DEFAULT_ZOOM);
    addPoiMarker(lat, lng, name);
}

/**
 * Handles map click for distance measurement.
 * @param {Object} e - Leaflet click event.
 */
function handleMeasureClick(e) {
    measurePoints.push(e.latlng);
    const marker = L.marker(e.latlng).addTo(map);
    measureMarkers.push(marker);

    if (measurePoints.length > 1) {
        const line = L.polyline(measurePoints.slice(-2), { color: '#FF0000' }).addTo(map);
        measureLines.push(line);
        const distance = calculateDistance(
            measurePoints[measurePoints.length - 2].lat,
            measurePoints[measurePoints.length - 2].lng,
            measurePoints[measurePoints.length - 1].lat,
            measurePoints[measurePoints.length - 1].lng
        );
        marker.bindPopup(`Distance: ${distance.toFixed(2)} km`).openPopup();
        showToast(`Distance: ${distance.toFixed(2)} km`);
    }
}

/**
 * Clears distance measurement markers and lines.
 */
function clearMeasurement() {
    measureMarkers.forEach(marker => map.removeLayer(marker));
    measureLines.forEach(line => map.removeLayer(line));
    measurePoints = [];
    measureMarkers = [];
    measureLines = [];
}

/**
 * Gets the current location or falls back to map center.
 * @returns {Object} Latitude and longitude.
 */
function getCurrentLocation() {
    if (myMarker) {
        return { lat: myMarker.getLatLng().lat, lng: myMarker.getLatLng().lng };
    }
    const center = map.getCenter();
    return { lat: center.lat, lng: center.lng };
}

/**
 * Obfuscates user ID for display.
 * @param {string} id - User ID.
 * @returns {string} Hashed ID.
 */
function hashId(id) {
    return btoa(id).substring(0, 12);
}

/**
 * Debounces a function to limit execution rate.
 * @param {Function} func - Function to debounce.
 * @param {number} wait - Wait time in milliseconds.
 * @returns {Function} Debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Initializes the application.
 */
function initializeApp() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                socket.emit('send-location', { latitude, longitude });
                currentLatElement.textContent = `Latitude: ${latitude.toFixed(6)}`;
                currentLngElement.textContent = `Longitude: ${longitude.toFixed(6)}`;
                fetchAddress(latitude, longitude);

                if (!myMarker) {
                    myMarker = L.marker([latitude, longitude], {
                        icon: createCustomIcon(true)
                    }).addTo(map);
                    myMarker.bindPopup(`
                        <div class="user-popup">
                            <h3>Your Location</h3>
                            <p>Lat: ${latitude.toFixed(6)}</p>
                            <p>Lng: ${longitude.toFixed(6)}</p>
                        </div>
                    `);
                    activeUsers[mySocketId] = {
                        id: mySocketId,
                        marker: myMarker,
                        lastUpdate: new Date()
                    };
                    map.setView([latitude, longitude], DEFAULT_ZOOM);
                } else {
                    myMarker.setLatLng([latitude, longitude]);
                }
                trackingText.textContent = 'Tracking Active';
                trackingIcon.innerHTML = '<i class="fas fa-location-arrow"></i>';
                trackingIcon.classList.add('pulse');
            },
            (error) => {
                console.error('Error getting location:', error);
                trackingText.textContent = 'Tracking Failed';
                trackingIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                showToast('Could not get your location. Please check GPS settings.');
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
    } else {
        showToast('Geolocation is not supported by your browser.');
        trackingText.textContent = 'Tracking Not Supported';
        trackingIcon.innerHTML = '<i class="fas fa-ban"></i>';
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);