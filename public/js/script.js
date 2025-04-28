// Initialize socket connection
const socket = io();
let mySocketId = null;
let myMarker = null;
let activeUsers = {};
let currentMapLayer = 'streets';
let mapLayers = {
    streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    })
};

// Add these variables for route functionality
let routeLayer = null;
let routeInfoControl = null;

// Initialize map with a default location (San Francisco)
const mapElement = document.getElementById("map");
let map;

if (mapElement) {
    map = L.map("map", {
        layers: [mapLayers.streets]
    }).setView([37.7749, -122.4194], 16); // Increased zoom level from 13 to 16
    console.log("Map initialized successfully");
} else {
    console.error("Map container not found!");
}

// Custom marker icon
const createCustomIcon = (isCurrentUser = false) => {
    return L.divIcon({
        className: isCurrentUser ? 'custom-marker self' : 'custom-marker',
        html: `<i class="fas fa-male"></i>`, // Using a person icon
        iconSize: [50, 50], // Increased from 40x40 to 50x50
        iconAnchor: [25, 50]
    });
};

// UI Elements - Add null checks to prevent errors
const sidebar = document.querySelector('.sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const centerMapBtn = document.getElementById('center-map');
const toggleTrafficBtn = document.getElementById('toggle-traffic');
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

// Event Listeners - Add null checks to prevent errors
if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
        if (sidebar) sidebar.classList.toggle('active');
    });
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
        if (sidebar) sidebar.classList.remove('active');
    });
}

// Add search functionality event listeners
if (searchButton) {
    searchButton.addEventListener('click', () => {
        if (searchInput && map && myMarker) {
            const query = searchInput.value.trim();
            if (query) {
                searchPlaces(query, myMarker.getLatLng().lat, myMarker.getLatLng().lng);
            }
        }
    });
}

if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && map && myMarker) {
            const query = searchInput.value.trim();
            if (query) {
                searchPlaces(query, myMarker.getLatLng().lat, myMarker.getLatLng().lng);
            }
        }
    });
}

// Add event listeners for quick search buttons
if (quickSearchButtons) {
    quickSearchButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (map && myMarker) {
                const category = button.dataset.category;
                const query = button.dataset.query;
                
                if (category) {
                    searchNearby(category, myMarker.getLatLng().lat, myMarker.getLatLng().lng);
                } else if (query) {
                    searchPlaces(query, myMarker.getLatLng().lat, myMarker.getLatLng().lng);
                }
            } else {
                alert('Your location is not available yet. Please wait for GPS tracking to activate.');
            }
        });
    });
}

if (centerMapBtn) {
    centerMapBtn.addEventListener('click', () => {
        if (myMarker && map) {
            map.setView(myMarker.getLatLng(), 16);
        }
    });
}

