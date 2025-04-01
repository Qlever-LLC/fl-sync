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

/* eslint-disable unicorn/prevent-abbreviations, unicorn/no-null, sonarjs/no-duplicate-string */

import test from "ava";

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import FormData from "form-data";

import type { JsonObject, OADAClient } from "@oada/client";
import { connect } from "@oada/client";
import { doJob } from "@oada/client/jobs";
import { AssumeState, ChangeType, ListWatch } from "@oada/list-lib";

import type { TreeKey } from "@oada/types/oada/tree/v1.js";
import config from "../dist/config.js";
import { initialize as service } from "../dist/index.js";
import { tree } from "../dist/tree.js";
import mirrorTree from "../dist/tree.mirrorWatch.js";

// Import {makeTargetJob, sendUpdate} from './dummyTarget.js'
const FL_TOKEN = config.get("foodlogiq.token") || "";
const FL_DOMAIN = config.get("foodlogiq.domain") || "";
const SUPPLIER = config.get("foodlogiq.testSupplier.id");
const CO_ID = config.get("foodlogiq.community.owner.id");
const TOKEN = process.env.TOKEN ?? ""; // || config.get('trellis.token') || '';
const DOMAIN = config.get("trellis.domain") || "";
// Const SERVICE_NAME = `test-${config.get('service.name') as unknown as TreeKey}`;
const SERVICE_NAME = config.get("service.name") as unknown as TreeKey;
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;

if (SERVICE_NAME && tree?.bookmarks?.services?.["fl-sync"]) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services["fl-sync"];
}

let oada: OADAClient;
// Const INTERVAL_MS = config.get('foodlogiq.interval') * 1000;
/* const allPdfs = [
  'BDKFoods-COI-2099.pdf',
  'COI-2099-ReducedCoverage.pdf',
  'COI-Bad_Holder.pdf',
  'COI-BadWorkersComp.pdf',
  'COI-Expired.pdf',
  'COI-MultipleCOIs_OnePDF.pdf',
  'COI-MultipleInsurers.pdf',
  'COI-NonText.pdf',
  'COI-OtherWorkersCompEmployers.pdf',
  'COI-With_Umbrella.pdf',
  'COI-WorkersCompEmployers.pdf',
  'GFSICert.pdf',
];
*/
const supplierIdToCommunityId = new Map<string, string>();
const docIdToJobs = new Map<
  string,
  Record<
    string,
    {
      value: {
        [j: string]: any;
        _id: string;
      };
      order: number;
    }
  >
>();

test.before(async () => {
  oada = await connect({ domain: DOMAIN, token: TOKEN });
  /* Await oada.put({
    path: `${SERVICE_PATH}/_meta/oada-poll/food-logiq-poll`,
    data: { lastPoll: moment().subtract(1, 'minutes').utc().format() },
  });
  */
  await oada.delete({
    path: `${SERVICE_PATH}/jobs`,
  });

  await oada.put({
    path: `${SERVICE_PATH}`,
    data: {
      "autoapprove-assessments": true,
    },
  });

  await service({
    polling: true,
    incidents: false,
    watchConfig: true,
    mirrorWatch: true,
  });
  await setTimeout(3000);

  // Watch the documents and mark down the ids as they come in.
  const docsWatch = new ListWatch({
    conn: oada,
    itemsPath: "$.*.documents.*",
    name: "document-mirrored",
    path: `${SERVICE_PATH}/businesses`,
    resume: true,
    tree: mirrorTree,
    onNewList: AssumeState.Handled,
  });
  docsWatch.on(ChangeType.ItemChanged, async ({ change }) => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const ch = await change;
    // @ts-expect-error
    if (ch.body?.["food-logiq-mirror"]?.shareSource?.originalId) {
      supplierIdToCommunityId.set(
        // @ts-expect-error
        ch.body["food-logiq-mirror"].shareSource.originalId,
        // @ts-expect-error
        ch.body["food-logiq-mirror"]._id,
      );
    }
  });

  const jobsWatch = new ListWatch({
    conn: oada,
    name: "jobs-testing-watch",
    path: `${SERVICE_PATH}/jobs/pending`,
    resume: true,
    tree,
    onNewList: AssumeState.Handled,
  });
  jobsWatch.on(ChangeType.ItemChanged, async ({ item }) => {
    const it = (await item) as {
      [k: string]: any;
      _id: string;
      config: {
        [j: string]: any;
        key: string;
      };
    };
    if (it?.config?.key) {
      const obj = docIdToJobs.get(it?.config?.key) ?? {};
      obj[it._id] = {
        value: it,
        order: obj[it._id]?.order ?? Object.keys(obj).length,
      };
      docIdToJobs.set(it?.config?.key, obj);
    }
  });
});
test.after(async () => {
  await oada.delete({
    path: `${SERVICE_PATH}/jobs`,
  });
});

