/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { JsonObject, OADAClient } from '@oada/client';
import config from '../dist/config.js';
import type { Body } from '@oada/client/lib/client';
import { fromOadaType } from '../dist/conversions.js';
const SERVICE_PATH = config.get('service.path');
const pending = `/bookmarks/services/target/jobs/pending`;

export async function makeTargetJob(
  conn: OADAClient,
  jobId: string,
  bid: string
) {
  const flJob = await conn
    .get({
      path: jobId,
    })
    .then((r) => r.data as JsonObject);
  if (!flJob.trellisDoc)
    throw new Error('flJob did not have trellisDoc (yet?).');
  const { key, type }: { key: string; type: string } = flJob.trellisDoc as any;

  const bus = await conn
    .get({
      path: `${SERVICE_PATH}/businesses/${bid}`,
    })
    .then((r) => r.data as JsonObject);

  const meta = await conn
    .get({
      path: `/bookmarks/trellisfw/trading-partners/masterid-index/${bus.masterid}/shared/trellisfw/documents/${type}/${key}/_meta`,
    })
    .then((r) => r.data as any);

  const pdfs = Object.values(meta.vdoc!.pdf);
  const pdf = pdfs[0];

  console.log('document resource id', meta._id.replace(/\/_meta$/, ''));

  const data = {
    'trading-partner': bus.masterid,
    'type': 'transcription',
    'service': 'target',
    'config': {
      'type': 'pdf',
      pdf,
      'document': { _id: meta._id.replace(/\/_meta$/, '') },
      'docKey': key,
      'document-type': fromOadaType(type)!.name,
      'oada-doc-type': type,
    },
    '_type': `application/vnd.oada.job.1+json`,
  };

  const _id = await conn
    .post({
      path: `/resources`,
      contentType: 'application/vnd.oada.service.jobs.1+json',
      data: data as unknown as Body,
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));

  const jobkey = _id.replace(/^\/resources\//, '');
  await conn.put({
    path: `${pending}`,
    data: {
      [jobkey]: { _id, _rev: 0 },
    },
  });

  return _id;
}

export async function sendUpdate(conn: OADAClient, jobId: string, data: any) {
  await conn.post({
    path: `${jobId}/updates`,
    data,
  });
}
