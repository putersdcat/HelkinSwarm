// Tests for Entra ID employee provisioning tools.
// Covers entra_list_available_licenses, entra_create_user, entra_assign_license, entra_get_user.
// Issue: #473 — Add employee provisioning and initial M365 license assignment workflow.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Global fetch mock — set before any module import
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Identity mock — getCredential().getToken() returns a valid token
// ---------------------------------------------------------------------------

vi.mock('../../src/auth/identity.js', () => ({
  getCredential: () => ({
    getToken: vi.fn().mockResolvedValue({ token: 'mock-mi-token' }),
  }),
}));

// ---------------------------------------------------------------------------
// Module loader — resets modules and mocks between tests
// ---------------------------------------------------------------------------

async function loadHandlers() {
  vi.resetModules();
  mockFetch.mockReset();
  const mod = await import('../../skills/entra/handlers.js');
  return mod;
}

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Helper — build a JSON fetch response
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: { message } }, status);
}

// ---------------------------------------------------------------------------
// SKU fixtures
// ---------------------------------------------------------------------------

const SKU_WITH_SEATS = {
  skuId: 'aaaaaaaa-0000-1111-2222-bbbbbbbbbbbb',
  skuPartNumber: 'ENTERPRISEPREMIUM',
  displayName: 'Microsoft 365 E3',
  consumedUnits: 3,
  prepaidUnits: { enabled: 10, suspended: 0, warning: 0 },
};

const SKU_EXHAUSTED = {
  skuId: 'cccccccc-0000-1111-2222-dddddddddddd',
  skuPartNumber: 'STANDARDPACK',
  displayName: 'Office 365 E1',
  consumedUnits: 5,
  prepaidUnits: { enabled: 5, suspended: 0, warning: 0 },
};

// ---------------------------------------------------------------------------
// entra_list_available_licenses
// ---------------------------------------------------------------------------

describe('entra_list_available_licenses', () => {
  it('returns formatted list with available seat counts', async () => {
    const { entra_list_available_licenses } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      value: [SKU_WITH_SEATS, SKU_EXHAUSTED],
    }));

    const result = await entra_list_available_licenses({});

    expect(result).toContain('Microsoft 365 E3');
    expect(result).toContain('7 available');   // 10 - 3
    expect(result).toContain('10 total');
    expect(result).toContain(SKU_WITH_SEATS.skuId);
    expect(result).toContain('Office 365 E1');
    expect(result).toContain('0 available');   // exhausted
  });

  it('returns "no subscriptions" when tenant has no SKUs', async () => {
    const { entra_list_available_licenses } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));

    const result = await entra_list_available_licenses({});

    expect(result).toContain('No Microsoft 365 license subscriptions');
  });

  it('calls Graph /subscribedSkus with required fields', async () => {
    const { entra_list_available_licenses } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: [SKU_WITH_SEATS] }));

    await entra_list_available_licenses({});

    const [url] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/subscribedSkus');
    expect(String(url)).toContain('skuId');
  });
});

// ---------------------------------------------------------------------------
// entra_create_user
// ---------------------------------------------------------------------------

describe('entra_create_user', () => {
  it('creates a user and returns confirmation with temp password hint', async () => {
    const { entra_create_user } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 'user-guid-0001',
      displayName: 'Alice Example',
      userPrincipalName: 'alice.example@contoso.com',
    }));

    const result = await entra_create_user({
      displayName: 'Alice Example',
      userPrincipalName: 'alice.example@contoso.com',
      mailNickname: 'alice.example',
      usageLocation: 'US',
    });

    expect(result).toContain('User created successfully');
    expect(result).toContain('Alice Example');
    expect(result).toContain('alice.example@contoso.com');
    expect(result).toContain('user-guid-0001');
    expect(result).toContain('entra_assign_license');   // next-step hint
    expect(result).toContain('must change their password');
  });

  it('includes optional jobTitle and department in the Graph request body', async () => {
    const { entra_create_user } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 'user-guid-0002',
      displayName: 'Bob Worker',
      userPrincipalName: 'bob@contoso.com',
    }));

    await entra_create_user({
      displayName: 'Bob Worker',
      userPrincipalName: 'bob@contoso.com',
      mailNickname: 'bob',
      usageLocation: 'DE',
      jobTitle: 'Engineer',
      department: 'Engineering',
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string);
    expect(body.jobTitle).toBe('Engineer');
    expect(body.department).toBe('Engineering');
    expect(body.usageLocation).toBe('DE');
    expect(body.passwordProfile.forceChangePasswordNextSignIn).toBe(true);
  });

  it('rejects missing required field (usageLocation) with Zod error', async () => {
    const { entra_create_user } = await loadHandlers();

    await expect(entra_create_user({
      displayName: 'No Location',
      userPrincipalName: 'noloc@contoso.com',
      mailNickname: 'noloc',
      // usageLocation omitted
    })).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects usageLocation that is not a 2-char ISO code', async () => {
    const { entra_create_user } = await loadHandlers();

    await expect(entra_create_user({
      displayName: 'Bad Loc',
      userPrincipalName: 'bad@contoso.com',
      mailNickname: 'bad',
      usageLocation: 'USA',   // 3 chars — invalid
    })).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('propagates Graph API error with status and message', async () => {
    const { entra_create_user } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(errorResponse('Property userPrincipalName is required.', 400));

    await expect(entra_create_user({
      displayName: 'Broken User',
      userPrincipalName: 'broken@contoso.com',
      mailNickname: 'broken',
      usageLocation: 'US',
    })).rejects.toThrow('400');
  });
});

