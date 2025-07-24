// Enhanced Smart Solar Hot Water Controller with Energy Management Integration
// Configuration - modify these values as needed
var config = {
    // Debug settings
    debug_enabled: true,  // Set to true for detailed logging

    // Rate limiting
    controller_interval_seconds: 30,  // How often to actually run the controller logic

    // Logging settings
    logging: {
        log_setpoints: true,          // Log setpoints to InfluxDB
        log_on_change_only: false,    // true = only when setpoints change, false = every cycle
        log_weather_data: true        // Include weather data in logs
    },

    // Time-based operating modes with different temperature thresholds
    modes: {
        // Early morning (5-8 AM) - Conservative heating unless weather is poor
        morning: {
            switch_off_temp: 44,     // Lower target to rely on solar
            switch_on_temp: 35,      // Only heat if really low
            switch_on_s4_temp: 40,
            // Weather-based overrides
            poor_weather: {
                switch_off_temp: 44,
                switch_on_temp: 36,
                switch_on_s4_temp: 42
            }
        },

        // Daytime (8 AM - 10AM   & 2PM - 4PM) - Minimal electrical heating, rely on solar
        daytime: {
            switch_off_temp: 40,     // Very conservative
            switch_on_temp: 28,      // Emergency only
            switch_on_s4_temp: 34,
            // Bad weather override
            poor_weather: {
                switch_off_temp: 40,
                switch_on_temp: 30,
                switch_on_s4_temp: 38
            }
        },

        // Midday    (10AM - 2PM) - extra minimal electrical heating, rely on solar
        midday: {
            switch_off_temp: 40,     // Very conservative
            switch_on_temp: 25,      // Emergency only
            switch_on_s4_temp: 32,
            // Bad weather override
            poor_weather: {
                switch_off_temp: 40,
                switch_on_temp: 25,
                switch_on_s4_temp: 42
            }
        },


        // Evening prep (4-8 PM) - Prepare for evening usage
        evening_prep: {
            switch_off_temp: 48,
            switch_on_temp: 40,
            switch_on_s4_temp: 42
        },

        // Evening/Night (8 PM - 5 AM) - Ensure adequate hot water
        evening_night: {
            switch_off_temp: 42,
            switch_on_temp: 35,
            switch_on_s4_temp: 38
        },

        // Super heat mode (manual override)
        super_heat: {
            switch_off_temp: 60,
            switch_on_temp: 58,
            switch_on_s4_temp: 58
        }
    },

    // Time thresholds
    min_time_seconds: 600,

    // Switch state change limiting (prevents rapid cycling)
    min_switch_interval_minutes: 15  // Minimum time between state changes
};

// Rate limiting - don't run controller logic too frequently
var now = Date.now();
var last_run = flow.get('last_controller_run') || 0;
var min_interval_ms = config.controller_interval_seconds * 1000;

// Skip execution if called too recently
if (now - last_run < min_interval_ms) {
    // if (config.debug_enabled) {
    //     var seconds_remaining = Math.ceil((min_interval_ms - (now - last_run)) / 1000);
    //     node.warn(`Rate limited: ${seconds_remaining}s remaining until next controller run`);
    // }
    return; // Exit early, no processing
}
flow.set('last_controller_run', now);

// =============================================================================
// ENERGY MANAGEMENT MONITORING
// =============================================================================

// Monitor control state changes between energy management and auto control
function monitorControlState() {
    const energyMgmtActive = global.get('energy_management_hws_active') || false;
    const disableAutoControl = global.get('disable_auto_control') || 0;

    const controlState = energyMgmtActive ? 'ENERGY_MGMT' : 'AUTO_CONTROL';
    const lastState = flow.get('last_hws_control_state') || 'AUTO_CONTROL';

    if (controlState !== lastState) {
        node.log(`HWS Control changed: ${lastState} → ${controlState}`);
        flow.set('last_hws_control_state', controlState);

        // Log additional context for debugging
        if (config.debug_enabled) {
            node.warn(`Control state details: energy_mgmt_active=${energyMgmtActive}, disable_auto_control=${disableAutoControl}`);
        }
    }

    // Also check for inconsistent states (energy mgmt active but auto control not disabled)
    if (energyMgmtActive && disableAutoControl !== 1) {
        node.warn(`Warning: Inconsistent HWS control state - energy_mgmt_active=${energyMgmtActive} but disable_auto_control=${disableAutoControl}`);
    }

    return controlState;
}

