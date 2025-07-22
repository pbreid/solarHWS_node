# Smart Solar Hot Water Controller

A weather-aware Node-RED controller for solar hot water systems that optimizes electrical heating based on time of day, weather conditions, and solar irradiance forecasts.

## Overview

This project enhances a traditional solar hot water system with intelligent control logic that:

- **Minimizes electrical energy usage** by leveraging weather forecasts and aggressive solar optimization
- **Ensures adequate hot water availability** for daily needs with time-based strategies
- **Adapts heating strategy** based on time of day, solar conditions, and usage patterns
- **Provides comprehensive monitoring** through InfluxDB and Grafana dashboards
- **Prevents equipment damage** with anti-cycling protection and rate limiting

## Features

### Smart Heating Control
- **Ultra-aggressive solar optimization**: 35°C switch-off during 8-hour daytime period (8 AM-4 PM)
- **Time-based operating modes**: Different strategies for morning, daytime, evening prep, and night
- **Weather-aware decisions**: Adjusts heating based on cloud cover and solar irradiance
- **Conservative morning heating**: Relies on solar heating during sunny days
- **Evening preparation boost**: Higher targets (45°C) for evening shower readiness
- **Anti-cycling protection**: 15-minute minimum between state changes to protect equipment
- **Rate limiting**: Prevents excessive API calls and processing (30-second intervals)

### Advanced Weather Integration
- **OpenWeatherMap API integration** for real-time weather data
- **Intelligent solar irradiance estimation** based on cloud cover, time of day, and visibility
- **6-hour weather forecasting** for predictive heating decisions
- **Smart weather thresholds**: Only triggers poor weather mode for genuinely bad conditions (80%+ clouds AND low irradiance)
- **Automatic weather data refresh** every 30-60 minutes

### Comprehensive Monitoring & Analytics
- **Dual InfluxDB logging**: Separate measurements for sensor data and setpoint analytics
- **Advanced setpoint tracking**: Temperature margins, weather correlation, and efficiency metrics
- **Grafana dashboards** for comprehensive system visualization with weather context
- **Historical analysis** of heating efficiency and weather correlation
- **Debug logging** with configurable verbosity and detailed decision tracking

### Equipment Protection
- **Anti-cycling logic**: Prevents rapid ON/OFF switching that damages heating elements and relays
- **Configurable protection intervals**: 15-minute default with easy adjustment
- **Rate limiting**: Controller logic runs maximum every 30 seconds
- **Sensor validation**: Robust error handling for missing or invalid data

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Weather API   │───▶│   Node-RED       │───▶│   Hot Water     │
│ (OpenWeatherMap)│    │   Controller     │    │   Element       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │    InfluxDB      │
                       │   (Logging)      │
                       └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │     Grafana      │
                       │  (Dashboard)     │
                       └──────────────────┘
```

## Hardware Requirements

### Temperature Sensors
- **S2**: Bottom of hot water tank
- **S3**: Middle of hot water tank (primary control sensor)
- **S4**: Top of hot water tank
- Sensors should provide readings via MQTT or similar protocol

### Hot Water System
- Electric heating element with on/off control
- Solar hot water collection system
- Hot water storage tank with temperature stratification

### Computing Platform
- Node-RED compatible system (Raspberry Pi, Home Assistant, etc.)
- Internet connection for weather API access
- InfluxDB database (local or cloud)
- Grafana instance for dashboards

## Software Requirements

- **Node-RED** (tested with v3.x+)
- **InfluxDB** v1.x or v2.x
- **Grafana** v9.x+ (for dashboard features)
- **OpenWeatherMap API key** (free tier sufficient)

## Installation

### 1. OpenWeatherMap Setup

1. Create account at [openweathermap.org](https://openweathermap.org/api)
2. Subscribe to **Current Weather Data** (free)
3. Optional: Subscribe to **5 Day Weather Forecast** (free)
4. Copy your API key
5. Wait 2 hours for API key activation

### 2. Node-RED Flow Setup

#### Weather Data Flow
```
[Timer: 30min] → [Weather Function] → [Template] → [HTTP Request] → [Weather Processor]
```

**Nodes Required:**
- **Inject Node**: Timer every 30 minutes, trigger at startup
- **Function Node**: Weather fetcher (see code below)
- **Template Node**: URL builder for API calls
- **HTTP Request Node**: Calls OpenWeatherMap API
- **Function Node**: Weather data processor

#### Hot Water Controller Flow
```
[MQTT/Sensor Data] → [Hot Water Controller] → [Element Control]
                                           → [InfluxDB Logging]
