let attach = require('./attach.js');

module.exports = {
  '{{Host}}/v2/businesses/{{BusinessID}}/documents?sourceCommunities={{CommunityID}}&sourceBusiness={{BusinessID}}': {
    "pageItems": [
      {
        "_id": "601afda253b391000e4a7a8e",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "SQF Audit North",
        "originalName": "SQF Audit North",
        "attachments": [
          {
            "S3Name": "601afd4c53b391000e4a7a8c",
            "fileName": "SQF Audit - North (FS) 06.25.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": "2022-02-05T12:00:00Z",
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": false
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "approved",
            "setAt": "2021-02-09T05:06:26.384Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-03T20:19:27.676Z"
          },
          "hasCorrectiveActions": true,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "601afda253b391000e4a7a8d",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "601afda253b391000e4a7a8e",
          "createdAt": "2021-02-09T05:06:26.412Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "60243df053b391000ec08791",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test Doc",
        "originalName": "Test Doc",
        "attachments": [
          {
            "S3Name": "60243dd953b391000ec0878f",
            "fileName": "SQF Audit - Cudahy (QA) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "approved",
            "setAt": "2021-02-10T20:11:58.472Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:11:28.659Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "60243df053b391000ec08790",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "60243df053b391000ec08791",
          "createdAt": "2021-02-10T20:11:58.473Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "6024433753b391000ec087aa",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test abc",
        "originalName": "Test abc",
        "attachments": [
          {
            "S3Name": "6024433453b391000ec087a8",
            "fileName": "SQF Audit - Cudahy (QA) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "rejected",
            "setAt": "2021-02-10T20:36:32.277Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:33:59.833Z"
          },
          "hasCorrectiveActions": true,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "6024433753b391000ec087a9",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "6024433753b391000ec087aa",
          "createdAt": "2021-02-10T20:36:32.28Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "602445eb53b391000ec087bb",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test with Product",
        "originalName": "Test with Product",
        "attachments": [
          {
            "S3Name": "602445c253b391000ec087b8",
            "fileName": "SQF Audit - Cudahy (FS) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [
          {
            "_id": "6024144a53b391000ec08781",
            "name": "Another Test Location",
            "globalLocationNumber": "",
            "type": ""
          }
        ],
        "products": [
          {
            "_id": "602439d753b391000ec0878a",
            "globalTradeItemNumber": "",
            "name": "Ham Hocks"
          }
        ],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "awaiting-review",
            "setAt": null,
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:45:31.35Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "602445d653b391000ec087b9",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602445eb53b391000ec087bb",
          "createdAt": "2021-02-10T20:45:31.355Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      }
    ],
    "pageItemCount": 4,
    "totalItemCount": 4,
    "hasNextPage": false
  },
  '{{Host}}/v2/businesses/{{BusinessID}}/documents/{{DocumentID}}/attachments': attach,
  '{{Host}}/v2/businesses/{{BusinessID}}/documents/{{DocumentID}}/approvalStatus/approved':{},
  '{{Host}}/v2/businesses/{{BusinessID}}/communities/{{CommunityID}}/memberships':{
    'pageItems': [{
      '_id': 'testmemberid_abc123',
      'business': {
        "_id": "601af61b53b391000e4a7a3e",
        "name": "Centricity Test Account",
        "heroURL": "",
        "iconURL": "",
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
            "longitude": 0,
            "warnings": [
              "A street address is required to geocode your address."
            ]
          }
        },
        "website": "",
        "email": "no@no.com",
        "phone": "5555555555"
      }
    }],
    "pageItemCount": 1,
    "totalItemCount": 1,
    "hasNextPage": false
  },
  '{{Host}}/v2/businesses/{{BusinessID}}/documents?sourceBusiness={{SupplierID}}&versionUpdated={{Date}}': {
    "pageItems": [
      {
        "_id": "601afda253b391000e4a7a8e",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "SQF Audit North",
        "originalName": "SQF Audit North",
        "attachments": [
          {
            "S3Name": "601afd4c53b391000e4a7a8c",
            "fileName": "SQF Audit - North (FS) 06.25.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": "2022-02-05T12:00:00Z",
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": false
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "approved",
            "setAt": "2021-02-09T05:06:26.384Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-03T20:19:27.676Z"
          },
          "hasCorrectiveActions": true,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "601afda253b391000e4a7a8d",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "601afda253b391000e4a7a8e",
          "createdAt": "2021-02-09T05:06:26.412Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "60243df053b391000ec08791",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test Doc",
        "originalName": "Test Doc",
        "attachments": [
          {
            "S3Name": "60243dd953b391000ec0878f",
            "fileName": "SQF Audit - Cudahy (QA) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "approved",
            "setAt": "2021-02-10T20:11:58.472Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:11:28.659Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "60243df053b391000ec08790",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "60243df053b391000ec08791",
          "createdAt": "2021-02-10T20:11:58.473Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "6024433753b391000ec087aa",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test abc",
        "originalName": "Test abc",
        "attachments": [
          {
            "S3Name": "6024433453b391000ec087a8",
            "fileName": "SQF Audit - Cudahy (QA) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [],
        "products": [],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "rejected",
            "setAt": "2021-02-10T20:36:32.277Z",
            "setBy": {
              "_id": "5e27480dd85523000155f6db",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:33:59.833Z"
          },
          "hasCorrectiveActions": true,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "6024433753b391000ec087a9",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "6024433753b391000ec087aa",
          "createdAt": "2021-02-10T20:36:32.28Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      },
      {
        "_id": "602445eb53b391000ec087bb",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test with Product",
        "originalName": "Test with Product",
        "attachments": [
          {
            "S3Name": "602445c253b391000ec087b8",
            "fileName": "SQF Audit - Cudahy (FS) 08.05.19.pdf",
            "BucketName": "fcmdev",
            "updatedAt": "0001-01-01T00:00:00Z"
          }
        ],
        "locations": [
          {
            "_id": "6024144a53b391000ec08781",
            "name": "Another Test Location",
            "globalLocationNumber": "",
            "type": ""
          }
        ],
        "products": [
          {
            "_id": "602439d753b391000ec0878a",
            "globalTradeItemNumber": "",
            "name": "Ham Hocks"
          }
        ],
        "expirationDate": null,
        "isArchived": false,
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {
            "customTest1": true
          },
          "type": {
            "_id": "601afc7053b391000e4a7a88",
            "name": "FSQA",
            "category": "FSQA"
          },
          "approvalInfo": {
            "status": "awaiting-review",
            "setAt": null,
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T20:45:31.35Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "602445d653b391000ec087b9",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          }
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602445eb53b391000ec087bb",
          "createdAt": "2021-02-10T20:45:31.355Z",
          "createdBy": {
            "_id": "5e27480dd85523000155f6db",
            "firstName": "",
            "lastName": ""
          }
        },
        "tags": null,
        "links": null,
        "contentType": "document",
        "auditAttributes": null,
        "ExpirationEmailSentAt": null,
        "archivedInCommunity": {}
      }
    ],
    "pageItemCount": 4,
    "totalItemCount": 4,
    "hasNextPage": false
  },
  '{{Host}}/v2/businesses/{{BusinessID}}/products?sourceBusiness={{SupplierID}}&versionUpdated={{Date}}': {
    "pageItems": [
      {
        "_id": "602587ce53b391000ec08807",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602587ce53b391000ec08807",
          "createdAt": "2021-02-11T19:38:54.157Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-11T19:38:54.157Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-11T19:38:54.152Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "602587ce53b391000ec08806",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "privateData": {},
        "noGtinRequired": true,
        "name": "Bacon Bits",
        "gpcInfo": {},
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": true,
        "originalName": "Bacon Bits",
        "todoCount": 0
      },
      {
        "_id": "60244d0553b391000ec087c3",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "60244d0553b391000ec087c3",
          "createdAt": "2021-02-10T21:15:49.939Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-10T21:15:49.939Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T21:15:49.934Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "60244d0553b391000ec087c2",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "privateData": {},
        "name": "Bacon Thing",
        "gpcInfo": {},
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": true,
        "originalName": "Bacon Thing",
        "todoCount": 0
      },
      {
        "_id": "60274af553b391000ec0899d",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "60274af553b391000ec0899d",
          "createdAt": "2021-02-13T03:43:49.802Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-13T03:43:49.802Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-13T03:43:49.797Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "60274af553b391000ec0899c",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "privateData": {},
        "globalTradeItemNumber": "00012345678905",
        "brand": "Macaw",
        "name": "Fresh Produce",
        "description": "Fresh Produce",
        "tradeItemCountryOfOrigin": "HN",
        "gpcInfo": {
          "familyName": "Leaf Vegetables - Unprepared/Unprocessed (Fresh)",
          "className": "Head Lettuce",
          "brickName": "Head Lettuce (Butterhead)"
        },
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": true,
        "originalName": "Fresh Produce",
        "todoCount": 0
      },
      {
        "_id": "60286ceb53b391000ec089f9",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "60286ceb53b391000ec089f9",
          "createdAt": "2021-02-14T00:20:59.331Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "privateData": {},
        "globalTradeItemNumber": "00012345678905",
        "brand": "Macaw",
        "name": "Fresh Produce 1",
        "gpcInfo": {
          "familyName": "Leaf Vegetables - Unprepared/Unprocessed (Fresh)",
          "className": "Head Lettuce",
          "brickName": "Head Lettuce (Butterhead)"
        },
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": false,
        "todoCount": 0
      },
      {
        "_id": "602439d753b391000ec0878a",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602439d753b391000ec0878a",
          "createdAt": "2021-02-10T19:53:59.682Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Approved",
            "setAt": "2021-02-10T20:08:54.732Z",
            "setBy": {
              "_id": "601ac1ef53b391000e4a7608",
              "firstName": "",
              "lastName": ""
            }
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T19:53:59.677Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "602439d753b391000ec08789",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": true
        },
        "privateData": {},
        "noGtinRequired": true,
        "name": "Ham Hocks",
        "gpcInfo": {},
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": true,
        "originalName": "Ham Hocks",
        "todoCount": 0
      },
      {
        "_id": "602411ba53b391000ec0877a",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602411ba53b391000ec0877a",
          "createdAt": "2021-02-10T17:02:50.144Z",
          "createdBy": {
            "_id": "601af61b53b391000e4a7a3f",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-10T17:02:50.144Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T17:02:50.139Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "601afe3a53b391000e4a7a99",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "privateData": {},
        "noGtinRequired": true,
        "name": "Pork",
        "gpcInfo": {
          "familyName": "Bread/Bakery Products",
          "className": "Biscuits/Cookies",
          "brickName": "Biscuits/Cookies (Perishable)"
        },
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": false,
        "originalName": "Pork",
        "todoCount": 0
      },
      {
        "_id": "602589d253b391000ec08810",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602589d253b391000ec08810",
          "createdAt": "2021-02-11T19:47:30.709Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "60240f3653b391000ec0876a",
            "name": "Test Product Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-11T19:47:30.709Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-11T19:47:30.704Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "602589d253b391000ec0880f",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "privateData": {},
        "noGtinRequired": true,
        "brand": "123456789",
        "name": "Yummy Test Product",
        "gpcInfo": {},
        "isPackaged": false,
        "pluCode": "",
        "saleUnitUPC": "",
        "isArchived": false,
        "createdOnBehalf": true,
        "originalName": "Yummy Test Product",
        "todoCount": 0
      }
    ],
    "pageItemCount": 7,
    "totalItemCount": 7,
    "hasNextPage": false
  },
  '{{Host}}/v2/businesses/{{BusinessID}}/locations?sourceBusiness={{SupplierID}}&versionUpdated={{Date}}': {
    "pageItems": [
      {
        "_id": "6024144a53b391000ec08781",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Another Test Location",
        "type": "",
        "internalId": "",
        "globalLocationNumber": "",
        "noGlnRequired": true,
        "description": "",
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
            "longitude": 0,
            "warnings": [
              "A street address is required to geocode your address."
            ]
          }
        },
        "associatedCommunities": [],
        "supplyChainId": null,
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "6024144a53b391000ec08781",
          "createdAt": "2021-02-10T17:13:46.851Z",
          "createdBy": {
            "_id": "601af61b53b391000e4a7a3f",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareWithSuppliersOfCommunities": [],
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "6024113b53b391000ec08773",
            "name": "Test Location Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-10T17:13:46.851Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T17:13:46.846Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "6024144053b391000ec08780",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "timeZone": {
          "daylightSavingsOffset": 0,
          "utcOffset": 0,
          "timeZoneId": "",
          "timeZoneName": ""
        },
        "phone": "",
        "createdOnBehalf": false,
        "originalName": "Another Test Location",
        "privateData": {},
        "todoCount": 0
      },
      {
        "_id": "602411c953b391000ec0877d",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Lafayette Test",
        "type": "",
        "internalId": "",
        "globalLocationNumber": "",
        "noGlnRequired": true,
        "description": "",
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
            "longitude": 0,
            "warnings": [
              "A street address is required to geocode your address."
            ]
          }
        },
        "associatedCommunities": [],
        "supplyChainId": "601b007953b391000e4a7ade",
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "602411c953b391000ec0877d",
          "createdAt": "2021-02-10T17:03:05.6Z",
          "createdBy": {
            "_id": "601af61b53b391000e4a7a3f",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareWithSuppliersOfCommunities": [],
        "shareRecipients": [],
        "shareSource": {
          "shareSpecificAttributes": {},
          "type": {
            "_id": "6024113b53b391000ec08773",
            "name": "Test Location Type",
            "category": ""
          },
          "approvalInfo": {
            "status": "Awaiting Approval",
            "setAt": "2021-02-10T17:03:05.6Z",
            "setBy": null
          },
          "complianceInfo": {
            "status": "compliant",
            "setAt": "2021-02-10T17:03:05.595Z"
          },
          "hasCorrectiveActions": false,
          "incidentContacts": [],
          "community": {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          },
          "originalId": "601aff4053b391000e4a7ad3",
          "sourceBusiness": {
            "_id": "601af61b53b391000e4a7a3e",
            "name": "Centricity Test Account",
            "heroURL": "",
            "iconURL": "",
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
                "longitude": 0,
                "warnings": [
                  "A street address is required to geocode your address."
                ]
              }
            },
            "website": "",
            "email": "no@no.com",
            "phone": "5555555555"
          },
          "draftVersionId": null,
          "isDeleted": false,
          "deleteRejected": false,
          "liveVersion": false
        },
        "timeZone": {
          "daylightSavingsOffset": 0,
          "utcOffset": 0,
          "timeZoneId": "",
          "timeZoneName": ""
        },
        "phone": "",
        "createdOnBehalf": false,
        "originalName": "Lafayette Test",
        "privateData": {},
        "todoCount": 0
      },
      {
        "_id": "601b025d53b391000e4a7aff",
        "business": {
          "_id": "5b2a416f6923920001acd471",
          "name": "Smithfield Foods Inc.",
          "heroURL": "",
          "iconURL": "",
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
              "longitude": 0,
              "warnings": [
                "A street address is required to geocode your address."
              ]
            }
          },
          "website": "",
          "email": "implementation@foodlogiq.com",
          "phone": "999999999999"
        },
        "name": "Test Facility",
        "type": "",
        "internalId": "",
        "globalLocationNumber": "",
        "noGlnRequired": true,
        "description": "",
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
            "longitude": 0,
            "warnings": [
              "A street address is required to geocode your address."
            ]
          }
        },
        "associatedCommunities": [],
        "supplyChainId": null,
        "versionInfo": {
          "isCurrentVersion": true,
          "currentVersionId": "601b025d53b391000e4a7aff",
          "createdAt": "2021-02-03T20:06:53.198Z",
          "createdBy": {
            "_id": "601ac1ef53b391000e4a7608",
            "firstName": "",
            "lastName": ""
          }
        },
        "shareWithSuppliersOfCommunities": [
          {
            "_id": "5b2a418646cfcf0001d2319a",
            "name": "Smithfield Foods Blockchain",
            "iconURL": "",
            "replyToEmail": ""
          }
        ],
        "shareRecipients": [],
        "timeZone": {
          "daylightSavingsOffset": 0,
          "utcOffset": 0,
          "timeZoneId": "",
          "timeZoneName": ""
        },
        "phone": "",
        "createdOnBehalf": false,
        "privateData": {},
        "todoCount": 0
      }
    ],
    "pageItemCount": 3,
    "totalItemCount": 3,
    "hasNextPage": false
  }
}
