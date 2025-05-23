/**
 * @license
 * Copyright 2024 Qlever LLC
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

/* eslint-disable sonarjs/no-duplicate-string, unicorn/no-null */

import config from "../dist/config.js";

import test from "ava";

import { setTimeout } from "node:timers/promises";

import sql from "mssql";

import { ensureTable, fetchIncidentsCsv } from "../dist/flIncidentsCsv.js";
// Import moment from 'moment';
//
const FL_TOKEN = config.get("foodlogiq.token") || "";
const FL_DOMAIN = config.get("foodlogiq.domain") || "";
const CO_ID = config.get("foodlogiq.community.owner.id");
const { database, server, user, password, port, interval, table } =
  config.get("incidents");
/*
Const SUPPLIER = config.get('foodlogiq.testSupplier.id');
const TOKEN = process.env.TOKEN || ''; // || config.get('trellis.token') || '';
const DOMAIN = config.get('trellis.domain') || '';
const SERVICE_PATH = config.get('service.path') as unknown as TreeKey;
const SERVICE_NAME = config.get('service.name') as unknown as TreeKey;
if (SERVICE_NAME && tree?.bookmarks?.services?.['fl-sync']) {
  tree.bookmarks.services[SERVICE_NAME] = tree.bookmarks.services['fl-sync'];
}
*/

