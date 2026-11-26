import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const DRAFT_PATH = path.resolve(process.cwd(), 'DRAFT_firestore.rules');

function readRules(): string {
  if (fs.existsSync(RULES_PATH)) return fs.readFileSync(RULES_PATH, 'utf8');
  return fs.readFileSync(DRAFT_PATH, 'utf8');
}

test('Firestore rules enforce default-deny catch-all and rules_version 2', () => {
  const rules = readRules();
  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('Firestore rules enforce verified email ownership, path ID regex, and PII isolation on /users', () => {
  const rules = readRules();
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  assert.match(rules, /match \/users\/\{userId\}[\s\S]*?allow list:\s*if false;/);
});

test('Firestore rules enforce Master Gate parent existence and validation blueprints on every subcollection', () => {
  const rules = readRules();
  for (const sub of ['garments', 'combinations', 'savedOutfits', 'advisorMessages']) {
    assert.ok(rules.includes(`match /${sub}/`), `Missing match block for ${sub}`);
  }
  assert.match(rules, /function hasUserParent\(userId\)/);
  assert.match(rules, /function isValidUserProfile\(data\)/);
  assert.match(rules, /function isValidGarment\(data\)/);
  assert.match(rules, /function isValidOutfit\(data\)/);
  assert.match(rules, /function isValidAdvisorMessage\(data\)/);
});

test('Firestore rules enforce strict timestamps, action-based updates, immutable advisor messages, and bounded arrays', () => {
  const rules = readRules();
  assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rules, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
  assert.match(rules, /incoming\(\)\.ownerId == existing\(\)\.ownerId/);
  assert.match(rules, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(/);
  assert.match(rules, /isNumberListBounded\(data\.vector, 256\)/);
  assert.match(rules, /data\.attachedImages\.size\(\) <= 4/);
  assert.match(rules, /match \/advisorMessages\/\{messageId\}[\s\S]*?allow update:\s*if false;/);
});

test('Firestore rules enforce query-scoped list rules without get() or exists() calls', () => {
  const rules = readRules();
  const listBlocks = [...rules.matchAll(/allow list:\s*if\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(listBlocks.length >= 4, 'Expected list rules for user subcollections');
  for (const expr of listBlocks) {
    if (expr.trim() === 'false') continue;
    assert.ok(
      expr.includes('resource.data.ownerId == request.auth.uid'),
      `List rule must check resource.data.ownerId: ${expr}`
    );
    assert.ok(
      !expr.includes('get(') && !expr.includes('exists(') && !expr.includes('hasUserParent('),
      `List rule must not execute get()/exists(): ${expr}`
    );
  }
});
