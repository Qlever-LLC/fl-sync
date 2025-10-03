/**
 * @license
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import "@oada/pino-debug";

import fs from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { connect, type JsonObject, type OADAClient } from "@oada/client";
import { doJob } from "@oada/client/jobs";
// @ts-expect-error no types
import csvjson from "csvjson";
import debug from "debug";
import Fuse from "fuse.js";

import config from "./config.js";
import { mapTradingPartner, type TradingPartner } from "./masterData.js";
import tree from "./tree.masterData.js";
import type { FlBusiness, OldTradingPartner } from "./types.js";

const { domain, token } = config.get("trellis");
const CO_ID = config.get("foodlogiq.community.owner.id");
const COMMUNITY_ID = config.get("foodlogiq.community.id");
const FL_DOMAIN = config.get("foodlogiq.domain");
const FL_TOKEN = config.get("foodlogiq.token");
const warn = debug("fl-sync:vendorsReport:warn");
const trace = debug("fl-sync:vendorsReport:trace");
const error = debug("fl-sync:vendorsReport:error");

const INSTRUCTION_HEADER =
  "Place one X per set of rows with the same FL Name to select a match. Leave blank to select no matches";

export async function makeReport() {
  const oada = await connect({
    domain,
    token,
  });
  try {
    const { data: businesses } = (await oada.get({
      path: "/bookmarks/services/fl-sync/businesses",
    })) as { data: JsonObject };

    const businessKeys = Object.keys(businesses).filter(
      (key) => !key.startsWith("_"),
    );

    const results: any[] = [];

    for await (const bid of businessKeys) {
      const { data } = await oada.get({
        path: `/bookmarks/services/fl-sync/businesses/${bid}`,
      });

      const bus = (data as JsonObject)[
        "food-logiq-mirror"
      ] as unknown as FlBusiness;
      const element = mapTradingPartner(bus);

      const job = await doJob(oada, {
        type: "trading-partners-query",
        service: "trellis-data-manager",
        config: { element },
      });

      for (const match of Object.values(job?.result?.matches || {})) {
        results.push({
          "FoodLogiq Business Name": bus.business.name,
          "FoodLogiq Business Address": `${bus.business.address.addressLineOne}; ${bus.business.address.city}; ${bus.business.address.region}`,
          "FoodLogiq Business ID": `${bus._id}`,
          "SAP Business Name": match.name,
          "SAP Business Address": `${match.address}; ${match.city}; ${match.state}`,
          "SAP Business EIN": match.ein,
        });
      }
    }
  } catch (error_: unknown) {
    error(error_);
  }
}

// Create Trellis trading-partners for each vendor in the master-data-sync index
export async function makeVendors() {
  const oada = await connect({
    domain,
    token,
  });
  const { data } = await oada.get({
    path: "/bookmarks/services/master-data-sync/data-sources/vendors/day-index/2023-04-21",
  });

  const values = Object.entries(data ?? {})
    .filter(([key, _]) => !key.startsWith("_"))
    .map(([_, value]) => value);

  for await (const value of values) {
    const element = mapVendor(value);

    try {
      await doJob(oada, {
        type: "trading-partners-generate",
        service: "trellis-data-manager",
        config: { element },
      });
    } catch (error_: unknown) {
      error(error_);
    }
  }
}

// Map vendors between the Vendor data and Trellis Trading Partners
function mapVendor(vendor: any) {
  return {
    sapid: vendor.Vendor,
    externalIds: [vendor.Vendor],
    name: vendor.VendorName,
    vendorid: vendor.Vendor,
    address: vendor.StreetAddress,
    city: vendor.City,
    state: vendor.Region,
    phone: vendor.Telephone1 ?? vendor.Telephone2,
    zip: vendor.PostalCode,
    ein1: vendor.TaxNumber2,
    ein2: vendor.TaxNumber2,
  };
}

// Put all of the TP data into the fuse search
async function loadVendors() {
  const oada = await connect({
    domain,
    token,
  });
  const { data } = await oada.get({
    path: "/bookmarks/services/master-data-sync/data-sources/vendors/day-index/2023-04-21",
  });

  const values = Object.entries(data ?? {})
    .filter(([key, _]) => !key.startsWith("_"))
    .filter(([_, value]) => !value.VendorName.startsWith("BLK"))
    .filter(([_, value]) => value.CentralDeletionFlag.trim() !== "X")
    .map(([_, value]) => mapVendor(value));

  const searchKeys = [
    {
      name: "name",
      weight: 5,
    },
    {
      name: "address",
      weight: 2,
    },
    {
      name: "city",
      weight: 0.5,
    },
    {
      name: "state",
      weight: 0.5,
    },
    "phone",
    "email",
    "sapid",
    "masterid",
    "externalIds",
  ];
  const searchKeysList = new Set(
    searchKeys.map((index) => (typeof index === "string" ? index : index.name)),
  );
  const options = {
    includeScore: true,
    keys: searchKeys,
    // ignoreLocation: true,
    // minMatchCharLength: 3,
    useExtendedSearch: true,
  };
  const index = new Fuse<(typeof values)[0]>([], options);

  const collection = Object.values(values || {}).filter(
    (value) => value !== undefined,
  );

  index.setCollection(collection);

  const conn = await connect({
    domain,
    token,
  });

  const { data: businesses } = await conn.get({
    path: "/bookmarks/services/fl-sync/businesses",
  });

  const businessKeys = Object.keys(businesses as JsonObject).filter(
    (key) => !key.startsWith("_"),
  );

  const results = [];

  for await (const bid of businessKeys) {
    const { data } = await conn.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    });

    const bus = (data as JsonObject)[
      "food-logiq-mirror"
    ] as unknown as FlBusiness;
    const foodlogiq = Object.fromEntries(
      Object.entries(mapTradingPartner(bus))
        .filter(([k, _]) => searchKeysList.has(k))
        .filter(([_, v]) => v !== "" && v !== undefined),
    );

    // @ts-expect-error
    foodlogiq.name = foodlogiq.name.replace(/\(.+?\)/, "");
    const matches = getMatches(foodlogiq, index);
    // Let matches = index.search({name: foodlogiq.name})
    // if (matches.length > 5) matches = matches.slice(0, 4);

    if (matches.length === 0)
      results.push({
        [INSTRUCTION_HEADER]: "",
        // @ts-expect-error
        "FL Name": foodlogiq.name.replace(",", ""),
        "FL Address":
          `${foodlogiq.address ?? " "} - ${foodlogiq.city ?? " "} - ${foodlogiq.state ?? " "}`.replace(
            ",",
            "",
          ),
        "Match Score": " ",
        "SAP Name": " ",
        "SAP Address": " ",
        "FL ID": bus.business._id,
      });

    for (const m of matches) {
      results.push({
        [INSTRUCTION_HEADER]: "",
        // @ts-expect-error
        "FL Name": foodlogiq.name.replace(",", ""),
        "FL Address":
          `${foodlogiq.address ?? " "} - ${foodlogiq.city ?? " "} - ${foodlogiq.state ?? " "}`.replace(
            ",",
            "",
          ),
        "Match Score": m.score,
        "SAP Name": m.item.name.replace(",", ""),
        "SAP Address":
          `${m.item.address || " "} - ${m.item.city || " "} - ${m.item.state || " "}`.replace(
            ",",
            "",
          ),
        "SAP ID": m.item.sapid,
        "FL ID": bus.business._id,
      });
    }
  }

  const csvData = csvjson.toCSV(results, {
    delimiter: ",",
    wrap: false,
    headers: "relative",
  });

  await fs.writeFile("vendorsReport.csv", csvData, { encoding: "utf8" });
}

// Basically, try a bunch of different permutations of the given attributes and
// look for the lowest possible scores across all of those
function getMatches(foodlogiq: any, index: any) {
  // 1. Gather a bunch of results
  let allMatches = [];
  allMatches.push(...index.search({ name: foodlogiq.name }));
  allMatches.push(...index.search(foodlogiq));

  const keys = ["name", "address", "city", "state"];
  allMatches.push(
    ...index.search(
      Object.fromEntries(
        keys.filter((k) => foodlogiq[k]).map((k) => [k, foodlogiq[k]]),
      ),
    ),
  );

  // 3. sort
  allMatches = allMatches.sort(({ score: sa }, { score: sb }) => sa - sb);
  // 2. Dedupe
  const seen: any = {};
  allMatches = allMatches.filter(({ refIndex }) => {
    if (seen[refIndex]) return false;
    seen[refIndex] = true;
    return true;
  });

  // 4. reduce to top 4 options
  if (allMatches.length > 5) allMatches = allMatches.slice(0, 4);
  return allMatches;
}

// Identify the FL IDs of items in the report that had no matches selected
function findNoMatchIds(rows: any) {
  let ids = Array.from(new Set(rows.map((r: any) => r["FL ID"])));
  ids = ids.filter(
    (id) => !rows.some((r: any) => r["FL ID"] === id && r[INSTRUCTION_HEADER]),
  );
  const found = rows.filter((r: any) => ids.includes(r["FL ID"]));

  /*
  Const csvData = csvjson.toCSV(found, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });

  fs.writeFileSync('vendorsReportNoMatches.csv', csvData, { encoding: 'utf8' })
  */
  return ids;
}

