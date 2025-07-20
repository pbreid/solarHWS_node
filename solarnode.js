// Enhanced Smart Solar Hot Water Controller
// Configuration - modify these values as needed
var config = {
    // Debug settings
    debug_enabled: false,  // Set to true for detailed logging
    
    // Time-based operating modes with different temperature thresholds
    modes: {
        // Early morning (5-8 AM) - Conservative heating unless weather is poor
        morning: {
            switch_off_temp: 45,     // Lower target to rely on solar
            switch_on_temp: 35,      // Only heat if really low
            switch_on_s4_temp: 38,
            // Weather-based overrides
            poor_weather: {
                switch_off_temp: 50,
                switch_on_temp: 40,
                switch_on_s4_temp: 42
            }
        },
        
        // Daytime (8 AM - 4 PM) - Minimal electrical heating, rely on solar
        daytime: {
            switch_off_temp: 42,     // Very conservative
            switch_on_temp: 32,      // Emergency only
            switch_on_s4_temp: 35,
            // Bad weather override
            poor_weather: {
                switch_off_temp: 48,
                switch_on_temp: 38,
                switch_on_s4_temp: 40
            }
        },
        
        // Evening prep (4-7 PM) - Prepare for evening usage
        evening_prep: {
            switch_off_temp: 52,
            switch_on_temp: 45,
            switch_on_s4_temp: 47
        },
        
        // Evening/Night (7 PM - 5 AM) - Ensure adequate hot water
        evening_night: {
            switch_off_temp: 55,
            switch_on_temp: 42,
            switch_on_s4_temp: 45
        },
        
        // Super heat mode (manual override)
        super_heat: {
            switch_off_temp: 60,
            switch_on_temp: 58,
            switch_on_s4_temp: 58
        }
    },

    // Time thresholds
    min_time_seconds: 600
};

// Helper function to determine time-based mode
function getTimeBasedMode() {
    var now = new Date();
    var hour = now.getHours();
    
    if (hour >= 5 && hour < 8) {
        return 'morning';
    } else if (hour >= 8 && hour < 16) {
        return 'daytime';
    } else if (hour >= 16 && hour < 19) {
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
        
        // Simple logic: poor conditions if clouds > 50% OR irradiance < 100 OR forecast is overcast
        var poor_conditions = false;
        
        if (cloud_cover > 50) poor_conditions = true;
        if (solar_irradiance > 0 && solar_irradiance < 100) poor_conditions = true;
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

// Main control logic
function main() {
    // Get global variables
    var disable_auto_control = global.get('disable_auto_control') || 0;
    var hot_water_element = global.get('hot_water_element') || 0;
    var super_heat = global.get('super_heat') || 0;
    
    // Exit if auto control is disabled
    if (disable_auto_control == 1) {
        return;
    }
    
    // Current sensor readings
    var s2_temp = msg.payload.s2;
    var s3_temp = msg.payload.s3;
    var s4_temp = msg.payload.s4;
    var time_seconds = msg.payload.time;
    
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
        msg.payload = 0;
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
        
        msg.payload = 1;
        if (config.debug_enabled) {
            node.warn(`Switching ON: S3:${s3_temp}°C < ${thresholds.switch_on_temp}°C AND S4:${s4_temp}°C < ${thresholds.switch_on_s4_temp}°C`);
        }
        return msg;
    }
    
    // No action required
    return;
}

// Execute main function
return main();