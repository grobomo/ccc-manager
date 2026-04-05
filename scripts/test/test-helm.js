// Test: Helm chart structure and template validation
// Verifies chart files exist, values are valid, templates have required fields.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CHART_DIR = resolve(ROOT, 'helm', 'ccc-manager');
const TPL_DIR = resolve(CHART_DIR, 'templates');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}: ${err.message}`);
    failed++;
  }
}

// 1. Chart structure
console.log('1. Chart structure...');
test('Chart.yaml exists', () => assert(existsSync(resolve(CHART_DIR, 'Chart.yaml'))));
test('values.yaml exists', () => assert(existsSync(resolve(CHART_DIR, 'values.yaml'))));
test('values-rone.yaml exists', () => assert(existsSync(resolve(CHART_DIR, 'values-rone.yaml'))));
test('templates/ directory exists', () => assert(existsSync(TPL_DIR)));

const expectedTemplates = [
  '_helpers.tpl',
  'configmap.yaml',
  'deployment.yaml',
  'service.yaml',
  'pvc.yaml',
  'networkpolicy.yaml',
  'servicemonitor.yaml',
  'NOTES.txt',
];
for (const t of expectedTemplates) {
  test(`templates/${t} exists`, () => assert(existsSync(resolve(TPL_DIR, t))));
}

// 2. Chart.yaml content
console.log('2. Chart.yaml content...');
const chartYaml = readFileSync(resolve(CHART_DIR, 'Chart.yaml'), 'utf-8');
test('Chart has apiVersion: v2', () => assert(chartYaml.includes('apiVersion: v2')));
test('Chart has name: ccc-manager', () => assert(chartYaml.includes('name: ccc-manager')));
test('Chart has appVersion', () => assert(chartYaml.includes('appVersion:')));

// 3. values.yaml content
console.log('3. values.yaml defaults...');
const valuesYaml = readFileSync(resolve(CHART_DIR, 'values.yaml'), 'utf-8');
test('Has replicaCount', () => assert(valuesYaml.includes('replicaCount:')));
test('Has image.repository', () => assert(valuesYaml.includes('repository:')));
test('Has healthPort', () => assert(valuesYaml.includes('healthPort:')));
test('Has persistence section', () => assert(valuesYaml.includes('persistence:')));
test('Has networkPolicy section', () => assert(valuesYaml.includes('networkPolicy:')));
test('Has serviceMonitor section', () => assert(valuesYaml.includes('serviceMonitor:')));
test('Has securityContext', () => assert(valuesYaml.includes('securityContext:')));
test('Has projectConfig', () => assert(valuesYaml.includes('projectConfig:')));

// 4. Template syntax validation (check for common Helm patterns)
console.log('4. Template syntax...');
const deployment = readFileSync(resolve(TPL_DIR, 'deployment.yaml'), 'utf-8');
test('Deployment uses fullname helper', () => assert(deployment.includes('ccc-manager.fullname')));
test('Deployment has labels helper', () => assert(deployment.includes('ccc-manager.labels')));
test('Deployment has selectorLabels', () => assert(deployment.includes('ccc-manager.selectorLabels')));
test('Deployment has security context', () => assert(deployment.includes('.Values.securityContext')));
test('Deployment has resource limits', () => assert(deployment.includes('.Values.resources')));
test('Deployment has liveness probe', () => assert(deployment.includes('livenessProbe')));
test('Deployment has readiness probe', () => assert(deployment.includes('readinessProbe')));
test('Deployment has config checksum annotation', () => assert(deployment.includes('checksum/config')));
test('Deployment has healthPort reference', () => assert(deployment.includes('.Values.healthPort')));

const svc = readFileSync(resolve(TPL_DIR, 'service.yaml'), 'utf-8');
test('Service uses fullname', () => assert(svc.includes('ccc-manager.fullname')));
test('Service has healthPort', () => assert(svc.includes('.Values.healthPort')));

const pvc = readFileSync(resolve(TPL_DIR, 'pvc.yaml'), 'utf-8');
test('PVC is conditional on persistence.enabled', () => assert(pvc.includes('.Values.persistence.enabled')));
test('PVC has storage size', () => assert(pvc.includes('.Values.persistence.size')));

const netpol = readFileSync(resolve(TPL_DIR, 'networkpolicy.yaml'), 'utf-8');
test('NetworkPolicy is conditional', () => assert(netpol.includes('.Values.networkPolicy.enabled')));
test('NetworkPolicy allows DNS', () => assert(netpol.includes('53')));
test('NetworkPolicy allows HTTPS', () => assert(netpol.includes('443')));

const sm = readFileSync(resolve(TPL_DIR, 'servicemonitor.yaml'), 'utf-8');
test('ServiceMonitor is conditional', () => assert(sm.includes('.Values.serviceMonitor.enabled')));

// 5. Helpers
console.log('5. Helpers...');
const helpers = readFileSync(resolve(TPL_DIR, '_helpers.tpl'), 'utf-8');
test('Has name helper', () => assert(helpers.includes('ccc-manager.name')));
test('Has fullname helper', () => assert(helpers.includes('ccc-manager.fullname')));
test('Has labels helper', () => assert(helpers.includes('ccc-manager.labels')));
test('Has selectorLabels helper', () => assert(helpers.includes('ccc-manager.selectorLabels')));

// 6. RONE values overlay
console.log('6. RONE values overlay...');
const roneValues = readFileSync(resolve(CHART_DIR, 'values-rone.yaml'), 'utf-8');
test('RONE has rone-teams-poller name', () => assert(roneValues.includes('rone-teams-poller')));
test('RONE has bridge existingClaim', () => assert(roneValues.includes('existingClaim:')));
test('RONE has claude dispatcher', () => assert(roneValues.includes('type: claude')));
test('RONE has k8s worker', () => assert(roneValues.includes('type: k8s')));
test('RONE has serviceMonitor enabled', () => assert(roneValues.includes('enabled: true')));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
