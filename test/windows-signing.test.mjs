import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'apps', 'desktop', 'electron-builder.windows-signed.cjs'), 'utf8');
const metadata = {
  CATPILOT_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net/',
  CATPILOT_SIGNING_ACCOUNT: 'test-account',
  CATPILOT_SIGNING_PROFILE: 'test-profile',
  CATPILOT_SIGNING_PUBLISHER: 'CatPilot test publisher',
};
function loadConfig(env) {
  const module = { exports: {} };
  vm.runInNewContext(source, { process: { env }, module, URL });
  return module.exports;
}

test('signed releases require every explicit metadata value without unsigned fallback', () => {
  for (const name of Object.keys(metadata)) {
    assert.throws(() => loadConfig({ ...metadata, [name]: '  ' }), new RegExp(name));
  }
  const config = loadConfig(metadata);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.extends, './electron-builder.yml');
  assert.equal(config.win.azureSignOptions.endpoint, 'https://weu.codesigning.azure.net');
  assert.equal(config.win.azureSignOptions.publisherName, metadata.CATPILOT_SIGNING_PUBLISHER);
  assert.equal(config.win.azureSignOptions.fileDigest, 'SHA256');
  assert.equal(config.win.azureSignOptions.timestampDigest, 'SHA256');
  assert.equal(config.win.azureSignOptions.timestampRfc3161, 'http://timestamp.acs.microsoft.com');
});

test('signing metadata rejects non-service, insecure or credential-bearing endpoints', () => {
  for (const endpoint of [
    'http://weu.codesigning.azure.net', 'https://example.com', 'https://weu.codesigning.azure.net.example.com',
    'https://user:password@weu.codesigning.azure.net', 'https://weu.codesigning.azure.net:8443',
    'https://weu.codesigning.azure.net/path', 'https://weu.codesigning.azure.net?redirect=example.com',
  ]) {
    assert.throws(() => loadConfig({ ...metadata, CATPILOT_SIGNING_ENDPOINT: endpoint }), /HTTPS regional/);
  }
});

test('Windows release verification rejects unsigned, wrong-publisher and untimestamped output', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'catpilot-signing-test-'));
  try {
    await mkdir(path.join(temp, 'win-unpacked'));
    const { version } = JSON.parse(await readFile(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
    await writeFile(path.join(temp, 'win-unpacked', 'CatPilot.exe'), 'Unsigned fixture');
    await writeFile(path.join(temp, `CatPilot Setup ${version}.exe`), 'Unsigned fixture');
    const script = path.join(root, 'apps', 'desktop', 'scripts', 'verify-windows-signatures.ps1');
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const invoke = `& ${quote(script)} -ReleaseDirectory ${quote(temp)}`;
    function run(overrides = {}, mock = true) {
      const command = `
        $ErrorActionPreference = 'Stop'
        ${mock ? `
          function Get-AuthenticodeSignature {
            param([string]$LiteralPath)
            $certificate = [pscustomobject]@{}
            $certificate | Add-Member -MemberType ScriptMethod -Name GetNameInfo -Value { $env:CATPILOT_TEST_CERT_PUBLISHER }
            $timestamp = if ($env:CATPILOT_TEST_TIMESTAMP -eq 'yes') { [pscustomobject]@{} } else { $null }
            [pscustomobject]@{
              Status = $env:CATPILOT_TEST_SIGNATURE_STATUS
              SignerCertificate = $certificate
              TimeStamperCertificate = $timestamp
            }
          }
        ` : ''}
        ${invoke}
      `;
      return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          CATPILOT_SIGNING_PUBLISHER: metadata.CATPILOT_SIGNING_PUBLISHER,
          CATPILOT_TEST_SIGNATURE_STATUS: 'Valid',
          CATPILOT_TEST_CERT_PUBLISHER: metadata.CATPILOT_SIGNING_PUBLISHER,
          CATPILOT_TEST_TIMESTAMP: 'yes',
          ...overrides,
        },
      });
    }
    const unsigned = run({}, false);
    assert.notEqual(unsigned.status, 0, unsigned.error?.message);
    assert.match(unsigned.stderr, /Authenticode verification failed/);
    for (const [overrides, message] of [
      [{ CATPILOT_TEST_SIGNATURE_STATUS: 'NotSigned' }, /Authenticode verification failed/],
      [{ CATPILOT_TEST_CERT_PUBLISHER: 'Different publisher' }, /does not match/],
      [{ CATPILOT_TEST_TIMESTAMP: 'no' }, /requires a publisher certificate and timestamp/],
    ]) {
      const result = run(overrides);
      assert.notEqual(result.status, 0, result.error?.message);
      assert.match(result.stderr, message);
    }
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr || valid.error?.message);
    assert.equal(valid.stdout.match(/Verified trusted publisher signature and timestamp/g)?.length, 2);
    await rm(path.join(temp, `CatPilot Setup ${version}.exe`));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Expected signed release file is missing/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
