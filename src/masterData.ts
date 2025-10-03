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

import type { JsonObject, OADAClient } from "@oada/client";
import { doJob } from "@oada/client/jobs";
import type { Job, WorkerFunction } from "@oada/jobs";
import { postUpdate } from "@oada/jobs";
import debug from "debug";

import config from "./config.js";
import tree from "./tree.masterData.js";
import type { FlBusiness } from "./types.js";

const SERVICE_NAME = config.get("service.name");
const SERVICE_PATH = `/bookmarks/services/${SERVICE_NAME}`;
const TP_MANAGER_SERVICE = config.get("tp-manager");
const TL_TP = "/bookmarks/trellisfw/trading-partners";

if (SERVICE_NAME && tree?.bookmarks?.services?.["fl-sync"]) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services["fl-sync"];
}

const trace = debug("fl-sync:master-data:trace");
const error = debug("fl-sync:master-data:error");

enum SourceType {
  Vendor = "vendor",
  Business = "business",
}

export interface NewBusinessJob {
  config: {
    "fl-business": FlBusiness;
  };
}

export interface TradingPartner {
  masterid: string;
  companycode?: string;
  vendorid?: string;
  partnerid?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  bookmarks: {
    _id: string;
  };
  shared: {
    _id: string;
  };
  externalIds: string[];
  frozen: boolean;
}

export type TradingPartnerNoLinks = Omit<
  TradingPartner,
  "bookmarks" | "shared"
>;

// Because we're calling ensure on foodlogiq externalId, we can eliminate several
// edge cases, e.g., multiple matches really should not occur.
export const handleFlBusiness: WorkerFunction = async (job: Job, { oada }) => {
  // 1. Make the query to the trellis trading partners
  // @ts-expect-error fl-bus doesn't exist on Json
  const element = mapTradingPartner(job.config["fl-business"]);
  const ensureJob = (await doJob(oada as unknown as OADAClient, {
    type: "trading-partners-ensure",
    service: TP_MANAGER_SERVICE,
    config: {
      element: {
        ...element,
        // Really, we just want to match on foodlogiq externalId here
        externalIds: [element.externalIds[0]!],
      },
    },
  })) as unknown as { result: EnsureResult; _id: string };

  await oada.put({
    path: `/${job.oadaId}`,
    data: {
      "ensure-job": {
        _id: ensureJob._id,
      },
      config: {
        // @ts-expect-error fl-bus doesn't exist on Json
        link: `https://connect.foodlogiq.com/businesses/5acf7c2cfd7fa00001ce518d/suppliers/detail/${job.config["fl-business"]._id}/5fff03e0458562000f4586e9`,
      },
    },
  });

  /*
  If ((ensureJob?.result?.matches ?? []).length > 1) {
    info(
      // @ts-expect-error fl-bus doesn't exist on Json
      `Food Logiq Business [${job.config['fl-business'].business._id}] inputs returned multiple trading-partner matches`
    );
    await postUpdate(oada, job.oadaId, `Multiple results on ensure request. See job /ensure-job for details.`, 'multiple-ensure-results');

    const match = ensureJob.result.matches?.find((m) =>
      m.externalIds.includes(
        element.externalIds.find((k) => k.startsWith('foodlogiq'))
      )
    )
    if (match) {
      return {
        ...ensureJob.result,
        entry: match,
      };
    }
  }
  */

  // @ts-expect-error annoying Json type
  if (!job.config["fl-business"].internalId && ensureJob.result.new) {
    const message = `FL Business is missing an 'internalId'.`;
    await postUpdate(oada, job.oadaId, message, "fl-business-incomplete");
    await oada.put({
      path: `/${job.oadaId}`,
      data: {
        "fl-business-incomplete-reason": "FL business is missing internalIds",
      },
    });
  }

  // Add the externalIds if they are present
  if (
    // @ts-expect-error annoying Json type
    job.config["fl-business"].internalId &&
    !element.externalIds
      .filter((k) => k.startsWith("sap"))
      .every((k) => k.indexOf(ensureJob?.result?.entry.externalIds) > 0)
  ) {
    try {
      const { result: updateResult } = await doJob(
        oada as unknown as OADAClient,
        {
          type: "trading-partners-update",
          service: TP_MANAGER_SERVICE,
          config: {
            element: {
              masterid: ensureJob.result.entry.masterid,
              externalIds: element.externalIds,
            },
          },
        },
      );
      const updateXids = (updateResult?.externalIds ?? []) as string[];
      if (updateXids.length !== element.externalIds.length) {
        const xids = element.externalIds.filter(
          (xid) => !updateXids.includes(xid),
        );
        const message = `The following failed to update for trading-partner ${
          ensureJob.result.entry.masterid
        }: ${xids.join(", ")}`;
        await postUpdate(oada, job.oadaId, message, "fl-business-incomplete");
        await oada.put({
          path: `/${job.oadaId}`,
          data: {
            "fl-business-incomplete-reason": `Conflicting internalIds: ${xids.join(",")}`,
          },
        });
      }

      await postUpdate(
        oada,
        job.oadaId,
        `Updated trading-partner ${ensureJob.result.entry.masterid} with FL internalId(s)`,
        "tp-updated",
      );
      return {
        ...ensureJob.result,
        entry: updateResult,
      };
    } catch (err: unknown) {
      error(
        err,
        // @ts-expect-error fl-bus doesn't exist on Json
        `Food Logiq Business [${job.config["fl-business"].business._id}] externalID update failed.`,
      );
      const message = `Failed to update trading-partner ${ensureJob.result.entry.masterid} with FL internalId(s)`;
      await postUpdate(oada, job.oadaId, message, "tp-update-failed");
      await oada.put({
        path: `/${job.oadaId}`,
        data: {
          "fl-business-incomplete-reason": `Other Internal Failure. See job ${job.oadaId} for details.`,
        },
      });
    }
  }

  return ensureJob.result.entry;
};