```

**Nodes Required:**
- **MQTT In/Function**: Sensor data input
- **Function Node**: Main controller logic (dual output)
- **Output 1**: Element control (relay, MQTT out, etc.)
- **Output 2**: InfluxDB out node for logging

### 3. Node-RED Configuration

#### Weather Fetcher Function Node
```javascript
// Configuration
var config = {
    api_key: "YOUR_API_KEY_HERE",
    lat: -27.4705,  // Your latitude
    lon: 153.0260,  // Your longitude
    units: "metric"
};

// Pass variables to template
msg.lat = config.lat;
msg.lon = config.lon;
msg.api_key = config.api_key;
msg.units = config.units;
msg.topic = "current_weather";

return msg;
```

#### Template Node Configuration
```
https://api.openweathermap.org/data/2.5/weather?lat={{lat}}&lon={{lon}}&appid={{api_key}}&units={{units}}
```

#### HTTP Request Node
- **Method**: GET
- **URL**: `{{{url}}}` (uses msg.url from template)
- **Return**: A parsed JSON object

#### Main Controller Function
Use the complete controller code from the artifacts section. Key configuration highlights:

```javascript
var config = {
    debug_enabled: false,  // Set to true for detailed logging
    controller_interval_seconds: 30,  // Rate limiting interval
    min_switch_interval_minutes: 15,  // Anti-cycling protection
    logging: {
        log_setpoints: true,
        log_on_change_only: false,
        log_weather_data: true
    },
    // EXTREME solar optimization strategy with 3-tier daytime approach
    modes: {
        morning: { switch_off_temp: 42, switch_on_temp: 30 },     // Moderate prep
        daytime: { switch_off_temp: 35, switch_on_temp: 30 },     // Conservative solar
        midday: { switch_off_temp: 32, switch_on_temp: 25 },      // EXTREME solar reliance
        evening_prep: { switch_off_temp: 45, switch_on_temp: 38 }, // Shower ready
        evening_night: { switch_off_temp: 40, switch_on_temp: 30 } // Maintenance
    }
};
```

### 4. InfluxDB Setup

#### Create Database
```sql
CREATE DATABASE "solar_hotwater"
```

#### Measurements Structure

**solarHW** (sensor data - existing):
```
time, s1, s2, s3, s4, heater, pumpSpeed, pumpHours, controllertime
```

**solarHW_setpoints** (control analytics - new):
```
time, mode, switch_off_temp, switch_on_temp, switch_on_s4_temp,
cloud_cover_pct, solar_irradiance, weather_forecast, poor_weather_mode,
hot_water_level_pct, margin_to_switch_on, margin_to_switch_off,
s2_current, s3_current, s4_current, hour_of_day, timestamp
```

#### Why Separate Measurements?
- **Different update frequencies**: Sensors every second vs setpoints every 30 seconds
- **Different purposes**: Operational monitoring vs control analysis  
- **Clean data separation**: No schema conflicts or null values
- **Optimized storage**: Different retention policies possible

#### InfluxDB Out Node Configuration
- **Server**: Your InfluxDB instance
- **Database**: solar_hotwater
- **Measurement**: solarHW_setpoints
- **Time Precision**: Milliseconds

## Configuration

### Ultra-Conservative Solar Strategy

The system uses an aggressive solar-first approach with different temperature thresholds based on time of day and weather conditions. This strategy is optimized for Brisbane's excellent solar conditions.

#### Morning Mode (5-8 AM)
```javascript
morning: {
    switch_off_temp: 42,     // Moderate morning target
    switch_on_temp: 30,      // Emergency heating only
    switch_on_s4_temp: 38,   // Top tank safety check
    poor_weather: {          // Cloudy day backup
        switch_off_temp: 40,
        switch_on_temp: 30,
        switch_on_s4_temp: 42
    }
}
```

#### Daytime Mode (8-10 AM, 2-4 PM) - **Conservative Solar Reliance**
```javascript
daytime: {
    switch_off_temp: 35,     // Conservative for moderate solar periods
    switch_on_temp: 30,      // Emergency only
    switch_on_s4_temp: 35,   // Standard safety check
    poor_weather: {          // Cloudy day protection
        switch_off_temp: 40,
        switch_on_temp: 38,
        switch_on_s4_temp: 40
    }
}
```

#### **Midday Mode (10 AM - 2 PM) - EXTREME Solar Optimization**
```javascript
midday: {
    switch_off_temp: 32,     // EXTREMELY low - maximum solar reliance
    switch_on_temp: 25,      // True emergency only (very cold)
    switch_on_s4_temp: 36,   // Higher safety threshold
    poor_weather: {          // Essential cloudy day backup
        switch_off_temp: 40,
        switch_on_temp: 38,
        switch_on_s4_temp: 40
    }
}
```

#### Evening Prep (4-7 PM) - **Shower Optimization**
```javascript
evening_prep: {
    switch_off_temp: 45,     // Higher target for evening showers
    switch_on_temp: 38,      // Active preparation
    switch_on_s4_temp: 42    // Ensure top tank readiness
}
```

#### Evening/Night (7 PM - 5 AM)
```javascript
evening_night: {
    switch_off_temp: 40,     // Maintain adequate overnight
    switch_on_temp: 30,      // Emergency heating only
    switch_on_s4_temp: 38    // Conservative maintenance
}
```

### Equipment Protection Settings

```javascript
// Anti-cycling protection
min_switch_interval_minutes: 15,  // Minimum time between any state changes

