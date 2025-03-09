// backend/server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { detectAnomalies, generateRecommendations, calculateSavings } = require('./anomalyDetection');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory storage for demo purposes (would use a database in production)
let buildingData = {};

// API Routes
app.post('/api/buildings', (req, res) => {
  const { buildingId, name, location, area } = req.body;
  
  if (!buildingId || !name) {
    return res.status(400).json({ error: 'Building ID and name are required' });
  }
  
  buildingData[buildingId] = {
    id: buildingId,
    name,
    location,
    area,
    energyData: [],
    anomalies: [],
    lastUpdated: new Date().toISOString()
  };
  
  res.status(201).json({ message: 'Building registered successfully', buildingId });
});

app.get('/api/buildings', (req, res) => {
  const buildings = Object.values(buildingData).map(building => ({
    id: building.id,
    name: building.name,
    location: building.location,
    area: building.area,
    lastUpdated: building.lastUpdated
  }));
  
  res.json(buildings);
});

app.post('/api/energy-data/:buildingId', (req, res) => {
  const { buildingId } = req.params;
  const { data } = req.body;
  
  if (!buildingId || !data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'Building ID and energy data array are required' });
  }
  
  if (!buildingData[buildingId]) {
    return res.status(404).json({ error: 'Building not found' });
  }
  
  // Process and store the new energy data
  const processedData = data.map(entry => ({
    timestamp: entry.timestamp || new Date().toISOString(),
    consumption: parseFloat(entry.consumption),
    temperature: parseFloat(entry.temperature || 0),
    occupancy: parseInt(entry.occupancy || 0, 10),
    dayType: entry.dayType || getDayType(new Date(entry.timestamp || new Date()))
  }));
  
  // Add to existing data
  buildingData[buildingId].energyData = [
    ...buildingData[buildingId].energyData,
    ...processedData
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  buildingData[buildingId].lastUpdated = new Date().toISOString();
  
  // Detect anomalies in the updated data
  const detectedAnomalies = detectAnomalies(buildingData[buildingId].energyData);
  buildingData[buildingId].anomalies = detectedAnomalies;
  
  // Generate recommendations based on anomalies
  const recommendations = generateRecommendations(detectedAnomalies, buildingData[buildingId]);
  
  // Calculate potential savings
  const savings = calculateSavings(detectedAnomalies, buildingData[buildingId]);
  
  res.json({
    message: 'Energy data processed successfully',
    dataPoints: processedData.length,
    anomaliesDetected: detectedAnomalies.length,
    recommendations,
    savings
  });
});

app.get('/api/energy-data/:buildingId', (req, res) => {
  const { buildingId } = req.params;
  const { startDate, endDate } = req.query;
  
  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }
  
  if (!buildingData[buildingId]) {
    return res.status(404).json({ error: 'Building not found' });
  }
  
  let filteredData = [...buildingData[buildingId].energyData];
  
  // Apply date filters if provided
  if (startDate) {
    filteredData = filteredData.filter(
      entry => new Date(entry.timestamp) >= new Date(startDate)
    );
  }
  
  if (endDate) {
    filteredData = filteredData.filter(
      entry => new Date(entry.timestamp) <= new Date(endDate)
    );
  }
  
  res.json(filteredData);
});

app.get('/api/anomalies/:buildingId', (req, res) => {
  const { buildingId } = req.params;
  const { severity, startDate, endDate } = req.query;
  
  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }
  
  if (!buildingData[buildingId]) {
    return res.status(404).json({ error: 'Building not found' });
  }
  
  let filteredAnomalies = [...buildingData[buildingId].anomalies];
  
  // Apply filters if provided
  if (severity) {
    filteredAnomalies = filteredAnomalies.filter(
      anomaly => anomaly.severity >= parseInt(severity, 10)
    );
  }
  
  if (startDate) {
    filteredAnomalies = filteredAnomalies.filter(
      anomaly => new Date(anomaly.timestamp) >= new Date(startDate)
    );
  }
  
  if (endDate) {
    filteredAnomalies = filteredAnomalies.filter(
      anomaly => new Date(anomaly.timestamp) <= new Date(endDate)
    );
  }
  
  res.json(filteredAnomalies);
});

app.get('/api/recommendations/:buildingId', (req, res) => {
  const { buildingId } = req.params;
  
  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }
  
  if (!buildingData[buildingId]) {
    return res.status(404).json({ error: 'Building not found' });
  }
  
  const recommendations = generateRecommendations(
    buildingData[buildingId].anomalies,
    buildingData[buildingId]
  );
  
  res.json(recommendations);
});

app.get('/api/savings/:buildingId', (req, res) => {
  const { buildingId } = req.params;
  
  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }
  
  if (!buildingData[buildingId]) {
    return res.status(404).json({ error: 'Building not found' });
  }
  
  const savings = calculateSavings(
    buildingData[buildingId].anomalies,
    buildingData[buildingId]
  );
  
  res.json(savings);
});

// Helper functions
function getDayType(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return 'weekend';
  return 'weekday';
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});