// Identify the FL IDs of the items in the report that had multiple results selected
function findMultipleXs(rows: any) {
  let ids = Array.from(new Set(rows.map((r: any) => r["FL ID"])));
  ids = ids.filter(
    (id) =>
      rows.filter((r: any) => r["FL ID"] === id && r[INSTRUCTION_HEADER])
        .length > 1,
  );
  const found = rows.filter((r: any) => ids.includes(r["FL ID"]));
  /*
  Const csvData = csvjson.toCSV(found, {
    delimiter: ',',
    wrap: false,
    headers: 'relative',
  });

  await fs.writeFile('vendorsReportMultipleMatches.csv', csvData, { encoding: 'utf8' })
  */
  return rows.map((r: any) => ids.includes(r["FL ID"]));
}

//
async function reduceForPerfectMatches(rows: any) {
  const highScoreIds = new Set(
    Array.from(
      new Set(
        rows
          .filter((r: any) => r["Match Score"] < 0.01)
          .map((r: any) => r["FL ID"]),
      ),
    ),
  );
  const found = rows.filter(
    (r: any) => !(highScoreIds.has(r["FL ID"]) && r["Match Score"] >= 0.01),
  );

  const csvData = csvjson.toCSV(found, {
    delimiter: ",",
    wrap: false,
    headers: "relative",
  });

  await fs.writeFile("vendorsReportReduced.csv", csvData, { encoding: "utf8" });
  return found;
}