// Call the monitoring function
var currentControlState = monitorControlState();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Helper function to determine time-based mode
function getTimeBasedMode() {
    var now = new Date();
    var hour = now.getHours();

    if (hour >= 5 && hour < 8) {
        return 'morning';
    } else if (hour >= 8 && hour < 10) {
        return 'daytime';
    } else if (hour >= 10 && hour < 14) {
        return 'midday';          // New ultra-conservative period
    } else if (hour >= 14 && hour < 16) {
        return 'daytime';
    } else if (hour >= 16 && hour < 20) {
        return 'evening_prep';
    } else {
        return 'evening_night';
    }
}

// Helper function to assess weather conditions
function assessWeatherConditions() {
    try {
        // Get weather data from global variables
        var cloud_cover = global.get('weather_cloud_cover') || 0;
        var solar_irradiance = global.get('weather_solar_irradiance') || 0;
        var weather_forecast_hours_ahead = global.get('weather_forecast_next_6h') || 'unknown';

        // More realistic thresholds for Brisbane conditions
        // Poor conditions = very high clouds OR very low irradiance OR overcast forecast
        var poor_conditions = false;

        // Only consider poor if VERY cloudy (95%+) AND low irradiance
        if (cloud_cover > 95 && solar_irradiance < 50) poor_conditions = true;

        // // OR if solar irradiance is extremely low (heavy overcast)
        // if (solar_irradiance > 0 && solar_irradiance < 50) poor_conditions = true;

        // OR if forecast is specifically overcast
        if (weather_forecast_hours_ahead === 'overcast') poor_conditions = true;

        if (config.debug_enabled) {
            node.warn(`Weather assessment: clouds=${cloud_cover}%, irradiance=${solar_irradiance}, forecast=${weather_forecast_hours_ahead}, poor=${poor_conditions}`);
        }

        return {
            poor_solar: poor_conditions,
            cloud_cover: cloud_cover,
            irradiance: solar_irradiance,
            forecast: weather_forecast_hours_ahead
        };
    } catch (e) {
        node.error("Error in weather assessment: " + e.message);
        // Return safe defaults
        return {
            poor_solar: false,
            cloud_cover: 0,
            irradiance: 0,
            forecast: 'unknown'
        };
    }
}

// Helper function to estimate hot water remaining
function estimateHotWaterLevel(s2, s3, s4) {
    // Rough estimate based on temperature stratification
    // Returns percentage of tank with "usable" hot water (>40°C)
    var usable_temp_threshold = 40;
    var hot_water_percentage = 0;

    if (s4 > usable_temp_threshold) hot_water_percentage += 33;
    if (s3 > usable_temp_threshold) hot_water_percentage += 33;
    if (s2 > usable_temp_threshold) hot_water_percentage += 34;

    return hot_water_percentage;
}

// Helper function to create setpoint logging data
function createSetpointLog(mode_name, thresholds, weather, hot_water_level, s2_temp, s3_temp, s4_temp) {
    var log_data = {
        // Core setpoints
        mode: mode_name,
        switch_off_temp: thresholds.switch_off_temp,
        switch_on_temp: thresholds.switch_on_temp,
        switch_on_s4_temp: thresholds.switch_on_s4_temp,

        // Current status
        hot_water_level_pct: hot_water_level,

        // Weather conditions (if available)
        cloud_cover_pct: weather ? weather.cloud_cover : null,
        solar_irradiance: weather ? weather.irradiance : null,
        weather_forecast: weather ? weather.forecast : null,
        poor_weather_mode: weather ? weather.poor_solar : false,

        // Sensor readings for context
        s2_current: s2_temp,
        s3_current: s3_temp,
        s4_current: s4_temp,

        // Trigger margins (how close we are to switching)
        margin_to_switch_on: thresholds.switch_on_temp - s3_temp,  // negative = needs heating
        margin_to_switch_off: s3_temp - thresholds.switch_off_temp, // negative = safe from switching off

        // Time context
        hour_of_day: new Date().getHours(),
        timestamp: Date.now()
    };

    return log_data;
}

// Helper function to check if setpoints have changed
function setpointsChanged(current_log) {
    var last_log = flow.get('last_setpoint_log');

    if (!last_log) return true; // First run

    // Check if key setpoints have changed
    return (last_log.mode !== current_log.mode ||
        last_log.switch_off_temp !== current_log.switch_off_temp ||
        last_log.switch_on_temp !== current_log.switch_on_temp ||
        last_log.switch_on_s4_temp !== current_log.switch_on_s4_temp ||
        last_log.poor_weather_mode !== current_log.poor_weather_mode);
}

