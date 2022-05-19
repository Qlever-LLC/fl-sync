const moment = require('moment');
const config = require('./config').default;
const CO_ID = config.get('foodlogiq.community.owner.id');
const TRELLIS_TOKEN = config.get('trellis.token');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');

async function generateReport() {
  let report = [];
  let newItems = [];
  let obj = {
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
      remedy: 'Indicate to supplier that they should not be attaching multiple PDFs for, e.g., multiple locations under a single Food LogiQ Document. Trellis can auto-reject these with this note.',
    },
    b3: {
      description: 'Failed to retrieve FL attachments',
      count: 0,
      items: [],
      remedy: 'Manually determine whether the attachments are available. If not, inform the supplier.'
    },
    b4: {
      description: 'Already approved by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b5: {
      description: 'Already rejected by non-trellis user prior to Trellis automation',
      count: 0,
      items: [],
      remedy: '',
    },
    b6: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
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
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
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
        remedy: 'Indicate to supplier that the PDF should contain a single CoI per Food LogiQ document. Trellis can auto-reject these with this note.',
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
        remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
      },
    },
    d3: {
      description: 'Other Target Result',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
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
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
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
        remedy: 'Auto-reject Food LogiQ Document and inform the suppler that the document is expired.',
      },
      f2b: {
        description: 'FL Document expirations do not match',
        count: 0,
        items: [],
        remedy: 'Auto-reject Food LogiQ Document and inform the suppler that the expiration dates do not match between the PDF contents and the date entered into FL.',
      },
    },
    f3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
    },
    g1: {
      description: 'FL assessment passes Trellis approval logic',
      count: 0,
      items: [],
    },
    g2: {
      description: 'FL assessment fails Trellis approval logic (not auto-rejected)',
      count: 0,
      items: [],
      remedy: 'Auto-reject the associated Food LogiQ Document and inform the suppler that the policy coverage amounts do not meet Smithfield requirements.',
    },
    g3: {
      description: 'Remainder of options',
      count: 0,
      items: [],
      remedy: 'Document requires manual evaluation. The Trellis team has flagged this document for their evaluation.',
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
  }

  let queue = await con.get({
    path: `/bookmarks/services/fl-sync/process-queue`
  }).then(r => r.data);
  let {data} = await con.get({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  let keys = Object.keys(data).filter(key => key.charAt(0) !== '_')
  let docApproved;

  let stuff = await Promise.map(keys, async bid => {
    let docs = await axios({
      method: 'get',
      url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents`,
      headers: {
        Authorization: `Bearer ${TRELLIS_TOKEN}`
      },
    }).then(r => r.data)
    .catch(err => {
      return
    })
  
    let k = Object.keys(docs || {}).filter(key => key.charAt(0) !== '_')

    await Promise.map(k, async key => {
      let doc = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}`,
        headers: {
          Authorization: `Bearer ${TRELLIS_TOKEN}`
        },
      })
      if (doc.status !== 200) return
      doc = doc.data;

      if (pointer.has(doc, `/food-logiq-mirror/shareSource/type/name`)) {
        if (doc['food-logiq-mirror'].shareSource.type.name === 'Certificate of Insurance') {
          obj.a.count++;
          obj.a.items.push({
            bid,
            key
          });
        } else return
      } else return

      if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'approved') {
        docApproved = true;
        obj.a.a1.count++;
        obj.a.a1.items.push({
          bid,
          key
        });
//        if (doc.shareSource.approvalInfo.setBy === userId) {
          //pushReportItem(report, doc, 'Success', '', '')
//        }
      } else if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'rejected') {
        docApproved = false;
        obj.a.a2.count++;
        obj.a.a2.items.push({
          bid,
          key
        });
      } else if (pointer.get(doc, `/food-logiq-mirror/shareSource/approvalInfo/status`) === 'awaiting-review') {
        obj.a.a4.count++;
        obj.a.a4.items.push({
          bid,
          key
        });
      } else {
        obj.a.a3.count++;
        obj.a.a3.items.push({
          bid,
          key
        });
      }

      //b.
      let result;
      let retries = 0;
      let fail;

      while (!result && retries++ < 5) {
        await Promise.delay(2000);
        result = await axios({
          method: 'get',
          headers: {Authorization: FL_TOKEN},
          url: `${FL_DOMAIN}/v2/businesses/${CO_ID}/documents/${key}/attachments`,
        }).catch((err) => {
          if (retries === 5) {
            console.log(err);
            console.log(doc);
            console.log('failed 5 times', bid, key);
            fail = true;
          }
        })
      }
      if (fail === true) {
        obj.b3.count++;
        obj.b3.items.push({
          bid,
          key
        });
        pushReportItem(report, doc, 'Fail', obj.b3.description, obj.b3.remedy, newItems)
        return;
      }

      let meta = await axios({
        method: 'get',
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta`,
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
      })
      if (meta.status !== 200) return
      meta = meta.data;

      if (pointer.has(meta, '/services/fl-sync')) {
        let metadata = pointer.get(meta, `/services/fl-sync`);
        if (metadata.valid === false && metadata.message.includes('Multiple')) {
          obj.b2.count++;
          obj.b2.items.push({
            bid,
            key
          });
          pushReportItem(report, doc, 'Fail', obj.b2.description, obj.b3.remedy, newItems)
          return;
        }
      }
      
      //b.
      let ref;
      if (pointer.has(meta, '/vdoc/pdf')) {
        let vdoc = Object.keys(meta.vdoc.pdf)[0]
        ref = meta.vdoc.pdf[vdoc]._id;
        obj.b1.count++;
        obj.b1.items.push({
          bid,
          key
        });
      } else {
        if (docApproved) {
          obj.b4.count++;
          obj.b4.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b4.description, obj.b4.remedy, newItems)
        } else if (docApproved === false) {
          obj.b5.count++;
          obj.b5.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b5.description, obj.b5.remedy, newItems)
        } else {
          obj.b6.count++;
          obj.b6.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.b6.description, obj.b6.remedy, newItems)
        }
        return
      }

      //c.
      let tpdoc = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/${ref}/_meta`
      })
      if (tpdoc.status !== 200) return;
      tpdoc = tpdoc.data

      let job;
      if (pointer.has(tpdoc, `/services/target/jobs`)) {
        job = Object.keys(tpdoc.services.target.jobs)[0];
        obj.c1.count++;
        obj.c1.items.push({
          bid,
          key
        });
      } else {
        obj.c2.count++;
        obj.c2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.c2.description, obj.c2.remedy, newItems)
        return;
      }

      //d.
      //Check validation status
      let jobdata = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/resources/${job}`,
      }).then(r => r.data);

      if (jobdata.status === "success") {
        obj.d1.count++;
        obj.d1.items.push({
          bid,
          key
        });
      } else if (jobdata.status === "failure") {
        obj.d2.count++;
        obj.d2.items.push({
          bid,
          key
        });


        let ev = Object.values(jobdata.updates).every(({information}) => {
          if (information && information.includes('recognized')) {
            obj.d2.d2c.count++;
            obj.d2.d2c.items.push({
              bid,
              key,
              job
            });
            pushReportItem(report, doc, 'Fail', obj.d2.d2c.description, obj.d2.d2c.remedy, newItems)
            return false;
          } else if (information && information.includes('multi-COI')) {
            obj.d2.d2b.count++;
            obj.d2.d2b.items.push({
              bid,
              key,
              job
            });
            pushReportItem(report, doc, 'Fail', obj.d2.d2b.description, obj.d2.d2b.remedy, newItems)
            return false;
          } else if (information && information.includes('OCR')) {
            obj.d2.d2a.count++;
            obj.d2.d2a.items.push({
              bid,
              key,
              job
            })
            pushReportItem(report, doc, 'Fail', obj.d2.d2a.description, obj.d2.d2a.remedy, newItems)
            return false;
          } else if (information && information.includes('Valiadation')) {
            obj.d2.d2d.count++;
            obj.d2.d2d.items.push({
              bid,
              key,
              job
            })
            pushReportItem(report, doc, 'Fail', obj.d2.d2d.description, obj.d2.d2d.remedy, newItems)
            return false;
          } else return true;
        })

        if (ev === true) {
          obj.d2.d2e.count++;
          obj.d2.d2e.items.push({
            bid,
            key,
            job
          })
          pushReportItem(report, doc, 'Fail', obj.d2.d2e.description, obj.d2.d2e.remedy, newItems)
        }
        return;
      } else {
        obj.d3.count++;
        obj.d3.items.push({
          bid,
          key
        });
        pushReportItem(report, doc, 'Fail', obj.d3.description, obj.d3.remedy, newItems)
        return
      }

      //e.
      let coi;
      if (pointer.has(tpdoc, `/vdoc/cois`)) {
        coi = Object.keys(tpdoc.vdoc.cois)[0];
        obj.e1.count++;
        obj.e1.items.push({
          bid,
          key
        });
      } else {
        obj.e2.count++;
        obj.e2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.e2.description, obj.e2.remedy, newItems)
        return;
      }

      //f.
      //Check validation status
      let v = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/resources/${coi}/_meta/services/fl-sync`,
      }).then(r => r.data)
      .catch(err => {})
      if (v === undefined || v.valid === false) {
        obj.f3.count++;
        obj.f3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.f3.description, obj.f3.remedy, newItems)
        return;
      }

      if (v.valid.status === true) {
        obj.f1.count++;
        obj.f1.items.push({
          bid,
          key
        })
      } else if (v.valid.status === false) {
        obj.f2.count++;
        obj.f2.items.push({
          bid,
          key
        })
        if (v.valid.message.includes('expired')) {
          obj.f2.f2a.count++;
          obj.f2.f2a.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.f2.f2a.description, obj.f2.f2a.remedy, newItems)
        } else if (v.valid.message.includes('match')) {
          obj.f2.f2b.count++;
          obj.f2.f2b.items.push({
            bid,
            key
          })
          pushReportItem(report, doc, 'Fail', obj.f2.f2b.description, obj.f2.f2b.remedy, newItems)
        } 
        return
      } else {
        obj.f3.count++;
        obj.f3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.f3.description, obj.f3.remedy, newItems)
        return;
      }

      //g & h.
      let assess = await axios({
        method: 'get',
        headers: {
          Authorization: `Bearer ${TOKEN}`
        },
        url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/documents/${key}/_meta/services/fl-sync/assessments/${ASSESSMENT_TEMPLATE_ID}`,
      }).then(r => r.data)
      .catch(err => {})
      if (assess === undefined) {
        obj.g3.count++;
        obj.g3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g3.description, obj.g3.remedy, newItems)
        return;
      }
      let {id, approval} = assess;

      if (approval === true) {
        obj.g1.count++;
        obj.g1.items.push({
          bid,
          key
        })
      } else if (approval === false) {
        obj.g2.count++;
        obj.g2.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g2.description, obj.g2.remedy, newItems)
        return;
      } else {
        obj.g3.count++;
        obj.g3.items.push({
          bid,
          key
        })
        pushReportItem(report, doc, 'Fail', obj.g3.description, obj.g3.remedy, newItems)
        return;
      }

      //A.
      if (id) {
        let as = await axios({
          method: 'get',
          url: `https://${DOMAIN}/bookmarks/services/fl-sync/businesses/${bid}/assessments/${id}`,
          headers: {
            Authorization: `Bearer ${TOKEN}`
          },
        })
        if (as.status !== 200) return
        as = as.data['food-logiq-mirror'];
        if (pointer.has(as, `/assessmentTemplate/name`)) {
          if (pointer.get(as, `/assessmentTemplate/name`) === ASSESSMENT_TEMPLATE_NAME) {
            obj.A1.count++;
            obj.A1.items.push({
              bid,
              key
            });
          } else return;
        } else return;
        if (as.creation.userId === userId) {
          obj.A1.A1a.count++;
          obj.A1.A1a.items.push({
            bid,
            key
          });
        } else {
          obj.A1.A1b.count++;
          obj.A1.A1b.items.push({
            bid,
            key
          });
        }

        //B.
        if (as.state === 'Approved') {
          obj.B1.count++;
          obj.B1.items.push({
            bid,
            key
          });
        } else if (as.state === 'Rejected') {
          obj.B2.count++;
          obj.B2.items.push({
            bid,
            key
          });
        } else if (as.state === 'Submitted') {
          obj.B3.count++;
          obj.B3.items.push({
            bid,
            key
          });
        } else if (as.state === 'In Progress') {
          obj.B4.count++;
          obj.B4.items.push({
            bid,
            key
          });
        } else if (as.state === 'Not Started') {
          obj.B5.count++;
          obj.B5.items.push({
            bid,
            key
          });
        } else {
          obj.B6.count++;
          obj.B6.items.push({
            bid,
            key,
            state: as.state
          });
        }
        pushReportItem(report, doc, 'Success', '', '', newItems);
      }
    }, {concurrency: 10})
  }, {concurrency: 10})
}

function pushReportItem(report, item, passFail, reason, remedy, newItems) {
  let id = item['food-logiq-mirror']._id;

  // Determine if the doc was within the past 24 hours
  let docTime = moment(item['food-logiq-mirror'].versionInfo.createdAt);
  let offset = LOCAL ? 8 : 12;
  let yday = moment().subtract(24, 'hours')

  let entry = {
    'FL Document Name': item['food-logiq-mirror'].name,
    'Supplier': item['food-logiq-mirror'].shareSource.sourceBusiness.name,
    'Date': docTime.subtract(offset, 'hours').format(),
    'Food Logiq Link': `https://connect.foodlogiq.com/businesses/${CO_ID}/documents/detail/${id}`,
    'Trellis Success/Fail': passFail,
    'Fail Reason': reason,
    'Suggested Remedy': remedy
  }
  report.push(entry)
  if (docTime > yday) {
    newItems.push(entry);
  }
}

export {
  generateReport,
}