// Rate limiting  
controller_interval_seconds: 30,  // Controller execution frequency

// Safety timers
min_time_seconds: 600             // 10-minute minimum between switches (legacy)
```

### Enhanced Weather Thresholds

```javascript
// Ultra-restrictive Brisbane-specific thresholds
weather_assessment: {
    // Only poor if EXTREMELY cloudy (95%+) AND low irradiance (<100 W/m²)
    very_poor_conditions: "cloud_cover > 95 && solar_irradiance < 100",
    
    // Removed: extremely low irradiance check (commented out for maximum solar reliance)
    // extremely_low_solar: "solar_irradiance < 50",
    
    // OR explicit overcast forecast
    overcast_forecast: "weather_forecast === 'overcast'"
}
```

**Key Changes:**
- **95% cloud threshold** (up from 80%) - even more restrictive
- **Removed low irradiance trigger** - trusts solar even in marginal conditions
- **Only overcast forecast** triggers poor weather mode

### Temperature Control Logic

#### Switch Control Variables Explained:
- **`switch_off_temp`**: S3 temperature at which heating element turns OFF
- **`switch_on_temp`**: S3 temperature threshold for turning element ON (primary condition)  
- **`switch_on_s4_temp`**: S4 temperature threshold for turning element ON (safety condition)

#### Complete Turn-ON Logic:
Element turns ON only if ALL conditions are met:
1. Element is currently OFF
2. Time since last switch > 15 minutes (anti-cycling protection)
3. Controller uptime > 10 minutes  
4. S3 temperature < switch_on_temp (primary check)
5. S4 temperature < switch_on_s4_temp (safety check - prevents heating when top tank already hot)

#### Complete Turn-OFF Logic:
Element turns OFF if:
1. Element is currently ON
2. Time since last switch > 15 minutes (anti-cycling protection)  
3. S3 temperature > switch_off_temp

### Geographic Configuration

Update coordinates in weather fetcher for your location:
```javascript
lat: -27.4705,  // Your latitude (decimal degrees)
lon: 153.0260,  // Your longitude (decimal degrees)
```

## Grafana Dashboard

### Enhanced Panel Queries with Clear Labels

#### Current Status (Stat Panels)
```sql
-- Tank Temperatures with Clear Labels
SELECT last("s2") AS "S2 Bottom Tank" FROM "solarHW" WHERE $timeFilter
SELECT last("s3") AS "S3 Middle Tank" FROM "solarHW" WHERE $timeFilter  
SELECT last("s4") AS "S4 Top Tank" FROM "solarHW" WHERE $timeFilter