// =============================================================================
// MAIN CONTROL LOGIC
// =============================================================================

// Main control logic
function main() {
    // Get global variables
    var disable_auto_control = global.get('disable_auto_control') || 0;
    var hot_water_element = global.get('hot_water_element') || 0;
    var super_heat = global.get('super_heat') || 0;

    // Exit if auto control is disabled (with enhanced logging)
    if (disable_auto_control == 1) {
        if (config.debug_enabled && currentControlState === 'ENERGY_MGMT') {
            node.warn(`Auto control disabled - energy management is controlling HWS`);
        } else if (config.debug_enabled) {
            node.warn(`Auto control disabled - manual control active`);
        }
        return;
    }

    // Current sensor readings with validation
    var s2_temp = msg.payload.s2;
    var s3_temp = msg.payload.s3;
    var s4_temp = msg.payload.s4;
    var time_seconds = msg.payload.time;

    // Validate sensor data - exit if critical sensors are missing
    if (s2_temp === undefined || s3_temp === undefined || s4_temp === undefined ||
        typeof s2_temp !== 'number' || typeof s3_temp !== 'number' || typeof s4_temp !== 'number') {
        if (config.debug_enabled) {
            node.warn(`Invalid sensor data: S2=${s2_temp}, S3=${s3_temp}, S4=${s4_temp} - skipping control logic`);
        }
        return null; // Don't attempt control with bad data
    }

    // Determine operating mode
    var mode_name;
    var thresholds;

    if (super_heat == 1) {
        mode_name = 'super_heat';
        thresholds = config.modes.super_heat;
    } else {
        mode_name = getTimeBasedMode();
        var weather = assessWeatherConditions();

        if (config.debug_enabled) {
            node.warn(`Debug: mode_name=${mode_name}, weather.poor_solar=${weather.poor_solar}`);
        }

        // Use weather-adjusted thresholds for morning and daytime modes
        if ((mode_name === 'morning' || mode_name === 'daytime') && weather.poor_solar) {
            thresholds = config.modes[mode_name].poor_weather;
            if (config.debug_enabled) {
                node.warn(`Using poor weather thresholds for ${mode_name} mode (cloud: ${weather.cloud_cover}%, irradiance: ${weather.irradiance})`);
            }
        } else {
            thresholds = config.modes[mode_name];
            if (config.debug_enabled) {
                node.warn(`Using normal ${mode_name} thresholds (cloud: ${weather.cloud_cover}%, irradiance: ${weather.irradiance})`);
            }
        }
    }

    // Log current status for debugging
    var hot_water_level = estimateHotWaterLevel(s2_temp, s3_temp, s4_temp);
    if (config.debug_enabled) {
        node.warn(`Mode: ${mode_name}, Hot water: ${hot_water_level}%, S2:${s2_temp}°C S3:${s3_temp}°C S4:${s4_temp}°C`);
    }

    // Check for switch-off conditions
    if (hot_water_element == 1 && s3_temp > thresholds.switch_off_temp) {
        // Check if enough time has passed since last switch
        var last_switch_time = flow.get('last_element_switch_time') || 0;
        var time_since_last_switch = (Date.now() - last_switch_time) / (1000 * 60); // minutes

        if (time_since_last_switch < config.min_switch_interval_minutes) {
            if (config.debug_enabled) {
                var wait_time = Math.ceil(config.min_switch_interval_minutes - time_since_last_switch);
                node.warn(`Switch-off blocked: Only ${Math.floor(time_since_last_switch)}min since last switch, need ${wait_time}min more`);
            }
            return null; // Explicitly return null instead of undefined
        }

        msg.payload = 0;
        flow.set('last_element_switch_time', Date.now());
        if (config.debug_enabled) {
            node.warn(`Switching OFF: S3 temp ${s3_temp}°C > threshold ${thresholds.switch_off_temp}°C`);
        }
        return msg;
    }

    // Check for switch-on conditions
    if (hot_water_element == 0 &&
        time_seconds > config.min_time_seconds &&
        s3_temp < thresholds.switch_on_temp &&
        s4_temp < thresholds.switch_on_s4_temp) {

        // Check if enough time has passed since last switch
        var last_switch_time = flow.get('last_element_switch_time') || 0;
        var time_since_last_switch = (Date.now() - last_switch_time) / (1000 * 60); // minutes

        if (time_since_last_switch < config.min_switch_interval_minutes) {
            if (config.debug_enabled) {
                var wait_time = Math.ceil(config.min_switch_interval_minutes - time_since_last_switch);
                node.warn(`Switch-on blocked: Only ${Math.floor(time_since_last_switch)}min since last switch, need ${wait_time}min more`);
            }
            return null; // Explicitly return null instead of undefined
        }

        msg.payload = 1;
        flow.set('last_element_switch_time', Date.now());
        if (config.debug_enabled) {
            node.warn(`Switching ON: S3:${s3_temp}°C < ${thresholds.switch_on_temp}°C AND S4:${s4_temp}°C < ${thresholds.switch_on_s4_temp}°C`);
            node.warn(`Switch-on check: s3=${s3_temp} < ${thresholds.switch_on_temp}? ${s3_temp < thresholds.switch_on_temp}`);
            node.warn(`Switch-on check: s4=${s4_temp} < ${thresholds.switch_on_s4_temp}? ${s4_temp < thresholds.switch_on_s4_temp}`);
            node.warn(`Switch-on check: time=${time_seconds} > ${config.min_time_seconds}? ${time_seconds > config.min_time_seconds}`);
            node.warn(`Switch-on check: element=${hot_water_element} == 0? ${hot_water_element == 0}`);
        }
        return msg;
    }

    // No action required
    return null; // Explicitly return null for no action
}

