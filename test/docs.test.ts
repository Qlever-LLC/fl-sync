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

import config from "../dist/config.js";

import test from "ava";

import { setTimeout } from "node:timers/promises";

import moment from "moment";

import type { JsonObject, OADAClient } from "@oada/client";
import { connect } from "@oada/client";

import type { TreeKey } from "@oada/types/oada/tree/v1.js";
import { initialize as service } from "../dist/index.js";
import type { FlObject } from "../dist/types.js";
import { isObj as isObject } from "../dist/mirrorWatch.js";
import { tree } from "../dist/tree.js";
import { coi } from "./documents/coi.js";

// Import {makeTargetJob, sendUpdate} from './dummyTarget.js'
const FL_TOKEN = config.get("foodlogiq.token") || "";
const FL_DOMAIN = config.get("foodlogiq.domain") || "";
const SUPPLIER = config.get("foodlogiq.testSupplier.id");
const TOKEN = process.env.TOKEN ?? ""; // || config.get('trellis.token') || '';
const DOMAIN = config.get("trellis.domain") || "";
const SERVICE_NAME = config.get("service.name") as unknown as TreeKey;
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;

if (SERVICE_NAME && tree?.bookmarks?.services?.["fl-sync"]) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services["fl-sync"];
}

const INTERVAL_MS = config.get("foodlogiq.interval") * 1000;
// Const pending = `${SERVICE_PATH}/jobs/pending`
let oada: OADAClient;

test.before(async (t) => {
  t.timeout(60_000);
  oada = await connect({ domain: DOMAIN, token: TOKEN });
  await oada.put({
    path: `${SERVICE_PATH}/_meta/oada-poll/food-logiq-poll`,
    // Tree,
    data: { lastPoll: moment().subtract(1, "minutes").utc().format() },
  });
  // Blow away the existing jobs queue
  let jobKeys;
  try {
    const r = await oada.get({
      path: `${SERVICE_PATH}/jobs/pending`,
    });
    jobKeys = Object.keys(r.data ?? {}).filter((key) => !key.startsWith("_"));
  } catch (error: unknown) {
    // @ts-expect-error error type
    if (error.status !== 404) throw error;
    return [];
  }

  await Promise.all(
    jobKeys.map(async (jobKey) => {
      await oada.delete({
        path: `${SERVICE_PATH}/jobs/pending/${jobKey}`,
      });
    }),
  );

  // Blow away the existing coi docs created
  const keys = await oada
    .get({
      path: "/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois",
    })
    .then((r) =>
      Object.keys(r.data ?? {}).filter((key) => !key.startsWith("_")),
    )
    .catch((error) => {
      if (error.status !== 404) throw error;
      return [];
    });
  await Promise.all(
    keys.map(async (key) => {
      await oada.delete({
        path: `/bookmarks/trellisfw/trading-partners/masterid-index/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e/shared/trellisfw/documents/cois/${key}`,
      });
    }),
  );

  await service({
    polling: true,
    mirrorWatch: true,
    watchConfig: true,
  });
  return oada;
});

test.after(async () => {
  /*
  Let data = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`,
  }).then(r => r.data);
  // @ts-ignore
  let list = Object.keys(data).filter(k => k.charAt(0) !== '_')

  for (const i of list) {
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${i}`,
    })
  }

  let d = await oada.get({
    path: `${SERVICE_PATH}/businesses`,
  }).then(r => r.data);
  // @ts-ignore
  let l = Object.keys(d).filter(k => k.charAt(0) !== '_')
  l = l.filter(k => k !== '61c22e047953d4000ee0363f')

  for (const i of l) {
    await oada.delete({
      path: `${SERVICE_PATH}/businesses/${i}`,
    })
  }
 */
});

test.skip("Should fail and warn suppliers when multiple PDFs are attached on COI documents.", async (t) => {
  t.timeout(200_000);
  const data = coi;
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "multi-files-attached",
  );
  t.assert(jobKeys?.[jobKey!]);
  t.is(Object.keys(jobKeys ?? {}).length, keyCount + 1);
});

// TODO: Find an example of this and get the flId
test.skip("Should allow suppliers to upload multiple files attached on some doc types.", async (t) => {
  t.timeout(200_000);
  const data = await getFlDocument("");
  // TODO: This needs to be addressed when I get to it; rerunFlDoc is for failures
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "multi-files-attached",
  );
  t.assert(jobKeys?.[jobKey!]);
  t.is(Object.keys(jobKeys ?? {}).length, keyCount + 1);
});