// ---------------------------------------------------------------------------
// entra_assign_license
// ---------------------------------------------------------------------------

describe('entra_assign_license', () => {
  it('assigns license when seats are available', async () => {
    const { entra_assign_license } = await loadHandlers();

    // First call: preflight SKU check
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: [SKU_WITH_SEATS] }));
    // Second call: POST assignLicense (204 No Content simulable as null body)
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as unknown as Response);

    const result = await entra_assign_license({
      userIdOrUpn: 'alice.example@contoso.com',
      skuId: SKU_WITH_SEATS.skuId,
    });

    expect(result).toContain('License assigned successfully');
    expect(result).toContain('alice.example@contoso.com');
    expect(result).toContain('Microsoft 365 E3');
    expect(result).toContain('6 seats remaining');  // 10 - 3 - 1
    expect(result).toContain('30 minutes');          // mailbox timing hint
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects with clear message when SKU is exhausted (preflight)', async () => {
    const { entra_assign_license } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: [SKU_EXHAUSTED] }));

    await expect(entra_assign_license({
      userIdOrUpn: 'new@contoso.com',
      skuId: SKU_EXHAUSTED.skuId,
    })).rejects.toThrow('No available seats');

    // Should not proceed to POST
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects when SKU ID is not found in tenant (preflight)', async () => {
    const { entra_assign_license } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: [SKU_WITH_SEATS] }));

    const unknownSkuId = 'eeeeeeee-ffff-0000-1111-222222222222';
    await expect(entra_assign_license({
      userIdOrUpn: 'alice@contoso.com',
      skuId: unknownSkuId,
    })).rejects.toThrow('not found in the tenant');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects non-UUID skuId before making any API call', async () => {
    const { entra_assign_license } = await loadHandlers();

    await expect(entra_assign_license({
      userIdOrUpn: 'alice@contoso.com',
      skuId: 'not-a-uuid',
    })).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entra_get_user
// ---------------------------------------------------------------------------

describe('entra_get_user', () => {
  it('returns user detail with license count and usageLocation', async () => {
    const { entra_get_user } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 'user-guid-0001',
      displayName: 'Alice Example',
      mail: 'alice.example@contoso.com',
      userPrincipalName: 'alice.example@contoso.com',
      jobTitle: 'Engineer',
      department: 'Engineering',
      accountEnabled: true,
      usageLocation: 'US',
      assignedLicenses: [{ skuId: SKU_WITH_SEATS.skuId }],
      createdDateTime: '2026-04-14T00:00:00Z',
    }));

    const result = await entra_get_user({ userIdOrUpn: 'alice.example@contoso.com' });

    expect(result).toContain('Alice Example');
    expect(result).toContain('alice.example@contoso.com');
    expect(result).toContain('Engineer');
    expect(result).toContain('US');
    expect(result).toContain('Assigned licenses: 1');
    expect(result).toContain('user-guid-0001');
  });

  it('shows "Assigned licenses: 0" for user with no licenses', async () => {
    const { entra_get_user } = await loadHandlers();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 'user-guid-0002',
      displayName: 'Unlicensed Bob',
      userPrincipalName: 'bob@contoso.com',
      accountEnabled: true,
      usageLocation: 'DE',
      assignedLicenses: [],
    }));

    const result = await entra_get_user({ userIdOrUpn: 'bob@contoso.com' });

    expect(result).toContain('Assigned licenses: 0');
    expect(result).toContain('Enabled');
  });

  it('rejects empty userIdOrUpn', async () => {
    const { entra_get_user } = await loadHandlers();

    await expect(entra_get_user({ userIdOrUpn: '' })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