test.beforeEach(() => {
  supplierIdToCommunityId.clear();
  docIdToJobs.clear();
});

test.skip("Should be able to create a job without mirrorwatch", async (t) => {
  t.timeout(380_000);
  const bid = "61f95cd2df6175000f371494";
  await oada.put({
    path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${doc["food-logiq-mirror"]._id}`,
    data: doc,
    tree,
  });
  const response = (await oada.get({
    path: `/bookmarks/services/fl-sync/businesses/${bid}/documents/${doc["food-logiq-mirror"]._id}`,
  })) as unknown as { data: JsonObject };

  const { result } = await doJob(oada, {
    service: SERVICE_NAME,
    type: "business-lookup",
    config: {
      "fl-business": bus["food-logiq-mirror"],
    },
  });

  const item = response.data["food-logiq-mirror"] as unknown as any;

  const jobConf = {
    status: "Awaiting Approval",
    "fl-sync-type": "document",
    type: item.shareSource.type.name,
    key: doc["food-logiq-mirror"]._id,
    date: item.versionInfo.createdAt,
    bid,
    _rev: response.data._rev as number,
    // @ts-expect-error
    masterid: result?.entry?.masterid,
    mirrorid: response.data._id as string,
    bname: item.shareSource.sourceBusiness.name,
    name: item.name,
    link: `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${item._id}`,
  };
  const docJob = await doJob(oada, {
    type: "document-mirrored",
    service: SERVICE_NAME,
    config: jobConf,
    "foodlogiq-result-status": jobConf.status,
  });
  await setTimeout(5000);
  t.truthy(docJob);
});

test("End to end basic COI approval", async (t) => {
  t.timeout(150_000);
  const testDoc = { ...doc["food-logiq-mirror"] } as {
    [k: string]: any;
    _id?: string;
  };
  delete testDoc._id;
  const docResponse = await postDocument(baseDoc, "BDKFoods-COI-2099.pdf");

  // Somehow get the associated community document??
  // Somehow get the associated job??
  await setTimeout(120_000);
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents/${docResponse._id}`,
    {
      method: "get",
      headers: {
        Authorization: FL_TOKEN,
      },
    },
  );
  const data = (await response.json()) as any;

  t.is(data.shareRecipients[0].approvalInfo.status, "Approved");
});

test("End to end expired COI should be rejected", async (t) => {
  t.timeout(150_000);
  const testDoc = { ...doc["food-logiq-mirror"] } as {
    [k: string]: any;
    _id?: string;
  };
  delete testDoc._id;
  const docResponse = await postDocument(baseDoc, "COI-Expired.pdf");

  // Somehow get the associated community document??
  // Somehow get the associated job??
  await setTimeout(120_000);
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents/${docResponse._id}`,
    {
      method: "get",
      headers: {
        Authorization: FL_TOKEN,
      },
    },
  );
  const data = (await response.json()) as any;

  t.is(data.shareRecipients[0].approvalInfo.status, "Rejected");
});

test("End to end multiple COIs in one PDF should be left alone", async (t) => {
  t.timeout(150_000);
  const testDoc = { ...doc["food-logiq-mirror"] } as {
    [k: string]: any;
    _id?: string;
  };
  delete testDoc._id;
  const docResponse = await postDocument(
    baseDoc,
    "COI-MultipleCOIs_OnePDF.pdf",
  );

  // Somehow get the associated community document??
  // Somehow get the associated job??
  await setTimeout(120_000);
  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documents/${docResponse._id}`,
    {
      method: "get",
      headers: {
        Authorization: FL_TOKEN,
      },
    },
  );
  const data = (await response.json()) as any;

  t.is(data.shareRecipients[0].approvalInfo.status, "Awaiting Approval");
});