// Validate the report responses and identify which ones require additional work
async function validateReportResponses() {
  const rows = csvjson.toObject(
    await fs.readFile("./Vendor Report - Updated 05.04.23.csv", {
      encoding: "utf8",
    }),
    {
      delimiter: ",",
    },
  );
  rows.map((r: any) => ({
    ...r,
    [INSTRUCTION_HEADER]:
      r[INSTRUCTION_HEADER].trim() === "X" ||
      r[INSTRUCTION_HEADER].trim() === "x",
  }));

  // No Matches
  const noMatches = findNoMatchIds(rows);
  // Find any with multiple Xs
  const multipleMatches = findMultipleXs(rows);

  // TODO: Eliminate any sets with one having score less than 0.01
  //  const perfects = reduceForPerfectMatches(rows);

  const matches = rows
    .filter((r: any) => r[INSTRUCTION_HEADER])
    .filter((_: unknown, index: number) => !multipleMatches[index]);

  return { rows, noMatches, multipleMatches, matches };
}

// Merge trading-partners based on report responses. One based on FL external ID
// and one originating from the SAP data.
async function fixVendors(oada: OADAClient, matches: any[]) {
  for await (const { "FL ID": fl, "SAP ID": sap } of matches) {
    const flId = `foodlogiq:${fl}`;
    const sapid = `sap:${sap}`;
    // Well, we haven't created any trading partners yet...
    const fromTP = await doJob(oada, {
      service: "trellis-data-manager",
      type: "trading-partners-query",
      config: { element: { externalIds: [flId] } },
    });

    const toTP = await doJob(oada, {
      service: "trellis-data-manager",
      type: "trading-partners-query",
      config: { element: { externalIds: [sapid] } },
    });

    if (fromTP.length !== 1 || toTP.length !== 1) {
      warn(`Multiple TP results found for food logiq: ${flId}, sap: ${sapid}`);
      continue;
    }

    const config = {
      from: fromTP.masterid,
      to: toTP.masterid,
      externalIds: [flId, sapid],
    };
    await doJob(oada, {
      service: "trellis-data-manager",
      type: "trading-partners-merge",
      config,
    });
  }
}

// The new report response handler. Find the trading-partner, write the
// internalId to the Food Logiq member, and wait for it to sync.
async function updateFlInternalIds() {
  const oada = await connect({
    domain,
    token,
  });
  const rows = csvjson.toObject(
    await fs.readFile("./VendorReport-05-19-23.csv", { encoding: "utf8" }),
    {
      delimiter: ",",
      quote: '"',
    },
  );
  for await (const tp of rows) {
    // 1. lookup the trading-partner
    const bid = tp["FL ID"] as string;
    const sapid = tp["SAP ID"] as string;
    /*
    Const job = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: {
        element: {
          externalIds: [`foodlogiq:${tp['FL ID']}`],
        },
      },
    });

    // 2. assign the sapids
    if (!job.result?.exact) {
      console.log(`Exact match missing for trading-partner 'FL ID': ${tp['FL ID']}`);
      throw new Error('Exact match should have been found');
    }
    */

    // 3. Get it to flow to LF sync
    const { data: flBus } = (await oada.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    })) as unknown as {
      data: {
        "food-logiq-mirror": {
          _id: string;
          internalId: string;
        };
      };
    };

    const sapids = sapid.split(",");
    const internalIds = flBus["food-logiq-mirror"].internalId.split(",");
    if (
      !flBus["food-logiq-mirror"].internalId ||
      internalIds.every((k) => sapids.includes(k))
    ) {
      const memberId = flBus["food-logiq-mirror"]._id;
      const res = await fetch(
        `${FL_DOMAIN}/businesses/${CO_ID}/memberships/${memberId}`,
        {
          method: "get",
          headers: { Authorization: FL_TOKEN },
        },
      );
      const member = (await res.json()) as any;
      member.internalId = sapid;
      trace(`Putting internalId ${sapid} to fl: ${member?.business?._id}`);
      /*
      Await fetch(
        `${FL_DOMAIN}/businesses/${CO_ID}/memberships/${memberId}`,
        {
          method: 'put',
          headers: { Authorization: FL_TOKEN },
          data: member,
      });
      */
    } else {
      trace("internalId already set for FL vendor", bid);
    }
  }
}

// This was the original plans for how to handle merging trading
// partners after Chris' responses.
async function processReportResponses() {
  const oada = await connect({
    domain,
    token,
  });
  const { matches } = await validateReportResponses();

  //  Await fixVendors(prod, matches);
}

// Utility function for removing OADA underscore keys
function filterOadaKeys(object: JsonObject) {
  return Object.fromEntries(
    Object.entries(object).filter(([key, _]) => !key.startsWith("_")),
  );
}

