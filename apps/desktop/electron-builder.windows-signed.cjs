function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Windows release signing requires ${name}. See docs/DESKTOP.md.`);
  return value;
}

const endpoint = new URL(required('CATPILOT_SIGNING_ENDPOINT'));
if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.codesigning\.azure\.net$/.test(endpoint.hostname)
  || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
  throw new Error('CATPILOT_SIGNING_ENDPOINT must be an HTTPS regional codesigning.azure.net endpoint.');
}

module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: true,
  win: {
    azureSignOptions: {
      endpoint: endpoint.origin,
      codeSigningAccountName: required('CATPILOT_SIGNING_ACCOUNT'),
      certificateProfileName: required('CATPILOT_SIGNING_PROFILE'),
      publisherName: required('CATPILOT_SIGNING_PUBLISHER'),
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    },
  },
};