test.skip("Should fail on Target fail due to multiple COIs in one pdf", async (t) => {
  t.timeout(200_000);
  const _id = "resources/205t2wh2G1a9UzEtxaPh0cDANr1";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-multiple-docs-combined",
  );
  t.assert(jobKeys?.[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

// Keep this one skipped until I can make attachments "bad"
// TODO: Find an example of this
test.skip("Should fail when attachments cannot be retrieved.", async (t) => {
  t.timeout(200_000);
  const data = coi;
  data.attachments = [data.attachments[0]!];
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "bad-fl-attachments",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

// TODO: The old examples of this no longer throw that particular error.
// Target may have fixed the issue and may no longer throw that error.
test.skip("Should fail on Target validation failure (COI)", async (t) => {
  t.timeout(200_000);
  const _id = "resources/20xekuS2XiDWIQJBJfqau7tHTxF";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-validation",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

// TODO: Determine whether certain validation pieces regarding COI holder field are checked;
test.skip("Should fail on Target validation failure (COI) - specific holder checks???", async (t) => {
  t.timeout(200_000);
  const _id = "resources/205t2sVsqFaMSZTcQLb5oTI2yFl";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-validation",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

test.skip("Should fail on Target fail on unrecognized format", async (t) => {
  t.timeout(200_000);
  const _id = "resources/205z6XnG6iPcyw04yYLMSPkRSUr";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-unrecognized",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

// This now gets recognized as a nutrition information document
test.skip("Should fail on Target failure to identify doc", async (t) => {
  t.timeout(200_000);
  const _id = "resources/26ZgYWfzAvX87PR8Y9JKXium7mm";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-unrecognized",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

// File is not a Textual PDF,requires OCR to be processed
// These are now hanging. Inquire...
test.skip("Should fail on Target failure due to not text pdf, needs OCR", async (t) => {
  t.timeout(200_000);
  const _id = "resources/206fbmvoqSwsgeclcHpTceT10kU";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "target-unrecognized",
  );
  t.assert(jobKeys?.[jobKey!]);
  t.is(Object.keys(jobKeys ?? {}).length, keyCount + 1);
});

test("Should approve a valid COI document.", async (t) => {
  t.timeout(300_000);
  const data = coi;
  data.attachments.pop();
  const { jobKey } = await postAndPause(data, oada);
  await setTimeout(100_000);
  t.log(
    "CONTINUING",
    `${SERVICE_PATH}/jobs/success/day-index/${moment().format(
      "YYYY-MM-DD",
    )}/${jobKey}`,
  );

  const job = await oada
    .get({
      path: `${SERVICE_PATH}/jobs/success/day-index/${moment().format(
        "YYYY-MM-DD",
      )}/${jobKey}`,
    })
    .catch((error) => {
      t.log(error);
      return { status: 0 };
    });

  t.is(job.status, 200);
});

test.skip("Should reject a COI with expirations that do not match the user-entered date.", async (t) => {
  t.timeout(300_000);
  const _id = "resources/29gNgxGtGRIQhOW087Kf7yfbWnC";
  const data = await getFlDocument(_id);
  const { flId, jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "document-validation",
  );
  t.assert(jobKeys?.[jobKey!]);
  t.is(Object.keys(jobKeys ?? {}).length, keyCount + 1);

  const { data: document } = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
  });
  if (!isObject(document)) throw new Error("bad doc");
  const flDocument = document["food-logiq-mirror"] as unknown as FlObject;
  t.is(flDocument.shareSource.approvalInfo.status, "rejected");
});

test.skip("Should reject a COI with insufficient policy coverage.", async (t) => {
  t.timeout(300_000);
  const _id = "resources/29gLjzngLbcCVUMbBf3PjO6UMg0";
  const data = await getFlDocument(_id);
  const { jobKeys, jobKey, keyCount } = await rerunFlDocument(
    data,
    "associated-assessment-rejected",
  );
  t.assert(jobKeys[jobKey!]);
  t.is(Object.keys(jobKeys).length, keyCount + 1);
});

test.skip("Shouldn't queue a job if already approved by non - trellis user.", async (t) => {
  const flId = "618ab8c04f52f0000eae7220";
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${flId}`,
    {
      method: "get",
      headers: {
        Authorization: `${FL_TOKEN}`,
      },
    },
  );
  t.log(response);
  const data = (await response.json()) as any;

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  t.log("putting", `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: { "food-logiq-mirror": data },
    tree,
  });
  await setTimeout(15_000);

  const { data: result } = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`,
  });
  // @ts-expect-error
  t.is(result?.status, 200);

  //  T.assert(jobKeys[jobKey])
  //  t.is(Object.keys(jobKeys).length, keyCount+1);
});

test.skip("Shouldn't queue a job if already rejected by non-trellis user.", async (t) => {
  const flId = "618ab8c04f52f0000eae7220";
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/5acf7c2cfd7fa00001ce518d/documents/${flId}`,
    {
      method: "get",
      headers: {
        Authorization: `${FL_TOKEN}`,
      },
    },
  );
  t.log(response);
  const data = (await response.json()) as any;

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  t.log("putting", `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: { "food-logiq-mirror": data },
    tree,
  });
  await setTimeout(15_000);

  const { data: result } = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`,
  });
  // @ts-expect-error
  t.is(result?.status, 200);
  // T.assert(jobKeys[jobKey])
  // t.is(Object.keys(jobKeys).length, keyCount+1);
});

/*
Test('Should handle an fl-sync job that is queued on startup.', async () => {
  //Post a dummy job to the job queue

  // Mock the mirroring of the doc
  data.shareSource.sourceBusiness._id = SUPPLIER;
  console.log('putting', `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}`,
    data: {'food-logiq-mirror': data},
    tree
  })
  await setTimeout(jobwaittime)

  let result = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta`
  }).then(r => r.data)

  //@ts-ignore
  expect(result?.services?.['fl-sync']?.jobs).to.equal(undefined);
});
 */

// I think this just occurs when the PDF is not a pdf because fl-sync didn't link it properly to the config
// test.skip(`Should fail on Target fail due to corrupted pdf`, async (t) => {
// });

async function postDocument(data: any, oada: OADAClient) {
  const { data: result } = await oada
    .get({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`,
    })
    .catch((error) => {
      if (error.status === 404) {
        return { data: undefined };
      }

      throw error as Error;
    });
  if (typeof result !== "object") throw new TypeError("Bad data");
  const bef = new Set(Object.keys(result!).filter((k) => !k.startsWith("_")));
  await fetch(`${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents`, {
    method: "post",
    body: JSON.stringify(data),
    headers: {
      Authorization: `${FL_TOKEN}`,
    },
  });
  await setTimeout(INTERVAL_MS + 5000);
  const { data: resp } = await oada.get({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents`,
  });
  if (typeof resp !== "object") throw new TypeError("Bad data");
  // @ts-expect-error
  const aft = Object.keys(resp).filter((k) => !k.startsWith("_"));
  let flId = aft.filter((k) => !bef.has(k));
  // @ts-expect-error
  flId = flId[0];

  return flId;
}

async function getFlDocument(_id: string) {
  const { data: resp } = await oada.get({
    path: `/${_id}`,
  });
  if (
    typeof resp !== "object" ||
    resp instanceof Uint8Array ||
    Array.isArray(resp) ||
    !resp?.["food-logiq-mirror"]
  ) {
    throw new Error("food-logiq-mirror");
  }

  return trellisMirrorToFlInput(resp?.["food-logiq-mirror"]) as unknown;
}

async function postAndPause(data: unknown, oada: OADAClient) {
  const flId = await postDocument(data, oada);
  await setTimeout(15_000);

  const jobId = await oada
    .get({
      path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${flId}/_meta/services/fl-sync/jobs`,
    })
    .then((r: any) => {
      if (r && typeof r.data === "object") {
        return Object.keys(r.data)[0];
      }

      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined;
    });
  const jobKey = jobId?.replace(/^resources\//, "");
  if (jobId === undefined) throw new Error("no job id");

  return { jobKey, jobId, flId };
}

async function rerunFlDocument(data: unknown, failType: string) {
  const jobsResultPath = `${SERVICE_PATH}/jobs/failure/${failType}/day-index/${moment().format(
    "YYYY-MM-DD",
  )}`;

  const keyCount = await oada
    .get({
      path: jobsResultPath,
    })
    .then((r) => Object.keys(r.data as JsonObject).length)
    .catch((error) => {
      if (error.status === 404) {
        return 4; // Number of internal _-prefixed keys of an empty resource
      }

      throw error as Error;
    });

  const { flId, jobId, jobKey } = await postAndPause(data, oada);
  await setTimeout(40_000);

  const { data: jobKeys } = (await oada.get({
    path: jobsResultPath,
  })) as { data: Record<string, unknown> };

  return { jobKeys, jobKey, flId, jobId, keyCount };
}

async function trellisMirrorToFlInput(data: any) {
  const newData = coi as unknown as FlBody;

  newData.shareRecipients = [data.shareSource];
  newData.attachments = data.attachments;

  return newData;
}

interface FlBody extends FlObject {
  products: unknown[];
  locations: unknown[];
  attachments: Record<string, unknown>;
  shareRecipients: [
    {
      type: Record<string, unknown>;
      community: Record<string, unknown>;
      shareSpecificAttributes: Record<string, unknown>;
    },
  ];
}

/*
Interface TrellisFlMirror extends FlObject {
  attachments: {};
  community: {};
  shareSource: {
    community: {};
  };
}
*/
