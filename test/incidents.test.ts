//import config from '../dist/config.js';
import * as flInc from '../dist/flIncidentsCsv.js';
//import moment from 'moment';
// @ts-ignore
import test from 'ava';
/*
const FL_TOKEN = config.get('foodlogiq.token') || '';
const FL_DOMAIN = config.get('foodlogiq.domain') || '';
const SUPPLIER = config.get('foodlogiq.testSupplier.id');
const TOKEN = process.env.TOKEN || ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}
*/

test.before(async (t: any) => {
  t.timeout(60_000);
});

test('test csv stuff', async (t: any) => {
  t.timeout(200_000);

  let result = await flInc.ensureTable();
  console.log(result);
  t.truthy(result);
})

test.skip('test big initial load of csv data', async (t: any) => {
  t.timeout(200_000);
  const startTime = '2021-09-01';
  const endTime = '2022-09-13';
  await flInc.fetchIncidentsCsv({startTime, endTime})
})

test.skip('test short period of csv data', async (t: any) => {
  t.timeout(200_000);
  const startTime = '2022-09-01';
  const endTime = '2022-09-13';
  await flInc.fetchIncidentsCsv({startTime, endTime})
})
