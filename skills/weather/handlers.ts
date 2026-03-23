// Weather skill handler — frictionless weather via Open-Meteo (no API key).
// Spec ref: 05-Capabilities-Framework.md
// Issue: #181
//
// APIs used:
//   Geocoding: https://geocoding-api.open-meteo.com/v1/search
//   Weather:   https://api.open-meteo.com/v1/forecast

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for API response validation at boundary
// ---------------------------------------------------------------------------

const GeoResultSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
});

const GeoResponseSchema = z.object({
  results: z.array(GeoResultSchema).optional(),
});

const CurrentWeatherSchema = z.object({
  time: z.string(),
  temperature_2m: z.number(),
  relative_humidity_2m: z.number(),
  apparent_temperature: z.number(),
  weather_code: z.number(),
  wind_speed_10m: z.number(),
  wind_direction_10m: z.number(),
  precipitation: z.number(),
});

const DailySchema = z.object({
  time: z.array(z.string()),
  temperature_2m_max: z.array(z.number()),
  temperature_2m_min: z.array(z.number()),
  weather_code: z.array(z.number()),
  precipitation_sum: z.array(z.number()),
  wind_speed_10m_max: z.array(z.number()),
});

const WeatherResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: CurrentWeatherSchema.optional(),
  daily: DailySchema.optional(),
});

// ---------------------------------------------------------------------------
// WMO Weather interpretation codes → human labels
// ---------------------------------------------------------------------------

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

function weatherLabel(code: number): string {
  return WMO_CODES[code] ?? `Unknown (${code})`;
}

// ---------------------------------------------------------------------------
// Geocoding: city name → lat/lon
// ---------------------------------------------------------------------------

async function geocode(location: string): Promise<{ lat: number; lon: number; name: string }> {
  // Check if already coordinates: "52.52,13.41"
  const coordMatch = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(location.trim());
  if (coordMatch) {
    return { lat: Number(coordMatch[1]), lon: Number(coordMatch[2]), name: location.trim() };
  }

  const params = new URLSearchParams({ name: location, count: '1', language: 'en', format: 'json' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  const parsed = GeoResponseSchema.parse(data);

  if (!parsed.results || parsed.results.length === 0) {
    throw new Error(`Location not found: "${location}". Try a city name like "Berlin" or coordinates "52.52,13.41".`);
  }

  const place = parsed.results[0];
  const parts = [place.name, place.admin1, place.country].filter(Boolean);
  return { lat: place.latitude, lon: place.longitude, name: parts.join(', ') };
}

// ---------------------------------------------------------------------------
// Weather fetch
// ---------------------------------------------------------------------------

interface WeatherOptions {
  lat: number;
  lon: number;
  period: string;
}

async function fetchWeather(opts: WeatherOptions) {
  const params = new URLSearchParams({
    latitude: String(opts.lat),
    longitude: String(opts.lon),
    timezone: 'auto',
  });

  // Always include current
  params.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation');

  // Forecast days based on period
  const forecastDays = opts.period === '7day' ? 7 : opts.period === '3day' ? 3 : opts.period === 'today' ? 1 : 0;
  if (forecastDays > 0) {
    params.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,wind_speed_10m_max');
    params.set('forecast_days', String(forecastDays));
  }

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) {
    throw new Error(`Weather API failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  return WeatherResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Format output
// ---------------------------------------------------------------------------

function formatCurrent(current: z.infer<typeof CurrentWeatherSchema>): string {
  return [
    `**Condition:** ${weatherLabel(current.weather_code)}`,
    `**Temperature:** ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C)`,
    `**Humidity:** ${current.relative_humidity_2m}%`,
    `**Wind:** ${current.wind_speed_10m} km/h (${current.wind_direction_10m}°)`,
    `**Precipitation:** ${current.precipitation} mm`,
  ].join('\n');
}

function formatDaily(daily: z.infer<typeof DailySchema>): string {
  return daily.time.map((date, i) =>
    `**${date}:** ${weatherLabel(daily.weather_code[i])} — ${daily.temperature_2m_min[i]}°C / ${daily.temperature_2m_max[i]}°C, precip ${daily.precipitation_sum[i]} mm, wind up to ${daily.wind_speed_10m_max[i]} km/h`,
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Tool: weather_get
// ---------------------------------------------------------------------------

export const weather_get: ToolHandler = async (args) => {
  const location = String(args['location'] ?? '');
  if (!location) throw new Error('Location is required');

  const period = String(args['period'] ?? 'current');

  const geo = await geocode(location);
  const weather = await fetchWeather({ lat: geo.lat, lon: geo.lon, period });

  const sections: string[] = [`📍 **${geo.name}**\n`];

  if (weather.current) {
    sections.push('### Current Weather\n' + formatCurrent(weather.current));
  }

  if (weather.daily) {
    const label = period === '7day' ? '7-Day' : period === '3day' ? '3-Day' : "Today's";
    sections.push(`\n### ${label} Forecast\n` + formatDaily(weather.daily));
  }

  return sections.join('\n');
};
