import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HolodeckHost, checkExtensionMatchesManifest, packageRoles, validateHolodeckPackageManifest } from '@holodeck/sdk';
import manifest from '../holodeck.package.json';
import cloudManifest from '../../library-cloud/holodeck.package.json';
import npmPackage from '../package.json';
import iconSource from './icon-source.json';
import entry, { AWS_PACKAGE_MANIFEST, awsPackage, createAwsExtension } from './holodeck-package';
import { AWS_CATEGORIES, AWS_PART_DEFINITIONS, AWS_SERVICES, CLOUDWATCH_NAMESPACE_PARTS, createAwsParts } from './parts';
import { MAX_ICON_BYTES, sanitizeSvg, svgProblems, tileColour } from '../scripts/svg-sanitize.mjs';
// Pure engine contracts only: no React, renderer or editor installation required in this CI job.
import { ISO_KINDS, isIsoPartDefinition } from '../../editor-2.5d-react/src/registry/kinds';
// Source-level imports keep the check cheap: no AWS SDK needed in this job.
import { DEFAULT_PART_HINTS } from '../../provider-aws/src/discovery';

const root = new URL('..', import.meta.url).pathname;
const cloudModels = new URL('../../library-cloud/assets/models/', import.meta.url).pathname;
const manifestUrl = 'https://assets.example.test/packs/aws/holodeck.package.json';
const cloudManifestUrl = 'https://assets.example.test/packs/cloud/holodeck.package.json';
const assetBase = 'https://assets.example.test/packs/aws/assets/';
const context = { host: 'test', assetUrl: (path) => new URL(path, assetBase).href };
const engine = { id: 'holodeck.iso', label: 'Iso contract', apiVersion: '1.0.0', documentFormat: 'holodeck.iso.scene.v1', kinds: ISO_KINDS };

/** Services the three-tier sample (S3) and provider-aws discovery need, whatever else the catalogue grows to. */
const REQUIRED_SLUGS = [
  'ec2', 'elb', 'rds', 'elasticache', 's3', 'cloudfront', 'lambda', 'sqs', 'sns', 'api-gateway', 'dynamodb',
  'ecs', 'fargate', 'eks', 'cloudwatch', 'iam', 'vpc', 'route53', 'cognito', 'kinesis', 'redshift', 'secrets-manager', 'waf',
];

