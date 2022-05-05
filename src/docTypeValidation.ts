import moment from 'moment';
import debug from 'debug';
import type {TrellisCOI, FlObject} from './mirrorWatch'

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');

/**
 * validates documents that have not yet been approved
 * @param {*} trellisDoc 
 * @param {*} flMirror
 * @param {*} type 
 * @returns 
 */
export async function validateResult(trellisDoc: TrellisCOI, flMirror: FlObject, type: string) {
  info(`Validating pending doc [${trellisDoc._id}]`);
  let message;
  let status = true;
  try {
    switch (type) {
      case 'cois':
        let flExp = moment(flMirror.expirationDate).format('YYYY-MM-DD');
        let policiesExp : any[] = Object.values(trellisDoc.policies)
          .map((obj:any) => moment(obj.expire_date).utcOffset(0))
        if (!policiesExp || !policiesExp[0]) return;
        let minimumExp = policiesExp.reduce(
          (prevExp, currentExp) => prevExp < currentExp ? prevExp : currentExp,
          policiesExp[0]
        ).format('YYYY-MM-DD');
//        let trellisExp = moment(policies[0].expire_date).utcOffset(0).format('YYYY-MM-DD');
        let now = moment().utcOffset(0);

        if (flExp !== minimumExp) {
          message = `Expiration date submitted in Food Logiq (${flExp}) does not match the minimum expiration date found in the PDF document (${minimumExp}).`;
          status = false;
        }
        if (moment(flExp) <= now || minimumExp <= now) {
          message = `Document is already expired: ${flExp}`;
          status = false;
        }
        if (message) info(message);
        break;
      default:
        break;
    }
  } catch(err: any) {
    error('validateResult Errored: ', err);
    status = false;
    message = `validateResult Errored: ` + err.message;
  }
  return { message, status };
}//validateResult


module.exports = {
  validateResult,
}