if (toggleSatelliteBtn) {
    toggleSatelliteBtn.addEventListener('click', () => {
        if (!map) return;
        
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

// Socket events
socket.on('connect', () => {
    mySocketId = socket.id;
    if (userIdElement) userIdElement.textContent = `ID: ${mySocketId}`;
    if (connectionText) connectionText.textContent = 'Connected';
    if (connectionIcon) {
        connectionIcon.innerHTML = '<i class="fas fa-wifi"></i>';
        connectionIcon.classList.add('connected');
        connectionIcon.classList.remove('disconnected');
    }
});

socket.on('disconnect', () => {
    if (connectionText) connectionText.textContent = 'Disconnected';
    if (connectionIcon) {
        connectionIcon.innerHTML = '<i class="fas fa-wifi-slash"></i>';
        connectionIcon.classList.add('disconnected');
        connectionIcon.classList.remove('connected');
    }
    if (trackingText) trackingText.textContent = 'Tracking Inactive';
    if (trackingIcon) trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
});

socket.on("receive-location", (data) => {
    if (!map) return;
    
    const { id, latitude, longitude } = data;
    
    // Update active users
    if (!activeUsers[id]) {
        activeUsers[id] = {
            id,
            marker: null,
            lastUpdate: new Date()
        };
        updateActiveUsersList();
    } else {
        activeUsers[id].lastUpdate = new Date();
    }
    
    // Update or create marker
    const isCurrentUser = id === mySocketId;
    if (activeUsers[id].marker) {
        activeUsers[id].marker.setLatLng([latitude, longitude]);
    } else {
        activeUsers[id].marker = L.marker([latitude, longitude], {
            icon: createCustomIcon(isCurrentUser)
        }).addTo(map);
        
        // Add popup with user info
        activeUsers[id].marker.bindPopup(`
            <div class="user-popup">
                <h3>${isCurrentUser ? 'Your Location' : 'User ' + id.substring(0, 6)}</h3>
                <p>Lat: ${latitude.toFixed(6)}</p>
                <p>Lng: ${longitude.toFixed(6)}</p>
            </div>
        `);
    }
    
    // If this is current user, update UI and center map
    if (isCurrentUser) {
        myMarker = activeUsers[id].marker;
        if (currentLatElement) currentLatElement.textContent = `Latitude: ${latitude.toFixed(6)}`;
        if (currentLngElement) currentLngElement.textContent = `Longitude: ${longitude.toFixed(6)}`;
        
        // Reverse geocode to get address
        fetchAddress(latitude, longitude);
        
        // Center map on first location
        if (!map.hasInitialLocation) {
            map.setView([latitude, longitude], 16);
            map.hasInitialLocation = true;
        }
    }
});

// Geolocation tracking
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            socket.emit('send-location', { latitude, longitude });
            
            if (trackingText) trackingText.textContent = 'Tracking Active';
            if (trackingIcon) {
                trackingIcon.innerHTML = '<i class="fas fa-location-arrow"></i>';
                trackingIcon.classList.add('pulse');
            }
        },
        (error) => {
            console.error('Error getting location:', error);
            if (trackingText) trackingText.textContent = 'Tracking Error';
            if (trackingIcon) {
                trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
                trackingIcon.classList.remove('pulse');
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0,
        }
    );
} else {
    if (trackingText) trackingText.textContent = 'Geolocation Not Supported';
    if (trackingIcon) trackingIcon.innerHTML = '<i class="fas fa-location-slash"></i>';
}

// Helper Functions
function updateActiveUsersList() {
    if (!activeUsersList) return;
    
    // Clear the list
    activeUsersList.innerHTML = '';
    
    // Add each user
    Object.values(activeUsers).forEach(user => {
        const isCurrentUser = user.id === mySocketId;
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="user-item">
                <i class="fas fa-car"></i>
                <span>${isCurrentUser ? 'You' : 'User ' + user.id.substring(0, 6)}</span>
            </div>
        `;
        activeUsersList.appendChild(li);
    });
    
    // If no users
    if (Object.keys(activeUsers).length === 0) {
        activeUsersList.innerHTML = '<li>No active users</li>';
    }
}

// Fetch address from coordinates using Nominatim (OpenStreetMap)
async function fetchAddress(lat, lng) {
    if (!currentAddressElement) return;
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        
        if (data && data.display_name) {
            currentAddressElement.textContent = `Address: ${data.display_name}`;
        } else {
            currentAddressElement.textContent = 'Address: Not available';
        }
    } catch (error) {
        console.error('Error fetching address:', error);
        currentAddressElement.textContent = 'Address: Error fetching';
    }
}

// Clean up inactive users every 30 seconds
setInterval(() => {
    if (!map) return;
    
    const now = new Date();
    Object.keys(activeUsers).forEach(id => {
        const user = activeUsers[id];
        const timeDiff = now - user.lastUpdate;
        
        // If user hasn't updated in 30 seconds, remove them
        if (timeDiff > 30000) {
            if (user.marker) {
                map.removeLayer(user.marker);
            }
            delete activeUsers[id];
            updateActiveUsersList();
        }
    });
}, 30000);

// POI markers array to keep track of all points of interest
let poiMarkers = [];
let trafficLayerActive = false;
let trafficLayer = null;
let distanceMeasurementActive = false;
let measurePoints = [];
let measureMarkers = [];
let measureLines = [];

// Search for places
async function searchPlaces(query, lat, lng) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    
    try {
        // Clear previous results
        clearSearchResults();
        
        // Show loading state
        resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
        searchResultsPanel.classList.add('active');
        
        // For POI searches like "restaurants near me", use Overpass API
        if (query.includes("near me")) {
            const amenity = query.replace(" near me", "").trim();
            const radius = 5000; // 5km radius (in meters)
            
            // Overpass query to find POIs of specified type near the user
            const overpassQuery = `
                [out:json];
                node["amenity"="${amenity}"](around:${radius},${lat},${lng});
                out body;
            `;
            
            const response = await fetch(`https://overpass-api.de/api/interpreter`, {
                method: 'POST',
                body: overpassQuery
            });
            
            const data = await response.json();
            
            if (data.elements && data.elements.length > 0) {
                displayNearbyResults(data.elements, amenity);
            } else {
                // Fallback to Nominatim if no results from Overpass
                const nominatimResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&lat=${lat}&lon=${lng}&addressdetails=1`);
                const nominatimData = await nominatimResponse.json();
                displaySearchResults(nominatimData, query);
            }
        } else {
            // Use Nominatim for regular searches
            const viewboxSize = 0.1; // Size of the viewbox in degrees
            const viewbox = `${lng-viewboxSize},${lat-viewboxSize},${lng+viewboxSize},${lat+viewboxSize}`;
            
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&viewbox=${viewbox}&bounded=1&addressdetails=1`);
            const data = await response.json();
            
            // Display results
            displaySearchResults(data, query);
        }
    } catch (error) {
        console.error('Error searching places:', error);
        resultsContainer.innerHTML = '<div class="no-results">Error searching. Please try again.</div>';
    }
}