// Copy trading-partner data from production to dev for testing
async function copyProdData() {
  const dev = await connect({
    domain,
    token,
  });

  const prod = await connect({
    domain,
    token,
  });

  // Copy FL businesses
  /*
  const { data: businesses } = (await prod.get({
    path: `/bookmarks/services/fl-sync/businesses`,
  })) as { data: JsonObject };

  const businessKeys = Object.keys(businesses).filter(
    (key) => !key.startsWith('_')
  );

  let passed = false;
  for await (const bid of businessKeys) {
    if (bid === '641085b1137b5a000f95b71b') passed = true;
    console.log({ bid, passed });
    if (!passed) continue;
    let { data: flBus } = (await prod.get({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    })) as { data: JsonObject };

    flBus = Object.fromEntries(
      Object.entries(flBus).filter(([k, _]) => !k.startsWith('_'))
    );

    await dev.put({
      path: `/bookmarks/services/fl-sync/businesses/${bid}`,
      data: flBus,
      tree: flTree,
    });
    await setTimeout(500);
  }
  */

  // Copy Trading Partner data
  const { data: tps } = (await prod.get({
    path: "/bookmarks/trellisfw/trading-partners",
  })) as { data: JsonObject };

  const tpKeys = Object.keys(tps)
    .filter((k) => !k.startsWith("_"))
    .filter((k) => !["masterid-index", "expand-index"].includes(k));

  let passed = false;
  for await (const tpKey of tpKeys) {
    trace({ tpKey });
    if (tpKey === "5ddd8032343c9b000126f0f8") passed = true;
    if (!passed) continue;
    let { data: tp } = (await prod.get({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
    })) as { data: JsonObject };

    tp = Object.fromEntries(
      Object.entries(tp)
        .filter(([k, _]) => !k.startsWith("_"))
        .filter(([k, _]) => !["bookmarks", "shared"].includes(k)),
    );
    await dev.put({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
      data: tp,
    });
    await setTimeout(700);

    const { data: docs } = (await prod.get({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents`,
    })) as { data: JsonObject };
    const docTypeKeys = Object.keys(docs).filter((k) => !k.startsWith("_"));

    for await (const docTypeKey of docTypeKeys) {
      const { data: docType } = (await prod.get({
        path: `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents/${docTypeKey}`,
      })) as { data: JsonObject };
      const docKeys = Object.keys(docType).filter((k) => !k.startsWith("_"));

      for await (const docKey of docKeys) {
        let { data: doc } = (await prod.get({
          path: `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents/${docTypeKey}/${docKey}`,
        })) as { data: JsonObject };

        doc = Object.fromEntries(
          Object.entries(doc).filter(([k, _]) => !k.startsWith("_")),
        );
        trace(
          { doc },
          `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents/${docTypeKey}/${docKey}`,
        );
        try {
          await dev.head({
            path: `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents/${docTypeKey}/${docKey}`,
          });
        } catch (error_: unknown) {
          // @ts-expect-error error bs
          if (error_.status !== 404) {
            throw error_;
          }

          try {
            await dev.put({
              path: `/bookmarks/trellisfw/trading-partners/${tpKey}/bookmarks/trellisfw/documents/${docTypeKey}/${docKey}`,
              data: doc,
              tree,
            });
          } catch (error_: unknown) {
            error(error_);
          }

          await setTimeout(500);
        }
      }
    }
  }
}

// The full prep necessary for the trellis-data-manager and other
// changes deployed Summer 2023.
async function tradingPartnerPrep06142023() {
  const prod = await connect({
    domain,
    token,
  });

  // Copy food logiq vendors over to dev for testing
  const { data: tps } = (await prod.get({
    path: "/bookmarks/trellisfw/trading-partners",
  })) as { data: JsonObject };

  const tpKeys = Object.keys(tps)
    .filter((key) => !key.startsWith("_"))
    .filter((key) => !key.includes("index"));
  const list = new Set([
    "55c8b0993402cf00010000ed",
    "55ca4ffa3402cf00010001ce",
    "55ce160eabc8920001000031",
    "55db1dd3abc8920001000105",
    "55db518fabc892000100018f",
    "55c8edd13402cf000100011e",
    "5603072709c30a0001000368",
    "56c21b30c07c2d0001000117",
    "56c21b5450743a00010000b8",
    "56c21e4150743a000100010e",
    "579256897e803200015ba50f",
    "56c21ee6c07c2d0001000171",
    "56c2166150743a000100008a",
    "580f7f6c980fcb0001cbbfd1",
    "580f7f28f23c480001ddc7dc",
    "580f857487f0210001b9e445",
    "5841a004f823bf0001fe7823",
    "580f7fc0f23c480001ddc7f3",
    "58501985b10eda0001d9ddd8",
    "585031c1f033a20001622244",
    "5850337b039e500001d0660d",
    "585034970a3c9a0001683c99",
    "58d9c3814532df0001c30c2e",
    "58ecf3f87bd5a100011ce905",
    "58948143f1206f00018b8cfd",
    "591ae438edf0fe000158da0a",
    "59238100cb06460001dc38ba",
    "593ede1e1d95ca00016d42a1",
    "59077c505602dd00019de7ab",
    "59e9508a61ccee00019175c3",
    "5a3acdc32e7e830001f430b3",
    "5a21830be16fb40001d358e4",
    "5a5686b2837b6f000111452a",
    "59fa4f76fc42680001e7fc2b",
    "5a68c37e6b390300014474dc",
    "5a786599a0ba6300010ce2c0",
    "5ac645a2fa59f800012dd928",
    "5acbd1021772b90001b45a85",
    "5acbdaad230156000101ad90",
    "5acbdbf4627fec0001bb4283",
    "5acbdc28230156000101adec",
    "5acbdc6d1772b90001b45c48",
    "5accb069230156000101b42a",
    "5adcf497411bf70001ea28c8",
    "5ae9ea3c486b690001429e00",
    "5b966e03ae018a00012285c0",
    "5bae1421dd01530001b56f0f",
    "5bbfa370e8c95200017b6fe0",
    "5bfda241a8653700017535b6",
    "5bc9d78337c00b0001a68171",
    "5c003b23bfbe2d0001c06b28",
    "5c0932dc5d69240001a305cc",
    "5c0fc20dbd4aa3001a3fa5ff",
    "5c0fc2cabd4aa3001a3fbeff",
    "5c0fc42fbd4aa3001a3ff09b",
    "5c0fe88c2994d80001b6cff4",
    "5c5b8f18186903000199857f",
    "5c1ab0ad67292800016dbf30",
    "5c2d04d4380dd800010b976f",
    "5c881b0f2b1d5000017af034",
    "5c99cf3c0fade7000169d59c",
    "5c9a6e7d991c010001ca464f",
    "5c894a084baeda000155c36c",
    "5cb67bb2499dcf0001a1e811",
    "5ca236e6e110ad0001fe9bed",
    "5cf98221b58cd50001dd083f",
    "5cc897d174dfc60001c24399",
    "5d01873bd0db47000156c373",
    "5d77e00552bcb90001306625",
    "5d7f8384be001900013d1d36",
    "5d80d89c16be480001032837",
    "5d234722ead18100017b5ab6",
    "5d852de559f5220001fce04d",
    "5daf837026c48300012167da",
    "5ddd8032343c9b000126f0f8",
    "5df012f3dea1670001000445",
    "5e3c523153afec00013e9a77",
    "5e6640ea6f62e7000152d6f7",
    "5e8d36b3d3e6d60001daeec2",
    "5ec2f357275aef000106a5b1",
    "5ea9fa88f9ab680001872655",
    "5f46e55eafb3da0012dbac4d",
    "5f6bd1603e0240000ef43863",
    "5f9c2fb65d023d000e0d4048",
    "5f9b20f5bbf923000f145e82",
    "5f89e7e7bbf923000e629be3",
    "5fb3f01b26bdb0000eb26ff7",
    "600061c680a9f2000ed24b08",
    "6001d1d2458562000efdafed",
    "60097c91458562000ea112e6",
    "604fb5220d24d9000e0fc157",
    "608ac32f2200de000eb01cd8",
    "605cad04c8f60c000e4aece1",
    "60a67a26878fea000e7fe515",
    "60a67cd25f1645000ee1d251",
    "60a67d36878fea000e7fe67b",
    "60a67dc8878fea000e7fe6b6",
    "60a67e22878fea000e7fe6f6",
    "60a805415f1645000ee24563",
    "60b11015033190000edb6bd0",
    "60b9901ff0ba6a000e390ba2",
    "60aea3af033190000ed2c372",
    "60ba1d7395c48d000e28bf88",
    "60ba1da4033190000e4b49d1",
    "60ba1df4033190000e4b49f1",
    "60ba1de495c48d000e28bfbb",
    "60ba1e1ed2a730000eaca320",
    "60ba1dd495c48d000e28bfb5",
    "60ba1e13d2a730000eaca31a",
    "60ba1e49033190000e4b4a19",
    "60ba1e6e95c48d000e28bff9",
    "60ba1e50d2a730000eaca341",
    "60ba1ed1033190000e4b4a4b",
    "60ba1e8cd2a730000eaca35b",
    "60ba1f2ad2a730000eaca379",
    "60ba1f10b91309000ea97b97",
    "60ba1f2f033190000e4b4a67",
    "60ba1f41033190000e4b4a7c",
    "60ba1f5695c48d000e28c031",
    "60ba1f6cb91309000ea97bbc",
    "60ba1f62d2a730000eaca398",
    "60ba1f75b91309000ea97bc7",
    "60ba1f9195c48d000e28c04a",
    "60ba1f9a95c48d000e28c054",
    "60ba1fa7033190000e4b4a93",
    "60ba1fb3b91309000ea97bd7",
    "60ba1fd4033190000e4b4aa6",
    "60ba1fd9b91309000ea97bdd",
    "60ba2003f0ba6a000ec421a5",
    "60ba1feaf0ba6a000ec42199",
    "60ba1ffdd2a730000eaca3df",
    "60ba2015d2a730000eaca417",
    "60ba2011033190000e4b4ac2",
    "60ba202ef0ba6a000ec421b3",
    "60ba202ef0ba6a000ec421b7",
    "60ba206b033190000e4b4ae3",
    "60ba209eb91309000ea97c52",
    "60ba2902d2a730000eaca6d0",
    "60ba4295b91309000ea98855",
    "60ba49af95c48d000e28cddf",
    "60ba4c85b91309000ea98be9",
    "60ba4dde95c48d000e28cee1",
    "60ba4e46b91309000ea98ca7",
    "60ba4f08b91309000ea98cf9",
    "60ba5563d2a730000eacb984",
    "60ba56a795c48d000e28d2b5",
    "60ba5721033190000e4b60cb",
    "60ba5870033190000e4b611a",
    "60ba58a9033190000e4b6128",
    "60c13f591c31d4000e902d93",
    "60c1400d08382c00132e2fe3",
    "60c13ec308382c00132e2fae",
    "60c140cf08382c00132e300b",
    "60c141cd1c31d4000e902df8",
    "60c1424c685b46000e5e76c4",
    "60c142d61c31d4000e902e1f",
    "60c1438140faf1000e2021b7",
    "60c1441308382c00132e307e",
    "60d0ed6feb25c0000e1c28a4",
    "60d0ed8d78bfbb000e30f9f8",
    "60d0ee29eb25c0000e1c28fa",
    "60d0ee87a49a43000ec2e402",
    "60d0eec278bfbb000e30fb19",
    "60d0eef978bfbb000e30fb33",
    "60d0ef27a49a43000ec2e436",
    "60d0ef7eeb25c0000e1c29b5",
    "60d0efa1a49a43000ec2e47f",
    "60d0f14e78bfbb000e30fc76",
    "60d0f185aeb961000ea55536",
    "60d0f1c1eb25c0000e1c2a79",
    "60d0f42daeb961000ea555e1",
    "60d0f48578bfbb000e30fdb3",
    "60d0f4b0eb25c0000e1c2bb7",
    "60d0f4e3a49a43000ec2e670",
    "60d0f623a49a43000ec2e70d",
    "60d0f6e09c09d3000f6dd624",
    "60d0f64e9c09d3000f6dd5ca",
    "60d0f72deb25c0000e1c2c8e",
    "60d0f75978bfbb000e30ff15",
    "60d0f6fa78bfbb000e30feef",
    "60d0f7b878bfbb000e30ff29",
    "60d0f81b9c09d3000f6dd66f",
    "60d0f84da49a43000ec2e7d0",
    "60d0f800a49a43000ec2e7a8",
    "60d0fa82a49a43000ec2e841",
    "60d0fb0778bfbb000e310007",
    "60d0faccaeb961000ea5580b",
    "60d0fb3e78bfbb000e31004d",
    "60d0fb6c9c09d3000f6dd7ce",
    "60d0fc22a49a43000ec2e8e3",
    "60d0fb89eb25c0000e1c2eb6",
    "60d0fc65aeb961000ea5585f",
    "60d0fc96eb25c0000e1c2ef5",
    "60d0fcbb78bfbb000e3100c6",
    "60d0fcdcaeb961000ea558cf",
    "60d0fd1baeb961000ea558dd",
    "60d0fd72a49a43000ec2e94e",
    "60d0fdc8aeb961000ea5591e",
    "60d0fdfa78bfbb000e310192",
    "60d0fe3beb25c0000e1c2fc7",
    "60d0fe7378bfbb000e3101b0",
    "60d0ffe8aeb961000ea559a9",
    "60d1000feb25c0000e1c3057",
    "60d10052a49a43000ec2ea67",
    "60d100899c09d3000f6dd972",
    "60d100ffeb25c0000e1c309a",
    "60d100c378bfbb000e310252",
    "60d10143a49a43000ec2ea97",
    "60d1015aa49a43000ec2eaa2",
    "60d101929c09d3000f6dd9c4",
    "60d101abeb25c0000e1c30c0",
    "60d101c5aeb961000ea55a12",
    "60d102229c09d3000f6dd9eb",
    "60d1029aaeb961000ea55a55",
    "60d102239c09d3000f6dd9ef",
    "60d10271aeb961000ea55a49",
    "60d102e5aeb961000ea55a5e",
    "60d10517eb25c0000e1c3184",
    "60d10941a49a43000ec2ecab",
    "60d108a8aeb961000ea55d7c",
    "60d10a36a49a43000ec2ecd7",
    "60d10a8078bfbb000e3105d7",
    "60d10b65a49a43000ec2ed57",
    "60d1e10d78bfbb000e311d4f",
    "60d1e22878bfbb000e311dd0",
    "60d1e2569c09d3000f6df48a",
    "60d1e261aeb961000ea57493",
    "60d1e284aeb961000ea574a0",
    "60d1e2ada49a43000ec30496",
    "60d1e29baeb961000ea574a6",
    "60d1e37678bfbb000e311e33",
    "60d1e2caeb25c0000e1c4a5c",
    "60d1e3c1aeb961000ea57580",
    "60d1e3ef78bfbb000e311e70",
    "60d1e42baeb961000ea575ae",
    "60d1e449a49a43000ec30518",
    "60d1e46ceb25c0000e1c4b0f",
    "60d1e487a49a43000ec30531",
    "60d1e4f278bfbb000e311ed4",
    "60d1e50aa49a43000ec30552",
    "60d1e51d78bfbb000e311ee7",
    "60d1e54478bfbb000e311ef7",
    "60d1e5759c09d3000f6df5f3",
    "60d1e5a778bfbb000e311f15",
    "60d1e5d5aeb961000ea5765c",
    "60d1e647a49a43000ec305e1",
  ]);

  for await (const tpKey of tpKeys) {
    if (list.has(tpKey)) {
      trace("skipping", tpKey);
      continue;
    }

    trace({ tpKey });
    const { data: tp } = (await prod.get({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
    })) as unknown as { data: OldTradingPartner };
    const data: TradingPartner = {
      masterid: tp._id,
      companycode: tp.companycode ?? "",
      vendorid: tp.vendorid ?? "",
      partnerid: tp.partnerid ?? "",
      name: tp.name ?? "",
      address: tp.address ?? "",
      city: tp.city ?? "",
      state: tp.state ?? "",
      coi_emails: tp.coi_emails ?? "",
      fsqa_emails: tp.fsqa_emails ?? "",
      email: tp.email ?? "",
      phone: tp.phone ?? "",
      externalIds: [],
      bookmarks: tp.bookmarks,
      shared: tp.shared,
      frozen: false,
    };
    if (tp?.foodlogiq?._id) {
      data.externalIds = [...data.externalIds, `foodlogiq:${tp.foodlogiq._id}`];
      // @ts-expect-error some have already been converted and aren't OldTradingPartner
    } else if ((tp?.externalIds ?? []).some((k) => k.startsWith("foodlogiq"))) {
      // @ts-expect-error some have already been converted and aren't OldTradingPartner
      data.externalIds = tp.externalIds;
    } else {
      const { data: change } = (await prod.get({
        path: `${tp._id}/_meta/_changes/1`,
      })) as unknown as { data: any };
      if (change?.[0]?.body?.foodlogiq?.business?._id) {
        data.externalIds = [
          ...data.externalIds,
          `foodlogiq:${change[0].body.foodlogiq.business._id}`,
        ];
      } else {
        error("No foodlogiq id found for TP:", tp._id);
      }
    }

    await prod.put({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
      // @ts-expect-error data is fine...
      data,
    });
    await prod.delete({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}/id`,
    });
    await prod.delete({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}/foodlogiq`,
    });
    trace("done with tp");
  }

  process.exit();
}

// Fix a mistake from the 06142023 script
async function tradingPartnerFix07102023() {
  const prod = await connect({
    domain,
    token,
  });

  // Copy food logiq vendors over to dev for testing
  const { data: tps } = (await prod.get({
    path: "/bookmarks/trellisfw/trading-partners",
  })) as { data: JsonObject };

  const tpKeys = Object.keys(tps)
    .filter((key) => !key.startsWith("_"))
    .filter((key) => !key.includes("index"));

  for await (const tpKey of tpKeys) {
    trace({ tpKey });
    const { data: tp } = (await prod.get({
      path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
    })) as unknown as { data: any };
    if (tp.externalIds.includes("foodlogiq:undefined")) {
      await prod.put({
        path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
        data: {
          externalIds: tp.externalIds.filter(
            (k: string) => !k.includes("undefined"),
          ),
        },
      });
    }

    const { data: change } = (await prod.get({
      path: `${tp._id}/_meta/_changes/1`,
    })) as unknown as { data: any };

    if (change?.[0]?.body?.foodlogiq?.business?._id) {
      await prod.put({
        path: `/bookmarks/trellisfw/trading-partners/${tpKey}`,
        data: {
          externalIds: [`foodlogiq:${change[0].body.foodlogiq.business._id}`],
        },
      });
    } else {
      warn("No foodlogiq id found for TP:", tp._id);
    }
  }

  process.exit();
}

// Fix some old still-queued jobs that used the old masterid implementation
async function fixJobs() {
  const oada = await connect({
    domain,
    token,
  });
  const { data: expand } = (await oada.get({
    path: "/bookmarks/trellisfw/trading-partners/_meta/indexings/expand-index",
  })) as unknown as { data: any };
  const expandIndex = Object.entries(expand)
    .filter(([key, _]) => !key.startsWith("_"))
    .map(([_, value]) => value);
  const { data: jobs } = (await oada.get({
    path: "/bookmarks/services/fl-sync/jobs/pending",
  })) as unknown as { data: any };
  const keys = Object.keys(jobs).filter((k) => !k.startsWith("_"));
  for await (const jobKey of keys) {
    console.log("Job", jobKey);
    const { data: job } = (await oada.get({
      path: `/bookmarks/services/fl-sync/jobs/pending/${jobKey}`,
    })) as unknown as {
      data: { type: string; config: { masterid: string; bid: string } };
    };
    if (
      job.type === "document-mirrored" &&
      !job.config.masterid.startsWith("resources")
    ) {
      /*
      Console.log("Job missing proper masterid. FL bid is", job.config.bid);
      const { data: bus } = (await oada.get({
        path: `/bookmarks/services/fl-sync/businesses/${job.config.bid}`,
      })) as unknown as { data: { 'food-logiq-mirror': any } };
      // @ts-expect-error Running a worker function manually
      const result = (await handleFlBusiness({config: {'fl-business': bus['food-logiq-mirror']}},
        {
          oada,
        }
      )) as unknown as { masterid: string };
      if (!result?.masterid) {
        console.log("no masterid for flId", job.config.bid);
        continue;
      }
      console.log('masterid set as', result.masterid);
      */
      const result = expandIndex.find((object: any) =>
        object.externalIds.includes(`foodlogiq:${job.config.bid}`),
      ) as { masterid: string };
      if (!result?.masterid) {
        warn("no masterid for flId", job.config.bid);
        continue;
      }
      // Console.log('Found masterid', result.masterid);

      await oada.put({
        path: `/bookmarks/services/fl-sync/jobs/pending/${jobKey}`,
        data: {
          config: {
            masterid: result.masterid,
          },
        },
      });
      trace("put to job", jobKey);
    }
  }

  process.exit();
}

// Generate the Vendors list that still requires an SAP ID
// FYI this uses old non-v2 FL endpoints. v1 uses 'internalId' versus 'Internalid'
async function generateFLVendorsReport() {
  const { data } = (await fetch(
    `${FL_DOMAIN}/businesses/${CO_ID}/communities/${COMMUNITY_ID}/memberships`,
    {
      method: "get",
      headers: { Authorization: FL_TOKEN },
    },
  )) as unknown as any;

  const csvObject = data
    .filter(
      (s: any) =>
        s.locationGroup.name !== "Internal" &&
        s.productGroup.name !== "Internal",
    )
    .filter((s: any) => s.internalId === "")
    .map((s: any) => ({
      "FL Name": s.business.name.replaceAll(",", ""),
      "FL Address": s.business.address.addressLineOne.replaceAll(",", ""),
      "FL City": s.business.address.city.replaceAll(",", ""),
      "FL State": s.business.address.region.replaceAll(",", ""),
      "FL Link": `https://connect.foodlogiq.com/businesses/${CO_ID}/suppliers/detail/${s._id}/${COMMUNITY_ID}`,
    }))
    .sort((a: any, b: any) => {
      if (a["FL Name"] > b["FL Name"]) return 1;
      if (a["FL Name"] < b["FL Name"]) return -1;
      return 0;
    });
  const csvData = csvjson.toCSV(csvObject, {
    delimiter: ",",
    wrap: false,
    headers: "relative",
  });

  const date = Date.now().toLocaleString().split("T")[0];
  await fs.writeFile(`Vendor Report${date}.csv`, csvData, { encoding: "utf8" });
}

