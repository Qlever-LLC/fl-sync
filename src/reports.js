const debug = require('debug');
const info = debug('oada-poll:info');
const error = debug('oada-poll:error');
const trace = debug('oada-poll:trace');
const warn = debug('oada-poll:warn');
const moment = require('moment');

async function interval(config) {
  config.reportsPath = `${config.basePath}/reports/${config.name}`

  // Ensure the base path
  let result = await config.connection.get({
    path: `${config.basePath}/reports`
  }).then(r => r.data)
  .catch(async (err) => {
    if (err.status !== 404) throw err;
    
    let reportId = await config.connection.post({
      path: `/resources`,
      data: {}
    }).then(r => r.headers['content-location'].replace(/^\//, ''))

    let reportsId = await config.connection.post({
      path: `/resources`,
      data: {
        [config.name]: {_id: reportId}
      }
    }).then(r => r.headers['content-location'].replace(/^\//, ''))

    await config.connection.put({
      path: `${config.basePath}/reports`,
      data: {
        [config.name]: {_id: reportId}
      }
    })
  })
  if (!result[config.name]) {
    let reportId = await config.connection.post({
      path: `/resources`,
      data: {}
    }).then(r => r.headers['content-location'].replace(/^\//, ''))

    await config.connection.put({
      path: `${config.basePath}/reports`,
      data: {
        [config.name]: {_id: reportId}
      }
    })
  }

  setInterval(() => { makeReport(config) }, config.interval)
  
}

async function makeReport(config) {
  let report = await config.reportFunc();

  // Put it in the day-index
  let date = moment().format('YYYY-MM-DD');
//  let str = ksuid.randomSync().string;
  await config.connection.put({
    path: `${config.reportsPath}/day-index/${date}`,
    data: report
  })
  let csv = csvjson.toCSV(report, {
    delimeter: ",", 
    wrap: false,
    headers: 'key'
  });
//  fs.writeFileSync(`${date}-${str}.csv`, report)

//    newItems.unshift(headers);
  newItems = csvjson.toCSV(newItems, {
    delimeter: ",", 
    wrap: false,
    headers: 'key'
  });
//  fs.writeFileSync(`${date}-${str}-new.csv`, newItems)

  if (config.emails) {
    await Promise.each(config.emails, async (email) => {
      await emailReport(config, email, file, date);
    })
  }
}

async function emailReport(config, email, file, date) {
  //1. Make the abalonemail config
  let data = {
    to: email,
    subject: `Trellis Report - Food Logiq Automation - Week of ${date}`,
    attachments: [/*{
      "content": "",
      "filename": `TrellisReport_FoodLogiqAutomation_${date}.csv`,
      "type": "text/csv"
    },*/ {
      "content": file,
      "filename": `TrellisReport_FoodLogiqAutomation_NewItems_${date}.csv`,
      "type": "text/csv"
    }]
  }

  //2. Post job to abalonemail service 
  let jobkey = await config.connection.post({
    path: `/resources`,
    contentType: `application/vnd.oada.job.1+json`,
    data,
  }).then(r => r.headers['content-location'].replace(/^\/resources\//, ''))

  await config.connection.put({
    path: `/bookmarks/services/abalonemail/jobs/${jobkey}`,
    data: {_id, _rev: 0}
  })
}

export {
  interval 
}
