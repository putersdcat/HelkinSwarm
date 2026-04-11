// Travel routing skill — drive/walk/cycle time + geocoding via free OpenStreetMap APIs.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md
// Issue: #180
//
// APIs used (all free, no API key required):
//   Geocoding: https://nominatim.openstreetmap.org/ (Nominatim OSM geocoder)
//   Routing:   https://router.project-osrm.org/     (OSRM community demo server)
//
// Usage policy:
//   - Nominatim: max 1 req/sec per IP; User-Agent header required.
//     Geocodes are done sequentially (not parallel) to comply.
//   - OSRM demo: community-supported, suitable for low-volume personal use.
//
// Deferred to future slices (#180 Slice 2+):
//   - Tesla vehicle location, preconditioning, summon
//   - Multi-modal planning (flights, trains)
//   - Saved home/work location preferences

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Nominatim API response schema
// ---------------------------------------------------------------------------

const NominatimResultSchema = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  type: z.string().optional(),
  class: z.string().optional(),
});

const NominatimResponseSchema = z.array(NominatimResultSchema);

// ---------------------------------------------------------------------------
// OSRM API response schema
// ---------------------------------------------------------------------------

const OsrmRouteSchema = z.object({
  distance: z.number(), // meters
  duration: z.number(), // seconds
  legs: z.array(z.object({
    distance: z.number(),
    duration: z.number(),
  })).optional(),
});

const OsrmResponseSchema = z.object({
  code: z.string(), // "Ok" on success
  routes: z.array(OsrmRouteSchema).optional(),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GeoPoint {
  lat: number;
  lon: number;
  displayName: string;
}

interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

// ---------------------------------------------------------------------------
// Nominatim geocoding
// ---------------------------------------------------------------------------

export async function geocodeAddress(address: string): Promise<GeoPoint> {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
    addressdetails: '0',
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // Nominatim requires a meaningful User-Agent per their terms of use.
        'User-Agent': 'HelkinSwarm/1.0 (personal AI assistant; github.com/putersdcat/HelkinSwarm)',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  const results = NominatimResponseSchema.parse(data);

  if (results.length === 0) {
    throw new Error(`No location found for: "${address}". Try a more specific place name or address.`);
  }

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

// ---------------------------------------------------------------------------
// OSRM routing
// ---------------------------------------------------------------------------

type TravelMode = 'driving' | 'walking' | 'cycling';

// OSRM uses 'foot' and 'bike' as profile names for walking/cycling respectively
const OSRM_PROFILES: Record<TravelMode, string> = {
  driving: 'driving',
  walking: 'foot',
  cycling: 'bike',
};

export async function getRoute(
  from: GeoPoint,
  to: GeoPoint,
  mode: TravelMode,
): Promise<RouteResult> {
  const profile = OSRM_PROFILES[mode];
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;

  const response = await fetch(
    `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=false&alternatives=false`,
    {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Routing request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  const result = OsrmResponseSchema.parse(data);

  if (result.code !== 'Ok' || !result.routes?.length) {
    throw new Error(`Could not calculate route: ${result.message ?? 'No route found between these locations'}`);
  }

  return {
    distanceMeters: result.routes[0].distance,
    durationSeconds: result.routes[0].duration,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return 'less than 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

export function formatDistance(meters: number): string {
  const km = meters / 1000;
  const miles = km * 0.621_371;
  if (km < 1) {
    return `${Math.round(meters)} m (${Math.round(meters * 3.281)} ft)`;
  }
  return `${km.toFixed(1)} km (${miles.toFixed(1)} mi)`;
}

export function shortenDisplayName(name: string, maxLen = 70): string {
  if (name.length <= maxLen) return name;
  // Use first 2 comma-separated segments for a readable short form
  const parts = name.split(',');
  return parts.slice(0, 2).join(',').trim();
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const TravelModeSchema = z.enum(['driving', 'walking', 'cycling']).default('driving');

const TravelDriveTimeInputSchema = z.object({
  from: z.string().min(1, 'Starting location is required'),
  to: z.string().min(1, 'Destination is required'),
  mode: TravelModeSchema.optional(),
});

const TravelGeocodeInputSchema = z.object({
  address: z.string().min(1, 'Address is required'),
});

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export const travel_drive_time: ToolHandler = async (args) => {
  const input = TravelDriveTimeInputSchema.parse(args);
  const mode: TravelMode = (input.mode ?? 'driving') as TravelMode;

  // Geocode sequentially to respect Nominatim's ~1 req/sec rate guideline
  const fromGeo = await geocodeAddress(input.from);
  const toGeo = await geocodeAddress(input.to);

  const route = await getRoute(fromGeo, toGeo, mode);

  const modeEmoji: Record<TravelMode, string> = {
    driving: '🚗',
    walking: '🚶',
    cycling: '🚲',
  };
  const modeLabel: Record<TravelMode, string> = {
    driving: 'Driving',
    walking: 'Walking',
    cycling: 'Cycling',
  };

  const fromName = shortenDisplayName(fromGeo.displayName);
  const toName = shortenDisplayName(toGeo.displayName);
  const emoji = modeEmoji[mode];
  const label = modeLabel[mode];

  return [
    `${emoji} **${label} time: ${formatDuration(route.durationSeconds)}**`,
    `📏 Distance: ${formatDistance(route.distanceMeters)}`,
    '',
    `**From:** ${fromName}`,
    `**To:** ${toName}`,
    '',
    `_Estimated typical time via OSRM/OpenStreetMap. Does not include real-time traffic._`,
  ].join('\n');
};

export const travel_geocode: ToolHandler = async (args) => {
  const input = TravelGeocodeInputSchema.parse(args);
  const geo = await geocodeAddress(input.address);
  const shortName = shortenDisplayName(geo.displayName);

  return [
    `📍 **${shortName}**`,
    `- Latitude: ${geo.lat.toFixed(6)}`,
    `- Longitude: ${geo.lon.toFixed(6)}`,
    `- Full name: ${geo.displayName}`,
  ].join('\n');
};
