# Smart Solar Hot Water Controller

A weather-aware Node-RED controller for solar hot water systems that optimizes electrical heating based on time of day, weather conditions, and solar irradiance forecasts.

## Overview

This project enhances a traditional solar hot water system with intelligent control logic that:

- **Minimizes electrical energy usage** by leveraging weather forecasts
- **Ensures adequate hot water availability** for daily needs
- **Adapts heating strategy** based on time of day and solar conditions
- **Provides comprehensive monitoring** through InfluxDB and Grafana dashboards

## Features

### Smart Heating Control
- **Time-based operating modes**: Different strategies for morning, daytime, evening, and night
- **Weather-aware decisions**: Adjusts heating based on cloud cover and solar irradiance
- **Conservative morning heating**: Relies on solar heating during sunny days
- **Evening preparation**: Ensures adequate hot water for peak usage times
- **Rate limiting**: Prevents excessive API calls and processing

### Weather Integration
- **OpenWeatherMap API integration** for real-time weather data
- **Solar irradiance estimation** based on cloud cover and time of day
- **6-hour weather forecasting** for predictive heating decisions
- **Automatic weather data refresh** every 30-60 minutes

### Monitoring & Analytics
- **InfluxDB logging** of setpoints, weather data, and system status
- **Grafana dashboards** for comprehensive system visualization
- **Historical analysis** of heating efficiency and weather correlation
- **Debug logging** with configurable verbosity

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
Use the complete controller code from the artifacts section. Key configuration:

```javascript
var config = {
    debug_enabled: false,  // Set to true for detailed logging
    controller_interval_seconds: 15,  // Rate limiting
    logging: {
        log_setpoints: true,
        log_on_change_only: false,
        log_weather_data: true
    },
    // ... temperature thresholds for different modes
};
```

### 4. InfluxDB Setup

#### Create Database
```sql
CREATE DATABASE "solar_hotwater"
```

#### Measurements Structure
**solarHW** (sensor data):
```
time, s1, s2, s3, s4, heater, pumpSpeed, pumpHours, controllertime
```

**solarHW_setpoints** (control data):
```
time, mode, switch_off_temp, switch_on_temp, switch_on_s4_temp,
cloud_cover_pct, solar_irradiance, weather_forecast, poor_weather_mode,
hot_water_level_pct, margin_to_switch_on, margin_to_switch_off,
s2_current, s3_current, s4_current, hour_of_day
```

#### InfluxDB Out Node Configuration
- **Server**: Your InfluxDB instance
- **Database**: solar_hotwater
- **Measurement**: solarHW_setpoints
- **Time Precision**: Milliseconds

## Configuration

### Temperature Thresholds

The system uses different temperature thresholds based on time of day and weather conditions:

#### Morning Mode (5-8 AM)
```javascript
morning: {
    switch_off_temp: 45,     // Conservative target
    switch_on_temp: 35,      // Only heat if really low
    switch_on_s4_temp: 38,
    poor_weather: {          // Override for bad weather
        switch_off_temp: 50,
        switch_on_temp: 40,
        switch_on_s4_temp: 42
    }
}
```

#### Daytime Mode (8 AM - 4 PM)
```javascript
daytime: {
    switch_off_temp: 42,     // Very conservative
    switch_on_temp: 32,      // Emergency only
    switch_on_s4_temp: 35,
    poor_weather: {
        switch_off_temp: 48,
        switch_on_temp: 38,
        switch_on_s4_temp: 40
    }
}
```

#### Evening Prep (4-7 PM)
```javascript
evening_prep: {
    switch_off_temp: 52,     // Prepare for evening use
    switch_on_temp: 45,
    switch_on_s4_temp: 47
}
```

#### Evening/Night (7 PM - 5 AM)
```javascript
evening_night: {
    switch_off_temp: 55,     // Ensure adequate hot water
    switch_on_temp: 42,
    switch_on_s4_temp: 45
}
```

### Weather Thresholds

```javascript
weather_thresholds: {
    poor_solar_conditions: 50,    // Cloud cover % threshold
    poor_solar_irradiance: 100    // W/m² threshold for poor solar
}
```

### Geographic Configuration

