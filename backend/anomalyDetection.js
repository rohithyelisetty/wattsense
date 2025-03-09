// backend/anomalyDetection.js

/**
 * Detects anomalies in building energy consumption data using statistical methods
 * @param {Array} data - Array of energy consumption data points
 * @returns {Array} - Detected anomalies
 */
function detectAnomalies(data) {
    if (!data || data.length < 7) {
      return []; // Need at least a week of data for meaningful analysis
    }
    
    const anomalies = [];
    
    // Group data by day type (weekday/weekend)
    const weekdayData = data.filter(entry => entry.dayType === 'weekday');
    const weekendData = data.filter(entry => entry.dayType === 'weekend');
    
    // Calculate baseline statistics
    const weekdayStats = calculateStats(weekdayData.map(entry => entry.consumption));
    const weekendStats = calculateStats(weekendData.map(entry => entry.consumption));
    
    // 1. Detect sudden spikes (equipment malfunction)
    for (let i = 1; i < data.length; i++) {
      const current = data[i];
      const previous = data[i - 1];
      const dayType = current.dayType;
      const stats = dayType === 'weekday' ? weekdayStats : weekendStats;
      
      // Calculate percentage increase
      const percentageIncrease = ((current.consumption - previous.consumption) / previous.consumption) * 100;
      
      // Spike detection - If consumption is significantly higher than both the previous reading and the typical value
      if (percentageIncrease > 30 && current.consumption > stats.mean + 2 * stats.stdDev) {
        anomalies.push({
          type: 'spike',
          timestamp: current.timestamp,
          consumption: current.consumption,
          expected: previous.consumption,
          percentageIncrease: Math.round(percentageIncrease * 10) / 10,
          severity: percentageIncrease > 50 ? 3 : 2,
          description: `Sudden energy spike of ${Math.round(percentageIncrease)}% detected`
        });
      }
    }
    
    // 2. Detect gradual increases (efficiency loss)
    // Use a rolling window to detect consistent increases over time
    const windowSize = 5; // 5-day window
    for (let i = windowSize; i < data.length; i++) {
      const window = data.slice(i - windowSize, i + 1);
      const dayType = data[i].dayType;
      const stats = dayType === 'weekday' ? weekdayStats : weekendStats;
      
      // Check if all points in the window show increasing trend
      let isIncreasing = true;
      for (let j = 1; j < window.length; j++) {
        if (window[j].consumption <= window[j - 1].consumption) {
          isIncreasing = false;
          break;
        }
      }
      
      if (isIncreasing && window[windowSize].consumption > stats.mean + 1.5 * stats.stdDev) {
        // Calculate average daily increase percentage
        const startVal = window[0].consumption;
        const endVal = window[windowSize].consumption;
        const percentageIncrease = ((endVal - startVal) / startVal) * 100;
        const avgDailyIncrease = percentageIncrease / windowSize;
        
        if (avgDailyIncrease > 3) { // More than 3% increase per day
          anomalies.push({
            type: 'drift',
            timestamp: window[windowSize].timestamp,
            consumption: endVal,
            expected: startVal,
            percentageIncrease: Math.round(percentageIncrease * 10) / 10,
            severity: avgDailyIncrease > 5 ? 2 : 1,
            description: `Gradual efficiency loss of ${Math.round(percentageIncrease)}% over ${windowSize} days`
          });
        }
      }
    }
    
    // 3. Detect schedule anomalies (off-hours usage)
    // Create a 24-hour profile for each day type
    const weekdayHourlyProfile = createHourlyProfile(weekdayData);
    const weekendHourlyProfile = createHourlyProfile(weekendData);
    
    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      const hour = new Date(entry.timestamp).getHours();
      const profile = entry.dayType === 'weekday' ? weekdayHourlyProfile : weekendHourlyProfile;
      
      // Skip if we don't have enough data for this hour
      if (!profile[hour] || profile[hour].count < 3) continue;
      
      const expected = profile[hour].mean;
      const deviation = profile[hour].stdDev;
      
      // If consumption during typically low-usage hours (nights, weekends) is abnormally high
      if (entry.consumption > expected + 2.5 * deviation) {
        // Check if this is typically a low-usage hour (using the average across all hours)
        const allHoursAvg = Object.values(profile).reduce((sum, h) => sum + h.mean, 0) / 24;
        
        if (expected < 0.7 * allHoursAvg) { // This is typically a low-usage hour
          const percentageIncrease = ((entry.consumption - expected) / expected) * 100;
          
          anomalies.push({
            type: 'schedule',
            timestamp: entry.timestamp,
            consumption: entry.consumption,
            expected: expected,
            percentageIncrease: Math.round(percentageIncrease * 10) / 10,
            severity: percentageIncrease > 70 ? 2 : 1,
            description: `Abnormal energy use during off-hours (${hour}:00)`
          });
        }
      }
    }
    
    return anomalies;
  }
  
  /**
   * Generates actionable recommendations based on detected anomalies
   * @param {Array} anomalies - Detected anomalies
   * @param {Object} buildingData - Building information
   * @returns {Array} - Recommendations
   */
  function generateRecommendations(anomalies, buildingData) {
    if (!anomalies || anomalies.length === 0) {
      return [];
    }
    
    const recommendations = [];
    
    // Group anomalies by type
    const spikeAnomalies = anomalies.filter(a => a.type === 'spike');
    const driftAnomalies = anomalies.filter(a => a.type === 'drift');
    const scheduleAnomalies = anomalies.filter(a => a.type === 'schedule');
    
    // 1. Handle spike anomalies (equipment malfunctions)
    if (spikeAnomalies.length > 0) {
      // Find the most severe spike
      const worstSpike = spikeAnomalies.sort((a, b) => b.severity - a.severity)[0];
      const date = new Date(worstSpike.timestamp).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      
      recommendations.push({
        id: 'spike-' + Date.now(),
        title: "Potential Equipment Malfunction",
        description: `Sudden energy spike of ${worstSpike.percentageIncrease}% detected on ${date}. This pattern typically indicates HVAC system malfunction or short-cycling.`,
        action: "Schedule inspection of HVAC control systems and verify thermostat settings.",
        impact: `Addressing this issue could save approximately $${Math.round((worstSpike.consumption - worstSpike.expected) * 30 * 0.15)} per month if recurring.`,
        urgency: worstSpike.severity === 3 ? "High - Immediate attention recommended" : "Medium - Address within 1 week",
        anomalyType: "spike"
      });
    }
    
    // 2. Handle drift anomalies (efficiency loss)
    if (driftAnomalies.length > 0) {
      // Look for patterns in drift anomalies
      const mostRecent = driftAnomalies.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      const date = new Date(mostRecent.timestamp).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      
      recommendations.push({
        id: 'drift-' + Date.now(),
        title: "Gradual Efficiency Loss Detected",
        description: `Increasing energy consumption pattern detected, culminating on ${date}. This typically indicates developing system inefficiency.`,
        action: "Check for air leaks, inspect insulation integrity, and verify building automation schedules.",
        impact: `Addressing this trend could save approximately $${Math.round((mostRecent.consumption - mostRecent.expected) * 30 * 0.15)} per month.`,
        urgency: mostRecent.severity === 2 ? "Medium - Address within 1-2 weeks" : "Low - Schedule during next maintenance",
        anomalyType: "drift"
      });
    }
    
    // 3. Handle schedule anomalies (off-hours usage)
    if (scheduleAnomalies.length > 0) {
      // Group by hour to find patterns
      const hourGroups = {};
      scheduleAnomalies.forEach(anomaly => {
        const hour = new Date(anomaly.timestamp).getHours();
        if (!hourGroups[hour]) hourGroups[hour] = [];
        hourGroups[hour].push(anomaly);
      });
      
      // Find the hour with most anomalies
      let worstHour = 0;
      let maxCount = 0;
      
      Object.entries(hourGroups).forEach(([hour, anomalies]) => {
        if (anomalies.length > maxCount) {
          maxCount = anomalies.length;
          worstHour = parseInt(hour, 10);
        }
      });
      
      if (maxCount > 0) {
        const hourFormatted = worstHour < 12 
          ? `${worstHour}am` 
          : worstHour === 12 
            ? '12pm' 
            : `${worstHour-12}pm`;
        
        const averageExcess = hourGroups[worstHour].reduce((sum, a) => sum + (a.consumption - a.expected), 0) / hourGroups[worstHour].length;
        
        recommendations.push({
          id: 'schedule-' + Date.now(),
          title: "Off-hours Energy Usage",
          description: `Abnormal energy consumption detected during expected low-usage hours (${hourFormatted}). This has occurred ${maxCount} times recently.`,
          action: "Review building occupancy schedule and automation system settings. Check for unauthorized equipment operation.",
          impact: `Optimizing scheduling could save approximately $${Math.round(averageExcess * maxCount * 4 * 0.15)} per month.`,
          urgency: maxCount > 3 ? "Medium - Investigate within 2 weeks" : "Low - Investigate during next maintenance cycle",
          anomalyType: "schedule"
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Calculates potential savings from addressing detected anomalies
   * @param {Array} anomalies - Detected anomalies
   * @param {Object} buildingData - Building information
   * @returns {Object} - Potential savings in energy, cost, and carbon
   */
  function calculateSavings(anomalies, buildingData) {
    if (!anomalies || anomalies.length === 0) {
      return {
        energy: 0,
        cost: 0,
        carbon: 0
      };
    }
    
    // Calculate excess energy consumption from all anomalies
    const totalExcessEnergy = anomalies.reduce((sum, anomaly) => {
      return sum + (anomaly.consumption - anomaly.expected);
    }, 0);
    
    // Constants for calculations
    const ELECTRICITY_COST_PER_KWH = 0.15; // $0.15 per kWh
    const CARBON_INTENSITY = 0.4; // 0.4 kg CO2 per kWh
    
    // Calculate cost and carbon savings
    const costSavings = totalExcessEnergy * ELECTRICITY_COST_PER_KWH;
    const carbonSavings = totalExcessEnergy * CARBON_INTENSITY;
    
    return {
      energy: Math.round(totalExcessEnergy * 10) / 10, // kWh
      cost: Math.round(costSavings * 100) / 100, // $
      carbon: Math.round(carbonSavings * 10) / 10 // kg CO2
    };
  }
  
  /**
   * Helper function to calculate mean and standard deviation
   * @param {Array} values - Array of numerical values
   * @returns {Object} - Statistical properties
   */
  function calculateStats(values) {
    const count = values.length;
    
    if (count === 0) {
      return {
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0
      };
    }
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    const mean = sum / count;
    
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      stdDev,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }
  
  /**
   * Creates hourly consumption profiles
   * @param {Array} data - Energy data points
   * @returns {Object} - Hourly profiles with statistical properties
   */
  function createHourlyProfile(data) {
    const hourlyData = {};
    
    // Initialize hourly buckets
    for (let hour = 0; hour < 24; hour++) {
      hourlyData[hour] = {
        values: [],
        mean: 0,
        stdDev: 0,
        count: 0
      };
    }
    
    // Group data by hour
    data.forEach(entry => {
      const hour = new Date(entry.timestamp).getHours();
      hourlyData[hour].values.push(entry.consumption);
    });
    
    // Calculate statistics for each hour
    for (let hour = 0; hour < 24; hour++) {
      const stats = calculateStats(hourlyData[hour].values);
      hourlyData[hour].mean = stats.mean;
      hourlyData[hour].stdDev = stats.stdDev;
      hourlyData[hour].count = hourlyData[hour].values.length;
    }
    
    return hourlyData;
  }
  
  module.exports = {
    detectAnomalies,
    generateRecommendations,
    calculateSavings
  };