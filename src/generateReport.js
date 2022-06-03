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
const moment = require('moment');
const config = require('./config').default;
const CO_ID = config.get('foodlogiq.community.owner.id');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');

async function generateReport() {
  const report = [];
  const newItems = [];
  const object = {
    a: {
      description: 'Mirror created',
      count: 0,
      items: [],
      a1: {
        description: 'Document approved',
        count: 0,
        items: [],
      },
      a2: {
        description: 'Document rejected',
        count: 0,
        items: [],
      },
      a3: {
        description: 'Other doc statuses',
        count: 0,
        items: [],
      },
      a4: {
        description: 'Document awaiting-review',
        count: 0,
        items: [],
      },
    },
    b1: {
      description: 'Trellis doc created',
      count: 0,
      items: [],
    },
    b2: {
      description: 'FL Document has multiple PDFs attached',
      count: 0,
      items: [],
      remedy:
        'Indicate to supplier that they should not be attaching multiple PDFs for, e.g., multiple locations under a single Food LogiQ Document. Trellis can auto-reject these with this note.',
    },
    b3: {
      description: 'Failed to retrieve FL attachments',
      count: 0,
      items: [],
      remedy:
        'Manually determine whether the attachments are available. If not, inform the supplier.',
    },
    b4: {
      description:
        'Already approved by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b5: {
      description:
        'Already rejected by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b6: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    c1: {
      description: 'Job created',
      count: 0,
      items: [],
    },
    c2: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    d1: {
      description: 'Target Success',
      count: 0,
      items: [],
    },
    d2: {
      description: 'Target Failure',
      count: 0,
      items: [],
      d2a: {
        description: 'FL Document requires OCR',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2b: {
        description: 'FL Document has multiple CoIs within the PDF file',
        count: 0,
        items: [],
        remedy:
          'Indicate to supplier that the PDF should contain a single CoI per Food LogiQ document. Trellis can auto-reject these with this note.',
      },
      d2c: {
        description: 'FL Document PDF format unrecognized',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2d: {
        description: 'Target Validation failure',
        count: 0,
        items: [],
        remedy: 'Document requires manual evaluation.',
      },
      d2e: {
        description: 'Other target failure modes',
        count: 0,
        items: [],
        remedy:
          'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
      },
    },
    d3: {
      description: 'Other Target Result',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    e1: {
      description: 'COI data extracted',
      count: 0,
      items: [],
    },
    e2: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    f1: {
      description: 'FL Document extracted JSON passes Trellis logic',
      count: 0,
      items: [],
    },
    f2: {
      description: 'FL Document extracted JSON fails Trellis logic',
      count: 0,
      items: [],
      f2a: {
        description: 'FL Document expired',
        count: 0,
        items: [],
        remedy:
          'Auto-reject Food LogiQ Document and inform the suppler that the document is expired.',
      },
      f2b: {
        description: 'FL Document expirations do not match',
        count: 0,
        items: [],
        remedy:
          'Auto-reject Food LogiQ Document and inform the suppler that the expiration dates do not match between the PDF contents and the date entered into FL.',
      },
    },
    f3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    g1: {
      description: 'FL assessment passes Trellis approval logic',
      count: 0,
      items: [],
    },
    g2: {
      description:
        'FL assessment fails Trellis approval logic (not auto-rejected)',
      count: 0,
      items: [],
      remedy:
        'Auto-reject the associated Food LogiQ Document and inform the suppler that the policy coverage amounts do not meet Smithfield requirements.',
    },
    g3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy:
        'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    A1: {
      description: 'Assessments mirrored',
      count: 0,
      items: [],
      A1a: {
        description: 'Created by Trellis',
        count: 0,
        items: [],
      },
      A1b: {
        description: 'Created by someone else',
        count: 0,
        items: [],
      },
    },
    B1: {
      description: 'Assessment state is Approved',
      count: 0,
      items: [],
    },
    B2: {
      description: 'Assessment state is Rejected',
      count: 0,
      items: [],
    },
    B3: {
      description: 'Assessment state is Submitted',
      count: 0,
      items: [],
    },
    B4: {
      description: 'Assessment state is In Progress',
      count: 0,
      items: [],
    },
    B5: {
      description: 'Assessment state is Not Started',
      count: 0,
      items: [],
    },
    B6: {
      description: 'Other assessment states',
      count: 0,
      items: [],
    },
  };

  const queue = await con
    .get({
      path: `/bookmarks/services/fl-sync/process-queue`,
    })
    .then((r) => r.data);
  const { data } = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`,
  });
  const keys = Object.keys(data).filter((key) => key.charAt(0) !== '_');
  let documentApproved;

  const stuff = await Promise.map(
    keys,
    async (bid) => {
      const docs = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents`,
        headers: {
          Authorization: `Bearer ${TRELLIS_TOKEN}`,
        },
      })
        .then((r) => r.data)
        .catch((error) => {});
      const k = Object.keys(docs || {}).filter((key) => key.charAt(0) !== '_');

      await Promise.map(
        k,
        async (key) => {
          let document = await axios({
            method: 'get',
            url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
            headers: {
              Authorization: `Bearer ${TRELLIS_TOKEN}`,
            },
          });
          if (document.status !== 200) return;
          document = document.data;

          if (
            pointer.has(document, `/food-logiq-mirror/shareSource/type/name`)
          ) {
            if (
              document['food-logiq-mirror'].shareSource.type.name ===
              'Certificate of Insurance'
            ) {
              object.a.count++;
              object.a.items.push({
                bid,
                key,
              });
            } else return;
          } else return;

          if (
            pointer.get(
              document,
              `/food-logiq-mirror/shareSource/approvalInfo/status`
            ) === 'approved'
          ) {
            documentApproved = true;
            object.a.a1.count++;
            object.a.a1.items.push({
              bid,
              key,
            });
            //        If (doc.shareSource.approvalInfo.setBy === userId) {
            // pushReportItem(report, doc, 'Success', '', '')
            //        }
          } else if (
            pointer.get(
              document,
              `/food-logiq-mirror/shareSource/approvalInfo/status`
            ) === 'rejected'
          ) {
            documentApproved = false;
            object.a.a2.count++;
            object.a.a2.items.push({
              bid,
              key,
            });
          } else if (
            pointer.get(
              document,
              `/food-logiq-mirror/shareSource/approvalInfo/status`
            ) === 'awaiting-review'
          ) {
            object.a.a4.count++;
            object.a.a4.items.push({
              bid,
              key,
            });
          } else {
            object.a.a3.count++;
            object.a.a3.items.push({
              bid,
              key,
            });
          }

          // B.
          let result;
          let retries = 0;
          let fail;

          while (!result && retries++ < 5) {
            await Promise.delay(2000);
            result = await axios({
              method: 'get',
              headers: { Authorization: FL_TOKEN },
              url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${key}/attachments`,
            }).catch((error) => {
              if (retries === 5) {
                console.log(error);
                console.log(document);
                console.log('failed 5 times', bid, key);
                fail = true;
              }
            });
          }

          if (fail === true) {
            object.b3.count++;
            object.b3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.b3.description,
              object.b3.remedy,
              newItems
            );
            return;
          }

          let meta = await axios({
            method: 'get',
            url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`,
            headers: {
              Authorization: `Bearer ${TOKEN}`,
            },
          });
          if (meta.status !== 200) return;
          meta = meta.data;

          if (pointer.has(meta, '/services/fl-sync')) {
            const metadata = pointer.get(meta, `/services/fl-sync`);
            if (
              metadata.valid === false &&
              metadata.message.includes('Multiple')
            ) {
              object.b2.count++;
              object.b2.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.b2.description,
                object.b3.remedy,
                newItems
              );
              return;
            }
          }

          // B.
          let reference;
          if (pointer.has(meta, '/vdoc/pdf')) {
            const vdoc = Object.keys(meta.vdoc.pdf)[0];
            reference = meta.vdoc.pdf[vdoc]._id;
            object.b1.count++;
            object.b1.items.push({
              bid,
              key,
            });
          } else {
            if (documentApproved) {
              object.b4.count++;
              object.b4.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.b4.description,
                object.b4.remedy,
                newItems
              );
            } else if (documentApproved === false) {
              object.b5.count++;
              object.b5.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.b5.description,
                object.b5.remedy,
                newItems
              );
            } else {
              object.b6.count++;
              object.b6.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.b6.description,
                object.b6.remedy,
                newItems
              );
            }

            return;
          }

          // C.
          let tpdoc = await axios({
            method: 'get',
            headers: {
              Authorization: `Bearer ${TOKEN}`,
            },
            url: `https://${DOMAIN}/${reference}/_meta`,
          });
          if (tpdoc.status !== 200) return;
          tpdoc = tpdoc.data;

          let job;
          if (pointer.has(tpdoc, `/services/target/jobs`)) {
            job = Object.keys(tpdoc.services.target.jobs)[0];
            object.c1.count++;
            object.c1.items.push({
              bid,
              key,
            });
          } else {
            object.c2.count++;
            object.c2.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.c2.description,
              object.c2.remedy,
              newItems
            );
            return;
          }

          // D.
          // Check validation status
          const jobdata = await axios({
            method: 'get',
            headers: {
              Authorization: `Bearer ${TOKEN}`,
            },
            url: `https://${DOMAIN}/resources/${job}`,
          }).then((r) => r.data);

          if (jobdata.status === 'success') {
            object.d1.count++;
            object.d1.items.push({
              bid,
              key,
            });
          } else if (jobdata.status === 'failure') {
            object.d2.count++;
            object.d2.items.push({
              bid,
              key,
            });

            const event = Object.values(jobdata.updates).every(
              ({ information }) => {
                if (information && information.includes('recognized')) {
                  object.d2.d2c.count++;
                  object.d2.d2c.items.push({
                    bid,
                    key,
                    job,
                  });
                  pushReportItem(
                    report,
                    document,
                    'Fail',
                    object.d2.d2c.description,
                    object.d2.d2c.remedy,
                    newItems
                  );
                  return false;
                } if (information && information.includes('multi-COI')) {
                  object.d2.d2b.count++;
                  object.d2.d2b.items.push({
                    bid,
                    key,
                    job,
                  });
                  pushReportItem(
                    report,
                    document,
                    'Fail',
                    object.d2.d2b.description,
                    object.d2.d2b.remedy,
                    newItems
                  );
                  return false;
                } if (information && information.includes('OCR')) {
                  object.d2.d2a.count++;
                  object.d2.d2a.items.push({
                    bid,
                    key,
                    job,
                  });
                  pushReportItem(
                    report,
                    document,
                    'Fail',
                    object.d2.d2a.description,
                    object.d2.d2a.remedy,
                    newItems
                  );
                  return false;
                } if (information && information.includes('Valiadation')) {
                  object.d2.d2d.count++;
                  object.d2.d2d.items.push({
                    bid,
                    key,
                    job,
                  });
                  pushReportItem(
                    report,
                    document,
                    'Fail',
                    object.d2.d2d.description,
                    object.d2.d2d.remedy,
                    newItems
                  );
                  return false;
                } else return true;
              }
            );

            if (event === true) {
              object.d2.d2e.count++;
              object.d2.d2e.items.push({
                bid,
                key,
                job,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.d2.d2e.description,
                object.d2.d2e.remedy,
                newItems
              );
            }

            return;
          } else {
            object.d3.count++;
            object.d3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.d3.description,
              object.d3.remedy,
              newItems
            );
            return;
          }

          // E.
          let coi;
          if (pointer.has(tpdoc, `/vdoc/cois`)) {
            coi = Object.keys(tpdoc.vdoc.cois)[0];
            object.e1.count++;
            object.e1.items.push({
              bid,
              key,
            });
          } else {
            object.e2.count++;
            object.e2.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.e2.description,
              object.e2.remedy,
              newItems
            );
            return;
          }

          // F.
          // Check validation status
          const v = await axios({
            method: 'get',
            headers: {
              Authorization: `Bearer ${TOKEN}`,
            },
            url: `https://${DOMAIN}/resources/${coi}/_meta/services/fl-sync`,
          })
            .then((r) => r.data)
            .catch((error) => {});
          if (v === undefined || v.valid === false) {
            object.f3.count++;
            object.f3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.f3.description,
              object.f3.remedy,
              newItems
            );
            return;
          }

          if (v.valid.status === true) {
            object.f1.count++;
            object.f1.items.push({
              bid,
              key,
            });
          } else if (v.valid.status === false) {
            object.f2.count++;
            object.f2.items.push({
              bid,
              key,
            });
            if (v.valid.message.includes('expired')) {
              object.f2.f2a.count++;
              object.f2.f2a.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.f2.f2a.description,
                object.f2.f2a.remedy,
                newItems
              );
            } else if (v.valid.message.includes('match')) {
              object.f2.f2b.count++;
              object.f2.f2b.items.push({
                bid,
                key,
              });
              pushReportItem(
                report,
                document,
                'Fail',
                object.f2.f2b.description,
                object.f2.f2b.remedy,
                newItems
              );
            }

            return;
          } else {
            object.f3.count++;
            object.f3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.f3.description,
              object.f3.remedy,
              newItems
            );
            return;
          }

          // G & h.
          const assess = await axios({
            method: 'get',
            headers: {
              Authorization: `Bearer ${TOKEN}`,
            },
            url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
          })
            .then((r) => r.data)
            .catch((error) => {});
          if (assess === undefined) {
            object.g3.count++;
            object.g3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.g3.description,
              object.g3.remedy,
              newItems
            );
            return;
          }

          const { id, approval } = assess;

          if (approval === true) {
            object.g1.count++;
            object.g1.items.push({
              bid,
              key,
            });
          } else if (approval === false) {
            object.g2.count++;
            object.g2.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.g2.description,
              object.g2.remedy,
              newItems
            );
            return;
          } else {
            object.g3.count++;
            object.g3.items.push({
              bid,
              key,
            });
            pushReportItem(
              report,
              document,
              'Fail',
              object.g3.description,
              object.g3.remedy,
              newItems
            );
            return;
          }

          // A.
          if (id) {
            let as = await axios({
              method: 'get',
              url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/assessments/${id}`,
              headers: {
                Authorization: `Bearer ${TOKEN}`,
              },
            });
            if (as.status !== 200) return;
            as = as.data['food-logiq-mirror'];
            if (pointer.has(as, `/assessmentTemplate/name`)) {
              if (
                pointer.get(as, `/assessmentTemplate/name`) ===
                ASSESSMENT_TEMPLATE_NAME
              ) {
                object.A1.count++;
                object.A1.items.push({
                  bid,
                  key,
                });
              } else return;
            } else return;
            if (as.creation.userId === userId) {
              object.A1.A1a.count++;
              object.A1.A1a.items.push({
                bid,
                key,
              });
            } else {
              object.A1.A1b.count++;
              object.A1.A1b.items.push({
                bid,
                key,
              });
            }

            // B.
            switch (as.state) {
              case 'Approved': {
                object.B1.count++;
                object.B1.items.push({
                  bid,
                  key,
                });

                break;
              }

              case 'Rejected': {
                object.B2.count++;
                object.B2.items.push({
                  bid,
                  key,
                });

                break;
              }

              case 'Submitted': {
                object.B3.count++;
                object.B3.items.push({
                  bid,
                  key,
                });

                break;
              }

              case 'In Progress': {
                object.B4.count++;
                object.B4.items.push({
                  bid,
                  key,
                });

                break;
              }

              case 'Not Started': {
                object.B5.count++;
                object.B5.items.push({
                  bid,
                  key,
                });

                break;
              }

              default: {
                object.B6.count++;
                object.B6.items.push({
                  bid,
                  key,
                  state: as.state,
                });
              }
            }

            pushReportItem(report, document, 'Success', '', '', newItems);
          }
        },
        { concurrency: 10 }
      );
    },
    { concurrency: 10 }
  );
}

function pushReportItem(report, item, passFail, reason, remedy, newItems) {
  const id = item['food-logiq-mirror']._id;

  // Determine if the doc was within the past 24 hours
  const documentTime = moment(item['food-logiq-mirror'].versionInfo.createdAt);
  const offset = LOCAL ? 8 : 12;
  const yday = moment().subtract(24, 'hours');

  const entry = {
    'FL Document Name': item['food-logiq-mirror'].name,
    'Supplier': item['food-logiq-mirror'].shareSource.sourceBusiness.name,
    'Date': documentTime.subtract(offset, 'hours').format(),
    'Food Logiq Link': `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${id}`,
    'Trellis Success/Fail': passFail,
    'Fail Reason': reason,
    'Suggested Remedy': remedy,
  };
  report.push(entry);
  if (documentTime > yday) {
    newItems.push(entry);
  }
}

export { generateReport };