test.skip(`End to end - documents approved by users should get moved through to the trading-partners' bookmarks`, async (t) => {
  t.timeout(450_000);
  const testDoc = { ...gfsicert } as {
    [k: string]: any;
    _id?: string;
  };
  delete testDoc._id;
  const docResponse = await postDocument(testDoc, "GFSICert.pdf");

  // Wait a few seconds
  await setTimeout(20_000);

  // Manually pretend someone approved the doc
  const shareDocId = supplierIdToCommunityId.get(docResponse._id);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${shareDocId}`,
    data: {
      "food-logiq-mirror": {
        shareSource: {
          approvalInfo: {
            status: "Approved",
            setAt: "2023-06-06T16:29:16.491Z",
            setBy: {
              firstName: "bob",
              lastName: "test",
              _id: "abc123test",
            },
          },
        },
      },
    },
  });
  await setTimeout(150_000);
  t.is(Object.keys(docIdToJobs.get(shareDocId!) ?? {}).length, 2);
  const job = Object.values(docIdToJobs.get(shareDocId!) ?? {}).find(
    ({ order }) => order === 1,
  );
  t.is(job?.value?.status, "success");
});

test.skip(`Should correctly handle a doc that gets approved "accidentally" then rejected in quick succession by a SF user`, async (t) => {
  t.timeout(450_000);
  const testDoc = { ...gfsicert } as {
    [k: string]: any;
    _id?: string;
  };
  delete testDoc._id;
  const docResponse = await postDocument(testDoc, "GFSICert.pdf");

  // Wait a few seconds
  await setTimeout(10_000);
  // Synthetic doc approval by an outsider
  const shareDocId = supplierIdToCommunityId.get(docResponse._id);
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${shareDocId}`,
    data: {
      "food-logiq-mirror": {
        shareSource: {
          approvalInfo: {
            status: "Approved",
            setAt: "2023-06-06T16:29:16.491Z",
            setBy: {
              firstName: "bob",
              lastName: "test",
              _id: "abc123test",
            },
          },
        },
      },
    },
  });
  await setTimeout(10_000);
  // Synthetic doc rejection by an outsider
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${SUPPLIER}/documents/${shareDocId}`,
    data: {
      "food-logiq-mirror": {
        shareSource: {
          approvalInfo: {
            status: "Rejected",
            setAt: "2023-06-06T16:29:19.491Z",
            setBy: {
              firstName: "bob",
              lastName: "test",
              _id: "abc123test",
            },
          },
        },
      },
    },
  });
  await setTimeout(150_000);

  // The correct outcome: The rejection update should not result in a new job. However, any
  // jobs created along the way (one for 'Awaiting-Approval' and one for 'Approved') should be
  // cancelled.
  t.is(Object.keys(docIdToJobs.get(shareDocId!) ?? {}).length, 2);
  const awaitingApprovalJob = Object.values(
    docIdToJobs.get(shareDocId!) ?? {},
  ).find(({ order }) => order === 0);
  const approvedJob = Object.values(docIdToJobs.get(shareDocId!) ?? {}).find(
    ({ order }) => order === 1,
  );
  t.truthy(
    awaitingApprovalJob?.value?.result?.message?.includes("interrupted"),
  );
  t.truthy(approvedJob?.value?.result?.message?.includes("interrupted"));
});

test.skip(`Should generate report items for successful jobs`, (t) => {
  t.timeout(300_000);
});

const doc = {
  "food-logiq-mirror": {
    _id: "647f5edcfb73a5000f1f48fd",
    business: {
      _id: "5acf7c2cfd7fa00001ce518d",
      name: "Smithfield Foods CONNECT",
      heroURL: "",
      iconURL:
        "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
      address: {
        addressLineOne: "401 North Church Street",
        addressLineTwo: "",
        addressLineThree: "",
        city: "Smithfield",
        region: "VA",
        country: "US",
        postalCode: "23430",
        latLng: {
          latitude: 36.990_505_2,
          longitude: -76.631_072_699_999_99,
        },
      },
      website: "http://www.smithfieldfoods.com/",
      email: "cpantaleo@smithfield.com",
      phone: "(757) 365-3529",
    },
    name: "test",
    originalName: "test",
    attachments: [
      {
        S3Name: "647f5ec1fb73a5000f1f48fb",
        fileName: "BDKFoods-COI-2023.pdf",
        BucketName: "fcmdev",
        updatedAt: "0001-01-01T00:00:00Z",
      },
    ],
    locations: [],
    products: [],
    expirationDate: "2023-10-30T12:00:00Z",
    isArchived: false,
    isInitialShare: true,
    createdOnBehalf: false,
    shareRecipients: [],
    shareSource: {
      shareSpecificAttributes: {},
      type: {
        _id: "60653e5e18706f0011074ec8",
        name: "Certificate of Insurance",
        category: "Legal",
      },
      approvalInfo: {
        status: "Awaiting Approval",
        setAt: "2023-06-06T16:29:16.491Z",
        setBy: null,
      },
      complianceInfo: null,
      hasCorrectiveActions: false,
      incidentContacts: [],
      community: {
        _id: "5fff03e0458562000f4586e9",
        name: "Smithfield Foods",
        iconURL:
          "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
        replyToEmail: "cpantaleo@smithfield.com",
      },
      originalId: "647f5edcfb73a5000f1f48fc",
      sourceBusiness: {
        _id: "61f95cd2df6175000f371494",
        name: "TrellisTestSupplier",
        heroURL: "",
        iconURL: "",
        address: {
          addressLineOne: "",
          addressLineTwo: "",
          addressLineThree: "",
          city: "",
          region: "",
          country: "US",
          postalCode: "",
          latLng: {
            latitude: 0,
            longitude: 0,
            warnings: ["A street address is required to geocode your address."],
          },
        },
        website: "",
        email: "dev_3pty@centricity.us",
        phone: "9999999999",
      },
      membershipId: "647f5e6cfb73a5000f1f48ed",
      draftVersionId: null,
      isDeleted: false,
      deleteRejected: false,
      liveVersion: false,
    },
    versionInfo: {
      isCurrentVersion: true,
      currentVersionId: "647f5edcfb73a5000f1f48fd",
      createdAt: "2023-06-06T16:29:16.491Z",
      createdBy: {
        _id: "61f95cd2df6175000f371495",
        firstName: "Test",
        lastName: "Supplier",
      },
    },
    tags: null,
    links: null,
    contentType: "document",
    auditAttributes: null,
    ExpirationEmailSentAt: null,
    archivedInCommunity: {},
    history: {
      "5fff03e0458562000f4586e9": [
        {
          changedBy: {
            _id: "61f95cd2df6175000f371495",
            firstName: "Test",
            lastName: "Supplier",
          },
          changedAt: "2023-06-06T16:29:16.491Z",
          fromName: "",
          toName: "",
          fromSupplierName: "",
          toSupplierName: "",
          comment: "",
          action: "shared",
          versionId: "647f5edcfb73a5000f1f48fe",
          additionalInfo: {},
          visibleForSupplier: false,
        },
      ],
    },
    comments: {
      "5fff03e0458562000f4586e9": null,
    },
  },
};

const baseDoc = {
  business: {
    _id: "61f95cd2df6175000f371494",
    name: "TrellisTestSupplier",
    heroURL: "",
    iconURL: "",
    address: {
      addressLineOne: "",
      addressLineTwo: "",
      addressLineThree: "",
      city: "",
      region: "",
      country: "US",
      postalCode: "",
      latLng: {
        latitude: 0,
        longitude: 0,
        warnings: ["A street address is required to geocode your address."],
      },
    },
    website: "",
    email: "dev_3pty@centricity.us",
    phone: "9999999999",
  },
  name: "test",
  originalName: "test",
  locations: [],
  products: [],
  expirationDate: "2099-10-30T12:00:00Z",
  isInitialShare: true,
  shareRecipients: [
    {
      shareSpecificAttributes: {
        effectiveDate: "2022-11-01T16:00:00.000Z",
      },
      type: {
        _id: "60653e5e18706f0011074ec8",
        name: "Certificate of Insurance",
        category: "Legal",
      },
      community: {
        _id: "5fff03e0458562000f4586e9",
        name: "Smithfield Foods",
        iconURL:
          "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
        replyToEmail: "cpantaleo@smithfield.com",
      },
      missingAttributes: false,
    },
  ],
  contentType: "document",
};

const bus = {
  "food-logiq-mirror": {
    _id: "61f95cd3719715000e2de488",
    auditors: null,
    business: {
      _id: "61f95cd2df6175000f371494",
      address: {
        addressLineOne: "",
        addressLineThree: "",
        addressLineTwo: "",
        city: "",
        "country/_meta/_changes/30230": "US",
        latLng: {
          latitude: 0,
          longitude: 0,
          warnings: ["A street address is required to geocode your address."],
        },
        postalCode: "",
        region: "",
      },
      email: "dev_3pty@centricity.us",
      heroURL: "",
      iconURL: "",
      name: "TrellisTestSupplier",
      phone: "9999999999",
      website: "",
    },
    buyers: [
      {
        _id: "5b73178405b3760001f40f71",
        email: "cpantaleo@smithfield.com",
        firstName: "Christopher",
        lastName: "Pantaleo",
        phone: "+17573653529",
        phoneExt: "",
        mobile: "+17578101794",
      },
    ],
    community: {
      _id: "5fff03e0458562000f4586e9",
      iconURL:
        "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
      name: "Smithfield Foods",
      replyToEmail: "cpantaleo@smithfield.com",
    },
    createdAt: "2022-02-01T16:16:19.634Z",
    eventSubmissionStats: null,
    expirationDate: null,
    expiredRecently: false,
    expiredSoon: false,
    expires: false,
    hasExpiredEntities: false,
    hasExpiringEntities: false,
    internalId: "",
    locationGroup: {
      _id: "604c0d48c57289000ef55861",
      name: "Pork",
    },
    overallRating: 0,
    productGroup: {
      _id: "604132678b2178000ed4ffe1",
      name: "Protein",
    },
    ratings: {},
    status: "Invitation Accepted",
    statusCategory: "onboarding",
    statusSetAt: "0001-01-01T00:00:00Z",
    statusSetBy: "",
    todoCount: 0,
    traceabilityOptions: null,
    updatedAt: "0001-01-01T00:00:00Z",
  },
};

async function postDocument(document: any, filename: string) {
  const file = await fs.readFile(`./test/pdfs/${filename}`, {
    encoding: "utf8",
  });
  const res = await fetch(`${FL_DOMAIN}/attachment`, {
    method: "post",
    body: JSON.stringify({
      ContentType: "application/pdf",
      FileName: filename,
    }),
    headers: {
      Authorization: FL_TOKEN,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as any;

  const fd = new FormData();
  const aDoc = {
    ...document,
    name: filename,
    attachments: [data.attachment],
  };
  fd.append("document", JSON.stringify(aDoc));
  fd.append("attachments", createReadStream(`./test/pdfs/${filename}`));

  const response = await fetch(
    `${FL_DOMAIN}/v2/businesses/${SUPPLIER}/documentsWithAttachments`,
    {
      method: "post",
      body: JSON.stringify(fd),
      headers: {
        Authorization: `${FL_TOKEN}`,
        "Content-Type": "multipart/form-data",
      },
    },
  );

  return response.json() as any;
}

const gfsicert = {
  business: {
    _id: "61f95cd2df6175000f371494",
    name: "TrellisTestSupplier",
    heroURL: "",
    iconURL: "",
    address: {
      addressLineOne: "",
      addressLineTwo: "",
      addressLineThree: "",
      city: "",
      region: "",
      country: "US",
      postalCode: "",
      latLng: {
        latitude: 0,
        longitude: 0,
        warnings: ["A street address is required to geocode your address."],
      },
    },
    website: "",
    email: "dev_3pty@centricity.us",
    phone: "9999999999",
  },
  name: "GFSICert",
  attachments: [
    {
      S3Name: "64921033f17905000fed013c",
      fileName: "GFSICert exp. 12.04.2023.pdf",
      BucketName: "fcmdev",
      updatedAt: "0001-01-01T00:00:00Z",
    },
  ],
  locations: [],
  products: [],
  expirationDate: "2023-10-30T12:00:00Z",
  isArchived: false,
  isInitialShare: false,
  createdOnBehalf: false,
  shareRecipients: [
    {
      shareSpecificAttributes: {
        gradeScore: "A+",
      },
      type: {
        _id: "605a56162200de000ecd1a89",
        name: "GFSI Certificate",
        category: "Food Safety",
      },
      approvalInfo: {
        status: "Awaiting Approval",
        setAt: "2023-06-20T20:47:23.322375459Z",
        setBy: null,
      },
      complianceInfo: null,
      hasCorrectiveActions: false,
      incidentContacts: null,
      community: {
        _id: "5fff03e0458562000f4586e9",
        name: "Smithfield Foods",
        iconURL:
          "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
        replyToEmail: "cpantaleo@smithfield.com",
      },
      missingAttributes: false,
    },
  ],
  versionInfo: {
    isCurrentVersion: true,
    currentVersionId: "6492105bf17905000fed013d",
    createdAt: "2023-06-20T20:47:23.790602677Z",
    createdBy: {
      _id: "61f95cd2df6175000f371495",
      firstName: "Test",
      lastName: "Supplier",
    },
  },
  tags: null,
  links: null,
  contentType: "audit",
  auditAttributes: {
    auditor: "",
    auditDate: "2023-06-12T12:00:00Z",
    certIssuedDate: "2023-06-19T12:00:00Z",
    reAuditDate: null,
    certificationBody: "",
    scope:
      "GlobalG.A.P - Integrated Farm Assurance Standard (GFSI) - GlobalG.A.P - Integrated Farm Assurance Standard (GFSI)",
    criticalFailures: null,
  },
  ExpirationEmailSentAt: null,
  archivedInCommunity: null,
};