export async function generateFLDocsReport(inDate?: string) {
  const object: any = {};

  const oada = await connect({
    domain,
    token,
  });
  const { data: dates } = (await oada.get({
    path: "/bookmarks/services/fl-sync/jobs/reports/fl-sync-report/day-index",
  })) as unknown as any;

  const today = inDate ? new Date(inDate) : new Date();
  // @ts-expect-error you can subtract dates
  const now = new Date(today - today.getTimezoneOffset() * 60 * 1000);
  // @ts-expect-error you can subtract dates
  const lastWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);

  for (let index = 0; index < 50; index++) {
    // @ts-expect-error you can subtract dates
    const day = new Date(today - index * 24 * 60 * 60 * 1000);
    const date = day.toISOString().split("T")[0];

    try {
      const { data: report } = (await oada.get({
        path: `/bookmarks/services/fl-sync/jobs/reports/fl-sync-report/day-index/${date}`,
      })) as unknown as any;

      const data = Object.fromEntries(
        Object.entries(report)
          .filter(
            ([key, item]: [string, any]) =>
              !key.startsWith("_") &&
              new Date(item["Creation Date"]) > lastWeek,
          )
          .map(([key, item]) => [
            key,
            Object.fromEntries(
              // @ts-expect-error
              Object.entries(item).map(([k, it]: [string, string]) => [
                k,
                it.replaceAll(",", ""),
              ]),
            ),
          ]),
      );
      Object.assign(object, data);
    } catch {}
  }

  const csvObject = Object.values(object);
  const csvData = csvjson.toCSV(csvObject, {
    delimiter: ",",
    wrap: false,
    headers: "relative",
  });

  await fs.writeFile(
    `TrellisFLDocsReport${now.toISOString().split("T")[0]}.csv`,
    csvData,
    { encoding: "utf8" },
  );
  trace("done");
}