describe('catalogue data', () => {
  it('covers every required service with unique slugs, labels and well-formed rows', () => {
    const slugs = AWS_SERVICES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(AWS_SERVICES.map((s) => s.label)).size).toBe(slugs.length);
    expect(slugs).toEqual(expect.arrayContaining(REQUIRED_SLUGS));
    expect(slugs.length).toBeGreaterThanOrEqual(50);
    for (const service of AWS_SERVICES) {
      expect(service.slug, service.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(AWS_CATEGORIES, service.slug).toHaveProperty(service.category);
      expect(service.hint.length, service.slug).toBeGreaterThan(8);
      expect(service.cloudwatchNamespace === null || /^(AWS\/|Glue)[A-Za-z0-9]*$/.test(service.cloudwatchNamespace), service.slug).toBe(true);
    }
    for (const category of Object.values(AWS_CATEGORIES)) expect(category.color).toMatch(/^#[\dA-F]{6}$/);
  });

  it('uses only archetypes that library-cloud ships, vendored byte-for-byte', () => {
    for (const archetype of new Set(AWS_SERVICES.map((s) => s.archetype))) {
      const mine = readFileSync(`${root}assets/models/${archetype}.glb`);
      expect(mine.readUInt32LE(0), archetype).toBe(0x46546c67);
      expect(mine.equals(readFileSync(`${cloudModels}${archetype}.glb`)), `${archetype}.glb drifted from library-cloud; run pnpm assets:sync`).toBe(true);
    }
    // No orphans either.
    const used = new Set(AWS_SERVICES.map((s) => `${s.archetype}.glb`));
    expect(readdirSync(`${root}assets/models`).sort()).toEqual([...used].sort());
  });

  it('maps CloudWatch namespaces to existing parts, first service winning a shared namespace', () => {
    const ids = new Set(AWS_PART_DEFINITIONS.map((p) => p.id));
    for (const [namespace, partId] of Object.entries(CLOUDWATCH_NAMESPACE_PARTS)) {
      expect(ids.has(partId), namespace).toBe(true);
    }
    expect(CLOUDWATCH_NAMESPACE_PARTS['AWS/EC2']).toBe('aws:ec2');
    expect(CLOUDWATCH_NAMESPACE_PARTS['AWS/ECS']).toBe('aws:ecs'); // Fargate shares it
    expect(CLOUDWATCH_NAMESPACE_PARTS['AWS/RDS']).toBe('aws:rds'); // Aurora shares it
    expect(Object.values(CLOUDWATCH_NAMESPACE_PARTS)).not.toContain('aws:iam'); // IAM has no namespace
    expect(Object.isFrozen(CLOUDWATCH_NAMESPACE_PARTS)).toBe(true);
  });
});

describe('provider-aws alignment', () => {
  it('every DEFAULT_PART_HINT names a part this package contributes', () => {
    const ids = new Set(AWS_PART_DEFINITIONS.map((p) => p.id));
    for (const [kind, partId] of Object.entries(DEFAULT_PART_HINTS)) {
      expect(ids.has(partId), `${kind} -> ${partId}`).toBe(true);
    }
  });
});

describe('icons', () => {
  const dir = `${root}assets/aws-icons`;

  it('ships exactly one icon per service and nothing else but the notice', () => {
    const files = readdirSync(dir);
    expect(files.filter((f) => f.endsWith('.svg')).sort()).toEqual(AWS_SERVICES.map((s) => `${s.slug}.svg`).sort());
    expect(files.filter((f) => !f.endsWith('.svg'))).toEqual(['NOTICE.txt']);
  });

  it.each(AWS_SERVICES.map((s) => [s.slug, s]))('%s icon is sanitised, within budget and in its category colour', (_slug, service) => {
    const path = `${dir}/${service.slug}.svg`;
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(svgProblems(text)).toEqual([]);
    expect(statSync(path).size).toBeLessThanOrEqual(MAX_ICON_BYTES);
    expect(tileColour(text)).toBe(AWS_CATEGORIES[service.category].color.toUpperCase());
    const canonical = sanitizeSvg(text);
    expect(svgProblems(canonical)).toEqual([]);
    expect(sanitizeSvg(canonical)).toBe(canonical);
    expect(tileColour(canonical)).toBe(tileColour(text));
  });

  it('keeps the total asset size within budget', () => {
    const size = (d) => readdirSync(d).reduce((sum, f) => sum + statSync(`${d}/${f}`).size, 0);
    expect(size(dir)).toBeLessThan(400 * 1024);
    expect(size(`${root}assets/models`)).toBeLessThan(2 * 1024 * 1024);
  });

  it('records the AWS source release and notice', () => {
    expect(iconSource.packageUrl).toMatch(/^https:\/\/d1\.awsstatic\.com\/.*Icon-package_\d{8}\./);
    expect(iconSource.packageSha256).toMatch(/^[\da-f]{64}$/);
    expect(iconSource.releasePage).toBe('https://aws.amazon.com/architecture/icons/');
    expect(manifest.assetLicenses[0].notice).toContain(iconSource.version);
    expect(readFileSync(`${dir}/NOTICE.txt`, 'utf8')).toContain(manifest.assetLicenses[0].notice);
  });
});

describe('aws package contract', () => {
  it('validates with the SDK, requires holodeck.cloud and matches the published entry', () => {
    expect(validateHolodeckPackageManifest(manifest)).toEqual([]);
    expect(manifest.id).toBe('holodeck.aws');
    expect(manifest.version).toBe(npmPackage.version);
    expect(manifest.requires).toEqual({ 'holodeck.cloud': '^0.1' });
    expect(packageRoles(AWS_PACKAGE_MANIFEST)).toEqual(['library']);
    expect(npmPackage.engines.node).toBe('>=26');
    expect(npmPackage.exports['./holodeck-package'].import).toBe(`./${manifest.entry}`);
    expect(entry).toBe(awsPackage);
    expect(entry.manifest).toEqual(manifest);
    expect(checkExtensionMatchesManifest(AWS_PACKAGE_MANIFEST, createAwsExtension(context))).toEqual([]);
  });

  it('carries the AWS trademark notice as an assetLicenses entry', () => {
    const [license] = manifest.assetLicenses;
    expect(manifest.assetLicenses).toHaveLength(1);
    expect(license).toMatchObject({ path: 'assets/aws-icons', license: 'LicenseRef-AWS-Architecture-Icons' });
    expect(license.notice).toMatch(/trademarks of Amazon\.com/);
    expect(license.notice).toMatch(/not covered by this package's MIT licence/);
    expect(license.notice).toMatch(/sponsorship or endorsement/);
  });

  it('provides one data-only part per service, accepted by E2, with the category accent', () => {
    const parts = createAwsParts(context.assetUrl);
    expect(parts.map((p) => p.id)).toEqual(AWS_SERVICES.map((s) => `aws:${s.slug}`));
    for (const [i, part] of parts.entries()) {
      const service = AWS_SERVICES[i];
      expect(isIsoPartDefinition(part), part.id).toBe(true);
      expect(part).not.toHaveProperty('component');
      expect(part.instanced).toBe(false);
      expect(part.floor).toBe(false);
      expect(part.footprint).toEqual({ w: 2, h: 2 });
      expect(part.category).toBe(AWS_CATEGORIES[service.category].label);
      expect(part.model).toBe(`${assetBase}models/${service.archetype}.glb`);
      expect(part.logo.url).toBe(`${assetBase}aws-icons/${service.slug}.svg`);
      expect(part.colors).toEqual({ accent: AWS_CATEGORIES[service.category].color });
      expect(JSON.parse(JSON.stringify(part))).toEqual(part);
    }
  });

  it.each([false, true])('installs after holodeck.cloud (engine first = %s) and uninstalls cleanly', async (engineFirst) => {
    const host = new HolodeckHost({ name: 'test' });
    if (engineFirst) host.registerEngine(engine);
    // Without the required package the install is refused.
    await expect(host.installPackage(manifest, entry, { manifestUrl })).rejects.toMatchObject({ code: 'MISSING_REQUIREMENT' });
    const cloud = await import('../../library-cloud/src/holodeck-package');
    await host.installPackage(cloudManifest, cloud.default, { manifestUrl: cloudManifestUrl });
    const report = await host.installPackage(manifest, entry, { manifestUrl });
    expect(report.unresolvedEngines).toEqual(engineFirst ? [] : ['holodeck.iso']);
    if (!engineFirst) host.registerEngine(engine);
    const awsParts = () => host.registry.list('holodeck.iso.part').filter((p) => p.id.startsWith('aws:'));
    expect(awsParts()).toHaveLength(AWS_SERVICES.length);
    // The cloud package cannot be removed while this one needs it.
    expect(() => host.uninstallPackage('holodeck.cloud')).toThrow(/still required/);
    expect(host.uninstallPackage(manifest.id).removed).toEqual([manifest.id]);
    expect(awsParts()).toEqual([]);
  });

  it('isolates nested part data between installations', () => {
    const a = createAwsExtension(context);
    const b = createAwsExtension(context);
    a.contributions['holodeck.iso.part'][0].colors.accent = '#ff0000';
    a.contributions['holodeck.iso.part'][0].logo.url = 'changed.svg';
    expect(b).toEqual(createAwsExtension(context));
    expect(AWS_PART_DEFINITIONS[0].logo.url).toBe('aws-icons/ec2.svg');
  });
});