// Execute main function
var main_result = main();

// =============================================================================
// SETPOINT LOGGING
// =============================================================================

// Create setpoint logging data if enabled
if (config.logging.log_setpoints) {
    // if (config.debug_enabled) {
    //     node.warn("Starting setpoint logging...");
    // }

    // Get global variables
    var super_heat = global.get('super_heat') || 0;

    var mode_name = super_heat == 1 ? 'super_heat' : getTimeBasedMode();
    var weather = assessWeatherConditions();
    var s2_temp = msg.payload.s2;
    var s3_temp = msg.payload.s3;
    var s4_temp = msg.payload.s4;
    var hot_water_level = estimateHotWaterLevel(s2_temp, s3_temp, s4_temp);

    // Determine current thresholds (copy logic from main function)
    var current_thresholds;
    if (super_heat == 1) {
        current_thresholds = config.modes.super_heat;
    } else {
        var time_mode = getTimeBasedMode();
        if ((time_mode === 'morning' || time_mode === 'daytime' || time_mode === 'midday') && weather.poor_solar) {
            current_thresholds = config.modes[time_mode].poor_weather;
        } else {
            current_thresholds = config.modes[time_mode];
        }
    }

    // Create the setpoint log data (with sensor validation)
    var setpoint_log = null;
    if (s2_temp !== undefined && s3_temp !== undefined && s4_temp !== undefined) {
        setpoint_log = createSetpointLog(mode_name, current_thresholds, weather, hot_water_level, s2_temp, s3_temp, s4_temp);

        // Add energy management status to setpoint log
        setpoint_log.control_state = currentControlState;
        setpoint_log.energy_mgmt_active = global.get('energy_management_hws_active') || false;
        setpoint_log.disable_auto_control = global.get('disable_auto_control') || 0;
    } else {
        if (config.debug_enabled) {
            node.warn(`Skipping setpoint logging due to invalid sensor data: S2=${s2_temp}, S3=${s3_temp}, S4=${s4_temp}`);
        }
    }

    // Check if we should log (based on change-only setting)
    var should_log = false;
    if (setpoint_log !== null) {
        should_log = true;
        if (config.logging.log_on_change_only) {
            should_log = setpointsChanged(setpoint_log);
            if (should_log) {
                flow.set('last_setpoint_log', setpoint_log);
            }
        }
    }

    // Send setpoint data to second output if we should log
    if (should_log) {
        var setpoint_msg = {
            payload: setpoint_log,
            topic: "solarHW_setpoints"
        };

        if (config.debug_enabled) {
            node.warn(`Logging setpoints: mode=${mode_name}, switch_on=${current_thresholds.switch_on_temp}°C, switch_off=${current_thresholds.switch_off_temp}°C, control=${currentControlState}`);
        }

        // Return array: [main output, setpoint logging output]
        return [main_result, setpoint_msg];
    }
}

// Return just the main result if no logging
return [main_result, null];