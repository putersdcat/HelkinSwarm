import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

type StaticTabEntry = {
  entityId: string;
  contentUrl: string;
  websiteUrl: string;
};

describe('Teams manifest tab URL versioning', () => {
  it('bumps the app version and uses versioned static tab URLs to bust iframe cache', () => {
    const manifest = JSON.parse(readFileSync('appPackage/manifest.json', 'utf8')) as {
      version: string;
      staticTabs: StaticTabEntry[];
    };

    const getTab = (entityId: string): StaticTabEntry | undefined =>
      manifest.staticTabs.find((tab) => tab.entityId === entityId);

    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(getTab('getting-started')?.contentUrl).toContain(`index.html?v=${manifest.version}#get-started`);
    expect(getTab('getting-started')?.websiteUrl).toContain(`index.html?v=${manifest.version}#get-started`);
    expect(getTab('control-center')?.contentUrl).toContain(`index.html?v=${manifest.version}#control-center`);
    expect(getTab('control-center')?.websiteUrl).toContain(`index.html?v=${manifest.version}#control-center`);
    expect(getTab('skills-library')?.contentUrl).toContain(`index.html?v=${manifest.version}#skills-library`);
    expect(getTab('skills-library')?.websiteUrl).toContain(`index.html?v=${manifest.version}#skills-library`);
  });
});