/**
 * Assigns fl business data into the trading partner template
 * @param {*} bus fl business
 * @returns
 */
export function mapTradingPartner(bus: FlBusiness): TradingPartnerNoLinks {
  let externalIds = [`foodlogiq:${bus.business._id}`];
  if (bus.internalId) {
    const iids = bus.internalId.split(",").map((iid) => `sap:${iid.trim()}`);
    externalIds = [...externalIds, ...iids];
  }

  return {
    ...structuredClone(trellisTPTemplate),
    name: bus.business.name || "",
    address: bus.business.address.addressLineOne || "",
    city: bus.business.address.city || "",
    state: bus.business.address.region || "",
    email: bus.business.email || "",
    phone: bus.business.phone || "",
    externalIds,
  };
}

/**
 * Updates the masterid property in the
 * fl-sync/business/<bid> endpoint
 * @param masterid string that contains internalid from FL or
 * random string created by sap-sync
 */
async function updateMasterId(
  flBusiness: any,
  masterid: string,
  oada: OADAClient,
) {
  await oada.put({
    path: `${SERVICE_PATH}/businesses/${flBusiness._id}`,
    data: { masterid } as JsonObject,
  });
  trace(
    `${SERVICE_PATH}/businesses/<bid> updated with masterid [${masterid}].`,
  );

  await oada.put({
    path: `/${masterid}/_meta`,
    data: {
      services: {
        "fl-sync": {
          businesses: {
            [flBusiness._id]: { _id: masterid },
          },
        },
      },
    } as JsonObject,
  });
  trace(`${TL_TP}/ updated with masterid [${masterid}].`);
} // UpdateMasterId

const trellisTPTemplate: TradingPartnerNoLinks = {
  masterid: "", // Internal trellis resource id
  companycode: "",
  vendorid: "",
  partnerid: "",
  name: "", // Both
  address: "", // Both
  city: "", // Both
  state: "", // Both
  // type: 'CUSTOMER', // Both
  // source: SourceType.Business,
  coi_emails: "", // Business
  fsqa_emails: "", // Business
  email: "", // Both
  phone: "", // Both,
  externalIds: [],
  frozen: false,
};

/**
 * Watches for changes in the fl-sync/businesses
 */
/*
export async function watchTrellisFLBusinesses(conn: OADAClient, service: Service) {
  info(`Setting masterData ListWatch on FL Businesses`);
  setConnection(conn);
  // eslint-disable-next-line no-new
  const watch = new ListWatch({
    path: `${SERVICE_PATH}/businesses`,
    name: `fl-sync-master-data-businesses`,
    conn,
    tree,
    resume: true,
    onNewList: AssumeState.Handled,
  });
  watch.on(ChangeType.ItemAdded, async ({ item, pointer }) => {
    await addTP2Trellis((await item) as Resource, pointer, conn, service);
  });

  // FIXME: Handle changes to the trading partners
  watch.on(ChangeType.ItemChanged, async ({ item, pointer }) => {
    await addTP2Trellis((await item) as Resource, pointer, conn);
  });
} // WatchTrellisFLBusinesses
*/
export interface EnsureResult {
  entry?: any;
  matches?: any[];
  exact?: boolean;
  new?: boolean;
}
