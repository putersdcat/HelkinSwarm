// Tests for travel routing skill — geocoding, routing, formatting
// Issue: #180

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  geocodeAddress,
  getRoute,
  formatDuration,
  formatDistance,
  shortenDisplayName,
  travel_drive_time,
  travel_geocode,
} from '../../skills/travel/handlers.js';

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('returns "less than 1 min" for very short durations', () => {
    // Math.round(10/60) === 0 → triggers the sub-minute message
    expect(formatDuration(10)).toBe('less than 1 min');
  });

  it('returns minutes only when under 60 min', () => {
    expect(formatDuration(1800)).toBe('30 min');
  });

  it('rounds to nearest minute', () => {
    expect(formatDuration(3660)).toBe('1 hr 1 min');
  });

  it('returns "N hr" when minutes are zero', () => {
    expect(formatDuration(7200)).toBe('2 hr');
  });

  it('combines hours and minutes', () => {
    expect(formatDuration(5400)).toBe('1 hr 30 min');
  });

  it('handles large durations', () => {
    expect(formatDuration(36000)).toBe('10 hr');
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe('formatDistance', () => {
  it('returns meters and feet below 1 km', () => {
    const result = formatDistance(500);
    expect(result).toContain('500 m');
    expect(result).toContain('ft');
  });

  it('returns km and miles above 1 km', () => {
    const result = formatDistance(16_093); // ~10 miles
    expect(result).toContain('km');
    expect(result).toContain('mi');
  });

  it('formats km to 1 decimal place', () => {
    expect(formatDistance(1000)).toBe('1.0 km (0.6 mi)');
  });
});

// ---------------------------------------------------------------------------
// shortenDisplayName
// ---------------------------------------------------------------------------

describe('shortenDisplayName', () => {
  it('returns full name when within maxLen', () => {
    const name = 'Short Name, City';
    expect(shortenDisplayName(name)).toBe(name);
  });

  it('truncates long names to first 2 segments', () => {
    const longName = 'Empire State Building, 350 Fifth Avenue, Midtown Manhattan, New York County, New York, United States';
    const result = shortenDisplayName(longName, 50);
    // Should return "Empire State Building, 350 Fifth Avenue"
    expect(result).toBe('Empire State Building, 350 Fifth Avenue');
  });

  it('handles name with no commas by returning full string', () => {
    const name = 'SingleToken';
    expect(shortenDisplayName(name, 5)).toBe('SingleToken');
  });
});

// ---------------------------------------------------------------------------
// geocodeAddress — mocked fetch
// ---------------------------------------------------------------------------

describe('geocodeAddress', () => {
  const mockNominatimResult = [
    {
      lat: '30.2672',
      lon: '-97.7431',
      display_name: 'Austin, Travis County, Texas, United States',
    },
  ];

  it('resolves a well-known place to lat/lon', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockNominatimResult),
    } as Response);

    const result = await geocodeAddress('Austin, TX');
    expect(result.lat).toBeCloseTo(30.2672, 3);
    expect(result.lon).toBeCloseTo(-97.7431, 3);
    expect(result.displayName).toContain('Austin');
  });

  it('sends the User-Agent header required by Nominatim ToS', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockNominatimResult),
    } as Response);

    await geocodeAddress('Austin, TX');
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const userAgent = (options?.headers as Record<string, string>)['User-Agent'];
    expect(userAgent).toBeDefined();
    expect(userAgent).toMatch(/HelkinSwarm/);
  });

  it('throws when location is not found (empty array)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    await expect(geocodeAddress('xyzzy-nonexistent-place-99999')).rejects.toThrow('No location found');
  });

  it('throws on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.resolve({}),
    } as Response);

    await expect(geocodeAddress('somewhere')).rejects.toThrow('Geocoding request failed');
  });
});

// ---------------------------------------------------------------------------
// getRoute — mocked fetch
// ---------------------------------------------------------------------------

const mockFromGeo = { lat: 30.2672, lon: -97.7431, displayName: 'Austin, TX' };
const mockToGeo = { lat: 29.7604, lon: -95.3698, displayName: 'Houston, TX' };

describe('getRoute', () => {
  const mockOsrmResponse = {
    code: 'Ok',
    routes: [
      {
        distance: 257_000, // ~257 km
        duration: 9_000,  // 2.5 hours
        legs: [{ distance: 257_000, duration: 9_000 }],
      },
    ],
  };

  it('returns distance and duration from OSRM', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOsrmResponse),
    } as Response);

    const result = await getRoute(mockFromGeo, mockToGeo, 'driving');
    expect(result.distanceMeters).toBe(257_000);
    expect(result.durationSeconds).toBe(9_000);
  });

  it('uses "foot" profile for walking mode', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOsrmResponse),
    } as Response);

    await getRoute(mockFromGeo, mockToGeo, 'walking');
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/foot/');
  });

  it('uses "bike" profile for cycling mode', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOsrmResponse),
    } as Response);

    await getRoute(mockFromGeo, mockToGeo, 'cycling');
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/bike/');
  });

  it('throws when OSRM code is not Ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 'NoRoute', message: 'No route found' }),
    } as Response);

    await expect(getRoute(mockFromGeo, mockToGeo, 'driving')).rejects.toThrow('No route found');
  });

  it('throws on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    } as Response);

    await expect(getRoute(mockFromGeo, mockToGeo, 'driving')).rejects.toThrow('Routing request failed');
  });
});

// ---------------------------------------------------------------------------
// travel_drive_time handler
// ---------------------------------------------------------------------------

describe('travel_drive_time', () => {
  const mockGeoAustin = {
    lat: '30.2672', lon: '-97.7431',
    display_name: 'Austin, Travis County, Texas, United States',
  };
  const mockGeoHouston = {
    lat: '29.7604', lon: '-95.3698',
    display_name: 'Houston, Harris County, Texas, United States',
  };
  const mockOsrm = {
    code: 'Ok',
    routes: [{ distance: 257_000, duration: 9_000 }],
  };

  it('returns a string with duration and distance', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockGeoAustin]) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockGeoHouston]) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockOsrm) } as Response);

    const result = (await travel_drive_time({ from: 'Austin TX', to: 'Houston TX' })) as string;
    expect(result).toContain('hr');
    expect(result).toContain('km');
    expect(result).toContain('🚗');
  });

  it('uses walking emoji and "Walking" label for walking mode', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockGeoAustin]) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockGeoHouston]) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockOsrm) } as Response);

    const result = (await travel_drive_time({ from: 'Austin TX', to: 'Houston TX', mode: 'walking' })) as string;
    expect(result).toContain('🚶');
    expect(result).toContain('Walking');
  });

  it('throws Zod error on empty from field', async () => {
    await expect(travel_drive_time({ from: '', to: 'Houston TX' })).rejects.toThrow();
  });

  it('throws Zod error on missing to field', async () => {
    await expect(travel_drive_time({ from: 'Austin TX' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// travel_geocode handler
// ---------------------------------------------------------------------------

describe('travel_geocode', () => {
  const mockGeo = [
    {
      lat: '48.8566',
      lon: '2.3522',
      display_name: 'Paris, Île-de-France, France',
    },
  ];

  it('returns coordinates in the output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockGeo),
    } as Response);

    const result = (await travel_geocode({ address: 'Paris France' })) as string;
    expect(result).toContain('48.856600');
    expect(result).toContain('2.352200');
    expect(result).toContain('Paris');
  });

  it('throws on empty address', async () => {
    await expect(travel_geocode({ address: '' })).rejects.toThrow();
  });
});