-- Hot Water Level
SELECT last("hot_water_level_pct") AS "Hot Water Available %" FROM "solarHW_setpoints" WHERE $timeFilter
```

#### Current Setpoints with Clear Naming
```sql
-- Control Thresholds  
SELECT last("switch_off_temp") AS "S3 Switch OFF Temperature" FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("switch_on_temp") AS "S3 Switch ON Temperature" FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("switch_on_s4_temp") AS "S4 Switch ON Temperature" FROM "solarHW_setpoints" WHERE $timeFilter
```

#### Weather Information
```sql
-- Current Weather with Solar Context
SELECT last("cloud_cover_pct") AS "Cloud Cover %" FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("solar_irradiance") AS "Solar Irradiance W/m²" FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("weather_forecast") AS "6h Forecast" FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("poor_weather_mode") AS "Poor Weather Override" FROM "solarHW_setpoints" WHERE $timeFilter
```

#### Advanced Analytics Timeline
```sql
-- Temperature vs Setpoints Analysis
SELECT 
  mean("s3") AS "S3 Current (Middle Tank)",
  mean("s4") AS "S4 Current (Top Tank)", 
  mean("switch_on_temp") AS "S3 Switch ON Temperature",
  mean("switch_on_s4_temp") AS "S4 Switch ON Temperature",
  mean("switch_off_temp") AS "S3 Switch OFF Temperature"
FROM "solarHW_setpoints" 
WHERE $timeFilter 
GROUP BY time($__interval)
```

#### System Efficiency Metrics
```sql
-- Heating Efficiency (24h rolling)
SELECT 
  (sum("heater") * 100 / count("heater")) AS "Electrical Heating %"
FROM "solarHW" 
WHERE time >= now() - 24h

-- Solar vs Electrical Contribution
SELECT 
  mean("solar_irradiance") AS "Solar Available",
  mean("heater") * 100 AS "Electrical Usage %"
FROM "solarHW_setpoints" 
WHERE $timeFilter 
GROUP BY time(1h)
```

#### Weather Impact Analysis
```sql
-- Mode Distribution by Weather
SELECT 
  count("mode") 
FROM "solarHW_setpoints" 
WHERE $timeFilter 
GROUP BY "mode", "poor_weather_mode", time(2h)

-- Temperature Margins (Switching Readiness)
SELECT 
  mean("margin_to_switch_on") AS "Margin to Heat (°C)",
  mean("margin_to_switch_off") AS "Margin to Stop (°C)"
FROM "solarHW_setpoints" 
WHERE $timeFilter
GROUP BY time($__interval)
```

### Dashboard Variables for Smart Displays

Create these variables for dynamic text panels and conditional displays:

```sql
-- Core sensor readings
SELECT last("s3") FROM "solarHW" WHERE $timeFilter     -- current_temp_s3
SELECT last("s4") FROM "solarHW" WHERE $timeFilter     -- current_temp_s4

-- Weather context
SELECT last("cloud_cover_pct") FROM "solarHW_setpoints" WHERE $timeFilter  -- cloud_cover
SELECT last("solar_irradiance") FROM "solarHW_setpoints" WHERE $timeFilter  -- solar_irradiance
SELECT last("weather_forecast") FROM "solarHW_setpoints" WHERE $timeFilter  -- weather_forecast

