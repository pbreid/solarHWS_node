# Smart Solar Hot Water Controller

A weather-aware Node-RED controller for solar hot water systems that optimizes electrical heating based on time of day, weather conditions, and solar irradiance forecasts.

## Overview

This project enhances a traditional solar hot water system with intelligent control logic that:

- **Minimizes electrical energy usage** by leveraging weather forecasts and aggressive solar optimization
- **Ensures adequate hot water availability** for daily needs with time-based strategies
- **Adapts heating strategy** based on a 6-period daily schedule, solar conditions, and usage patterns
- **Provides comprehensive monitoring** through InfluxDB and Grafana dashboards
- **Prevents equipment damage** with anti-cycling protection and rate limiting

## Features

### Smart Heating Control
- **Ultra-aggressive solar optimization**: 35°C switch-off during daytime, 32°C at midday (10 AM-2 PM)
- **6 time-based operating modes**: morning, daytime (early/late), midday, evening_prep, evening_night, and super_heat (manual override)
- **Weather-aware decisions**: Adjusts heating based on cloud cover and solar irradiance, with restrictive override (95%+ clouds and low irradiance, or 'overcast' forecast)
- **Conservative morning heating**: Relies on solar heating during sunny days
- **Evening preparation boost**: Higher targets (45°C) for evening shower readiness
- **Anti-cycling protection**: 15-minute minimum between state changes to protect equipment
- **Rate limiting**: Prevents excessive API calls and processing (30-second intervals)

### Advanced Weather Integration
- **OpenWeatherMap API integration** for real-time weather data
- **Intelligent solar irradiance estimation** based on cloud cover, time of day, and visibility
- **6-hour weather forecasting** for predictive heating decisions
- **Smart weather thresholds**: Only triggers poor weather mode for genuinely bad conditions (95%+ clouds AND low irradiance, or explicit 'overcast' forecast)
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

## Configuration

### 6-Period Daily Schedule and Temperature Thresholds

The controller uses a 6-mode daily schedule with weather-based overrides for morning, daytime, and midday. Each mode has its own temperature thresholds for switching the heating element ON/OFF, and some have special thresholds for poor weather conditions.

#### Modes and Thresholds (as in solarnode.js):

```javascript
modes: {
    // Early morning (5-8 AM)
    morning: {
        switch_off_temp: 42,
        switch_on_temp: 30,
        switch_on_s4_temp: 38,
        poor_weather: {
            switch_off_temp: 40,
            switch_on_temp: 30,
            switch_on_s4_temp: 42
        }
    },
    // Daytime (8-10 AM & 2-4 PM)
    daytime: {
        switch_off_temp: 38,
        switch_on_temp: 25,
        switch_on_s4_temp: 35,
        poor_weather: {
            switch_off_temp: 38,
            switch_on_temp: 30,
            switch_on_s4_temp: 42
        }
    },
    // Midday (10AM - 2PM)
    midday: {
        switch_off_temp: 35,
        switch_on_temp: 25,
        switch_on_s4_temp: 36,
        poor_weather: {
            switch_off_temp: 40,
            switch_on_temp: 38,
            switch_on_s4_temp: 40
        }
    },
    // Evening prep (4-7 PM)
    evening_prep: {
        switch_off_temp: 45,
        switch_on_temp: 38,
        switch_on_s4_temp: 42
    },
    // Evening/Night (7 PM - 5 AM)
    evening_night: {
        switch_off_temp: 40,
        switch_on_temp: 30,
        switch_on_s4_temp: 38
    },
    // Super heat mode (manual override)
    super_heat: {
        switch_off_temp: 60,
        switch_on_temp: 58,
        switch_on_s4_temp: 58
    }
}
```

- **Weather override**: For morning, daytime, and midday, if poor weather is detected (cloud cover > 95% AND solar irradiance < 50, or forecast is 'overcast'), the controller uses the `poor_weather` thresholds for that mode.
- **Super heat**: If the `super_heat` global variable is set, the controller uses the super_heat thresholds regardless of time/weather.

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
// Ultra-restrictive thresholds
// Poor weather if EXTREMELY cloudy (95%+) AND low irradiance (<50 W/m²), or forecast is 'overcast'
weather_assessment: {
    very_poor_conditions: "cloud_cover > 95 && solar_irradiance < 50",
    overcast_forecast: "weather_forecast === 'overcast'"
}
```

## Node-RED Configuration

### Main Controller Function
Use the complete controller code from `solarnode.js`. Key configuration highlights:

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
    // 6-mode daily schedule with weather overrides
    modes: { /* see above for full structure */ }
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
        switch_off_temp: 38,                // S3 switch-off threshold
        switch_on_temp: 25,                 // S3 switch-on threshold  
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
        timestamp: 1753123456789,           // Precise logging timestamp
        // New fields for energy management
        control_state: "AUTO_CONTROL",      // or "ENERGY_MGMT"
        energy_mgmt_active: false,          // true if energy management is active
        disable_auto_control: 0             // 1 if auto control is disabled
    },
    topic: "solarHW_setpoints"
};
```

## API Reference

### Global Variables (Node-RED)

#### Control Variables
- `disable_auto_control`: 0/1 - Disable automatic control
- `hot_water_element`: 0/1 - Current element state
- `super_heat`: 0/1 - Force high temperature mode
- `energy_management_hws_active`: true/false - Energy management system override

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

## Troubleshooting

- **Element not responding to controller**: Check global variables and sensor data format. Enable debug logging to see decision logic.
- **Rapid cycling or equipment stress**: Verify anti-cycling protection is working (check debug logs for "Switch blocked" messages). Adjust `min_switch_interval_minutes` if needed.
- **Ultra-aggressive daytime strategy causing hot water shortages**: Monitor performance and adjust thresholds if needed. Check poor weather override is activating on cloudy days.

## Changelog

### v2.2.0 - 6-Mode Schedule, Enhanced Weather Override, and Setpoint Logging
- **6-mode daily schedule**: morning, daytime (early/late), midday, evening_prep, evening_night, super_heat
- **Weather override**: Only triggers for 95%+ cloud and low irradiance, or explicit 'overcast' forecast
- **Super heat mode**: Manual override for maximum heating
- **Setpoint logging**: Now includes control_state and energy management status
- **Updated config and logic**: All thresholds and logic match solarnode.js

---

**Author**: Created for Brisbane, Australia solar hot water system optimized for exceptional solar conditions  
**Last Updated**: July 2025  
**Current Strategy**: EXTREME solar reliance with 32°C midday targeting for maximum energy savings