// Search for nearby places
async function searchNearby(category, lat, lng) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    
    try {
        // Clear previous results
        clearSearchResults();
        
        // Show loading state
        resultsContainer.innerHTML = '<div class="loading">Searching nearby...</div>';
        searchResultsPanel.classList.add('active');
        
        // Use Overpass API to find nearby POIs
        const radius = 5000; // 5km radius (in meters)
        const query = `
            [out:json];
            node["amenity"="${category}"](around:${radius},${lat},${lng});
            out body;
        `;
        
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        });
        
        const data = await response.json();
        
        // Display results
        displayNearbyResults(data.elements, category);
    } catch (error) {
        console.error('Error searching nearby places:', error);
        resultsContainer.innerHTML = '<div class="no-results">Error searching nearby. Please try again.</div>';
    }
}

// Display Overpass API results
function displayOverpassResults(elements, amenityType) {
    if (!resultsContainer) return;
    
    if (elements.length === 0) {
        resultsContainer.innerHTML = `<div class="no-results">No ${amenityType} found nearby.</div>`;
        return;
    }
    
    let resultsHTML = '';
    
    elements.forEach(place => {
        const name = place.tags.name || `${amenityType.charAt(0).toUpperCase() + amenityType.slice(1)}`;
        resultsHTML += `
            <div class="result-item" data-lat="${place.lat}" data-lng="${place.lon}">
                <h4>${name}</h4>
                <p>${place.tags.address || ''}</p>
                <div class="result-actions">
                    <button class="btn-view" onclick="viewOnMap(${place.lat}, ${place.lon}, '${name.replace(/'/g, "\\'")}')">View</button>
                    <button class="btn-directions" onclick="getDirections(${place.lat}, ${place.lon})">Directions</button>
                    <button class="btn-route" onclick="getRoute(${place.lat}, ${place.lon})">Show Route</button>
                </div>
            </div>
        `;
        
        // Add marker for this place
        addPoiMarker(place.lat, place.lon, name);
    });
    
    resultsContainer.innerHTML = resultsHTML;
    
    // Add click event to result items
    const resultItems = document.querySelectorAll('.result-item');
    resultItems.forEach(item => {
        item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            const name = item.querySelector('h4').textContent;
            
            viewOnMap(lat, lng, name);
        });
    });
}

