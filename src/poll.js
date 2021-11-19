const debug = require('debug');
const info = debug('oada-poll:info');
const error = debug('oada-poll:error');
const trace = debug('oada-poll:trace');
const warn = debug('oada-poll:warn');
const moment = require('moment');

/*
export interface PollConfig {
  name: string;
  basePath: string;
  interval: number;
  checkInterval?: number;
}
*/

let CURRENTLY_POLLING = false;
let lastPoll;

// Manual poll: pull next set of documents now
// Fresh poll: pull all documents from the beginning of time
async function checkTime(config) {
  let freshPoll = config.freshPoll;
  let manualPoll = config.manualPoll;
  info('Checking to determine whether to poll.');
  if (CURRENTLY_POLLING && config.multiPoll) {
    info('Already polling. Skipping this poll loop');
  } else {
    info('Beginning poll check...');
    console.log(config);
    _setCurrentlyPolling(true);

    let manualPoll;

    //Get last poll date
    try {
      console.log(config.path);
      let response = await config.connection.get({ path: config.path })

      manualPoll = response.data.manualPoll || manualPoll;

      //info(`lastPoll was: ${response.data.lastPoll}`);
      if (!freshPoll && response.data.lastPoll) lastPoll = moment(response.data.lastPoll).utc();
    } catch (err) {
      if (err.status === 404) {
        info(`lastPoll undefined. Making an initial poll.`);
      } else {
        error('An error occurred while fetching lastPoll');
        _setCurrentlyPolling(false);
        throw err;
      }
    }

    let current = moment().utc();
    let nextUpdate = (lastPoll ? lastPoll.clone() : current.clone()).add(config.interval)
    info({
      current,
      nextUpdate,
      lastPoll,
      freshPoll,
      manualPoll
    }, 'Poll factors')



//    info(`currentTime is ${current}, nextUpdate is ${nextUpdate}. ${!lastPoll ? 'lastPoll was undefined. Polling.' : current > nextUpdate ? 'Polling' : 'Not Polling'}`);
    if (manualPoll) info(`Manual poll detected. Getting changes since last poll`);
    if (!lastPoll || current > nextUpdate || manualPoll) {
      try {
        info('Polling now...')
        await config.pollFunc();
      } catch (err) {
        error('An error occurred while polling');
        error(err);
        _setCurrentlyPolling(false);
        throw err;
      }
      // 3. Success. Now store update the last checked time.
      current = current.format();
      info(`Storing new "lastPoll" value: ${current}. Next poll will occur after this time.`);

      if (manualPoll) {
        info(`Resetting manualPoll to false`)
        await config.connection.put({
          path: config.path,
          tree,
          data: { manualPoll: false }
        })
      }

      _setCurrentlyPolling(false);
      return config.connection.put({
        path: config.path,
        tree,
        data: { lastPoll: current }
      })
    }
    _setCurrentlyPolling(false);
  }
}//checkTime

async function poll(config) {
  
  if (!config.basePath) {
    throw new Error('config.basePath is required');
  }
  config.path = `${config.basePath}/_meta/oada-poll/${config.name}`
  console.log('path', config.path);
  config.checkInterval = config.checkInterval || config.interval / 2;
  
  info(`Initiating poll [${config.name}]. Will poll every ${config.interval / 1000}s. Checking OADA if its time to poll every ${config.checkInterval / 1000}s.`);
  console.log('CONfIG', config);
  if (config.pollOnStartup) {
    await checkTime(config);
  }
  setInterval(() => {checkTime(config)}, config.checkInterval);
}


function _setCurrentlyPolling(value) {
  CURRENTLY_POLLING = value;
}

module.exports = {
  poll
}