export async function generateIncrementalFLVendorsReport(inDate?: string) {
  const object: any = {};

  const oada = await connect({
    domain,
    token,
  });
  const { data: dates } = (await oada.get({
    path: "/bookmarks/services/fl-sync/jobs/reports/businesses-report/day-index",
  })) as unknown as any;

  const today = inDate ? new Date(inDate) : new Date();
  // @ts-expect-error you can subtract dates
  const now = new Date(today - today.getTimezoneOffset() * 60 * 1000);
  // @ts-expect-error you can subtract dates
  const lastWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);

  for (let index = 0; index < 7; index++) {
    // @ts-expect-error you can subtract dates
    const day = new Date(today - index * 24 * 60 * 60 * 1000);
    const date = day.toISOString().split("T")[0];

    try {
      const { data: report } = (await oada.get({
        path: `/bookmarks/services/fl-sync/jobs/reports/businesses-report/day-index/${date}`,
      })) as unknown as any;

      const data = Object.fromEntries(
        Object.entries(report)
          .filter(([key, _]: [string, unknown]) => !key.startsWith("_"))
          .map(([key, item]) => [
            key,
            Object.fromEntries(
              // @ts-expect-error
              Object.entries(item).map(([k, it]: [string, string]) => [
                k,
                it.replaceAll(",", ""),
              ]),
            ),
          ]),
      );

      Object.assign(object, data);
    } catch {}
  }

  const csvObject = Object.values(object);
  const csvData = csvjson.toCSV(csvObject, {
    delimiter: ",",
    wrap: false,
    headers: "relative",
  });

  await fs.writeFile(
    `TrellisFLVendorsReport${now.toISOString().split("T")[0]}.csv`,
    csvData,
    { encoding: "utf8" },
  );
  trace("done");
}

setInterval(() => {
  trace("stay alive");
}, 3000);
// Await loadVendors();
// await makeVendors();
// await makeReport();
// validateReportResponses();
// processReportResponses();
// await vendorPrepPriorToHandleReport();
// await copyProdData();

// await tradingPartnerPrep06142023();
// await tradingPartnerFix07102023();
// await updateFlInternalIds();
// await fixJobs();
// await generateFLVendorsReport();

// await generateFLDocsReport('2023-09-11');
await generateIncrementalFLVendorsReport("2023-09-11");
process.exit();
