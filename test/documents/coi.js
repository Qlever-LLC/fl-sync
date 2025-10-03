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

/* eslint-disable unicorn/no-null */

import config from "../../dist/config.js";

const CO_ID = config.get("foodlogiq.community.owner.id");
const CO_NAME = config.get("foodlogiq.community.owner.name");
const COMMUNITY_ID = config.get("foodlogiq.community.id");
const COMMUNITY_NAME = config.get("foodlogiq.community.name");

export const coi = {
  products: [],
  locations: [],
  contentType: "document",
  shareRecipients: [
    {
      community: {
        business: {
          _id: CO_ID,
          name: CO_NAME,
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
              latitude: 36.990_408_7,
              longitude: -76.630_524_9,
            },
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
          latLng: {
            latitude: 0,
            longitude: 0,
          },
        },
        _id: COMMUNITY_ID,
        createdAt: "2021-03-04T20:44:22.823Z",
        updatedAt: "2021-05-06T20:47:06.69Z",
        name: COMMUNITY_NAME,
        communityType: "member",
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
        replyToEmail: "implementation@foodlogiq.com",
        welcomeMessage: {
          modalTitle: "Welcome",
          bodyTitle: "Welcome to Smithfield Foods’ Supplier Portal",
          bodyMessage:
            "Smithfield Foods has created this community for you to share information about your company, people, products, and food safety programs, and to provide a convenient location for us to communicate with our supplier partners like you.\nIf you have questions at any time about the program your supplier manager will act as your main contact.",
        },
        onboardingInstructions: {
          instructions:
            '<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class="MsoPlainText">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class="MsoPlainText">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class="MsoPlainText">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company\'s individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you\'ll be asked to collect and enter information about your business. You\'ll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u>Available Resources</u></b><br></p><p><a href="https://connect.foodlogiq.com/view/60de21d29c09d3000ef2fef0" target="">Supplier Management Webinar Recording&#8203;</a></p><p><a href="https://connect.foodlogiq.com/view/60ad3f07f0ba6a000ef4fff6" target="_blank">Supplier Management Webinar Slide Deck</a></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type="disc">  <ul type="circle">   <li><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard" target="_blank"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting" target="_blank">Inviting       Users</a></u></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667" target="_blank">Adding       Locations</a></u></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667">Adding       Products</a></u></li>   <li><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href="https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647" target="_blank">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href="mailto:support@foodlogiq.com"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href="mailto:fsqasupplier@smithfield.com"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href="mailto:fsqasupplier@smithfield.com"></u></p><p></p>',
        },
      },
      type: {
        _id: "60653e5e18706f0011074ec8",
        createdAt: "2021-04-01T03:30:38.377Z",
        updatedAt: "2021-06-06T21:51:03.079Z",
        business: {
          _id: CO_ID,
          name: CO_NAME,
          heroURL: "",
          iconURL:
            "https://flq-connect-production.s3.amazonaws.com/6047bc14eaaf2e00014f4af1",
          address: {
            addressLineOne: "401 North Church Street",
            addressLineTwo: "",
            addressLineThree: "",
            city: "Smithfield",
            region: "VA",
            country: "US",
            postalCode: "23430",
            latLng: {
              latitude: 36.990_408_7,
              longitude: -76.630_524_9,
            },
          },
          website: "http://www.smithfieldfoods.com/",
          email: "cpantaleo@smithfield.com",
          phone: "(757) 365-3529",
        },
        name: "Certificate of Insurance",
        template: {
          S3Name: "60935ec3e8541c00121e8a1a",
          fileName: "Vendor Insurance Requirement Guide.pdf",
          BucketName: "flq-connect-production",
          updatedAt: "2021-05-06T03:13:07.358Z",
        },
        attributes: [
          {
            fieldType: "date",
            storedAs: "effectiveDate",
            commonName: "Effective Date",
            required: true,
            options: null,
            multiple: false,
            includeOtherOpt: false,
            isCustom: false,
            fieldOne: null,
            fieldTwo: null,
          },
        ],
        helpText:
          "Please upload a Certificate of Insurance (COI) that meets the requirements listed in the Vendor Insurance Requirement Guide (refer to attachment).",
        associateWith: "",
        category: "Legal",
        defaultAttributes: {
          expirationDate: true,
        },
        is3rdPartyAudit: false,
        scopes: [],
        certificationBodies: [],
        whoToNotify: {
          rolesToNotify: [
            {
              _id: "6081f0f618706f000fc81896",
              name: "FSQA Compliance Manager",
            },
          ],
          notifyBuyer: false,
          notifyAdministrator: false,
        },
        whoCanEdit: {
          administratorCanEdit: false,
          rolesCanEdit: [],
        },
        requirement: "",
        community: {
          _id: "5fff03e0458562000f4586e9",
          name: "Smithfield Foods",
          iconURL:
            "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          replyToEmail: "implementation@foodlogiq.com",
        },
      },
      shareSpecificAttributes: {
        effectiveDate: "2021-11-01T16:00:00.000Z",
      },
    },
  ],
  name: "test coi",
  expirationDate: "2022-10-30T16:00:00.000Z",
  attachments: [
    {
      S3Name: "620037bc17e808000e3ceb82",
      fileName: "BDKFoods-COI-2022.pdf",
      BucketName: "fcmdev",
      updatedAt: "2022-02-06T21:03:56.036043003Z",
    },
    {
      S3Name: "620039ec17e808000e3ceb83",
      fileName: "BDKFoods-COI-2022-ReducedCoverage.pdf",
      BucketName: "fcmdev",
      updatedAt: "2022-02-06T21:13:16.736728817Z",
    },
  ],
};

export default coi;