Update coordinates in weather fetcher for your location:
```javascript
lat: -27.4705,  // Your latitude (decimal degrees)
lon: 153.0260,  // Your longitude (decimal degrees)
```

## Grafana Dashboard

### Panel Types and Queries

#### Current Status (Stat Panels)
```sql
-- Tank Temperatures
SELECT last("s2") FROM "solarHW" WHERE $timeFilter
SELECT last("s3") FROM "solarHW" WHERE $timeFilter  
SELECT last("s4") FROM "solarHW" WHERE $timeFilter

-- Hot Water Level
SELECT last("hot_water_level_pct") FROM "solarHW_setpoints" WHERE $timeFilter
```

#### Weather Information
```sql
-- Current Weather
SELECT last("cloud_cover_pct") FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("solar_irradiance") FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("weather_forecast") FROM "solarHW_setpoints" WHERE $timeFilter
```

#### System Setpoints
```sql
-- Current Mode and Setpoints
SELECT last("mode") FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("switch_on_temp") FROM "solarHW_setpoints" WHERE $timeFilter
SELECT last("switch_off_temp") FROM "solarHW_setpoints" WHERE $timeFilter
```

#### Temperature Timeline
```sql
SELECT 
  mean("s2") AS "Bottom",
  mean("s3") AS "Middle", 
  mean("s4") AS "Top",
  mean("switch_on_temp") AS "Switch ON",
  mean("switch_off_temp") AS "Switch OFF"
FROM "solarHW" 
WHERE $timeFilter 
GROUP BY time($__interval)
```

#### Heating Efficiency
```sql
-- Heating time percentage (24h)
SELECT 
  (sum("heater") * 100 / count("heater")) AS "Heating Time %"
FROM "solarHW" 
WHERE time >= now() - 24h
```

### Dashboard Variables

Create these variables for dynamic displays:

```sql
-- Raw sensor values
SELECT last("s3") FROM "solarHW" WHERE $timeFilter     -- current_temp_s3
SELECT last("s4") FROM "solarHW" WHERE $timeFilter     -- current_temp_s4
SELECT last("cloud_cover_pct") FROM "solarHW_setpoints" WHERE $timeFilter  -- cloud_cover
SELECT last("mode") FROM "solarHW_setpoints" WHERE $timeFilter  -- current_mode
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

**Problem**: Rate limiting too aggressive/loose
**Solution**:
- Adjust `controller_interval_seconds` in config
- Monitor system responsiveness vs. processing load

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

### Performance Optimization
- **Review heating patterns**: Use Grafana analytics to identify inefficiencies
- **Tune thresholds**: Adjust based on actual hot water usage patterns
- **Weather correlation**: Analyze forecast accuracy vs. actual conditions

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
    s1: 18.29999924,         // Temperature sensor 1
    s2: 18.60000038,         // Temperature sensor 2 (bottom)
    s3: 39.90000153,         // Temperature sensor 3 (middle)
    s4: 44.90000153,         // Temperature sensor 4 (top)
    pumpSpeed: 0,            // Solar pump speed
    pumpHours: 5136          // Solar pump total hours
    // ... other system data
};
```

### Output Message Format

#### Element Control (Output 1)
```javascript
msg.payload = 0;  // Element OFF
msg.payload = 1;  // Element ON
```

#### Setpoint Logging (Output 2)
```javascript
msg = {
    payload: {
        mode: "morning",
        switch_off_temp: 45,
        switch_on_temp: 35,
        switch_on_s4_temp: 38,
        hot_water_level_pct: 33,
        cloud_cover_pct: 0,
        solar_irradiance: 276,
        weather_forecast: "clear",
        poor_weather_mode: false,
        // ... additional fields
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
- **New operating modes**: Add to `config.modes` object
- **Additional weather sources**: Extend weather processor function
- **Alternative sensors**: Modify input message handling
- **Different heating elements**: Extend output message format

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

### v1.0.0
- Initial release with weather-aware control
- OpenWeatherMap integration
- Time-based operating modes
- InfluxDB logging with comprehensive setpoint data
- Grafana dashboard templates
- Rate limiting and debug features

---

**Author**: Created for Brisbane, Australia solar hot water system  
**Last Updated**: July 2025