const sqlConfig = {
  server,
  database,
  user,
  password,
  port,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// @ts-expect-error mssql docs show an await on connect...
await sql.connect(sqlConfig);

test.before((t) => {
  t.timeout(60_000);
});

test.skip("test csv stuff", async (t) => {
  t.timeout(200_000);
  const result = await ensureTable();
  t.log(result);
  t.truthy(result);
});

test.skip("test big initial load of csv data", async (t) => {
  t.timeout(200_000);
  const startTime = "2021-09-01";
  const endTime = "2022-09-13";
  await fetchIncidentsCsv({ startTime, endTime });
});

test.skip("test short period of csv data", async (t) => {
  t.timeout(200_000);
  const startTime = "2022-09-15";
  const endTime = "2022-09-28";
  await fetchIncidentsCsv({ startTime: endTime, endTime: "" });
});

test("write a new incident and wait for Trellis to get it.", async (t) => {
  t.timeout(200_000);
  const incidentId = "63331d4d73ff53000fe4679c";
  const data = {
    createSource: "connect",
    community: {
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
          latLng: { latitude: 36.990_505_2, longitude: -76.631_072_699_999_99 },
        },
        website: "http://www.smithfieldfoods.com/",
        email: "cpantaleo@smithfield.com",
        phone: "(757) 365-3529",
      },
      address: {
        addressLineOne: "",
        addressLineTwo: "",
        addressLineThree: "",
        city: "",
        region: "",
        country: "",
        postalCode: "",
        latLng: { latitude: 0, longitude: 0 },
      },
      _id: "5fff03e0458562000f4586e9",
      createdAt: "2021-03-04T20:44:22.823Z",
      updatedAt: "2021-12-29T00:28:19.202Z",
      name: "Smithfield Foods",
      communityType: "managed",
      suppliersCanLink: false,
      supplierCanLinkLocations: false,
      suppliersCanLinkLocationsOfType: [],
      email: "implementation@foodlogiq.com",
      website: "",
      phone: "",
      membershipType: "Suppliers",
      iconURL:
        "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
      heroURL:
        "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
      feedPosts: null,
      videoLinks: null,
      links: null,
      replyToEmail: "cpantaleo@smithfield.com",
      welcomeMessage: {
        modalTitle: "Welcome",
        bodyTitle: "Welcome to Smithfield Foods’ Supplier Portal",
        bodyMessage:
          "Smithfield Foods has created this community for you to share information about your company, people, products, and food safety programs, and to provide a convenient location for us to communicate with our supplier partners like you.\nIf you have questions at any time about the program your supplier manager will act as your main contact.",
      },
      onboardingInstructions: {
        instructions:
          '<div><h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class="MsoPlainText">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class="MsoPlainText">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class="MsoPlainText">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company\'s individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you\'ll be asked to collect and enter information about your business. You\'ll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u>Available Resources</u></b>&#8203;</p><p><a href="https://connect.foodlogiq.com/view/60de21d29c09d3000ef2fef0" target=""><u>Supplier Management Webinar Recording&#8203;</u></a></p><p><a href="https://connect.foodlogiq.com/view/60ad3f07f0ba6a000ef4fff6" target="_blank"><u>Supplier Management Webinar Slide Deck</u></a></p><p><u><a href="https://connect.foodlogiq.com/view/61d8a61a179e94000e5117e7" target="_blank">Supplier Incident Reporting Process Recording</a></u></p><p><u><a href="https://connect.foodlogiq.com/view/61d8a7abc032a9000e3650e8" target="_blank">Supplier Incident Reporting Process Slide Deck</a></u></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type="disc">  <ul type="circle">   <li><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard" target="_blank"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting" target="_blank">Inviting       Users</a></u></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667" target="_blank">Adding       Locations</a></u></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667">Adding       Products</a></u></li>   <li><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647" target="_blank">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href="mailto:support@foodlogiq.com"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href="mailto:fsqasupplier@smithfield.com"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href="mailto:fsqasupplier@smithfield.com"></u></p><p></p></div>',
      },
    },
    incidentDate: "2022-09-26T14:32:00.000Z",
    incidentType: { _id: "622f5c1254e246000f9d3097", name: "Claim Request" },
    currentStatus: {
      id: 9,
      name: "Plant to Plant Claim Submission",
      visibilityOptions: {
        isForSupplier: false,
        isForBuyer: false,
        isForDistributor: false,
        isForCreator: false,
        roles: [],
        notifyOnAttributeSelection: [],
        supplyChainMemberFields: [],
      },
      editOptions: {
        isForSupplier: false,
        isForBuyer: false,
        isForDistributor: false,
        isForCreator: true,
        roles: ["61eaaa54719715000ebed68d"],
        notifyOnAttributeSelection: [],
        supplyChainMemberFields: [],
      },
      notificationOptions: {
        isForSupplier: false,
        isForBuyer: false,
        isForDistributor: false,
        isForCreator: false,
        roles: [],
        notifyOnAttributeSelection: [],
        supplyChainMemberFields: [],
      },
      attributesCaptured: [16, 28, 8],
      attributesVisible: [],
      transitions: [{ name: "Submit to Plant", goesTo: 24 }],
      emailSubject: "",
      emailText: "",
      deleteAllowed: true,
      isResolved: false,
      dueInHours: null,
      autoChange: null,
      reminderFrequencyInHours: null,
      stepType: "internal",
    },
    extraAttributes: {
      informationNeeded: "some needed info",
      informationNeeded1: "acknowledgement info",
      isThereAComplaintRelatedToThisClaim1: false,
      isTheRelatedIncidentLinkedOnTheRightSideOfTheScreen: false,
      acknowledgeClaimProcess: false,
      sourceOfClaim: "CoPacker",
      reporterName: "Trellis Test",
      poSto: 541_916_516,
      claimAmountRequested: 532.14,
      claimReason: "Product Loss",
      claimComments: "some comment",
      estNo: "2332523",
      claimReviewed: "Need More Information",
      buyerClaimComments: "some buyer claim comment",
      claimFinalReview: "Approved",
      finalReviewComments: "a final review comment",
    },
    location: {
      _id: "5ee8f3ea0114240001fe6de0",
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
          latLng: { latitude: 36.990_505_2, longitude: -76.631_072_699_999_99 },
        },
        website: "http://www.smithfieldfoods.com/",
        email: "cpantaleo@smithfield.com",
        phone: "(757) 365-3529",
      },
      name: "1202 - Pine Ridge Farms (1801 Maury) - Des Moines",
      type: "Manufacturing Facility",
      internalId: "",
      globalLocationNumber: "",
      noGlnRequired: true,
      description: "",
      address: {
        addressLineOne: "1801 Maury Street",
        addressLineTwo: "",
        addressLineThree: "",
        city: "Des Moines",
        region: "IA",
        country: "US",
        postalCode: "50317",
        latLng: { latitude: 41.579_786_000_000_01, longitude: -93.586_581 },
      },
      associatedCommunities: [],
      supplyChainId: "618a96dba6baf6000e4b31fb",
      versionInfo: {
        isCurrentVersion: true,
        currentVersionId: "5ee8f3ea0114240001fe6de0",
        createdAt: "2021-12-08T16:43:14.536Z",
        createdBy: {
          _id: "60aca45003fb37000ea1a1e5",
          firstName: "Mary",
          lastName: "Garcia",
        },
      },
      shareWithSuppliersOfCommunities: [],
      shareRecipients: [
        {
          shareSpecificAttributes: {
            amsFoodDefenseCertified: ["No"],
            applicableProcessingSeason: [],
            businessNamesPreviouslyDoingBusinessAsPdba: "",
            category: ["Raw Pork - Pork Slaughter"],
            contact1EmailAddress: "cpantaleo@smithfield.com",
            contact1Name: "Christopher Pantaleo",
            contact1PhoneNumber: "(757) 365-3529",
            contact1Title: "FSQA Compliance Manager",
            exportEligibility: [],
            fsisCategoryStatus: [],
            fsqaSupplierCategoryManager: ["Marcus Puente"],
            gfsiCertified: ["Yes"],
            labelClaimQualifications: [],
            parentCompanyCountry: [],
            parentCompanyCountry2: [],
            parentCompanyState: [],
            processCapability: ["Raw Processing", "Slaughter"],
            procurementCategoryManager: ["Darryl Baedke"],
            regulatoryRegistration: ["USDA"],
            superRegion: ["North America"],
            usdaEstablishmentNumber: "1775",
          },
          type: {
            _id: "5bce6aeab0c35c000100342e",
            name: "Raw Pork",
            category: "",
          },
          approvalInfo: {
            status: "Approved",
            setAt: "2020-06-19T18:56:15.337Z",
            setBy: {
              _id: "5c70728e7bd4ef00010cf30c",
              firstName: "Patty",
              lastName: "Lacour",
            },
          },
          complianceInfo: {
            status: "compliant",
            setAt: "2022-04-08T17:31:18.665Z",
          },
          hasCorrectiveActions: false,
          incidentContacts: [
            {
              _id: "5b73178405b3760001f40f71",
              firstName: "Christopher",
              lastName: "Pantaleo",
              email: "cpantaleo@smithfield.com",
              contactTimeZone: null,
              phone: "+17573653529",
              phoneExt: "",
              mobile: "+17578101794",
            },
          ],
          community: {
            _id: "5b296a148aea380001d83fa6",
            name: "Tyson Foods",
            iconURL:
              "https://flq-connect-production.s3.amazonaws.com/6151eaf23b82d200017ada30",
            replyToEmail: "Patty.Lacour@tyson.com",
          },
        },
      ],
      timeZone: {
        daylightSavingsOffset: 3600,
        utcOffset: -21_600,
        timeZoneId: "America/Chicago",
        timeZoneName: "Central Daylight Time",
      },
      phone: "",
      createdOnBehalf: false,
      privateData: {},
      todoCount: 0,
    },
    supplyChainMembersByField: {
      plant: {
        _id: "61942c4369fa12000ffe117f",
        business: {
          _id: "61942c421d5267000f3b7825",
          name: "1202 - Pine Ridge (2568) - Internal Supplier",
        },
        label: "1202 - Pine Ridge (2568) - Internal Supplier",
        productGroup: { _id: "61893ee4f4f178000f467c08", name: "Internal" },
        locationGroup: { _id: "61893eddf4f178000f467c06", name: "Internal" },
      },
    },
    sourceMembership: {
      _id: "61942c4369fa12000ffe117f",
      business: {
        _id: "61942c421d5267000f3b7825",
        name: "1202 - Pine Ridge (2568) - Internal Supplier",
      },
      label: "1202 - Pine Ridge (2568) - Internal Supplier",
      productGroup: { _id: "61893ee4f4f178000f467c08", name: "Internal" },
      locationGroup: { _id: "61893eddf4f178000f467c06", name: "Internal" },
    },
    product: {
      manualEntry: true,
      globalTradeItemNumber: "34534663346467",
      lot: "546116",
      name: "Test Product",
    },
    comment: "some plant to plant comment before submitting",
  };
  data.extraAttributes.estNo = Number.parseInt(
    `${Math.random() * 100_000}`,
    10,
  ).toString();
  // Get the before state
  const query = `SELECT * FROM incidents WHERE Id = '${incidentId}'`;
  t.log({ query });
  const before = await sql.query(`${query}`);
  t.log(before);
  await fetch(`${FL_DOMAIN}/v2/businesses/${CO_ID}/incidents/${incidentId}`, {
    method: "put",
    headers: { Authorization: FL_TOKEN },
    body: JSON.stringify(data),
  });
  const startTime = new Date().toISOString().slice(0, 10);
  await fetchIncidentsCsv({ startTime, endTime: startTime });
  const after = await sql.query(`${query}`);
  t.log({ after });
  await setTimeout(20_000);
  t.not(before, after);
});
