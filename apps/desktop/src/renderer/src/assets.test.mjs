import assert from 'node:assert/strict';
import test from 'node:test';
import { assetPath, imageMime, imagePath, importedAssetReference } from './assets.ts';

test('only canonical relative workspace asset references resolve', () => {
  assert.equal(assetPath('catpilot-asset:assets/a-123.png'), 'assets/a-123.png');
  assert.equal(assetPath('catpilot-asset:a.pdf'), 'a.pdf');
  assert.equal(assetPath('catpilot-asset:legacy-source/folder%20name/image%23one.png'), 'legacy-source/folder name/image#one.png');
  for (const reference of [
    'https://example.com/image.png', 'file:///secret.png', 'data:image/png;base64,abc',
    'blob:https://example.com/id', 'catpilot-asset://another-workspace/a.png',
    'catpilot-asset:/etc/file', 'catpilot-asset:../file', 'catpilot-asset:a/../file',
    'catpilot-asset:a//file', 'catpilot-asset:a/./file', 'catpilot-asset:a%2f..%2fsecret',
    'catpilot-asset:a\\file', 'catpilot-asset:C:/file', 'catpilot-asset:a?workspaceId=other',
  ]) assert.equal(assetPath(reference), null, reference);
});

test('native filenames become portable encoded Markdown references without embedding workspace IDs', () => {
  const reference = importedAssetReference('catpilot-asset:attachments/id-image (100%).png');
  assert.equal(reference, 'catpilot-asset:attachments/id-image%20%28100%25%29.png');
  assert.equal(assetPath(reference), 'attachments/id-image (100%).png');
  assert.equal(importedAssetReference('catpilot-asset:../secret'), null);
});

test('active image formats cannot be rendered through trusted blob previews', () => {
  assert.equal(imageMime('image/png'), true);
  assert.equal(imageMime('image/jpeg'), true);
  assert.equal(imageMime('image/svg+xml'), false);
  assert.equal(imageMime('image/avif'), false);
  assert.equal(imageMime('text/html'), false);
  assert.equal(imagePath('legacy-source/photo.JPG'), true);
  assert.equal(imagePath('legacy-source/vector.svg'), false);
});