-- System status
SELECT last("mode") FROM "solarHW_setpoints" WHERE $timeFilter  -- current_mode
SELECT last("poor_weather_mode") FROM "solarHW_setpoints" WHERE $timeFilter  -- poor_weather_active
SELECT last("hot_water_level_pct") FROM "solarHW_setpoints" WHERE $timeFilter  -- hot_water_level
```

### Smart Text Panel Example

```markdown
# 🌡️ Smart Solar Hot Water System

## Current Status
* **Tank Middle (S3):** ${current_temp_s3}°C
* **Tank Top (S4):** ${current_temp_s4}°C  
* **Hot Water Available:** ${hot_water_level}%
* **System Mode:** ${current_mode}

## Weather & Solar
* **Conditions:** ${weather_forecast} (${cloud_cover}% clouds)
* **Solar Power:** ${solar_irradiance} W/m²
* **Weather Override:** ${poor_weather_active ? "Active" : "Normal"}

## Strategy
**Current Focus:** ${current_mode === "daytime" ? "Maximum solar reliance" : current_mode === "evening_prep" ? "Preparing for showers" : "Maintaining hot water"}

---
*Ultra-aggressive solar optimization for Brisbane conditions*
```

## Troubleshooting

### Weather API Issues

**Problem**: "Invalid API key" error
**Solution**: 
- Verify API key is correct
- Wait up to 2 hours for activation
- Check OpenWeatherMap dashboard for subscription status

**Problem**: No weather data received
**Solution**:
- Test API URL directly in browser
- Check Node-RED debug panel for HTTP errors
- Verify coordinates are correct (decimal degrees)

### Controller Issues

**Problem**: Element not responding to controller
**Solution**:
- Check global variables: `hot_water_element`, `disable_auto_control`
- Verify sensor data format matches expected structure
- Enable debug logging to see decision logic

**Problem**: Rapid cycling or equipment stress
**Solution**:
- Verify anti-cycling protection is working (check debug logs for "Switch blocked" messages)
- Adjust `min_switch_interval_minutes` if needed (default 15 minutes)
- Monitor temperature margins to ensure adequate hysteresis

**Problem**: Ultra-aggressive daytime strategy causing hot water shortages
**Solution**:
- Monitor 35°C daytime switch-off performance during first week
- Increase daytime switch-off to 38-40°C if solar insufficient
- Check poor weather override is activating on cloudy days (48°C backup)
- Verify evening prep mode (45°C) adequately prepares for shower time

### InfluxDB Issues

**Problem**: No setpoint data in database
**Solution**:
- Verify function node has 2 outputs configured
- Check InfluxDB out node is connected to output 2
- Confirm `log_setpoints: true` in configuration

**Problem**: Data gaps in timeline
**Solution**:
- Check Node-RED is receiving regular sensor data
- Verify MQTT/sensor connectivity
- Review error logs for processing failures

## Monitoring and Maintenance

### Regular Checks
- **Weather API usage**: Monitor OpenWeatherMap dashboard for rate limits
- **InfluxDB storage**: Check database size and retention policies
- **System performance**: Review heating efficiency metrics
- **Temperature accuracy**: Validate sensor readings periodically

### Seasonal Adjustments
- **Summer**: Lower temperature thresholds, rely more on solar
- **Winter**: Higher thresholds, more aggressive evening heating
- **Shoulder seasons**: Adjust based on actual solar performance

## Performance Expectations

### Brisbane EXTREME Solar Optimization Results

With the ultra-aggressive 3-tier strategy (32°C midday switch-off), expect:

#### **Sunny Days (Clear/Partly Cloudy)**
- **Morning (5-8 AM)**: Moderate heating to 42°C for day preparation
- **Early/Late Day (8-10 AM, 2-4 PM)**: Conservative 35°C target, some solar available
- **Peak Midday (10 AM-2 PM)**: **EXTREME 32°C target** - element almost never runs
- **Evening Prep (4-7 PM)**: Active heating to 45°C for shower readiness
- **Solar heating**: Tank can rise from 32°C to 50°C+ purely from midday sun
- **Electricity savings**: 70-90% reduction during 4-hour peak solar period

#### **Cloudy Days (Rare Poor Weather Override)**
- **95%+ cloud trigger**: Only activates in genuinely terrible conditions
- **Automatic backup**: Switch-off rises to 40°C when weather is extremely poor
- **Maximum solar trust**: System relies on solar even in marginal conditions

#### **Equipment Protection & Cycling**
- **Anti-cycling**: No state changes within 15 minutes
- **Rate limiting**: Controller runs maximum every 30 seconds
- **Extreme strategy protection**: Large temperature gaps prevent rapid cycling

### Monitoring and Maintenance

#### **First Week - CRITICAL Monitoring**
- **Hot water adequacy**: Ensure morning and evening showers have sufficient temperature with 32°C midday strategy
- **Extreme midday performance**: Verify solar can reliably heat tank from 32°C to 45°C+ during peak hours
- **Weather response**: Confirm poor weather mode only activates in genuinely terrible conditions (95%+ clouds)
- **Emergency heating**: Monitor 25°C switch-on threshold - should only trigger in true emergencies
- **Cycling behavior**: Watch for any rapid switching issues with large temperature gaps

#### **3-Tier Daily Strategy Performance**
- **5-8 AM (Morning)**: 42°C target prepares for day
- **8-10 AM (Early Day)**: 35°C conservative approach as solar builds
- **10 AM-2 PM (Peak Solar)**: **32°C extreme reliance** - element should rarely run
- **2-4 PM (Late Day)**: Back to 35°C conservative  
- **4-7 PM (Evening Prep)**: 45°C active preparation for showers
- **7 PM-5 AM (Night)**: 40°C maintenance mode

#### **Ongoing Optimization**
- **Seasonal adjustments**: May need different thresholds for winter vs summer
- **Usage pattern learning**: Adjust evening prep timing based on actual shower schedules
- **Weather correlation analysis**: Use Grafana to analyze forecast accuracy vs actual heating needs
- **Efficiency tracking**: Monitor electrical heating percentage over time

#### **Recommended Dashboard Alerts**
- **Hot water level < 30%**: Potential shortage warning
- **Element running during midday (10 AM-2 PM)**: Extreme strategy may need adjustment
- **S3 temperature < 30°C during day**: Possible solar system issue
- **Poor weather mode active > 10% of time**: Weather thresholds may be too sensitive (should be very rare)
- **Element cycling > 4 times/hour**: Possible control issues with extreme temperature gaps
- **25°C emergency heating triggered**: True emergency condition requiring investigation

## API Reference

### Global Variables (Node-RED)

#### Control Variables
- `disable_auto_control`: 0/1 - Disable automatic control
- `hot_water_element`: 0/1 - Current element state
- `super_heat`: 0/1 - Force high temperature mode

#### Weather Variables (Set by weather processor)
- `weather_cloud_cover`: 0-100 - Current cloud cover percentage
- `weather_solar_irradiance`: Number - Estimated solar irradiance (W/m²)
- `weather_current_conditions`: String - Weather description
- `weather_forecast_next_6h`: String - 6-hour forecast
- `weather_forecast_next_12h`: String - 12-hour forecast

### Input Message Format

```javascript
msg.payload = {
    time: 3175980,           // Controller uptime seconds
    s1: 18.29999924,         // Temperature sensor 1 (additional)
    s2: 18.60000038,         // Temperature sensor 2 (bottom tank)
    s3: 39.90000153,         // Temperature sensor 3 (middle tank - primary control)
    s4: 44.90000153,         // Temperature sensor 4 (top tank - safety check)
    pumpSpeed: 0,            // Solar pump speed
    pumpHours: 5136          // Solar pump total hours
    // ... other system data
};
```

### Output Message Format

#### Element Control (Output 1)
```javascript
// Element control with anti-cycling protection
msg.payload = 0;  // Element OFF (only after 15+ minutes since last switch)
msg.payload = 1;  // Element ON (only after 15+ minutes since last switch)
// If switching blocked: function returns without sending message
```

#### Enhanced Setpoint Logging (Output 2)
```javascript
msg = {
    payload: {
        // Core control data
        mode: "daytime",                    // Current operating mode
        switch_off_temp: 35,                // S3 switch-off threshold
        switch_on_temp: 30,                 // S3 switch-on threshold  
        switch_on_s4_temp: 35,              // S4 switch-on threshold
        
        // Weather integration
        cloud_cover_pct: 25,                // Current cloud cover
        solar_irradiance: 450,              // Estimated solar W/m²
        weather_forecast: "partly_cloudy",   // 6-hour forecast
        poor_weather_mode: false,           // Weather override active
        
        // System status
        hot_water_level_pct: 67,            // Estimated usable hot water
        s2_current: 32.1, s3_current: 35.2, s4_current: 38.5,
        
        // Advanced analytics
        margin_to_switch_on: -5.2,          // Degrees below switch-on (negative = needs heating)
        margin_to_switch_off: 0.2,          // Degrees above switch-off (positive = will turn off soon)
        hour_of_day: 14,                    // Current hour for time-based analysis
        timestamp: 1753123456789            // Precise logging timestamp
    },
    topic: "solarHW_setpoints"
};
```

## Contributing

### Development Setup
1. Fork the repository
2. Set up test environment with Node-RED and InfluxDB
3. Use debug mode for development: `debug_enabled: true`
4. Test with various weather conditions and time scenarios

### Adding Features
- **New operating modes**: Add to `config.modes` object with weather overrides
- **Alternative weather sources**: Extend weather processor function for additional APIs
- **Different sensor configurations**: Modify input message handling and tank level estimation
- **Multiple heating elements**: Extend output message format and control logic
- **Advanced scheduling**: Add holiday modes, usage pattern learning, or seasonal adjustments
- **Integration with solar inverters**: Add direct solar production data for even smarter decisions

## License

MIT License - See LICENSE file for details

## Support

### Documentation
- Node-RED: [nodered.org](https://nodered.org/docs/)
- InfluxDB: [docs.influxdata.com](https://docs.influxdata.com/)
- Grafana: [grafana.com/docs](https://grafana.com/docs/)
- OpenWeatherMap: [openweathermap.org/api](https://openweathermap.org/api)

### Community
- Create issues for bugs or feature requests
- Share dashboard configurations and improvements
- Contribute weather integration improvements

## Changelog

### v2.1.0 - EXTREME Midday Solar Optimization
- **3-tier daytime strategy**: Morning (42°C) → Early Day (35°C) → **Peak Midday (32°C)** → Late Day (35°C) → Evening Prep (45°C)
- **Extreme midday mode**: 32°C switch-off with 25°C emergency heating during peak solar (10 AM-2 PM)
- **Ultra-restrictive weather thresholds**: 95%+ cloud coverage required to trigger poor weather mode
- **Removed low irradiance trigger**: Maximum trust in solar performance even in marginal conditions
- **Enhanced time scheduling**: 6-period daily optimization for maximum solar utilization

### v2.0.0 - Ultra-Aggressive Solar Optimization
- **Ultra-conservative daytime strategy**: 35°C switch-off for 8-hour period (8 AM-4 PM)
- **Anti-cycling protection**: 15-minute minimum between state changes
- **Enhanced weather intelligence**: Realistic thresholds for Brisbane conditions
- **Evening shower optimization**: 45°C evening prep mode for better shower readiness
- **Dual InfluxDB measurements**: Separate sensor and setpoint analytics
- **Advanced Grafana integration**: Clear labeling and comprehensive monitoring
- **Equipment protection**: Rate limiting and robust error handling

### v1.0.0 - Initial Release
- Initial release with weather-aware control
- OpenWeatherMap integration
- Time-based operating modes
- InfluxDB logging with comprehensive setpoint data
- Grafana dashboard templates
- Rate limiting and debug features

---

**Author**: Created for Brisbane, Australia solar hot water system optimized for exceptional solar conditions  
**Last Updated**: July 2025  
**Current Strategy**: EXTREME solar reliance with 32°C midday targeting for maximum energy savings