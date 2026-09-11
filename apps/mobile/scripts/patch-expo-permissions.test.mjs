import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyExpoPermissionsPatch, patchExpoPermissions } from './patch-expo-permissions.mjs';

const source = `- (void)registerRequesters:(NSArray<id<EXPermissionsRequester>> *)newRequesters {
  for (id<EXPermissionsRequester> requester in newRequesters) {
    [_requesters setObject:requester forKey:[[requester class] permissionType]];
    [_requestersByClass setObject:requester forKey:[requester class]];
  }
}
- (id<EXPermissionsRequester>)getPermissionRequesterForType:(NSString *)type
{
  return _requesters[type];
}
- (id<EXPermissionsRequester>)getPermissionRequesterForClass:(Class)requesterClass
{
  return [_requestersByClass objectForKey:requesterClass];
}
`;

test('serializes registration and both lookup paths using the same lock, idempotently', () => {
  const result = patchExpoPermissions(source);
  assert.equal(result.match(/@synchronized \(self\)/g)?.length, 3);
  assert.equal(patchExpoPermissions(result), result);
  assert.throws(() => patchExpoPermissions(result + result), /duplicated/);
});

test('fails closed for empty, malformed, duplicated or changed upstream access', () => {
  for (const bad of ['', null, '{}', source + source, source.replace('return _requesters[type];', 'return nil;')]) {
    assert.throws(() => patchExpoPermissions(bad));
  }
});

for (const hoisted of [true, false]) {
  test(`validates the ${hoisted ? 'hoisted' : 'standalone'} installation and rejects missing input`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'clawket-permissions-'));
    const mobile = path.join(root, 'apps/mobile');
    const file = path.join(hoisted ? root : mobile, 'node_modules/expo-modules-core/ios/Legacy/Services/Permissions/EXPermissionsService.m');
    try {
      assert.throws(() => applyExpoPermissionsPatch(mobile), /missing/);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source);
      assert.equal(applyExpoPermissionsPatch(mobile), 1);
      assert.equal(await readFile(file, 'utf8'), patchExpoPermissions(source));
      await writeFile(file, 'invalid upstream revision');
      assert.throws(() => applyExpoPermissionsPatch(mobile), /reviewed access/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
