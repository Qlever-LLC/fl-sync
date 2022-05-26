import type {OADAClient, JsonObject} from '@oada/client';
import config from "../dist/config.js";
import type { Body } from '@oada/client/lib/client';
import { fromOadaType } from '../dist/conversions.js';
let SERVICE_PATH = config.get('service.path');
let pending = `/bookmarks/services/target/jobs/pending`;

export async function makeTargetJob(conn: OADAClient, jobId: string, bid: string) {

  let flJob = await conn.get({
    path: jobId
  }).then(r => r.data as JsonObject);
  if (!flJob.trellisDoc) throw new Error('flJob did not have trellisDoc (yet?).')
  let {key, type}: {key:string, type: string} = (flJob!.trellisDoc as any);

  let bus = await conn.get({
    path: `${SERVICE_PATH}/businesses/${bid}`,
  }).then(r => r.data as JsonObject);

  let meta = await conn.get({
    path: `/bookmarks/trellisfw/trading-partners/masterid-index/${bus.masterid}/shared/trellisfw/documents/${type}/${key}/_meta`,
  }).then(r => r.data as any);

  let pdfs = Object.values(meta!.vdoc!.pdf);
  let pdf = (pdfs)[0]

  console.log("document resource id", meta._id.replace(/\/_meta$/, ''))

  let data = {
    'trading-partner': bus.masterid,
    type: 'transcription',
    'service': 'target',
    'config': {
      type: 'pdf',
      pdf: pdf,
      document: {_id: meta._id.replace(/\/_meta$/, '')},
      docKey: key,
      "document-type": fromOadaType(type)!.name,
      "oada-doc-type": type,
    },
    _type: `application/vnd.oada.job.1+json`
  }

  let _id = await conn.post({
    path: `/resources`,
    contentType: 'application/vnd.oada.service.jobs.1+json',
    data: data as unknown as Body
  }).then(r => r.headers['content-location']!.replace(/^\/resources\//,''));

  const jobkey = _id.replace(/^\/resources\//, '');
  await conn.put({
    path: `${pending}`,
    data: {
      [jobkey]: {_id, _rev: 0}
    }
  });

  return _id;
}

export async function sendUpdate(conn: OADAClient, jobId: string, data: any) {
  await conn.post({
    path: `${jobId}/updates`,
    data,
  })
}
