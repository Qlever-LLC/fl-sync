async function fakeFlBusiness() {
  let bid = 'TRELLIS-TEST'+ksuid.randomSync().string;
  let mid = 'TRELLIS-TEST'+ksuid.randomSync().string;
  await con.put({
    path: `/bookmarks/services/fl-sync/businesses/${bid}`,
    data: {
      "food-logiq-mirror": {
        "_id": mid,
        "createdAt": "2021-05-21T01:31:42.436Z",
        "updatedAt": "0001-01-01T00:00:00Z",
        "business": {
          "_id": bid,
          "name": bid,
          "heroURL": "",
          "iconURL": "",
          "address": {
            "addressLineOne": "",
            "addressLineTwo": "",
            "addressLineThree": "",
            "city": "",
            "region": "WA",
            "country": "US",
            "postalCode": "",
            "latLng": {
              "latitude": 0,
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "dev_3pty@centricity.us",
          "phone": "9999999999"
        },
        "community": {
          "_id": "5fff03e0458562000f4586e9",
          "name": "Smithfield Foods",
          "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          "replyToEmail": "implementation@foodlogiq.com"
        },
        "locationGroup": {
          "_id": "604c0d48c57289000ef55861",
          "name": "Pork"
        },
        "productGroup": {
          "_id": "604132678b2178000ed4ffe1",
          "name": "Protein"
        },
        "buyers": null,
        "auditors": null,
        "expirationDate": null,
        "expiredRecently": false,
        "expires": false,
        "expiredSoon": false,
        "hasExpiredEntities": false,
        "hasExpiringEntities": false,
        "traceabilityOptions": null,
        "ratings": {},
        "overallRating": 0,
        "status": "Invitation Accepted",
        "statusCategory": "onboarding",
        "statusSetBy": "",
        "statusSetAt": "0001-01-01T00:00:00Z",
        "internalId": bid,
        "todoCount": 0,
        "eventSubmissionStats": null
      }
    },
    tree
  })
  return {bid, mid};
}

function newNonCoiDoc(bid) {
  return {
    "products": [],
    "locations": [],
    "contentType": "document",
    "shareRecipients": [
      {
        "community": {
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "address": {
            "addressLineOne": "",
            "addressLineTwo": "",
            "addressLineThree": "",
            "city": "",
            "region": "",
            "country": "",
            "postalCode": "",
            "latLng": {
              "latitude": 0,
              "longitude": 0
            }
          },
          "_id": "5fff03e0458562000f4586e9",
          "createdAt": "2021-03-04T20:44:22.823Z",
          "updatedAt": "2021-05-06T20:47:06.69Z",
          "name": "Smithfield Foods",
          "communityType": "member",
          "suppliersCanLink": false,
          "supplierCanLinkLocations": false,
          "suppliersCanLinkLocationsOfType": [],
          "email": "implementation@foodlogiq.com",
          "website": "",
          "phone": "",
          "membershipType": "Suppliers",
          "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          "heroURL": "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
          "feedPosts": null,
          "videoLinks": null,
          "links": null,
          "replyToEmail": "implementation@foodlogiq.com",
          "welcomeMessage": {
            "modalTitle": "Welcome",
            "bodyTitle": "Welcome to Smithfield Foods’ Supplier Portal",
            "bodyMessage": "FoodLogiQ Supplier Training Guide\n\nTo start, you'll be asked to collect and enter information about your business. You'll be guided along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.\n\nNeed Help with Onboarding?\no\tSupplier Onboarding Dashboard\no\tInviting Users\no\tAdding Locations\no\tAdding Products\no\tViewing and Completing Workflow Assignments\no\tWhat Do I Do with Expired Documents?\nQuestions?\nIf you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at support@foodlogiq.com.\n\nIf you have any questions regarding Smithfield’s Supplier Approval Program or it’s requirements, please contact Christopher Pantaleo at fsqasupplier@smithfield.com."
          },
          "onboardingInstructions": {
            "instructions": "<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class=\"MsoPlainText\">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class=\"MsoPlainText\">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class=\"MsoPlainText\">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company's individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you'll be asked to collect and enter information about your business. You'll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u><a href=\"https://connect.foodlogiq.com/view/5d644b38855b520001c38a5a\" target=\"_blank\">FoodLogiQ Supplier Training Guide</a></u></b><br></p><p><br></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type=\"disc\">  <ul type=\"circle\">   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard\"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting\">Inviting       Users</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667\">Adding       Locations</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667\">Adding       Products</a></u></li>   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments\"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647\" target=\"_blank\">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href=\"mailto:support@foodlogiq.com\"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href=\"mailto:fsqasupplier@smithfield.com\"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href=\"mailto:fsqasupplier@smithfield.com\"></u></p><p></p>"
          }
        },
        "type": {
          "_id": "606541432200de000e6faf58",
          "createdAt": "2021-04-01T03:42:59.448Z",
          "updatedAt": "2021-05-12T21:04:57.192Z",
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods Corp.",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6047bc14eaaf2e00014f4af1",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "name": "Animal Welfare Audit",
          "template": {
            "S3Name": "",
            "fileName": "",
            "BucketName": "",
            "updatedAt": "2021-03-09T21:21:15.078Z"
          },
          "attributes": [
            {
              "fieldType": "text",
              "storedAs": "certificationBody",
              "commonName": "Certification Body",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "text",
              "storedAs": "gradeScore",
              "commonName": "Grade / Score",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "bool",
              "storedAs": "isAuditorPaacoCertified",
              "commonName": "Is Auditor PAACO Certified?",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            }
          ],
          "helpText": "Please upload your current 3rd Party Animal Welfare Audit.",
          "associateWith": "",
          "category": "Food Safety",
          "defaultAttributes": {
            "expirationDate": true
          },
          "is3rdPartyAudit": false,
          "scopes": [],
          "certificationBodies": [],
          "whoToNotify": {
            "rolesToNotify": [],
            "notifyBuyer": false,
            "notifyAdministrator": false
          },
          "whoCanEdit": {
            "administratorCanEdit": false,
            "rolesCanEdit": []
          },
          "requirement": "",
          "community": {
            "_id": "5fff03e0458562000f4586e9",
            "name": "Smithfield Foods",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
            "replyToEmail": "implementation@foodlogiq.com"
          }
        },
        "shareSpecificAttributes": {
          "certificationBody": "Mereiux",
          "gradeScore": "A+",
          "isAuditorPaacoCertified": true
        }
      }
    ],
    "expirationDate": "2021-10-30T16:00:00.000Z",
    "name": "TRELLIS-TEST-AnimalWelfare",
    "attachments": [
      {
        "S3Name": "61113ccb41ae7b000e8bc95c",
        "fileName": "BDKFoods-COI.pdf",
        "BucketName": "fcmdev",
        "updatedAt": "2021-08-09T14:33:47.22799089Z"
      }
    ]
  }
}

function testNonCoiDoc(bid) {
  return {
    "products": [],
    "locations": [],
    "contentType": "document",
    "shareRecipients": [
      {
        "community": {
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "address": {
            "addressLineOne": "",
            "addressLineTwo": "",
            "addressLineThree": "",
            "city": "",
            "region": "",
            "country": "",
            "postalCode": "",
            "latLng": {
              "latitude": 0,
              "longitude": 0
            }
          },
          "_id": "5fff03e0458562000f4586e9",
          "createdAt": "2021-03-04T20:44:22.823Z",
          "updatedAt": "2021-05-06T20:47:06.69Z",
          "name": "Smithfield Foods",
          "communityType": "member",
          "suppliersCanLink": false,
          "supplierCanLinkLocations": false,
          "suppliersCanLinkLocationsOfType": [],
          "email": "implementation@foodlogiq.com",
          "website": "",
          "phone": "",
          "membershipType": "Suppliers",
          "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          "heroURL": "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
          "feedPosts": null,
          "videoLinks": null,
          "links": null,
          "replyToEmail": "implementation@foodlogiq.com",
          "welcomeMessage": {
            "modalTitle": "Welcome",
            "bodyTitle": "Welcome to Smithfield Foods’ Supplier Portal",
            "bodyMessage": "FoodLogiQ Supplier Training Guide\n\nTo start, you'll be asked to collect and enter information about your business. You'll be guided along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.\n\nNeed Help with Onboarding?\no\tSupplier Onboarding Dashboard\no\tInviting Users\no\tAdding Locations\no\tAdding Products\no\tViewing and Completing Workflow Assignments\no\tWhat Do I Do with Expired Documents?\nQuestions?\nIf you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at support@foodlogiq.com.\n\nIf you have any questions regarding Smithfield’s Supplier Approval Program or it’s requirements, please contact Christopher Pantaleo at fsqasupplier@smithfield.com."
          },
          "onboardingInstructions": {
            "instructions": "<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class=\"MsoPlainText\">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class=\"MsoPlainText\">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class=\"MsoPlainText\">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company's individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you'll be asked to collect and enter information about your business. You'll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u><a href=\"https://connect.foodlogiq.com/view/5d644b38855b520001c38a5a\" target=\"_blank\">FoodLogiQ Supplier Training Guide</a></u></b><br></p><p><br></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type=\"disc\">  <ul type=\"circle\">   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard\"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting\">Inviting       Users</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667\">Adding       Locations</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667\">Adding       Products</a></u></li>   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments\"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647\" target=\"_blank\">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href=\"mailto:support@foodlogiq.com\"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href=\"mailto:fsqasupplier@smithfield.com\"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href=\"mailto:fsqasupplier@smithfield.com\"></u></p><p></p>"
          }
        },
        "type": {
          "_id": "6102f42341ae7b000e8abb4b",
          "createdAt": "2021-07-29T18:32:03.503Z",
          "updatedAt": "2021-07-29T18:33:14.539Z",
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "name": "Trellis Test Animal Welfare Audit",
          "template": {
            "S3Name": "",
            "fileName": "",
            "BucketName": "",
            "updatedAt": "2021-03-09T21:21:15.078Z"
          },
          "attributes": [
            {
              "fieldType": "text",
              "storedAs": "certificationBody",
              "commonName": "Certification Body",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "text",
              "storedAs": "gradeScore",
              "commonName": "Grade / Score",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "bool",
              "storedAs": "isAuditorPaacoCertified",
              "commonName": "Is Auditor PAACO Certified?",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "text",
              "storedAs": "customCentricityTest",
              "commonName": "Custom Centricity Test",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            }
          ],
          "helpText": "Please upload your current 3rd Party Animal Welfare Audit.",
          "associateWith": "",
          "category": "Food Safety",
          "defaultAttributes": {
            "expirationDate": true
          },
          "is3rdPartyAudit": false,
          "scopes": [],
          "certificationBodies": [],
          "whoToNotify": {
            "rolesToNotify": [],
            "notifyBuyer": false,
            "notifyAdministrator": false
          },
          "whoCanEdit": {
            "administratorCanEdit": false,
            "rolesCanEdit": []
          },
          "requirement": "",
          "community": {
            "_id": "5fff03e0458562000f4586e9",
            "name": "Smithfield Foods",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
            "replyToEmail": "implementation@foodlogiq.com"
          }
        },
        "shareSpecificAttributes": {
          "certificationBody": "Merieux",
          "gradeScore": "A+",
          "customCentricityTest": bid,
          "isAuditorPaacoCertified": true
        }
      }
    ],
    "name": "custom trellis animal welfare",
    "expirationDate": "2021-10-30T16:00:00.000Z",
    "attachments": [
      {
        "S3Name": "61041cd041ae7b000e8abcf9",
        "fileName": "Vendor Insurance Requirement Guide.pdf",
        "BucketName": "fcmdev",
        "updatedAt": "2021-07-30T15:37:52.23185725Z"
      }
    ]
  } 
}

function testCoiDoc(bid) {
  return {
    "products": [],
    "locations": [],
    "contentType": "document",
    "shareRecipients": [
      {
        "community": {
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "address": {
            "addressLineOne": "",
            "addressLineTwo": "",
            "addressLineThree": "",
            "city": "",
            "region": "",
            "country": "",
            "postalCode": "",
            "latLng": {
              "latitude": 0,
              "longitude": 0
            }
          },
          "_id": "5fff03e0458562000f4586e9",
          "createdAt": "2021-03-04T20:44:22.823Z",
          "updatedAt": "2021-05-06T20:47:06.69Z",
          "name": "Smithfield Foods",
          "communityType": "member",
          "suppliersCanLink": false,
          "supplierCanLinkLocations": false,
          "suppliersCanLinkLocationsOfType": [],
          "email": "implementation@foodlogiq.com",
          "website": "",
          "phone": "",
          "membershipType": "Suppliers",
          "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          "heroURL": "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
          "feedPosts": null,
          "videoLinks": null,
          "links": null,
          "replyToEmail": "implementation@foodlogiq.com",
          "welcomeMessage": {
            "modalTitle": "Welcome",
            "bodyTitle": "Welcome to Smithfield Foods’ Supplier Portal",
            "bodyMessage": "FoodLogiQ Supplier Training Guide\n\nTo start, you'll be asked to collect and enter information about your business. You'll be guided along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.\n\nNeed Help with Onboarding?\no\tSupplier Onboarding Dashboard\no\tInviting Users\no\tAdding Locations\no\tAdding Products\no\tViewing and Completing Workflow Assignments\no\tWhat Do I Do with Expired Documents?\nQuestions?\nIf you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at support@foodlogiq.com.\n\nIf you have any questions regarding Smithfield’s Supplier Approval Program or it’s requirements, please contact Christopher Pantaleo at fsqasupplier@smithfield.com."
          },
          "onboardingInstructions": {
            "instructions": "<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class=\"MsoPlainText\">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class=\"MsoPlainText\">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class=\"MsoPlainText\">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company's individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you'll be asked to collect and enter information about your business. You'll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u><a href=\"https://connect.foodlogiq.com/view/5d644b38855b520001c38a5a\" target=\"_blank\">FoodLogiQ Supplier Training Guide</a></u></b><br></p><p><br></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type=\"disc\">  <ul type=\"circle\">   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard\"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting\">Inviting       Users</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667\">Adding       Locations</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667\">Adding       Products</a></u></li>   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments\"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647\" target=\"_blank\">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href=\"mailto:support@foodlogiq.com\"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href=\"mailto:fsqasupplier@smithfield.com\"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href=\"mailto:fsqasupplier@smithfield.com\"></u></p><p></p>"
          }
        },
        "type": {
          "_id": "60653e5e18706f0011074ec8",
          "createdAt": "2021-04-01T03:30:38.377Z",
          "updatedAt": "2021-05-12T18:45:46.301Z",
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods Corp.",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6047bc14eaaf2e00014f4af1",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "name": "Centricity Test CoI",
          "template": {
            "S3Name": "60935ec3e8541c00121e8a1a",
            "fileName": "Vendor Insurance Requirement Guide.pdf",
            "BucketName": "flq-connect-production",
            "updatedAt": "2021-05-06T03:13:07.358Z"
          },
          "attributes": [
            {
              "fieldType": "date",
              "storedAs": "effectiveDate",
              "commonName": "Effective Date",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            },
            {
              "fieldType": "text",
              "storedAs": "customCentricity Test",
              "commonName": "Custom Centricity Test",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            }
          ],
          "helpText": "Please upload a Certificate of Insurance (COI) that meets the requirements listed in the Vendor Insurance Requirement Guide (refer to attachment).",
          "associateWith": "",
          "category": "Legal",
          "defaultAttributes": {
            "expirationDate": true
          },
          "is3rdPartyAudit": false,
          "scopes": [],
          "certificationBodies": [],
          "whoToNotify": {
            "rolesToNotify": [],
            "notifyBuyer": false,
            "notifyAdministrator": false
          },
          "whoCanEdit": {
            "administratorCanEdit": false,
            "rolesCanEdit": []
          },
          "requirement": "",
          "community": {
            "_id": "5fff03e0458562000f4586e9",
            "name": "Smithfield Foods",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
            "replyToEmail": "implementation@foodlogiq.com"
          }
        },
        "shareSpecificAttributes": {
          "effectiveDate": "2021-07-20T16:00:00.000Z",
          "customCentricityTest": bid,
        }
      }
    ],
    "expirationDate": "2021-10-30T16:00:00.000Z",
    "attachments": [
      {
        "S3Name": "60a7c425b22bd7000e45afac",
        "fileName": "BDKFoods-COI.pdf",
        "BucketName": "fcmdev",
        "updatedAt": "2021-05-21T14:31:01.374459593Z"
      }
    ],
    "name": "centricity test coi"
  }
}

function newCoiDoc() {
  return {
    "products": [],
    "locations": [],
    "contentType": "document",
    "shareRecipients": [
      {
        "community": {
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6094569c2985a700013e8a7d",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "address": {
            "addressLineOne": "",
            "addressLineTwo": "",
            "addressLineThree": "",
            "city": "",
            "region": "",
            "country": "",
            "postalCode": "",
            "latLng": {
              "latitude": 0,
              "longitude": 0
            }
          },
          "_id": "5fff03e0458562000f4586e9",
          "createdAt": "2021-03-04T20:44:22.823Z",
          "updatedAt": "2021-05-06T20:47:06.69Z",
          "name": "Smithfield Foods",
          "communityType": "member",
          "suppliersCanLink": false,
          "supplierCanLinkLocations": false,
          "suppliersCanLinkLocationsOfType": [],
          "email": "implementation@foodlogiq.com",
          "website": "",
          "phone": "",
          "membershipType": "Suppliers",
          "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
          "heroURL": "https://flq-connect-production.s3.amazonaws.com/60414295f6747a00017cd84c",
          "feedPosts": null,
          "videoLinks": null,
          "links": null,
          "replyToEmail": "implementation@foodlogiq.com",
          "welcomeMessage": {
            "modalTitle": "Welcome",
            "bodyTitle": "Welcome to Smithfield Foods’ Supplier Portal",
            "bodyMessage": "FoodLogiQ Supplier Training Guide\n\nTo start, you'll be asked to collect and enter information about your business. You'll be guided along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.\n\nNeed Help with Onboarding?\no\tSupplier Onboarding Dashboard\no\tInviting Users\no\tAdding Locations\no\tAdding Products\no\tViewing and Completing Workflow Assignments\no\tWhat Do I Do with Expired Documents?\nQuestions?\nIf you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at support@foodlogiq.com.\n\nIf you have any questions regarding Smithfield’s Supplier Approval Program or it’s requirements, please contact Christopher Pantaleo at fsqasupplier@smithfield.com."
          },
          "onboardingInstructions": {
            "instructions": "<h3></h3><h3><u></u></h3><h3><u>Welcome to Smithfield&#8217;s Supplier Portal</u></h3><p><b></b></p><p class=\"MsoPlainText\">Smithfield invites you to partner on a best in class Supplier Community Compliance Management System.</p><p class=\"MsoPlainText\">Customers are expressing an increasing amount of concern about Food Safety, Quality, Sustainability, and Transparency regarding the food we produce.&#160; We count on our supplier community to provide the required documentation to establish this confidence in our food products and supply chain.&#160; Managing all of this information has become challenging as you well know, so Smithfield is engaging our suppliers to create a modern, efficient, and flexible community system to address these concerns both now and in the future as needs change.</p><p class=\"MsoPlainText\">FoodLogiQ Connect will become an important means of evaluating our supplier community and your company's individual performance.</p><p></p><p><b><u>&#8203;</u></b></p><h4><u><b>Getting Started</b></u></h4><p>To start, you'll be asked to collect and enter information about your business. You'll be guided&#160;along the way, and if you have any questions, Smithfield and FoodLogiQ will be available for assistance.</p><p><b><u><a href=\"https://connect.foodlogiq.com/view/5d644b38855b520001c38a5a\" target=\"_blank\">FoodLogiQ Supplier Training Guide</a></u></b><br></p><p><br></p><h4><u><b>Need Help with Onboarding?</b></u><u></u></h4><ul type=\"disc\">  <ul type=\"circle\">   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002966367-Supplier-Onboarding-Dashboard\"><u>Supplier       Onboarding Dashboard</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360007944214-User-Management#inviting\">Inviting       Users</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002675667\">Adding       Locations</a></u></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115002673667\">Adding       Products</a></u></li>   <li><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/360026405313-Viewing-and-Completing-Workflow-Assignments\"><u>Viewing       and Completing Workflow Assignments</u></a></li>   <li><u><a href=\"https://knowledge.foodlogiq.com/hc/en-us/articles/115007674647\" target=\"_blank\">What Do I Do with Expired Documents?</a></u></li>  </ul> </ul><h4><u><br></u></h4><h4><u><b>Questions?</b></u></h4><p>If you have any Technical Issues with FoodLogiQ, please contact FoodLogiQ support at <a href=\"mailto:support@foodlogiq.com\"><u>support@foodlogiq.com</u></a>.</p><p></p><p>If you have any questions regarding Smithfield&#8217;s Supplier Approval Program or it&#8217;s requirements, please contact Christopher Pantaleo at <a href=\"mailto:fsqasupplier@smithfield.com\"><u>fsqasupplier@smithfield.com</u></a>.</p><p></p><p><u href=\"mailto:fsqasupplier@smithfield.com\"></u></p><p></p>"
          }
        },
        "type": {
          "_id": "60653e5e18706f0011074ec8",
          "createdAt": "2021-04-01T03:30:38.377Z",
          "updatedAt": "2021-05-12T18:45:46.301Z",
          "business": {
            "_id": "5acf7c2cfd7fa00001ce518d",
            "name": "Smithfield Foods Corp.",
            "heroURL": "",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/6047bc14eaaf2e00014f4af1",
            "address": {
              "addressLineOne": "401 North Church Street",
              "addressLineTwo": "",
              "addressLineThree": "",
              "city": "Smithfield",
              "region": "VA",
              "country": "US",
              "postalCode": "23430",
              "latLng": {
                "latitude": 36.9904087,
                "longitude": -76.6305249
              }
            },
            "website": "http://www.smithfieldfoods.com/",
            "email": "cpantaleo@smithfield.com",
            "phone": "(757) 365-3529"
          },
          "name": "Certificate of Insurance",
          "template": {
            "S3Name": "60935ec3e8541c00121e8a1a",
            "fileName": "Vendor Insurance Requirement Guide.pdf",
            "BucketName": "flq-connect-production",
            "updatedAt": "2021-05-06T03:13:07.358Z"
          },
          "attributes": [
            {
              "fieldType": "date",
              "storedAs": "effectiveDate",
              "commonName": "Effective Date",
              "required": true,
              "options": null,
              "multiple": false,
              "includeOtherOpt": false,
              "isCustom": false,
              "fieldOne": null,
              "fieldTwo": null
            }
          ],
          "helpText": "Please upload a Certificate of Insurance (COI) that meets the requirements listed in the Vendor Insurance Requirement Guide (refer to attachment).",
          "associateWith": "",
          "category": "Legal",
          "defaultAttributes": {
            "expirationDate": true
          },
          "is3rdPartyAudit": false,
          "scopes": [],
          "certificationBodies": [],
          "whoToNotify": {
            "rolesToNotify": [],
            "notifyBuyer": false,
            "notifyAdministrator": false
          },
          "whoCanEdit": {
            "administratorCanEdit": false,
            "rolesCanEdit": []
          },
          "requirement": "",
          "community": {
            "_id": "5fff03e0458562000f4586e9",
            "name": "Smithfield Foods",
            "iconURL": "https://flq-connect-production.s3.amazonaws.com/609455ca3c810e0001a08779",
            "replyToEmail": "implementation@foodlogiq.com"
          }
        },
        "shareSpecificAttributes": {
          "effectiveDate": "2021-05-20T16:00:00.000Z"
        }
      }
    ],
    "expirationDate": "2021-10-30T16:00:00.000Z",
    "attachments": [
      {
        "S3Name": "60a7c425b22bd7000e45afac",
        "fileName": "BDKFoods-COI.pdf",
        "BucketName": "fcmdev",
        "updatedAt": "2021-05-21T14:31:01.374459593Z"
      }
    ],
    "name": "TRELLIS-TEST-COI"
  }
}



module.exports = {
  fakeFlBusiness,
  testNonCoiDoc,
  testCoiDoc,
  newCoiDoc,
  newNonCoiDoc,
}