// View a location on the map
function viewOnMap(lat, lng, name) {
    if (!map) return;
    
    map.setView([lat, lng], 16);
    
    // Find existing marker or create a new one
    let marker = null;
    for (const m of poiMarkers) {
        if (m._latlng && m._latlng.lat === lat && m._latlng.lng === lng) {
            marker = m;
            break;
        }
    }
    
    if (!marker) {
        addPoiMarker(lat, lng, name);
    } else {
        marker.openPopup();
    }
}

// Display search results
function displaySearchResults(results, query) {
    if (!resultsContainer || !searchResultsPanel || !map) return;
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No results found for "' + query + '"</div>';
        return;
    }
    
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    // Add results to panel
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        resultItem.innerHTML = `
            <h4>${result.display_name}</h4>
            <p>Type: ${result.type || 'Place'}</p>
            <div class="result-actions">
                <button class="btn-view" onclick="viewOnMap(${result.lat}, ${result.lon}, '${result.display_name.replace(/'/g, "\\'")}')">View</button>
                <button class="btn-route" onclick="getRoute(${result.lat}, ${result.lon})">Show Route</button>
            </div>
        `;
        
        // Add click event to center map on result
        resultItem.addEventListener('click', () => {
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            // Center map on result
            map.setView([lat, lng], 16);
            
            // Add marker for result
            addPoiMarker(lat, lng, result.display_name);
            
            // Close results panel on mobile
            if (window.innerWidth <= 768) {
                searchResultsPanel.classList.remove('active');
            }
        });
        
        resultsContainer.appendChild(resultItem);
    });
}

// Display nearby search results
function displayNearbyResults(results, category) {
    if (!resultsContainer || !searchResultsPanel || !map || !myMarker) return;
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No ' + category + ' found nearby</div>';
        return;
    }
    
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    // Sort results by distance
    results.sort((a, b) => {
        const distA = calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, a.lat, a.lon);
        const distB = calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, b.lat, b.lon);
        return distA - distB;
    });
    
    // Add results to panel
    results.forEach(result => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        
        // Get name from tags or use category as fallback
        const name = result.tags && result.tags.name ? result.tags.name : category;
        
        resultItem.innerHTML = `
            <h4>${name}</h4>
            <p>Distance: ${calculateDistance(myMarker.getLatLng().lat, myMarker.getLatLng().lng, result.lat, result.lon).toFixed(1)} km</p>
            <div class="result-actions">
                <button class="btn-view" onclick="viewOnMap(${result.lat}, ${result.lon}, '${name.replace(/'/g, "\\'")}')">View</button>
                <button class="btn-route" onclick="getRoute(${result.lat}, ${result.lon})">Show Route</button>
            </div>
        `;
        
        // Add click event to center map on result
        resultItem.addEventListener('click', () => {
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            
            // Center map on result
            map.setView([lat, lng], 16);
            
            // Add marker for result
            addPoiMarker(lat, lng, name);
            
            // Close results panel on mobile
            if (window.innerWidth <= 768) {
                searchResultsPanel.classList.remove('active');
            }
        });
        
        resultsContainer.appendChild(resultItem);
    });
}

// Add POI marker to map
function addPoiMarker(lat, lng, name) {
    if (!map) return;
    
    // Create custom icon for POI
    const poiIcon = L.divIcon({
        className: 'poi-marker',
        html: `<i class="fas fa-map-pin"></i>`,
        iconSize: [45, 45], // Increased from 36x36 to 45x45
        iconAnchor: [22, 45],
        popupAnchor: [0, -45]
    });
    
    // Create marker
    const marker = L.marker([lat, lng], {
        icon: poiIcon
    }).addTo(map);
    
    // Add popup with improved UI
    marker.bindPopup(`
        <div class="poi-popup">
            <h3>${name}</h3>
            <p>Lat: ${lat.toFixed(6)}</p>
            <p>Lng: ${lng.toFixed(6)}</p>
            <div class="popup-buttons">
                <button class="btn-directions" onclick="getDirections(${lat}, ${lng})">Get Directions</button>
                <button class="btn-route" onclick="getRoute(${lat}, ${lng})">Show Route</button>
                <button class="btn-cancel" onclick="cancelRoute()">Cancel Route</button>
            </div>
        </div>
    `).openPopup();
    
    // Add to POI markers array
    poiMarkers.push(marker);
}

// Clear search results and POI markers
function clearSearchResults() {
    if (!map) return;
    
    // Clear POI markers from map
    poiMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    
    // Reset POI markers array
    poiMarkers = [];
    
    // Clear route layer if exists
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    
    // Remove route info control if exists
    if (routeInfoControl) {
        map.removeControl(routeInfoControl);
        routeInfoControl = null;
    }
    
    // Hide search results panel
    if (searchResultsPanel) {
        searchResultsPanel.classList.remove('active');
    }
}

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const distance = R * c; // Distance in km
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// Get directions to a location
function getDirections(lat, lng) {
    if (!myMarker) {
        alert('Your location is not available yet.');
        return;
    }
    
    // Open in Google Maps
    const myLat = myMarker.getLatLng().lat;
    const myLng = myMarker.getLatLng().lng;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${myLat},${myLng}&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank');
}

// Get route to a location
async function getRoute(lat, lng) {
    if (!myMarker) {
        alert('Your location is not available yet.');
        return;
    }
    
    try {
        const myLat = myMarker.getLatLng().lat;
        const myLng = myMarker.getLatLng().lng;
        
        // Cancel any existing route
        cancelRoute();
        
        // Show loading indicator
        const loadingToast = document.createElement('div');
        loadingToast.className = 'loading-toast';
        loadingToast.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating route...';
        document.body.appendChild(loadingToast);
        
        // Call OSRM API for routing
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${myLng},${myLat};${lng},${lat}?overview=full&geometries=geojson`);
        const data = await response.json();
        
        // Remove loading indicator
        document.body.removeChild(loadingToast);
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('No route found');
        }
        
        // Get route geometry
        const routeGeometry = data.routes[0].geometry;
        const distance = (data.routes[0].distance / 1000).toFixed(2); // km
        const duration = Math.round(data.routes[0].duration / 60); // minutes
        
        // Create route layer
        routeLayer = L.geoJSON(routeGeometry, {
            style: {
                color: '#276EF1',
                weight: 5,
                opacity: 0.7
            }
        }).addTo(map);
        
        // Add route info control
        routeInfoControl = L.control({position: 'bottomleft'});
        routeInfoControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'route-info');
            div.innerHTML = `
                <div class="route-info-content">
                    <h4>Route Information</h4>
                    <p><i class="fas fa-road"></i> Distance: ${distance} km</p>
                    <p><i class="fas fa-clock"></i> Duration: ${duration} min</p>
                    <button class="close-route-btn" onclick="cancelRoute()">Cancel Route</button>
                </div>
            `;
            return div;
        };
        routeInfoControl.addTo(map);
        
        // Fit map to show the route
        map.fitBounds(routeLayer.getBounds(), {
            padding: [50, 50]
        });
        
    } catch (error) {
        console.error('Error getting route:', error);
        alert('Unable to calculate route. Please try again.');
    }
}

// Cancel route
function cancelRoute() {
    if (!map) return;
    
    // Clear route layer if exists
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    
    // Remove route info control if exists
    if (routeInfoControl) {
        map.removeControl(routeInfoControl);
        routeInfoControl = null;
    }
    
    // Return to original zoom level
    if (myMarker) {
        map.setView(myMarker.getLatLng(), 16);
    }
}

window.getRoute = getRoute;
window.cancelRoute = cancelRoute;
window.getDirections = getDirections;
window.viewOnMap = viewOnMap;

// Add event listener for close results button
if (closeResultsBtn) {
    closeResultsBtn.addEventListener('click', () => {
        if (searchResultsPanel) {
            searchResultsPanel.classList.remove('active');
            clearSearchResults();
        }
    });
}


